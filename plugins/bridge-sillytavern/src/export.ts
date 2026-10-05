/**
 * Export: .persona → SillyTavern Character Card V2.
 *
 * Privacy rules (inherited from persona assembly):
 * 1. synthesis_only witnesses' raw text is withheld before we see it
 *    (the caller passes the package through withholdSynthesisOnly).
 * 2. Private content (嘱咐保密) is filtered by the kernel's privacy
 *    filter during persona assembly; we re-apply the same markers here.
 * 3. Name hints (称呼线索) are never exported — witnesses appear by
 *    relation label only.
 * 4. doNotRaiseToSubject answers are excluded from claim/episode
 *    selection (they never reach the .persona package).
 *
 * Real-person gate: when the persona depicts a real person (i.e. it is
 * not an imported-from-card persona), the caller must pass
 * `acknowledgeRealPerson: true` or the export is refused.
 */
import {
  type Store,
  PERSONA_DISCIPLINE,
  personaIdentityLine,
  computeStyleProfile,
  renderStyleDiscipline,
} from '@openmimic/kernel';
import {
  buildPersonaPackage,
  isImportedSubject,
  type PersonaPackage,
} from '@openmimic/server';
import { withholdSynthesisOnly } from '@openmimic/server';
import type {
  CharacterCardV2,
  CharacterCardV2Data,
  OpenMimicExtension,
} from './character-card';

/* ------------------------------------------------------------------ */
/* Private-content markers (same as kernel/src/persona.ts)             */
/* ------------------------------------------------------------------ */

const PRIVATE_MARKERS = [
  '别告诉', '别跟', '千万别', '别外传', '只跟你说',
  '你可别', '你别跟', '谁都没说', '别人不知道', '没跟', '嘱咐我',
];

const CN_AMOUNT_RE =
  /(?<!千)[一二两三四五六七八九十百\d]+[万千百亿](?:[一二两三四五六七八九十百千万]*)(?:块|元)?|\d[\d,.]*(?:万|千|百|元|块)/g;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！？；\n])/).map((s) => s.trim()).filter(Boolean);
}

function extractPrivateKeyPhrases(texts: string[]): Set<string> {
  const phrases = new Set<string>();
  for (const text of texts) {
    const sentences = splitSentences(text);
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i]!;
      if (PRIVATE_MARKERS.some((m) => s.includes(m))) {
        // The marker sentence + preceding sentence
        if (i > 0) {
          for (const amt of [...sentences[i - 1]!.matchAll(CN_AMOUNT_RE)].map((m) => m[0])) {
            phrases.add(amt);
          }
        }
        for (const amt of [...s.matchAll(CN_AMOUNT_RE)].map((m) => m[0])) {
          phrases.add(amt);
        }
        for (const m of PRIVATE_MARKERS) {
          if (s.includes(m)) phrases.add(m);
        }
      }
    }
  }
  return phrases;
}

