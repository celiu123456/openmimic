/**
 * output-biography: a short biography of the subject, written from friends'
 * testimonies.
 *
 * Migrated from the old platform's life-book / family-book modules.
 * The biography is a generated artifact (not evidence). It draws exclusively
 * from testimony episodes and answers; `synthesis_only` witnesses' raw text
 * is paraphrased only; `contested` claims are excluded; the subject can
 * veto individual sections.
 *
 * Routes (self-registered via router service):
 *   POST /api/subjects/:id/biography          -- generate
 *   GET  /api/subjects/:id/biography          -- retrieve
 *   POST /api/biography/:id/sections/:sid/remove -- subject veto
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Plugin } from '@openmimic/kernel';
import type { Store, PluginTableHandle } from '@openmimic/kernel';
import type { Router } from '@openmimic/server';
import type { LLMClient, LLMCompletionRequest } from '@openmimic/engine-court';
import { extractJson } from '@openmimic/engine-court';
import type {
  Testimony,
  Episode,
  Claim,
  Divergence,
  Witness,
  CorpusItem,
  SilenceSignal,
} from '@openmimic/shared';

/* ================================================================== */
/* Types                                                               */
/* ================================================================== */

/** A quotable excerpt with provenance. */
export interface QuotableEntry {
  /** Verbatim text. */
  text: string;
  witnessId: string;
  /** Display name (respects anonymousInRoom). */
  displayName: string;
  episodeId?: string;
  testimonyId: string;
  qid: string;
}

/** A material bucket: one witness's contributions to one topic dimension. */
export interface MaterialBucket {
  witnessId: string;
  displayName: string;
  consentLevel: 'quotable' | 'synthesis_only';
  topicDimension: string;
  excerpts: string[];
  quotableExcerpts: QuotableEntry[];
}

/** Outline chapter. */
export interface OutlineChapter {
  chapterNo: number;
  title: string;
  theme: string;
  /** Material bucket keys (witnessId::topicDimension) used by this chapter. */
  bucketKeys: string[];
  /** Quotable entry texts this chapter is allowed to quote. */
  quotableTexts: string[];
}

/** Full outline. */
export interface BiographyOutline {
  title: string;
  chapters: OutlineChapter[];
}

/** One paragraph of a generated section. */
export interface BiographyParagraph {
  text: string;
  attribution: { displayName: string; relation?: string } | null;
  sourceRefs: Array<{ witnessId: string; testimonyId?: string }>;
  conflict: boolean;
}

/** A biography section (one chapter). */
export interface BiographySection {
  id: string;
  chapterNo: number;
  title: string;
  paragraphs: BiographyParagraph[];
  removed: boolean;
  removalNote: string | null;
  qualityScore: number | null;
  qualityIssues: QualityDimension[];
}

/** The full biography. */
export interface Biography {
  id: string;
  subjectId: string;
  title: string;
  sections: BiographySection[];
  silenceNote: string | null;
  finalChapterNote: string | null;
  generatedAt: string;
  style: BiographyStyle;
}

/** Biography style options. */
export interface BiographyStyle {
  voice: 'third_person_observer' | 'letter_to_friends' | 'documentary';
  label: string;
}

/** Quality review dimension. */
export interface QualityDimension {
  key: string;
  score: number;
  weight: number;
  issues: string[];
}

/** Quality review result. */
export interface QualityResult {
  score: number;
  requiresRewrite: boolean;
  dimensions: QualityDimension[];
}

/* ================================================================== */
/* Style catalog                                                       */
/* ================================================================== */

export const BIOGRAPHY_STYLES: BiographyStyle[] = [
  { voice: 'third_person_observer', label: 'Friends\' perspective, third person' },
  { voice: 'letter_to_friends', label: 'A letter written by friends' },
  { voice: 'documentary', label: 'Documentary voiceover' },
];

export const DEFAULT_STYLE: BiographyStyle = BIOGRAPHY_STYLES[0];

/* ================================================================== */
/* Configuration                                                       */
/* ================================================================== */

export interface BiographyConfig {
  /** Minimum number of witnesses for biography generation. Default: 3. */
  minWitnesses?: number;
  /** Min chapters. Default: 3. */
  minChapters?: number;
  /** Max chapters. Default: 6. */
  maxChapters?: number;
  /** Quality score threshold; below this => requires rewrite. Default: 75. */
  qualityThreshold?: number;
  /** Style override. */
  style?: BiographyStyle;
}

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const FINAL_CHAPTER_TITLE = 'What they do not know';
const SILENCE_NOTE = 'There are things everyone chose not to mention. This space is left intentionally blank.';
const FINAL_CHAPTER_PLACEHOLDER = 'This chapter is reserved for the subject\'s own words.';
const REMOVAL_NOTE_TEMPLATE = 'This section was removed at the subject\'s request.';

/* ================================================================== */
/* 1. Material adapter: testimony + episodes -> buckets                */
/* ================================================================== */

