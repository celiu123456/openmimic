import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ClaimSchema,
  ConsentLevelSchema,
  CorpusItemSchema,
  DivergenceSchema,
  EpisodeSchema,
  StyleSampleSchema,
  type Claim,
  type ConsentLevel,
  type CorpusItem,
  type CourtReport,
  type Divergence,
  type Episode,
  type StyleSample,
  type Subject,
} from '@openmimic/shared';
import { type Store } from '@openmimic/kernel';

/**
 * The `.persona` single-file package: one subject's adjudicated persona,
 * portable between OpenMimic installs without shipping the raw testimony it
 * was built from.
 *
 * The package is deliberately *derived* data. Claims are the court's
 * synthesised conclusions, style samples are limited to `quotable` witnesses,
 * and witnesses travel as metadata plus testimony **ids only** — never an
 * answer. The only raw words that leave the building are the `quotable` style
 * samples, which is exactly what those witnesses authorized.
 */

export const PERSONA_FORMAT = 'openmimic.persona' as const;
export const PERSONA_VERSION = 2 as const;
export const PERSONA_NOTICE = '原始证言不随包分发;本包内容已按证言人授权过滤' as const;

/**
 * The `freeText` written on every import receipt.
 *
 * A receipt is a customs declaration, not evidence: it stores no answers at
 * all (`answers: []`) and exists only so an imported claim has a real ledger
 * entry to point its `evidence` at. The no-anchor iron law stays intact — the
 * claim is anchored, but the anchor is honest about being a placeholder.
 */
export const IMPORT_RECEIPT_TEXT = '导入自 .persona 包,原始证言未随包分发' as const;

/** Appended to the display name so two subjects are never visually confused. */
export const IMPORT_SUBJECT_SUFFIX = '(导入)' as const;

/** One witness as shipped in a package: metadata + testimony ids, no answers. */
export interface PersonaWitnessEntry {
  relation: string;
  stance?: string;
  consentLevel: ConsentLevel;
  /**
   * Ids of the testimony entries this witness contributed.
   *
   * Only ids: this is the map import needs to anchor each claim's `evidence`
   * to the right import receipt. It contains no words.
   */
  evidenceIds: string[];
}

/** The full `.persona` payload. */
export interface PersonaPackage {
  format: typeof PERSONA_FORMAT;
  version: typeof PERSONA_VERSION;
  subject: { displayName: string };
  /** Surviving claims (qualified ones are surviving with qualifiers). */
  claims: Claim[];
  /**
   * v2: style samples come from corpus items (subject's own words).
   * v1 compatibility: old packages carry witness-derived samples here;
   * on import they are treated as episodes (evidence), not style.
   */
  styleSamples: StyleSample[];
  report: (CourtReport & { imported?: boolean }) | null;
  witnesses: PersonaWitnessEntry[];
  /** v2: quotable episodes. */
  episodes?: Episode[];
  /** v2: divergence map. */
  divergences?: Divergence[];
  /** v2: subject's own words (corpus). */
  corpus?: CorpusItem[];
  exportedAt: string;
  notice: string;
}

/** Validation schema for an incoming package; accepts both v1 and v2. */
export const PersonaPackageSchema = z.object({
  format: z.literal(PERSONA_FORMAT),
  version: z.union([z.literal(1), z.literal(2)]),
  subject: z.object({ displayName: z.string().min(1) }),
  claims: z.array(ClaimSchema),
  styleSamples: z.array(StyleSampleSchema),
  report: z.record(z.unknown()).nullable().optional(),
  witnesses: z.array(
    z.object({
      relation: z.string().min(1),
      stance: z.string().min(1).optional(),
      consentLevel: ConsentLevelSchema,
      evidenceIds: z.array(z.string().min(1)).default([]),
    }),
  ),
  episodes: z.array(EpisodeSchema).optional(),
  divergences: z.array(DivergenceSchema).optional(),
  corpus: z.array(CorpusItemSchema).optional(),
  exportedAt: z.string().min(1),
  notice: z.string().min(1),
});