function containsPrivateContent(text: string, phrases: Set<string>): boolean {
  for (const p of phrases) {
    if (text.includes(p)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Export options                                                       */
/* ------------------------------------------------------------------ */

export interface ExportCharacterCardOptions {
  /**
   * Must be true when the subject is a real person (not imported from
   * a character card). Without this flag the export is refused.
   */
  acknowledgeRealPerson?: boolean;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export interface ExportResult {
  card: CharacterCardV2;
  /** The raw JSON string, for PNG embedding or file output. */
  json: string;
}

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

/**
 * Build a Character Card V2 from a subject's persona.
 *
 * The function:
 * 1. Builds the .persona package (which already filters quotable-only
 *    episodes and surviving claims).
 * 2. Applies synthesis_only withholding.
 * 3. Applies private-content filtering on the exported fields.
 * 4. Maps persona data to Character Card V2 fields.
 * 5. Stores structured data in extensions.openmimic for round-trip.
 */
export function exportCharacterCard(
  subjectId: string,
  store: Store,
  options: ExportCharacterCardOptions = {},
): ExportResult {
  const now = options.now ?? (() => new Date());

  // Real-person gate
  const isImported = isImportedSubject(store, subjectId);
  if (!isImported && !options.acknowledgeRealPerson) {
    throw new Error(
      'This persona depicts a real person. Distributing a personality card ' +
      'based on someone else requires their authorization. Pass ' +
      'acknowledgeRealPerson: true to proceed.',
    );
  }

  // Build persona package (gate already enforced above, pass through)
  const rawPkg = buildPersonaPackage(subjectId, store, {
    now,
    acknowledgeRealPerson: options.acknowledgeRealPerson ?? isImported,
  });
  if (!rawPkg) {
    throw new Error(`Subject ${subjectId} not found`);
  }

  // Apply synthesis_only withholding
  const pkg = withholdSynthesisOnly(store, subjectId, rawPkg) as PersonaPackage;

  // Collect private key phrases from all testimony for this subject
  const allTexts: string[] = [];
  for (const t of store.listBySubject(subjectId)) {
    for (const a of t.answers) {
      allTexts.push(a.behindText);
    }
  }
  const privateKeyPhrases = extractPrivateKeyPhrases(allTexts);
  const isPrivate = (text: string) => containsPrivateContent(text, privateKeyPhrases);

  // Filter claims and episodes for private content
  const safeClaims = pkg.claims.filter((c) => !isPrivate(c.text));
  const safeEpisodes = (pkg.episodes ?? []).filter((ep) => !isPrivate(ep.text));
  const safeCorpus = (pkg.corpus ?? []).filter((ci) => !isPrivate(ci.text));

  // Build witness relation map (no real names — only relations)
  const witnessRelationMap = new Map<string, string>();
  for (const w of pkg.witnesses) {
    // Use evidence IDs to correlate with claims' evidence arrays
    for (const eid of w.evidenceIds) {
      witnessRelationMap.set(eid, w.relation);
    }
  }

  // Build witness relation by index for structured data
  const witnessRelations = pkg.witnesses.map((w) => w.relation);

  // Build a witness ID → relation map from the store (for episode labels)
  const storeWitnesses = store.listWitnessesBySubject(subjectId);
  const witnessIdToRelation = new Map<string, string>();
  for (const w of storeWitnesses) {
    witnessIdToRelation.set(w.id, w.relation);
  }

  // --- description: claims + episodes ---
  const descriptionLines: string[] = [];

  // Section 1: claims ("别人眼中的他")
  if (safeClaims.length > 0) {
    descriptionLines.push('## 别人眼中的他');
    for (const claim of safeClaims) {
      const qualifier = claim.qualifiers?.length
        ? `（限定：${claim.qualifiers.join('；')}）`
        : '';
      descriptionLines.push(`- ${claim.text}${qualifier}`);
    }
  }

  // Section 2: episodes ("别人讲过的事")
  // Round-robin by witness so every witness is represented; quotable only,
  // privacy-filtered, up to ~12 episodes or ~2000 chars.
  const MAX_EPISODE_COUNT = 12;
  const MAX_EPISODE_CHARS = 2000;
  if (safeEpisodes.length > 0) {
    // Group by witnessId for round-robin
    const byWitness = new Map<string, typeof safeEpisodes>();
    for (const ep of safeEpisodes) {
      if (!byWitness.has(ep.witnessId)) byWitness.set(ep.witnessId, []);
      byWitness.get(ep.witnessId)!.push(ep);
    }
    const witnessIds = [...byWitness.keys()];
    const indices = new Map<string, number>();
    for (const wid of witnessIds) indices.set(wid, 0);

    const pickedEpisodes: typeof safeEpisodes = [];
    let totalChars = 0;
    let added = true;
    while (added && pickedEpisodes.length < MAX_EPISODE_COUNT && totalChars < MAX_EPISODE_CHARS) {
      added = false;
      for (const wid of witnessIds) {
        if (pickedEpisodes.length >= MAX_EPISODE_COUNT || totalChars >= MAX_EPISODE_CHARS) break;
        const idx = indices.get(wid)!;
        const eps = byWitness.get(wid)!;
        if (idx < eps.length) {
          pickedEpisodes.push(eps[idx]!);
          totalChars += eps[idx]!.text.length;
          indices.set(wid, idx + 1);
          added = true;
        }
      }
    }

    if (pickedEpisodes.length > 0) {
      descriptionLines.push('');
      descriptionLines.push('## 别人讲过的事');
      for (const ep of pickedEpisodes) {
        const relation = witnessIdToRelation.get(ep.witnessId) ?? '证人';
        const situationTag = ep.situation ? `（${ep.situation}）` : '';
        descriptionLines.push(`- ${relation}${situationTag}:「${ep.text}」`);
      }
    }
  }

  const description = descriptionLines.join('\n') || pkg.subject.displayName;

  // --- personality: behavioral patterns from claims ---
  const personalityParts: string[] = [];
  for (const claim of safeClaims) {
    if (claim.context?.audience) {
      // Avoid doubling "对" when audience already starts with it (e.g. "对亲密的人")
      const prefix = claim.context.audience.startsWith('对') ? '' : '对';
      personalityParts.push(`${prefix}${claim.context.audience}：${claim.text}`);
    }
  }
  if (personalityParts.length === 0) {
    // Fallback: use top claims as personality
    personalityParts.push(...safeClaims.slice(0, 3).map((c) => c.text));
  }
  const personality = personalityParts.join('\n');

  // --- mes_example: subject's own words from corpus ---
  const mesExampleLines: string[] = [];
  for (const ci of safeCorpus) {
    mesExampleLines.push(`<START>`);
    mesExampleLines.push(`{{char}}: ${ci.text}`);
  }
  const mesExample = mesExampleLines.join('\n');

  // --- system_prompt: identity + style discipline + behavioral rules ---
  // Reuse kernel's PERSONA_DISCIPLINE (Chinese) and style-stats.
  const identityLine = personaIdentityLine(pkg.subject.displayName);

  // Compute speaking style from corpus
  const styleResult = computeStyleProfile(safeCorpus.map((ci) => ci.text));
  const styleDiscipline = renderStyleDiscipline(
    styleResult.status === 'ok' ? styleResult.profile : null,
  );

  const systemPromptParts: string[] = [
    identityLine,
    '',
    '只依据 description 里的侧面与别人讲过的事来扮演,不虚构素材之外的信息。',
    '',
    styleDiscipline,
    '',
    PERSONA_DISCIPLINE,
  ];
  const systemPrompt = systemPromptParts.join('\n');

  // --- post_history_instructions ---
  const postHistoryInstructions =
    '记住:这是基于证言的人格模拟,不是本人。只说素材里有的事,不确定的就以本人口吻说记不清。';

  // --- creator_notes ---
  const exportTime = now().toISOString();
  const creatorNotes = [
    `Generated by OpenMimic`,
    `Based on testimonies from ${pkg.witnesses.length} witness(es).`,
    `Exported at: ${exportTime}`,
    '',
    'IMPORTANT: This card does NOT contain the original testimonies. Once outside',
    'OpenMimic, there is no output-side fact-checking or privacy protection.',
    'For fact-checked conversations, point SillyTavern\'s API at OpenMimic\'s',
    'OpenAI-compatible endpoint instead of using this static card.',
  ].join('\n');

  // --- extensions.openmimic: structured data for round-trip ---
  const claimWitnessMap = new Map<string, string[]>();
  for (const claim of safeClaims) {
    const relations: string[] = [];
    for (const eid of claim.evidence) {
      const rel = witnessRelationMap.get(eid);
      if (rel) relations.push(rel);
    }
    claimWitnessMap.set(claim.id, [...new Set(relations)]);
  }

  const openMimicExt: OpenMimicExtension = {
    version: '0.0.1',
    exportedAt: exportTime,
    subjectDisplayName: pkg.subject.displayName,
    witnessCount: pkg.witnesses.length,
    claims: safeClaims.map((c) => ({
      id: c.id,
      text: c.text,
      conviction: c.conviction,
      kind: c.kind,
      domain: c.domain,
      context: c.context ? { ...c.context } : undefined,
      qualifiers: c.qualifiers,
      witnessRelations: claimWitnessMap.get(c.id) ?? [],
    })),
    episodes: safeEpisodes.map((ep) => ({
      id: ep.id,
      text: ep.text,
      witnessRelation: witnessIdToRelation.get(ep.witnessId) ?? '证人',
      situation: ep.situation,
    })),
    corpus: safeCorpus.map((ci) => ({
      id: ci.id,
      text: ci.text,
    })),
  };

  // --- first_mes: a brief in-character opening ---
  const firstMes = safeCorpus.length > 0
    ? safeCorpus[0]!.text
    : `...嗯？你找我？`;

  const data: CharacterCardV2Data = {
    name: pkg.subject.displayName,
    description,
    personality,
    scenario: '',
    first_mes: firstMes,
    mes_example: mesExample,
    creator_notes: creatorNotes,
    system_prompt: systemPrompt,
    post_history_instructions: postHistoryInstructions,
    alternate_greetings: [],
    tags: ['openmimic', 'testimony-based'],
    creator: 'OpenMimic',
    character_version: openMimicExt.version,
    extensions: {
      openmimic: openMimicExt,
    },
  };

  const card: CharacterCardV2 = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data,
  };

  return {
    card,
    json: JSON.stringify(card, null, 2),
  };
}