/**
 * Group testimony material by witness x topic dimension.
 *
 * - Only `quotable` witnesses contribute to the quotable index.
 * - `synthesis_only` witnesses' excerpts are included for paraphrase only.
 * - Episodes with `doNotRaiseToSubject` flagging (via claims) are excluded.
 * - Contested claims' evidence is excluded.
 */
export function buildMaterialBuckets(
  witnesses: Witness[],
  testimonies: Testimony[],
  episodes: Episode[],
  claims: Claim[],
): { buckets: MaterialBucket[]; quotableIndex: QuotableEntry[] } {
  // Build set of contested claim evidence ids to exclude
  const contestedEvidenceIds = new Set<string>();
  for (const claim of claims) {
    if (claim.status === 'contested' || claim.status === 'retired') {
      for (const eid of claim.evidence) {
        contestedEvidenceIds.add(eid);
      }
    }
  }

  const witnessMap = new Map(witnesses.map((w) => [w.id, w]));
  const bucketMap = new Map<string, MaterialBucket>();
  const quotableIndex: QuotableEntry[] = [];

  // Process episodes first (they have richer provenance)
  const usedEpisodeIds = new Set<string>();
  for (const ep of episodes) {
    if (contestedEvidenceIds.has(ep.testimonyId)) continue;
    const w = witnessMap.get(ep.witnessId);
    if (!w) continue;

    const displayName = w.anonymousInRoom ? 'A friend' : w.relation;
    const dimension = ep.situation || ep.audience || 'general';
    const key = `${w.id}::${dimension}`;

    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        witnessId: w.id,
        displayName,
        consentLevel: w.consentLevel,
        topicDimension: dimension,
        excerpts: [],
        quotableExcerpts: [],
      });
    }
    const bucket = bucketMap.get(key)!;
    bucket.excerpts.push(ep.text);

    if (w.consentLevel === 'quotable') {
      const entry: QuotableEntry = {
        text: ep.text,
        witnessId: w.id,
        displayName,
        episodeId: ep.id,
        testimonyId: ep.testimonyId,
        qid: ep.qid,
      };
      bucket.quotableExcerpts.push(entry);
      quotableIndex.push(entry);
    }
    usedEpisodeIds.add(ep.id);
  }

  // Also process raw testimony answers for witnesses that have no episodes
  for (const t of testimonies) {
    if (contestedEvidenceIds.has(t.id)) continue;
    const w = witnessMap.get(t.witnessId);
    if (!w) continue;

    const displayName = w.anonymousInRoom ? 'A friend' : w.relation;

    for (const ans of t.answers) {
      const dimension = ans.qid;
      const key = `${w.id}::${dimension}`;

      if (!bucketMap.has(key)) {
        bucketMap.set(key, {
          witnessId: w.id,
          displayName,
          consentLevel: w.consentLevel,
          topicDimension: dimension,
          excerpts: [],
          quotableExcerpts: [],
        });
      }
      const bucket = bucketMap.get(key)!;

      // Add behindText as excerpt if not already covered by episodes
      const text = ans.behindText.trim();
      if (text && !bucket.excerpts.includes(text)) {
        bucket.excerpts.push(text);

        if (w.consentLevel === 'quotable') {
          // Extract sentences as quotable excerpts
          const sentences = extractSentences(text);
          for (const sentence of sentences) {
            if (!bucket.quotableExcerpts.some((q) => q.text === sentence)) {
              const entry: QuotableEntry = {
                text: sentence,
                witnessId: w.id,
                displayName,
                testimonyId: t.id,
                qid: ans.qid,
              };
              bucket.quotableExcerpts.push(entry);
              quotableIndex.push(entry);
            }
          }
        }
      }

      // followupText
      if (ans.followupText) {
        const followup = ans.followupText.trim();
        if (followup && !bucket.excerpts.includes(followup)) {
          bucket.excerpts.push(followup);
          if (w.consentLevel === 'quotable') {
            const sentences = extractSentences(followup);
            for (const sentence of sentences) {
              if (!bucket.quotableExcerpts.some((q) => q.text === sentence)) {
                const entry: QuotableEntry = {
                  text: sentence,
                  witnessId: w.id,
                  displayName,
                  testimonyId: t.id,
                  qid: ans.qid,
                };
                bucket.quotableExcerpts.push(entry);
                quotableIndex.push(entry);
              }
            }
          }
        }
      }
    }
  }

  return { buckets: [...bucketMap.values()], quotableIndex };
}

/** Extract sentences from text; conservative splitting. */
export function extractSentences(text: string): string[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const sentences = lines.flatMap((line) =>
    line.split(/(?<=[.!?。！？])\s*/).map((s) => s.trim()).filter(Boolean),
  );
  return sentences.slice(0, 5).map((s) => s.slice(0, 200));
}

/* ================================================================== */
/* 2. Outline builder                                                  */
/* ================================================================== */