export interface BuildPersonaPackageOptions {
  /** Injectable clock, for deterministic tests. */
  now?: () => Date;
}

/** Compute a health report when the subject has never been to court. */
function computeReport(claims: readonly Claim[]): CourtReport {
  const surviving = claims.filter(
    (claim) => claim.status === 'surviving' && (claim.qualifiers?.length ?? 0) === 0,
  ).length;
  const qualified = claims.filter(
    (claim) => claim.status === 'surviving' && (claim.qualifiers?.length ?? 0) > 0,
  ).length;
  const rejected = claims.filter((claim) => claim.status === 'retired').length;
  const withEvidence = claims.filter((claim) => claim.evidence.length > 0).length;
  return {
    totalClaims: claims.length,
    surviving,
    qualified,
    rejected,
    challengeCount: 0,
    evidenceCoverage: claims.length === 0 ? 1 : withEvidence / claims.length,
  };
}

/**
 * A subject is "imported" when it has claims but no testimony that carries any
 * answer — i.e. every ledger entry is an import receipt. That is a structural
 * fact, not a name check, so it survives a renamed package.
 */
export function isImportedSubject(store: Store, subjectId: string): boolean {
  if (store.listClaimsBySubject(subjectId).length === 0) return false;
  const testimonies = store.listBySubject(subjectId);
  if (testimonies.length === 0) return false;
  return testimonies.every((testimony) => testimony.answers.length === 0);
}

/**
 * Build the export payload for one subject, or `undefined` if it does not
 * exist. The subject's own `selfReport` never enters the package.
 */
export function buildPersonaPackage(
  subjectId: string,
  store: Store,
  options: BuildPersonaPackageOptions = {},
): PersonaPackage | undefined {
  const subject = store.getSubject(subjectId);
  if (!subject) return undefined;

  // "surviving + qualified": a qualified claim is a surviving claim carrying
  // qualifiers, so the status filter covers both.
  const claims = store
    .listClaimsBySubject(subjectId)
    .filter((claim) => claim.status === 'surviving')
    .map((claim) => ({ ...claim }));

  const testimonies = store.listBySubject(subjectId);
  const witnesses: PersonaWitnessEntry[] = store
    .listWitnessesBySubject(subjectId)
    .map((witness) => ({
      relation: witness.relation,
      ...(witness.stance !== undefined ? { stance: witness.stance } : {}),
      consentLevel: witness.consentLevel,
      evidenceIds: testimonies
        .filter((testimony) => testimony.witnessId === witness.id)
        .map((testimony) => testimony.id),
    }));

  const sessions = store.listCourtSessionsBySubject(subjectId);
  const latestReport = sessions[sessions.length - 1]?.report;
  const baseReport = latestReport
    ? { ...latestReport }
    : computeReport(store.listClaimsBySubject(subjectId));
  const report: CourtReport & { imported?: boolean } =
    isImportedSubject(store, subjectId)
      ? { ...baseReport, imported: true }
      : baseReport;

  // v2: styleSamples come from corpus (subject's own words)
  const corpusItems = store.listCorpusItemsBySubject(subjectId);
  const styleSamples: StyleSample[] = corpusItems.map((item) => ({
    relation: '本人',
    text: item.text,
  }));

  // Quotable episodes only
  const quotableWitnessIds = new Set(
    store.listWitnessesBySubject(subjectId)
      .filter((w) => w.consentLevel === 'quotable')
      .map((w) => w.id),
  );
  const episodes = store.listEpisodesBySubject(subjectId)
    .filter((ep) => quotableWitnessIds.has(ep.witnessId))
    .map((ep) => ({ ...ep }));
  const divergences = store.listDivergencesBySubject(subjectId)
    .map((d) => ({ ...d }));

  return {
    format: PERSONA_FORMAT,
    version: PERSONA_VERSION,
    subject: { displayName: subject.displayName },
    claims,
    styleSamples,
    episodes,
    divergences,
    corpus: corpusItems.map((item) => ({ ...item })),
    report,
    witnesses,
    exportedAt: (options.now ?? (() => new Date()))().toISOString(),
    notice: PERSONA_NOTICE,
  };
}

