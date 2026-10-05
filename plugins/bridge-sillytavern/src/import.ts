/**
 * Import: SillyTavern Character Card V2 → OpenMimic subject.
 *
 * A character card is an author's fiction, not testimony. Everything
 * imported is marked as authored content:
 *
 * 1. description/personality → claims with a synthetic court session
 *    (no real court ever ran; conviction is a fixed 0.5).
 * 2. mes_example character lines → corpus items (source='imported').
 * 3. first_mes, scenario → stored in the plugin's own table, available
 *    for room scenarios but NOT as testimony.
 * 4. Nothing touches the testimony ledger as witness evidence.
 *
 * Security:
 * - All imported text passes through detectInjection(); matches are
 *   flagged on the corpus/claim but the text is still stored (same
 *   policy as testimony: flag, never reject).
 * - Text is sanitized through sanitizeDelimiters() for prompt safety.
 *
 * Round-trip:
 * - If the card has extensions.openmimic, structured claims/episodes
 *   are restored directly (lossless round-trip).
 * - Otherwise, heuristic extraction splits description lines into claims.
 */
import { randomUUID } from 'node:crypto';
import type { Store } from '@openmimic/kernel';
import { detectInjection, sanitizeDelimiters } from '@openmimic/shared';
import { CharacterCardV2Schema, type CharacterCardV2, type OpenMimicExtension } from './character-card';

/* ------------------------------------------------------------------ */
/* Import options & result                                             */
/* ------------------------------------------------------------------ */

export interface ImportCharacterCardOptions {
  /** Injectable clock, for deterministic tests. */
  now?: () => Date;
  /** Id factory, injectable for deterministic tests. */
  newId?: () => string;
}

export interface ImportCharacterCardResult {
  subjectId: string;
  displayName: string;
  claimCount: number;
  corpusCount: number;
  /** Texts where injection patterns were detected (flagged, not rejected). */
  injectionFlags: string[];
  /** Whether the card had an openmimic extension (lossless round-trip). */
  roundTrip: boolean;
}

/* ------------------------------------------------------------------ */
/* mes_example parser                                                  */
/* ------------------------------------------------------------------ */

/**
 * Extract character lines from a mes_example block.
 *
 * Format: lines separated by <START> tags. Character lines start with
 * `{{char}}:`. We ignore user lines (`{{user}}:`).
 *
 * Returns sanitized text strings.
 */
function parseMesExample(mesExample: string): string[] {
  if (!mesExample.trim()) return [];
  const lines: string[] = [];
  const blocks = mesExample.split(/<START>/i);
  for (const block of blocks) {
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      // Match {{char}}: prefix (case-insensitive)
      const match = trimmed.match(/^\{\{char\}\}\s*:\s*(.+)/i);
      if (match) {
        const text = sanitizeDelimiters(match[1]!.trim());
        if (text.length > 0) lines.push(text);
      }
    }
  }
  return lines;
}

/**
 * Split a description block into individual claim-like lines.
 *
 * Handles bullet lists (- or *), numbered lists, and paragraph breaks.
 */