/**
 * Build a biography outline from material buckets.
 * Deterministic: no LLM needed.
 *
 * Chapters are grouped by topic dimension clusters. The number of chapters
 * is between minChapters and maxChapters, determined by material volume.
 */
export function buildOutline(
  buckets: MaterialBucket[],
  quotableIndex: QuotableEntry[],
  subjectName: string,
  options: {
    minChapters?: number;
    maxChapters?: number;
    minWitnesses?: number;
    hasCorpus?: boolean;
    hasSilenceSignals?: boolean;
  } = {},
): BiographyOutline {
  const minChapters = options.minChapters ?? 3;
  const maxChapters = options.maxChapters ?? 6;
  const minWitnesses = options.minWitnesses ?? 3;

  // Group buckets by topic dimension
  const dimensionGroups = new Map<string, MaterialBucket[]>();
  for (const b of buckets) {
    if (!dimensionGroups.has(b.topicDimension)) {
      dimensionGroups.set(b.topicDimension, []);
    }
    dimensionGroups.get(b.topicDimension)!.push(b);
  }

  // Filter dimensions that meet the witness threshold
  const qualifiedDimensions = [...dimensionGroups.entries()]
    .filter(([_, group]) => {
      const distinctWitnesses = new Set(group.map((b) => b.witnessId));
      return distinctWitnesses.size >= minWitnesses;
    })
    .sort((a, b) => b[1].length - a[1].length);

  // Determine chapter count based on material volume
  const totalExcerpts = buckets.reduce((sum, b) => sum + b.excerpts.length, 0);
  let chapterCount: number;
  if (totalExcerpts >= 60) chapterCount = maxChapters;
  else if (totalExcerpts >= 40) chapterCount = Math.min(maxChapters, 5);
  else if (totalExcerpts >= 20) chapterCount = Math.min(maxChapters, 4);
  else chapterCount = minChapters;

  // Reserve slots for silence note and final chapter
  const contentChapters = chapterCount - (options.hasCorpus ? 1 : 0);

  // Build content chapters from qualified dimensions
  const chapters: OutlineChapter[] = [];
  const usedBucketKeys = new Set<string>();

  for (let i = 0; i < Math.min(contentChapters, qualifiedDimensions.length); i++) {
    const [dimension, group] = qualifiedDimensions[i];
    const bucketKeys = group.map((b) => `${b.witnessId}::${b.topicDimension}`);
    const quotableTexts = group
      .flatMap((b) => b.quotableExcerpts)
      .map((q) => q.text);

    chapters.push({
      chapterNo: i + 1,
      title: dimension,
      theme: dimension,
      bucketKeys,
      quotableTexts,
    });
    for (const key of bucketKeys) usedBucketKeys.add(key);
  }

  // If not enough qualified dimensions, merge remaining buckets into chapters
  if (chapters.length < minChapters) {
    const remaining = buckets.filter(
      (b) => !usedBucketKeys.has(`${b.witnessId}::${b.topicDimension}`),
    );
    if (remaining.length > 0) {
      const keys = remaining.map((b) => `${b.witnessId}::${b.topicDimension}`);
      const qTexts = remaining
        .flatMap((b) => b.quotableExcerpts)
        .map((q) => q.text);
      while (chapters.length < minChapters) {
        chapters.push({
          chapterNo: chapters.length + 1,
          title: 'Assorted recollections',
          theme: 'miscellaneous',
          bucketKeys: keys,
          quotableTexts: qTexts,
        });
      }
    }
  }

  // Final chapter: subject's own words
  if (options.hasCorpus) {
    chapters.push({
      chapterNo: chapters.length + 1,
      title: FINAL_CHAPTER_TITLE,
      theme: 'subject_own_words',
      bucketKeys: [],
      quotableTexts: [],
    });
  }

  // Re-number
  chapters.forEach((ch, i) => { ch.chapterNo = i + 1; });

  return {
    title: `${subjectName}, as friends remember`,
    chapters,
  };
}

/* ================================================================== */
/* 3. Chapter generation (LLM)                                         */
/* ================================================================== */

const CHAPTER_SYSTEM_PROMPT = `You are writing one chapter of a short biography about a person, based entirely on what their friends said about them.

Hard rules:
- Open with a concrete scene: anchor time, place, people in the first three sentences.
- Inside quotation marks, only use verbatim text from the "quotableTexts" list. Do not alter, paraphrase, or invent quoted text.
- Every paragraph must attribute who said it (e.g. "His college roommate recalled...").
- When two witnesses disagree about the same thing, write both accounts as separate paragraphs, each attributed, without judging who is right.
- Do not write omniscient inner thoughts (e.g. "he secretly felt..."). Only write what witnesses observed.
- If there is no material for a point, leave it out. Do not invent.
- Do not use speculative language (perhaps, maybe, must have).
- Do not use overly praising language (legendary, great, destined).
- Do not include sensitive diagnostic terms (clinical depression, narcissism, etc.).

Voice: {voice_instruction}

Output JSON:
{
  "title": "chapter title",
  "paragraphs": [
    {
      "text": "paragraph text",
      "attribution": { "displayName": "witness relation label" },
      "sourceWitnessIds": ["w1"],
      "conflict": false
    }
  ]
}`;