export interface ImportPersonaOptions {
  /** Injectable clock, for deterministic tests. */
  now?: () => Date;
  /** Id factory, injectable for deterministic tests. */
  newId?: () => string;
}

export interface ImportPersonaResult {
  subject: Subject;
  claimCount: number;
  witnessCount: number;
  receiptCount: number;
}

/**
 * Import a package as a brand-new subject.
 *
 * Every imported claim is anchored to a synthetic "import receipt" testimony:
 * one per witness entry (plus one synthetic witness for any evidence id the
 * package references but does not attribute). A receipt has `answers: []` and
 * a fixed `freeText`, inherits the package's declared `consentLevel`, and is
 * *not* evidence — it is the customs declaration that lets the no-anchor law
 * hold without smuggling raw testimony into the new install.
 *
 * Claims get fresh ids (the package may be imported many times) while their
 * substance — text, conviction, qualifiers, status, court session id — is
 * copied verbatim.
 */
export function importPersonaPackage(
  store: Store,
  input: unknown,
  options: ImportPersonaOptions = {},
): ImportPersonaResult {
  const pkg = PersonaPackageSchema.parse(input);
  const newId = options.newId ?? (() => randomUUID());
  const createdAt = (options.now ?? (() => new Date()))().toISOString();

  const subjectId = newId();
  const subject = store.putSubject({
    id: subjectId,
    displayName: `${pkg.subject.displayName}${IMPORT_SUBJECT_SUFFIX}`,
    styleSamples: pkg.styleSamples.map((sample) => ({ ...sample })),
  });

  const anchorMap = new Map<string, string>();
  const makeReceipt = (relation: string, consentLevel: ConsentLevel, stance?: string): string => {
    const witnessId = newId();
    store.putWitness({
      id: witnessId,
      subjectId,
      relation,
      ...(stance !== undefined ? { stance } : {}),
      consentLevel,
    });
    const receiptId = newId();
    store.addTestimony({
      id: receiptId,
      witnessId,
      subjectId,
      createdAt,
      answers: [],
      freeText: IMPORT_RECEIPT_TEXT,
    });
    return receiptId;
  };

  for (const witness of pkg.witnesses) {
    const receiptId = makeReceipt(witness.relation, witness.consentLevel, witness.stance);
    for (const evidenceId of witness.evidenceIds) anchorMap.set(evidenceId, receiptId);
  }

  // A claim may cite an id no witness entry declared. Fail closed to a
  // conservative receipt rather than dropping the claim's anchor.
  const anchorFor = (evidenceId: string): string => {
    const existing = anchorMap.get(evidenceId);
    if (existing) return existing;
    const receiptId = makeReceipt('导入证人', 'synthesis_only');
    anchorMap.set(evidenceId, receiptId);
    return receiptId;
  };

  for (const claim of pkg.claims) {
    store.putClaim({
      ...claim,
      id: newId(),
      subjectId,
      evidence: claim.evidence.map(anchorFor),
    });
  }

  return {
    subject,
    claimCount: pkg.claims.length,
    witnessCount: pkg.witnesses.length,
    receiptCount: anchorMap.size,
  };
}

/**
 * A header-safe `Content-Disposition` for a package download.
 *
 * HTTP header values must be latin-1, so a non-ASCII display name (林默) goes
 * in the RFC 5987 `filename*` parameter and the plain `filename` falls back to
 * the ASCII subject id. `subjectId` is only used for that fallback.
 */
export function personaContentDisposition(displayName: string, subjectId: string): string {
  const asciiName = /^[\x20-\x7e]+$/.test(displayName) ? displayName : subjectId;
  const encoded = encodeURIComponent(displayName);
  return `attachment; filename="${asciiName}.persona"; filename*=UTF-8''${encoded}.persona`;
}