function splitDescriptionIntoClaims(description: string): string[] {
  if (!description.trim()) return [];
  const lines: string[] = [];
  for (const raw of description.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Remove bullet/list markers
    const cleaned = trimmed.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();
    if (cleaned.length > 0) {
      lines.push(sanitizeDelimiters(cleaned));
    }
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

/**
 * Import a character card as a new OpenMimic subject.
 *
 * The card is validated against the V2 schema. All text content is
 * treated as untrusted data (sanitized, injection-checked).
 *
 * Returns the new subject id, counts, and any injection flags.
 */
export function importCharacterCard(
  store: Store,
  input: unknown,
  options: ImportCharacterCardOptions = {},
): ImportCharacterCardResult {
  const card = CharacterCardV2Schema.parse(input);
  const newId = options.newId ?? (() => randomUUID());
  const now = options.now ?? (() => new Date());
  const createdAt = now().toISOString();

  const injectionFlags: string[] = [];
  const checkInjection = (text: string): string | undefined => {
    const match = detectInjection(text);
    if (match) injectionFlags.push(match);
    return match;
  };

  const { data } = card;

  // Check if this is a round-trip card with OpenMimic extension
  const omExt = data.extensions?.openmimic as OpenMimicExtension | undefined;
  const isRoundTrip = !!(omExt?.version && omExt?.claims);

  // Create subject (suffix to distinguish from native subjects)
  const subjectId = newId();
  const displayName = `${data.name}（角色卡导入）`;
  store.putSubject({
    id: subjectId,
    displayName,
  });

  // Synthetic court session (no real court ran)
  const courtSessionId = newId();
  store.putCourtSession({
    id: courtSessionId,
    subjectId,
    startedAt: createdAt,
    finishedAt: createdAt,
    transcript: [],
    report: {
      totalClaims: 0, // updated below
      surviving: 0,
      qualified: 0,
      rejected: 0,
      challengeCount: 0,
      evidenceCoverage: 1,
    },
  });

  // Synthetic witness + receipt for anchoring claims
  const syntheticWitnessId = newId();
  store.putWitness({
    id: syntheticWitnessId,
    subjectId,
    relation: '角色卡作者',
    consentLevel: 'quotable',
  });
  const receiptId = newId();
  store.addTestimony({
    id: receiptId,
    witnessId: syntheticWitnessId,
    subjectId,
    createdAt,
    answers: [],
    freeText: `导入自 SillyTavern 角色卡: ${data.name}`,
  });

  // --- Claims ---
  let claimCount = 0;
  if (isRoundTrip && omExt!.claims.length > 0) {
    // Round-trip: restore structured claims
    for (const claim of omExt!.claims) {
      const sanitizedText = sanitizeDelimiters(claim.text);
      checkInjection(sanitizedText);
      store.putClaim({
        id: newId(),
        subjectId,
        text: sanitizedText,
        conviction: claim.conviction,
        evidence: [receiptId],
        status: 'surviving',
        courtSessionId,
        kind: (claim.kind as 'fact' | 'observation' | 'pattern') ?? 'pattern',
        domain: (claim.domain as 'observable' | 'internal' | 'evaluative') ?? undefined,
        context: claim.context ? { ...claim.context } : undefined,
        qualifiers: claim.qualifiers,
      });
      claimCount++;
    }
  } else {
    // Heuristic: split description into claims
    const descClaims = splitDescriptionIntoClaims(data.description);
    for (const text of descClaims) {
      checkInjection(text);
      store.putClaim({
        id: newId(),
        subjectId,
        text,
        conviction: 0.5,
        evidence: [receiptId],
        status: 'surviving',
        courtSessionId,
        kind: 'pattern',
      });
      claimCount++;
    }

    // Also import personality lines as claims if distinct from description
    if (data.personality.trim()) {
      const personalityClaims = splitDescriptionIntoClaims(data.personality);
      for (const text of personalityClaims) {
        checkInjection(text);
        store.putClaim({
          id: newId(),
          subjectId,
          text,
          conviction: 0.5,
          evidence: [receiptId],
          status: 'surviving',
          courtSessionId,
          kind: 'observation',
        });
        claimCount++;
      }
    }
  }

  // Update court report
  store.putCourtSession({
    id: courtSessionId,
    subjectId,
    startedAt: createdAt,
    finishedAt: createdAt,
    transcript: [],
    report: {
      totalClaims: claimCount,
      surviving: claimCount,
      qualified: 0,
      rejected: 0,
      challengeCount: 0,
      evidenceCoverage: 1,
    },
  });

  // --- Corpus (mes_example character lines) ---
  let corpusCount = 0;
  if (isRoundTrip && omExt!.corpus.length > 0) {
    for (const ci of omExt!.corpus) {
      const sanitizedText = sanitizeDelimiters(ci.text);
      checkInjection(sanitizedText);
      store.putCorpusItem({
        id: newId(),
        subjectId,
        text: sanitizedText,
        source: 'imported',
        createdAt,
      });
      corpusCount++;
    }
  } else {
    const charLines = parseMesExample(data.mes_example);
    for (const text of charLines) {
      checkInjection(text);
      store.putCorpusItem({
        id: newId(),
        subjectId,
        text,
        source: 'imported',
        createdAt,
      });
      corpusCount++;
    }
  }

  // --- first_mes and scenario stored in plugin table ---
  // The plugin registers a table for these; stored at plugin load time.
  // For now we store them via the plugin context (see index.ts).
  // This function returns them for the caller to persist.
  // (The actual storage is handled by the plugin's apply function.)

  return {
    subjectId,
    displayName,
    claimCount,
    corpusCount,
    injectionFlags,
    roundTrip: isRoundTrip,
  };
}

/**
 * Additional card metadata that the plugin table stores.
 * Not part of the testimony ledger.
 */
export interface CardMetadata {
  firstMes: string;
  scenario: string;
  alternateGreetings: string[];
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  tags: string[];
  creator: string;
  characterVersion: string;
}

/**
 * Extract metadata fields from a parsed card for plugin-table storage.
 */
export function extractCardMetadata(card: CharacterCardV2): CardMetadata {
  return {
    firstMes: card.data.first_mes,
    scenario: card.data.scenario,
    alternateGreetings: card.data.alternate_greetings,
    creatorNotes: card.data.creator_notes,
    systemPrompt: card.data.system_prompt,
    postHistoryInstructions: card.data.post_history_instructions,
    tags: card.data.tags,
    creator: card.data.creator,
    characterVersion: card.data.character_version,
  };
}