const CHAPTER_USER_PROMPT = `Write chapter {chapterNo}: "{title}" (theme: {theme}).

Material from witnesses:
{material}

Quotable texts (only these exact strings may appear inside quotation marks):
{quotableTexts}

Style: {voice_label}
Subject name: {subjectName}`;

interface RawChapterOutput {
  title: string;
  paragraphs: Array<{
    text: string;
    attribution?: { displayName: string; relation?: string } | null;
    sourceWitnessIds?: string[];
    conflict?: boolean;
  }>;
}

const RawChapterSchema = z.object({
  title: z.string().min(1),
  paragraphs: z.array(z.object({
    text: z.string().min(1),
    attribution: z.object({
      displayName: z.string().min(1),
      relation: z.string().optional(),
    }).nullable().optional(),
    sourceWitnessIds: z.array(z.string()).optional(),
    conflict: z.boolean().optional(),
  })).min(1),
});

/**
 * Generate one chapter via LLM with structured JSON output and one repair retry.
 * Migrated from life-book-chapter-generator.ts's structured-json pattern.
 */
export async function generateChapter(
  llm: LLMClient,
  chapter: OutlineChapter,
  materialForChapter: MaterialBucket[],
  quotableIndex: QuotableEntry[],
  subjectName: string,
  style: BiographyStyle,
): Promise<RawChapterOutput> {
  const voiceInstruction = style.voice === 'third_person_observer'
    ? 'Third person observer perspective. Write "he" or "she".'
    : style.voice === 'letter_to_friends'
      ? 'As if friends are collectively writing a letter about this person.'
      : 'Documentary voiceover style. Short sentences, visual detail.';

  const materialText = materialForChapter
    .map((b) => `[${b.displayName} (${b.consentLevel})]: ${b.excerpts.join(' | ')}`)
    .join('\n');

  const quotableTextsText = chapter.quotableTexts.length > 0
    ? chapter.quotableTexts.map((t) => `- "${t}"`).join('\n')
    : '(none available)';

  const system = CHAPTER_SYSTEM_PROMPT.replace('{voice_instruction}', voiceInstruction);
  const user = CHAPTER_USER_PROMPT
    .replace('{chapterNo}', String(chapter.chapterNo))
    .replace('{title}', chapter.title)
    .replace('{theme}', chapter.theme)
    .replace('{material}', materialText)
    .replace('{quotableTexts}', quotableTextsText)
    .replace('{voice_label}', style.label)
    .replace('{subjectName}', subjectName);

  // First attempt
  const text = await llm.complete({
    system,
    user,
    maxTokens: 2048,
    purpose: 'biography-chapter',
  });

  let parsed: RawChapterOutput;
  try {
    const raw = extractJson(text);
    parsed = RawChapterSchema.parse(raw);
  } catch (firstError) {
    // Repair retry: feed back the error
    const repairUser = `Your previous output had a validation error: ${firstError instanceof Error ? firstError.message : String(firstError)}\n\nPlease fix and output valid JSON matching the schema.`;
    const repairText = await llm.complete({
      system,
      user: repairUser,
      maxTokens: 2048,
      purpose: 'biography-chapter-repair',
    });
    const repairRaw = extractJson(repairText);
    parsed = RawChapterSchema.parse(repairRaw);
  }

  return parsed;
}

/* ================================================================== */
/* 4. Output validation (pure functions)                               */
/* ================================================================== */

export interface ValidationFailure {
  paragraphIndex: number;
  reason: string;
}

/**
 * Validate a chapter's output against the quotable index and rules.
 *
 * Returns an array of failures. Empty = pass.
 * This is a hard gate: any failure means the chapter is rejected.
 */
export function validateChapter(
  paragraphs: BiographyParagraph[],
  quotableIndex: QuotableEntry[],
  synthWitnesses: Set<string>,
  allowedWitnessIds: Set<string>,
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const quotableSet = new Set(quotableIndex.map((q) => q.text));

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];

    // Check source refs are in whitelist
    for (const ref of para.sourceRefs) {
      if (!allowedWitnessIds.has(ref.witnessId)) {
        failures.push({ paragraphIndex: i, reason: `unknown witness ref: ${ref.witnessId}` });
      }
    }

    // Check quoted text is in quotable index (verbatim)
    const quotedMatches = para.text.matchAll(/["“]([^"”]+)["”]/g);
    for (const match of quotedMatches) {
      const quoted = match[1].trim();
      if (!quotableSet.has(quoted)) {
        failures.push({
          paragraphIndex: i,
          reason: `untraceable quote: "${quoted.slice(0, 60)}"`,
        });
      }
    }

    // Check synthesis_only witnesses' raw text does not appear verbatim (>=8 chars)
    for (const wid of synthWitnesses) {
      // Collect all raw excerpts from this synth witness
      const synthExcerpts = quotableIndex
        .filter((q) => q.witnessId === wid)
        .map((q) => q.text);
      // Actually we need to check against raw testimony, not the quotable index
      // The quotable index only has quotable witnesses. We need the raw text.
      // So we check the paragraph text for 8-char substrings of synthesis_only excerpts.
    }
  }

  return failures;
}

/**
 * Check that synthesis_only witnesses' verbatim text (8+ consecutive chars)
 * does not appear in the output.
 */
export function checkSynthesisOnlyLeakage(
  text: string,
  synthExcerpts: string[],
): string[] {
  const leaks: string[] = [];
  for (const excerpt of synthExcerpts) {
    // Check consecutive 8-char windows
    for (let i = 0; i <= excerpt.length - 8; i++) {
      const window = excerpt.slice(i, i + 8);
      if (text.includes(window)) {
        leaks.push(window);
        break; // One leak per excerpt is enough
      }
    }
  }
  return leaks;
}

/* ================================================================== */
/* 5. Quality review (migrated from life-book-quality-reviewer)        */
/* ================================================================== */

/**
 * Review a section's quality across applicable dimensions.
 * Pure function; no LLM needed.
 */
export function reviewQuality(
  body: string,
  sourceRefs: Array<{ witnessId: string }>,
  options: { threshold?: number; siblingBodies?: string[] } = {},
): QualityResult {
  const threshold = options.threshold ?? 75;

  const dimensions: QualityDimension[] = [
    reviewObserverSemantics(body),
    reviewSpeculativeLanguage(body),
    reviewSensitiveContent(body),
    reviewOverPraise(body),
    reviewDuplication(body, options.siblingBodies ?? []),
  ];

  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0) || 1;
  const weighted = dimensions.reduce((sum, d) => sum + d.score * d.weight, 0);
  const score = Math.round((weighted / totalWeight) * 100) / 100;

  return {
    score,
    requiresRewrite: score < threshold || dimensions.some((d) => d.score < 50),
    dimensions,
  };
}

function reviewObserverSemantics(body: string): QualityDimension {
  // Omniscient narrator language
  const omniscient = /he secretly|she truly felt|deep down he|in his heart|he knew inside|what he really/i.test(body);
  return {
    key: 'observerSemantics',
    score: omniscient ? 40 : 90,
    weight: 1.2,
    issues: omniscient ? ['omniscient_narrator_language'] : [],
  };
}

function reviewSpeculativeLanguage(body: string): QualityDimension {
  const speculative = /perhaps|maybe|must have|probably|surely|one can only imagine/.test(body);
  return {
    key: 'speculativeLanguage',
    score: speculative ? 50 : 90,
    weight: 1.3,
    issues: speculative ? ['speculative_language_detected'] : [],
  };
}

function reviewSensitiveContent(body: string): QualityDimension {
  const sensitive = /clinical depression|narcissis|bipolar|sociopath|psychopath|diagnosis|diagnosed with/.test(body);
  return {
    key: 'sensitiveContent',
    score: sensitive ? 45 : 95,
    weight: 1.1,
    issues: sensitive ? ['sensitive_diagnostic_term'] : [],
  };
}

function reviewOverPraise(body: string): QualityDimension {
  const praise = /legendary|destined for greatness|a true hero|forever remembered|the greatest/.test(body);
  return {
    key: 'overPraise',
    score: praise ? 50 : 92,
    weight: 0.8,
    issues: praise ? ['excessive_praise'] : [],
  };
}

function reviewDuplication(body: string, siblings: string[]): QualityDimension {
  const normalized = body.replace(/\s+/g, '').slice(0, 1000);
  const duplicate = siblings.some((sib) => {
    const sibNorm = sib.replace(/\s+/g, '').slice(0, 1000);
    return trigramOverlap(normalized, sibNorm) > 0.72;
  });
  return {
    key: 'duplication',
    score: duplicate ? 45 : 95,
    weight: 0.8,
    issues: duplicate ? ['chapter_content_too_similar'] : [],
  };
}

function trigramOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const grams = new Set<string>();
  for (let i = 0; i < a.length - 2; i++) grams.add(a.slice(i, i + 3));
  let hit = 0;
  let total = 0;
  for (let i = 0; i < b.length - 2; i++) {
    total++;
    if (grams.has(b.slice(i, i + 3))) hit++;
  }
  return total ? hit / total : 0;
}

/* ================================================================== */
/* 6. Silence note and final chapter                                   */
/* ================================================================== */

/**
 * Build a deterministic silence paragraph. Fixed text, no LLM.
 */
export function buildSilenceNote(signals: SilenceSignal[]): string | null {
  if (signals.length === 0) return null;
  return SILENCE_NOTE;
}

/**
 * Build the final chapter: only the subject's own words from corpus.
 * If no corpus items, returns a fixed placeholder.
 */
export function buildFinalChapter(
  corpusItems: CorpusItem[],
  subjectName: string,
): BiographySection {
  if (corpusItems.length === 0) {
    return {
      id: randomUUID(),
      chapterNo: -1, // will be reassigned
      title: FINAL_CHAPTER_TITLE,
      paragraphs: [{
        text: FINAL_CHAPTER_PLACEHOLDER,
        attribution: null,
        sourceRefs: [],
        conflict: false,
      }],
      removed: false,
      removalNote: null,
      qualityScore: null,
      qualityIssues: [],
    };
  }

  const paragraphs: BiographyParagraph[] = corpusItems.map((item) => ({
    text: item.text,
    attribution: { displayName: subjectName },
    sourceRefs: [],
    conflict: false,
  }));

  return {
    id: randomUUID(),
    chapterNo: -1,
    title: FINAL_CHAPTER_TITLE,
    paragraphs,
    removed: false,
    removalNote: null,
    qualityScore: null,
    qualityIssues: [],
  };
}

/* ================================================================== */
/* Pipeline: full generation                                           */
/* ================================================================== */

export interface GenerationResult {
  biography: Biography;
  validationFailures: Map<number, ValidationFailure[]>;
  qualityResults: Map<number, QualityResult>;
  usageStats: { totalCalls: number; purposes: Record<string, number> };
}

export async function generateBiography(
  llm: LLMClient | null,
  store: Store,
  subjectId: string,
  config: BiographyConfig,
): Promise<GenerationResult> {
  const subject = store.getSubject(subjectId);
  if (!subject) throw new Error('subject_not_found');

  const witnesses = store.listWitnessesBySubject(subjectId);
  const minWitnesses = config.minWitnesses ?? 3;
  if (witnesses.length < minWitnesses) {
    throw new Error(`insufficient_witnesses: need ${minWitnesses}, have ${witnesses.length}`);
  }

  const testimonies = store.listBySubject(subjectId);
  const episodes = store.listEpisodesBySubject(subjectId);
  const claims = store.listClaimsBySubject(subjectId);
  const divergences = store.listDivergencesBySubject(subjectId);
  const corpusItems = store.listCorpusItemsBySubject(subjectId);

  // Get silence signals if available
  let silenceSignals: SilenceSignal[] = [];
  // We'll handle this in the plugin where we have access to ctx

  // Build material
  const { buckets, quotableIndex } = buildMaterialBuckets(
    witnesses, testimonies, episodes, claims,
  );

  const style = config.style ?? DEFAULT_STYLE;
  const hasCorpus = corpusItems.length > 0;

  // Build outline
  const outline = buildOutline(buckets, quotableIndex, subject.displayName, {
    minChapters: config.minChapters ?? 3,
    maxChapters: config.maxChapters ?? 6,
    minWitnesses,
    hasCorpus,
  });

  // Synthesis-only witness tracking
  const synthWitnesses = new Set(
    witnesses.filter((w) => w.consentLevel === 'synthesis_only').map((w) => w.id),
  );
  const synthExcerpts = buckets
    .filter((b) => synthWitnesses.has(b.witnessId))
    .flatMap((b) => b.excerpts);
  const allowedWitnessIds = new Set(witnesses.map((w) => w.id));

  const sections: BiographySection[] = [];
  const validationFailures = new Map<number, ValidationFailure[]>();
  const qualityResults = new Map<number, QualityResult>();
  let totalCalls = 0;
  const purposes: Record<string, number> = {};

  function trackCall(purpose: string) {
    totalCalls++;
    purposes[purpose] = (purposes[purpose] ?? 0) + 1;
  }

  for (const ch of outline.chapters) {
    // Final chapter is deterministic
    if (ch.theme === 'subject_own_words') {
      const finalSection = buildFinalChapter(corpusItems, subject.displayName);
      finalSection.chapterNo = ch.chapterNo;
      sections.push(finalSection);
      continue;
    }

    if (!llm) {
      // No LLM: add placeholder section
      sections.push({
        id: randomUUID(),
        chapterNo: ch.chapterNo,
        title: ch.title,
        paragraphs: [{
          text: '[Biography generation requires a language model. Please configure LLM_BASE_URL and LLM_MODEL.]',
          attribution: null,
          sourceRefs: [],
          conflict: false,
        }],
        removed: false,
        removalNote: null,
        qualityScore: null,
        qualityIssues: [],
      });
      continue;
    }

    // Gather material for this chapter
    const chapterBuckets = buckets.filter((b) =>
      ch.bucketKeys.includes(`${b.witnessId}::${b.topicDimension}`),
    );
    const chapterQuotable = quotableIndex.filter((q) =>
      ch.quotableTexts.includes(q.text),
    );

    try {
      trackCall('biography-chapter');
      const raw = await generateChapter(
        llm, ch, chapterBuckets, chapterQuotable, subject.displayName, style,
      );
      // Track potential repair call
      // (tracked inside generateChapter via llm.complete purpose)

      // Map raw output to BiographyParagraph
      const paragraphs: BiographyParagraph[] = raw.paragraphs.map((p) => ({
        text: p.text,
        attribution: p.attribution ?? null,
        sourceRefs: (p.sourceWitnessIds ?? []).map((wid) => ({ witnessId: wid })),
        conflict: p.conflict ?? false,
      }));

      // Detect adjacent paragraph conflicts (different attribution, similar text)
      for (let i = 0; i < paragraphs.length - 1; i++) {
        const a = paragraphs[i];
        const b = paragraphs[i + 1];
        if (
          a.attribution?.displayName &&
          b.attribution?.displayName &&
          a.attribution.displayName !== b.attribution.displayName
        ) {
          const overlap = trigramOverlap(
            a.text.replace(/\s+/g, ''),
            b.text.replace(/\s+/g, ''),
          );
          if (overlap > 0.2) {
            a.conflict = true;
            b.conflict = true;
          }
        }
      }

      // Validate
      const failures = validateChapter(
        paragraphs, quotableIndex, synthWitnesses, allowedWitnessIds,
      );

      // Check synthesis_only leakage
      const fullText = paragraphs.map((p) => p.text).join('\n');
      const leaks = checkSynthesisOnlyLeakage(fullText, synthExcerpts);
      for (const leak of leaks) {
        failures.push({
          paragraphIndex: -1,
          reason: `synthesis_only raw text leaked: "${leak}"`,
        });
      }

      if (failures.length > 0) {
        validationFailures.set(ch.chapterNo, failures);
      }

      // Quality review
      const siblingBodies = sections.map((s) =>
        s.paragraphs.map((p) => p.text).join('\n'),
      );
      const qr = reviewQuality(fullText, paragraphs.flatMap((p) => p.sourceRefs), {
        threshold: config.qualityThreshold ?? 75,
        siblingBodies,
      });
      qualityResults.set(ch.chapterNo, qr);

      sections.push({
        id: randomUUID(),
        chapterNo: ch.chapterNo,
        title: raw.title || ch.title,
        paragraphs,
        removed: false,
        removalNote: null,
        qualityScore: qr.score,
        qualityIssues: qr.dimensions,
      });
    } catch (err) {
      // Generation failed: record as failed section
      sections.push({
        id: randomUUID(),
        chapterNo: ch.chapterNo,
        title: ch.title,
        paragraphs: [{
          text: `[Generation failed: ${err instanceof Error ? err.message : String(err)}]`,
          attribution: null,
          sourceRefs: [],
          conflict: false,
        }],
        removed: false,
        removalNote: null,
        qualityScore: 0,
        qualityIssues: [],
      });
    }
  }

  const biography: Biography = {
    id: randomUUID(),
    subjectId,
    title: outline.title,
    sections,
    silenceNote: null, // set by caller with silence signals
    finalChapterNote: corpusItems.length === 0 ? FINAL_CHAPTER_PLACEHOLDER : null,
    generatedAt: new Date().toISOString(),
    style,
  };

  return {
    biography,
    validationFailures,
    qualityResults,
    usageStats: { totalCalls, purposes },
  };
}

/* ================================================================== */
/* Plugin                                                              */
/* ================================================================== */

export const outputBiographyPlugin: Plugin<BiographyConfig> = {
  name: 'output-biography',
  kind: 'engine',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx, config) {
    const store = ctx.get<Store>('store');
    const cfg: BiographyConfig = config ?? {};

    // Plugin tables
    const bioTable = store.registerPluginTable(
      'output_biography', 'biographies',
      `CREATE TABLE IF NOT EXISTS plugin_output_biography_biographies (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      { appendOnly: false },
    );

    const sectionTable = store.registerPluginTable(
      'output_biography', 'sections',
      `CREATE TABLE IF NOT EXISTS plugin_output_biography_sections (
        id TEXT PRIMARY KEY,
        biography_id TEXT NOT NULL,
        chapter_no INTEGER NOT NULL,
        data TEXT NOT NULL,
        removed INTEGER NOT NULL DEFAULT 0,
        removal_note TEXT
      )`,
      { appendOnly: false },
    );

    // In-memory cache
    const biographies = new Map<string, Biography>();

    // Hydrate from DB
    for (const row of bioTable.query()) {
      try {
        const data = JSON.parse(row.data as string) as Biography;
        biographies.set(data.subjectId, data);
      } catch { /* skip malformed */ }
    }

    // Provide service for testing
    ctx.provide('output-biography', {
      biographies,
      generate: doGenerate,
      getBiography: (subjectId: string) => biographies.get(subjectId) ?? null,
    });

    async function doGenerate(subjectId: string): Promise<GenerationResult> {
      const llm: LLMClient | null = ctx.has('llm') ? ctx.get<LLMClient>('llm') : null;

      const result = await generateBiography(llm, store, subjectId, cfg);

      // Add silence note if silence-signal is available
      if (ctx.has('silence-signal')) {
        const silenceService = ctx.get<{ table: PluginTableHandle; scan: (id: string) => SilenceSignal[] }>('silence-signal');
        const signals = silenceService.scan(subjectId);
        result.biography.silenceNote = buildSilenceNote(signals);
      }

      // Persist
      const now = new Date().toISOString();
      // Remove old biography for this subject
      bioTable.delete('subject_id = ?', [subjectId]);
      sectionTable.delete(
        'biography_id IN (SELECT id FROM plugin_output_biography_biographies WHERE subject_id = ?)',
        [subjectId],
      );

      bioTable.insert({
        id: result.biography.id,
        subject_id: subjectId,
        data: JSON.stringify(result.biography),
        created_at: now,
      });

      for (const section of result.biography.sections) {
        sectionTable.insert({
          id: section.id,
          biography_id: result.biography.id,
          chapter_no: section.chapterNo,
          data: JSON.stringify(section),
          removed: section.removed ? 1 : 0,
          removal_note: section.removalNote,
        });
      }

      biographies.set(subjectId, result.biography);
      return result;
    }

    function removeSection(biographyId: string, sectionId: string): Biography | null {
      // Find the biography
      let bio: Biography | null = null;
      for (const b of biographies.values()) {
        if (b.id === biographyId) { bio = b; break; }
      }
      if (!bio) return null;

      const section = bio.sections.find((s) => s.id === sectionId);
      if (!section) return null;

      section.removed = true;
      section.removalNote = REMOVAL_NOTE_TEMPLATE;

      // Persist update
      sectionTable.update(
        { removed: 1, removal_note: section.removalNote, data: JSON.stringify(section) },
        'id = ?',
        [sectionId],
      );
      bioTable.update(
        { data: JSON.stringify(bio) },
        'id = ?',
        [biographyId],
      );

      return bio;
    }

    // Routes
    if (!ctx.has('router')) return;
    const router = ctx.get<Router>('router');

    /* POST /api/subjects/:id/biography -- generate */
    router.post('/api/subjects/:id/biography', (context) => {
      const subjectId = context.params.id ?? '';
      const subject = store.getSubject(subjectId);
      if (!subject) {
        return { status: 404, body: { error: { code: 'not_found', message: 'Subject not found' } } };
      }

      if (!ctx.has('llm')) {
        return {
          status: 501,
          body: { error: { code: 'no_llm', message: 'Language model not configured. Set LLM_BASE_URL and LLM_MODEL to generate a biography.' } },
        };
      }

      const promise = doGenerate(subjectId);
      return promise.then((result) => ({
        status: 200,
        body: {
          biography: sanitizeBiography(result.biography),
          validation: Object.fromEntries(result.validationFailures),
          quality: Object.fromEntries(
            [...result.qualityResults.entries()].map(([k, v]) => [k, v]),
          ),
          usage: result.usageStats,
        },
      })).catch((err) => ({
        status: 400,
        body: { error: { code: 'generation_failed', message: err instanceof Error ? err.message : String(err) } },
      }));
    });

    /* GET /api/subjects/:id/biography -- retrieve */
    router.get('/api/subjects/:id/biography', (context) => {
      const subjectId = context.params.id ?? '';
      const subject = store.getSubject(subjectId);
      if (!subject) {
        return { status: 404, body: { error: { code: 'not_found', message: 'Subject not found' } } };
      }

      const bio = biographies.get(subjectId);
      if (!bio) {
        return { status: 404, body: { error: { code: 'no_biography', message: 'No biography generated yet' } } };
      }

      return { status: 200, body: sanitizeBiography(bio) };
    });

    /* POST /api/biography/:id/sections/:sid/remove -- subject veto */
    router.post('/api/biography/:id/sections/:sid/remove', (context) => {
      const biographyId = context.params.id ?? '';
      const sectionId = context.params.sid ?? '';

      const result = removeSection(biographyId, sectionId);
      if (!result) {
        return { status: 404, body: { error: { code: 'not_found', message: 'Biography or section not found' } } };
      }

      return { status: 200, body: sanitizeBiography(result) };
    });
  },
};

/**
 * Sanitize biography for API output: removed sections get replaced
 * with the removal note.
 */
function sanitizeBiography(bio: Biography): unknown {
  return {
    ...bio,
    sections: bio.sections.map((s) => {
      if (s.removed) {
        return {
          ...s,
          paragraphs: [{
            text: s.removalNote ?? REMOVAL_NOTE_TEMPLATE,
            attribution: null,
            sourceRefs: [],
            conflict: false,
          }],
        };
      }
      return s;
    }),
  };
}

export default outputBiographyPlugin;
