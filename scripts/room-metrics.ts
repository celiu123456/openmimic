#!/usr/bin/env npx tsx
/**
 * Room realism metrics: offline-testable pure functions + a CLI that reads a
 * room transcript and produces a report.
 *
 * Metrics:
 *   1. Tier distribution (extrapolate ratio)
 *   2. Sentence length distribution (median, p90)
 *   3. Secret leak detection
 *   4. Behind/front divergence (same-witness word overlap + evaluative-word ratio)
 *   5. Reply-chain rate (does a line respond to the previous 1-2 lines?)
 *   6. Repetition rate (pairwise ≥5-char contiguous overlap between utterances)
 *   7. Front frontText anchor rate (front lines sourced from frontText)
 *   8. Half-truth check (exactly 1 front line echoes behindText, short)
 *   9. Front third-person reference rate (front lines using 他/她 for subject)
 */

import type { RoomUtterance, UtteranceTier } from '@openmimic/shared';
import {
  hasFrontThirdPerson,
  normalizePronoun,
  extractFactElements,
  hasFactLevelLeak,
  type PrivateFactElements,
} from '@openmimic/engine-room';

/* ------------------------------------------------------------------ */
/* 1. Tier distribution                                                */
/* ------------------------------------------------------------------ */

export interface TierRatio {
  quote: number;
  paraphrase: number;
  extrapolate: number;
  total: number;
  extrapolateRatio: number;
}

export function tierRatio(utterances: readonly RoomUtterance[]): TierRatio {
  let quote = 0;
  let paraphrase = 0;
  let extrapolate = 0;
  for (const u of utterances) {
    const t: UtteranceTier = u.tier ?? 'extrapolate';
    if (t === 'quote') quote++;
    else if (t === 'paraphrase') paraphrase++;
    else extrapolate++;
  }
  const total = utterances.length;
  return {
    quote,
    paraphrase,
    extrapolate,
    total,
    extrapolateRatio: total > 0 ? extrapolate / total : 0,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Sentence length distribution                                     */
/* ------------------------------------------------------------------ */

export interface LengthStats {
  /** Character counts of every speech utterance (sorted ascending). */
  lengths: number[];
  median: number;
  mean: number;
  p90: number;
  max: number;
}

export function lengthStats(utterances: readonly RoomUtterance[]): LengthStats {
  const speechLengths = utterances
    .filter((u) => u.kind === 'speech')
    .map((u) => u.text.length)
    .sort((a, b) => a - b);

  if (speechLengths.length === 0) {
    return { lengths: [], median: 0, mean: 0, p90: 0, max: 0 };
  }

  const median = speechLengths[Math.floor(speechLengths.length / 2)]!;
  const mean = speechLengths.reduce((a, b) => a + b, 0) / speechLengths.length;
  const p90Index = Math.min(
    Math.floor(speechLengths.length * 0.9),
    speechLengths.length - 1,
  );
  const p90 = speechLengths[p90Index]!;
  const max = speechLengths[speechLengths.length - 1]!;

  return { lengths: speechLengths, median, mean, p90, max };
}

/* ------------------------------------------------------------------ */
/* 3. Secret leak detection                                            */
/* ------------------------------------------------------------------ */

/**
 * Phrases that mark private/confidential content in testimony text.
 * When any of these appear in a testimony answer, that sentence (plus the
 * preceding sentence) is flagged as "private".
 */
const PRIVATE_MARKERS = [
  '别告诉',
  '别跟',
  '千万别',
  '别外传',
  '只跟你说',
  '你可别',
  '你别跟',
  '谁都没说',
  '别人不知道',
  '没跟',
  '嘱咐我',
];

/** Split Chinese text into sentences on common sentence-end punctuation. */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！？；\n])/).map((s) => s.trim()).filter(Boolean);
}

export interface PrivateFragment {
  witnessId: string;
  qid: string;
  /** The private sentence(s) extracted from testimony. */
  text: string;
}

/**
 * Extract private fragments from testimony: sentences containing a privacy
 * marker plus their preceding sentence.
 */
export function extractPrivateFragments(
  testimonies: readonly {
    witnessId: string;
    answers: readonly { qid: string; behindText: string }[];
  }[],
): PrivateFragment[] {
  const fragments: PrivateFragment[] = [];
  for (const t of testimonies) {
    for (const a of t.answers) {
      const sentences = splitSentences(a.behindText);
      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i]!;
        if (PRIVATE_MARKERS.some((m) => sentence.includes(m))) {
          const parts: string[] = [];
          if (i > 0) parts.push(sentences[i - 1]!);
          parts.push(sentence);
          fragments.push({
            witnessId: t.witnessId,
            qid: a.qid,
            text: parts.join(''),
          });
        }
      }
    }
  }
  return fragments;
}

export interface LeakResult {
  /** Which witness leaked. */
  witnessId: string;
  /** The private fragment that was leaked. */
  fragment: PrivateFragment;
  /** The room line that leaked it. */
  utteranceText: string;
  /** The type of match. */
  matchType: 'substring' | 'numeric' | 'fact-level';
}

/**
 * Chinese amount pattern: 两万, 三千五, etc. + Arabic with units.
 */
const CN_AMOUNT_PATTERN =
  /[一二两三四五六七八九十百千万亿\d]+[万千百亿](?:[一二两三四五六七八九十百千万]*)(?:块|元)?|\d[\d,.]*(?:万|千|百|元|块)/g;

/**
 * Check whether any room line leaks private content.
 *
 * Three-layer detection:
 *   1. Substring overlap: >= 6 contiguous characters in common with a private fragment
 *   2. Numeric match: same amount (Chinese or Arabic) appears
 *   3. Fact-level: matches 2+ categories of extracted fact elements (amounts, verbs, nouns)
 */
export function detectLeaks(
  utterances: readonly RoomUtterance[],
  privateFragments: readonly PrivateFragment[],
): LeakResult[] {
  const leaks: LeakResult[] = [];

  // Extract fact elements for each fragment
  const fragElements: PrivateFactElements[] = privateFragments.map((f) =>
    extractFactElements(f.text),
  );

  const arabicNumberPattern = /\d[\d,.]*\d|\d/g;

  for (const u of utterances) {
    if (u.kind === 'stage') continue;
    for (let fi = 0; fi < privateFragments.length; fi++) {
      const frag = privateFragments[fi]!;
      const fragText = frag.text;
      let matched = false;

      // Layer 1: Substring overlap >= 8 contiguous characters
      const MIN_OVERLAP = 8;
      for (let start = 0; start + MIN_OVERLAP <= fragText.length; start++) {
        const sub = fragText.slice(start, start + MIN_OVERLAP);
        if (u.text.includes(sub)) {
          leaks.push({
            witnessId: u.witnessId,
            fragment: frag,
            utteranceText: u.text,
            matchType: 'substring',
          });
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Layer 2: Chinese amount match
      const fragCnAmounts = [...fragText.matchAll(CN_AMOUNT_PATTERN)].map((m) => m[0]);
      const fragArabicNumbers = [...fragText.matchAll(arabicNumberPattern)].map((m) => m[0]);
      const allFragAmounts = [...fragCnAmounts, ...fragArabicNumbers];

      if (allFragAmounts.length > 0) {
        const uttCnAmounts = [...u.text.matchAll(CN_AMOUNT_PATTERN)].map((m) => m[0]);
        const uttArabicNumbers = [...u.text.matchAll(arabicNumberPattern)].map((m) => m[0]);
        const allUttAmounts = [...uttCnAmounts, ...uttArabicNumbers];

        for (const a of allFragAmounts) {
          if (a.length >= 2 && allUttAmounts.includes(a)) {
            leaks.push({
              witnessId: u.witnessId,
              fragment: frag,
              utteranceText: u.text,
              matchType: 'numeric',
            });
            matched = true;
            break;
          }
        }
      }
      if (matched) continue;

      // Layer 3: Fact-level element matching (2+ categories)
      const el = fragElements[fi]!;
      if (hasFactLevelLeak(u.text, [el])) {
        leaks.push({
          witnessId: u.witnessId,
          fragment: frag,
          utteranceText: u.text,
          matchType: 'fact-level',
        });
      }
    }
  }
  return leaks;
}

/* ------------------------------------------------------------------ */
/* 4. Behind/front divergence                                          */
/* ------------------------------------------------------------------ */

/** CJK bigrams + latin words, like tier.ts's approach. */
function tokens(text: string): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    const a = text.codePointAt(i) ?? 0;
    const b = text.codePointAt(i + 1) ?? 0;
    if (a >= 0x4e00 && a <= 0x9fff && b >= 0x4e00 && b <= 0x9fff) {
      result.add(text.slice(i, i + 2));
    }
  }
  for (const word of text.split(/\s+/)) {
    if (word.length >= 2 && /^[a-zA-Z0-9]+$/.test(word)) {
      result.add(word.toLowerCase());
    }
  }
  return result;
}

function setOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const t of a) if (b.has(t)) count++;
  return count;
}

/** Evaluative words that indicate judgment rather than neutral observation. */
const EVALUATIVE_WORDS = [
  '真的', '特别', '很', '太', '最', '非常',
  '从来', '一直', '总是', '永远',
  '就是', '其实', '果然',
  '不错', '厉害', '牛', '差', '烂', '垃圾',
  '好人', '坏', '善良', '自私', '虚伪',
  '觉得', '认为', '感觉', '印象',
  '像', '简直', '活该',
  '配不上', '分不清', '算什么',
  '逃兵', '害怕', '讨厌',
];

export interface WitnessDivergence {
  witnessId: string;
  /** Number of behind speech lines. */
  behindCount: number;
  /** Number of front speech lines. */
  frontCount: number;
  /** Token overlap ratio: |A ∩ B| / |A ∪ B|. Lower = more different. */
  overlapRatio: number;
  /** Fraction of front speech tokens that are evaluative words. */
  frontEvaluativeRatio: number;
}

export function witnessDivergence(
  behind: readonly RoomUtterance[],
  front: readonly RoomUtterance[],
): WitnessDivergence[] {
  // Group speech by witness
  const behindByWit = new Map<string, string[]>();
  const frontByWit = new Map<string, string[]>();

  for (const u of behind) {
    if (u.kind !== 'speech') continue;
    const arr = behindByWit.get(u.witnessId) ?? [];
    arr.push(u.text);
    behindByWit.set(u.witnessId, arr);
  }
  for (const u of front) {
    if (u.kind !== 'speech') continue;
    const arr = frontByWit.get(u.witnessId) ?? [];
    arr.push(u.text);
    frontByWit.set(u.witnessId, arr);
  }

  const allWits = new Set([...behindByWit.keys(), ...frontByWit.keys()]);
  const results: WitnessDivergence[] = [];

  for (const wid of allWits) {
    const bTexts = behindByWit.get(wid) ?? [];
    const fTexts = frontByWit.get(wid) ?? [];
    if (bTexts.length === 0 || fTexts.length === 0) continue;

    const bTokens = tokens(bTexts.join(' '));
    const fTokens = tokens(fTexts.join(' '));

    const overlap = setOverlap(bTokens, fTokens);
    const union = new Set([...bTokens, ...fTokens]).size;
    const overlapRatio = union > 0 ? overlap / union : 0;

    // Evaluative ratio in front lines
    const frontJoined = fTexts.join(' ');
    let evalCount = 0;
    for (const w of EVALUATIVE_WORDS) {
      const re = new RegExp(w, 'g');
      const matches = frontJoined.match(re);
      if (matches) evalCount += matches.length;
    }
    // Rough word count: CJK chars + latin words
    const roughWordCount = (frontJoined.match(/[一-鿿]/g)?.length ?? 0) +
      (frontJoined.split(/\s+/).filter((w) => /^[a-zA-Z]/.test(w)).length);
    const frontEvaluativeRatio = roughWordCount > 0 ? evalCount / roughWordCount : 0;

    results.push({
      witnessId: wid,
      behindCount: bTexts.length,
      frontCount: fTexts.length,
      overlapRatio,
      frontEvaluativeRatio,
    });
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* 5. Reply-chain rate                                                 */
/* ------------------------------------------------------------------ */

/** Very common CJK characters that shouldn't count as meaningful overlap. */
const STOP_CHARS = new Set([
  '的', '了', '是', '在', '不', '也', '他', '她', '我', '你',
  '都', '就', '和', '有', '这', '那', '一', '个', '人', '上',
  '说', '到', '来', '去', '会', '很', '着', '把', '被', '让',
  '还', '又', '吗', '呢', '吧', '啊', '嗯', '哦', '哈',
]);

/** Extract content tokens for reply-chain matching. Uses both CJK bigrams and
 *  meaningful single characters (filtered by stopwords), plus latin words. */
function replyTokens(text: string): Set<string> {
  const result = new Set<string>();
  // CJK bigrams
  for (let i = 0; i < text.length - 1; i++) {
    const a = text.codePointAt(i) ?? 0;
    const b = text.codePointAt(i + 1) ?? 0;
    if (a >= 0x4e00 && a <= 0x9fff && b >= 0x4e00 && b <= 0x9fff) {
      result.add(text.slice(i, i + 2));
    }
  }
  // CJK unigrams (non-stop)
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff && !STOP_CHARS.has(char)) {
      result.add(char);
    }
  }
  // Latin words
  for (const word of text.split(/\s+/)) {
    if (word.length >= 2 && /^[a-zA-Z0-9]+$/.test(word)) {
      result.add(word.toLowerCase());
    }
  }
  return result;
}

/**
 * For each speech utterance after the first, check whether it "responds to"
 * one of the previous 2 utterances. A response is detected when there is
 * token overlap above a threshold (meaningful CJK characters + bigrams).
 */
export function replyChainRate(utterances: readonly RoomUtterance[]): {
  replyCount: number;
  eligible: number;
  rate: number;
} {
  const speeches = utterances.filter((u) => u.kind === 'speech');
  if (speeches.length <= 1) return { replyCount: 0, eligible: 0, rate: 0 };

  let replyCount = 0;
  const eligible = speeches.length - 1;

  for (let i = 1; i < speeches.length; i++) {
    const current = replyTokens(speeches[i]!.text);
    // Look back at previous 1–2 speeches
    let found = false;
    for (let j = Math.max(0, i - 2); j < i && !found; j++) {
      const prev = replyTokens(speeches[j]!.text);
      const overlap = setOverlap(current, prev);
      // Threshold: at least 3 shared tokens = likely a response
      if (overlap >= 3) found = true;
    }
    if (found) replyCount++;
  }

  return { replyCount, eligible, rate: eligible > 0 ? replyCount / eligible : 0 };
}

/* ------------------------------------------------------------------ */
/* 6. Repetition rate                                                  */
/* ------------------------------------------------------------------ */

/**
 * Check if two strings share a contiguous substring of at least `minLen` chars.
 */
export function hasContiguousOverlap(a: string, b: string, minLen: number): boolean {
  if (a.length < minLen || b.length < minLen) return false;
  for (let start = 0; start + minLen <= a.length; start++) {
    if (b.includes(a.slice(start, start + minLen))) return true;
  }
  return false;
}

/**
 * Fraction of speech-utterance pairs that share ≥5 contiguous characters.
 * Only counts unique pairs (i,j) where i < j.
 */
export function repetitionRate(utterances: readonly RoomUtterance[]): {
  duplicatePairs: number;
  totalPairs: number;
  rate: number;
} {
  const speeches = utterances.filter((u) => u.kind === 'speech');
  let duplicatePairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < speeches.length; i++) {
    for (let j = i + 1; j < speeches.length; j++) {
      totalPairs++;
      if (hasContiguousOverlap(speeches[i]!.text, speeches[j]!.text, 5)) {
        duplicatePairs++;
      }
    }
  }
  return {
    duplicatePairs,
    totalPairs,
    rate: totalPairs > 0 ? duplicatePairs / totalPairs : 0,
  };
}

/* ------------------------------------------------------------------ */
/* 7. Front frontText anchor rate                                      */
/* ------------------------------------------------------------------ */

export interface FrontTextInfo {
  witnessId: string;
  qid: string;
  frontText: string;
}

/**
 * Among front-room speech utterances, what fraction are quote or paraphrase
 * tier (i.e. anchored to testimony that has frontText)?
 *
 * `frontTextEntries` is the list of (witnessId, qid, frontText) tuples so we
 * can verify anchors actually point to answers that have frontText.
 */
export function frontTextAnchorRate(
  front: readonly RoomUtterance[],
  frontTextEntries: readonly FrontTextInfo[],
): { anchored: number; total: number; rate: number } {
  const speeches = front.filter((u) => u.kind === 'speech');
  if (speeches.length === 0) return { anchored: 0, total: 0, rate: 0 };

  // Build a set of (witnessId, qid) that have frontText
  const hasFrontText = new Set(
    frontTextEntries.map((e) => `${e.witnessId}:${e.qid}`),
  );

  let anchored = 0;
  for (const u of speeches) {
    const tier = u.tier ?? 'extrapolate';
    if (tier === 'quote' || tier === 'paraphrase') {
      // Verify at least one anchor points to a qid with frontText
      const hasValidAnchor = u.anchors?.some((a) =>
        hasFrontText.has(`${u.witnessId}:${a.qid}`),
      );
      if (hasValidAnchor) anchored++;
    }
  }

  return { anchored, total: speeches.length, rate: anchored / speeches.length };
}

/* ------------------------------------------------------------------ */
/* 8. Half-truth check                                                 */
/* ------------------------------------------------------------------ */

export interface BehindTextInfo {
  witnessId: string;
  qid: string;
  behindText: string;
}

export interface HalfTruthResult {
  /** Number of front lines that echo behindText (≥4 chars, ≤25 chars). */
  halfTruthCount: number;
  /** Number of front lines that dangerously echo behindText (≥8 chars). */
  heavyEchoCount: number;
  /** Whether exactly 1 half-truth exists and no heavy echoes exist. */
  pass: boolean;
  details: string[];
}

/** Patterns that indicate an interrupted / self-censored half-truth ending. */
const HALF_TRUTH_ENDINGS = ['……', '...', '算了', '不说了', '没什么', '不提了', '别说了', '罢了'];

/**
 * Check whether a line ends with a self-interruption pattern
 * (ellipsis, "算了", "不说了", etc.).
 */
export function hasInterruptedEnding(text: string): boolean {
  const trimmed = text.replace(/[。！？，、；：""''（）「」\s]+$/g, '');
  return HALF_TRUTH_ENDINGS.some((e) => trimmed.endsWith(e));
}

/**
 * Check the "half-truth" rule for the front room:
 * - Exactly 1 front speech line should have ≥4-char overlap with its witness's
 *   behindText, be ≤25 chars long, and end with a self-interruption pattern.
 * - No other front speech line should have ≥8-char overlap with behindText.
 */
export function halfTruthCheck(
  front: readonly RoomUtterance[],
  behindTexts: readonly BehindTextInfo[],
): HalfTruthResult {
  const speeches = front.filter((u) => u.kind === 'speech');
  const details: string[] = [];

  // Group behindTexts by witnessId
  const behindByWit = new Map<string, string[]>();
  for (const bt of behindTexts) {
    const arr = behindByWit.get(bt.witnessId) ?? [];
    arr.push(bt.behindText);
    behindByWit.set(bt.witnessId, arr);
  }

  let halfTruthCount = 0;
  let heavyEchoCount = 0;

  for (const u of speeches) {
    const witBehind = behindByWit.get(u.witnessId) ?? [];
    if (witBehind.length === 0) continue;

    // Pronoun-normalize for comparison (front line uses 你, behind uses 他/她)
    const normText = normalizePronoun(u.text);
    const normBehind = witBehind.map((bt) => normalizePronoun(bt));

    // Check for ≥8 char overlap (heavy echo - forbidden for non-half-truth lines)
    const has8 = normBehind.some((bt) => hasContiguousOverlap(normText, bt, 8));
    // Check for ≥4 char overlap + ≤25 chars + interrupted ending (half-truth candidate)
    const has4 = normBehind.some((bt) => hasContiguousOverlap(normText, bt, 4));
    const isShort = u.text.length <= 25;
    const isInterrupted = hasInterruptedEnding(u.text);

    if (has4 && isShort && isInterrupted) {
      halfTruthCount++;
      details.push(`half-truth: "${u.text}" (${u.witnessId})`);
    } else if (has8) {
      heavyEchoCount++;
      details.push(`heavy-echo: "${u.text}" (${u.witnessId})`);
    }
  }

  return {
    halfTruthCount,
    heavyEchoCount,
    pass: halfTruthCount === 1 && heavyEchoCount === 0,
    details,
  };
}

/* ------------------------------------------------------------------ */
/* 9. Front third-person reference rate                                */
/* ------------------------------------------------------------------ */

/**
 * Fraction of front-room speech utterances that use 他/她 to refer to the
 * subject (who is present). Target: 0%.
 */
export function frontThirdPersonRate(front: readonly RoomUtterance[]): {
  thirdPersonCount: number;
  total: number;
  rate: number;
} {
  const speeches = front.filter((u) => u.kind === 'speech');
  if (speeches.length === 0) return { thirdPersonCount: 0, total: 0, rate: 0 };

  let thirdPersonCount = 0;
  for (const u of speeches) {
    if (hasFrontThirdPerson(u.text)) thirdPersonCount++;
  }

  return {
    thirdPersonCount,
    total: speeches.length,
    rate: thirdPersonCount / speeches.length,
  };
}

/* ------------------------------------------------------------------ */
/* Full report                                                         */
/* ------------------------------------------------------------------ */

export interface RoomReport {
  phase: 'behind' | 'front';
  tierRatio: TierRatio;
  length: LengthStats;
  leaks: LeakResult[];
  replyChain: { replyCount: number; eligible: number; rate: number };
  repetition: { duplicatePairs: number; totalPairs: number; rate: number };
}

export interface FullReport {
  behind: RoomReport;
  front: RoomReport | null;
  divergence: WitnessDivergence[];
  frontTextAnchoring: { anchored: number; total: number; rate: number } | null;
  halfTruth: HalfTruthResult | null;
  frontThirdPerson: { thirdPersonCount: number; total: number; rate: number } | null;
}

export function buildReport(
  behind: readonly RoomUtterance[],
  front: readonly RoomUtterance[] | undefined,
  privateFragments: readonly PrivateFragment[],
  frontTextEntries?: readonly FrontTextInfo[],
  behindTextEntries?: readonly BehindTextInfo[],
): FullReport {
  const behindReport: RoomReport = {
    phase: 'behind',
    tierRatio: tierRatio(behind),
    length: lengthStats(behind),
    leaks: detectLeaks(behind, privateFragments),
    replyChain: replyChainRate(behind),
    repetition: repetitionRate(behind),
  };

  let frontReport: RoomReport | null = null;
  let frontAnchoring: FullReport['frontTextAnchoring'] = null;
  let ht: FullReport['halfTruth'] = null;

  if (front && front.length > 0) {
    frontReport = {
      phase: 'front',
      tierRatio: tierRatio(front),
      length: lengthStats(front),
      leaks: detectLeaks(front, privateFragments),
      replyChain: replyChainRate(front),
      repetition: repetitionRate(front),
    };
    if (frontTextEntries) {
      frontAnchoring = frontTextAnchorRate(front, frontTextEntries);
    }
    if (behindTextEntries) {
      ht = halfTruthCheck(front, behindTextEntries);
    }
  }

  const divergence =
    front && front.length > 0 ? witnessDivergence(behind, front) : [];

  const ftp = front && front.length > 0 ? frontThirdPersonRate(front) : null;

  return {
    behind: behindReport,
    front: frontReport,
    divergence,
    frontTextAnchoring: frontAnchoring,
    halfTruth: ht,
    frontThirdPerson: ftp,
  };
}

/* ------------------------------------------------------------------ */
/* CLI: read room data from stdin/file                                 */
/* ------------------------------------------------------------------ */

export function formatReport(report: FullReport): string {
  const lines: string[] = [];

  function formatPhase(r: RoomReport): void {
    lines.push(`### ${r.phase === 'behind' ? 'Behind' : 'Front'} Room`);
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total utterances | ${r.tierRatio.total} |`);
    lines.push(`| quote | ${r.tierRatio.quote} |`);
    lines.push(`| paraphrase | ${r.tierRatio.paraphrase} |`);
    lines.push(`| extrapolate | ${r.tierRatio.extrapolate} |`);
    lines.push(`| extrapolate ratio | ${(r.tierRatio.extrapolateRatio * 100).toFixed(0)}% |`);
    lines.push(`| median length (chars) | ${r.length.median} |`);
    lines.push(`| mean length (chars) | ${r.length.mean.toFixed(0)} |`);
    lines.push(`| p90 length (chars) | ${r.length.p90} |`);
    lines.push(`| max length (chars) | ${r.length.max} |`);
    lines.push(`| secret leaks | ${r.leaks.length} |`);
    lines.push(`| reply chain rate | ${(r.replyChain.rate * 100).toFixed(0)}% (${r.replyChain.replyCount}/${r.replyChain.eligible}) |`);
    lines.push(`| repetition rate | ${(r.repetition.rate * 100).toFixed(0)}% (${r.repetition.duplicatePairs}/${r.repetition.totalPairs} pairs) |`);
    lines.push('');
    if (r.leaks.length > 0) {
      lines.push('#### Leaks detected');
      for (const l of r.leaks) {
        lines.push(`- [${l.matchType}] witness=${l.witnessId}: "${l.utteranceText.slice(0, 60)}..."`);
        lines.push(`  leaked from: "${l.fragment.text.slice(0, 60)}..."`);
      }
      lines.push('');
    }
  }

  formatPhase(report.behind);
  if (report.front) formatPhase(report.front);

  if (report.divergence.length > 0) {
    lines.push('### Behind/Front Divergence');
    lines.push('');
    lines.push('| Witness | Behind | Front | Overlap | Front Eval% |');
    lines.push('|---------|--------|-------|---------|-------------|');
    for (const d of report.divergence) {
      lines.push(
        `| ${d.witnessId} | ${d.behindCount} | ${d.frontCount} | ${(d.overlapRatio * 100).toFixed(0)}% | ${(d.frontEvaluativeRatio * 100).toFixed(0)}% |`,
      );
    }
    lines.push('');
  }

  if (report.frontTextAnchoring) {
    const a = report.frontTextAnchoring;
    lines.push('### Front frontText Anchoring');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| anchored lines | ${a.anchored} |`);
    lines.push(`| total front speeches | ${a.total} |`);
    lines.push(`| anchor rate | ${(a.rate * 100).toFixed(0)}% |`);
    lines.push('');
  }

  if (report.halfTruth) {
    const h = report.halfTruth;
    lines.push('### Half-truth Check');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| half-truth count | ${h.halfTruthCount} (target: exactly 1) |`);
    lines.push(`| heavy echo count | ${h.heavyEchoCount} (target: 0) |`);
    lines.push(`| pass | ${h.pass ? 'YES' : 'NO'} |`);
    if (h.details.length > 0) {
      lines.push('');
      for (const d of h.details) {
        lines.push(`- ${d}`);
      }
    }
    lines.push('');
  }

  if (report.frontThirdPerson) {
    const tp = report.frontThirdPerson;
    lines.push('### Front Third-Person Reference');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| third-person lines | ${tp.thirdPersonCount} |`);
    lines.push(`| total front speeches | ${tp.total} |`);
    lines.push(`| third-person rate | ${(tp.rate * 100).toFixed(0)}% (target: 0%) |`);
    lines.push('');
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Pass/fail checks against the design criteria                        */
/* ------------------------------------------------------------------ */

export interface PassFail {
  name: string;
  pass: boolean;
  detail: string;
}

export function checkCriteria(report: FullReport): PassFail[] {
  const checks: PassFail[] = [];

  // 1. Behind extrapolate ratio: 40-70%
  const er = report.behind.tierRatio.extrapolateRatio;
  checks.push({
    name: 'behind-extrapolate-ratio',
    pass: er >= 0.30 && er <= 0.80,
    detail: `${(er * 100).toFixed(0)}% (target 40-70%, pass 30-80%)`,
  });

  // 2. Median sentence length <= 40 chars
  const med = report.behind.length.median;
  checks.push({
    name: 'behind-median-length',
    pass: med <= 45,
    detail: `${med} chars (target <=40, pass <=45)`,
  });

  // 3. Secret leaks: behind <= 1, front = 0
  checks.push({
    name: 'behind-secret-leaks',
    pass: report.behind.leaks.length <= 1,
    detail: `${report.behind.leaks.length} (target <=1)`,
  });
  if (report.front) {
    checks.push({
      name: 'front-secret-leaks',
      pass: report.front.leaks.length === 0,
      detail: `${report.front.leaks.length} (target 0)`,
    });
  }

  // 4. Reply chain rate >= 30%
  const rcr = report.behind.replyChain.rate;
  checks.push({
    name: 'behind-reply-chain',
    pass: rcr >= 0.25,
    detail: `${(rcr * 100).toFixed(0)}% (target >=30%, pass >=25%)`,
  });

  // 5. Repetition rate: behind <= 10%, front <= 10%
  const brr = report.behind.repetition.rate;
  checks.push({
    name: 'behind-repetition',
    pass: brr <= 0.10,
    detail: `${(brr * 100).toFixed(0)}% (target <=10%)`,
  });
  if (report.front) {
    const frr = report.front.repetition.rate;
    checks.push({
      name: 'front-repetition',
      pass: frr <= 0.10,
      detail: `${(frr * 100).toFixed(0)}% (target <=10%)`,
    });
  }

  // 6. Front frontText anchoring >= 40%
  if (report.frontTextAnchoring) {
    const fta = report.frontTextAnchoring.rate;
    checks.push({
      name: 'front-text-anchoring',
      pass: fta >= 0.40,
      detail: `${(fta * 100).toFixed(0)}% (target >=40%)`,
    });
  }

  // 7. Half-truth: exactly 1, no heavy echoes
  if (report.halfTruth) {
    checks.push({
      name: 'front-half-truth',
      pass: report.halfTruth.pass,
      detail: `half-truths=${report.halfTruth.halfTruthCount}, heavy-echoes=${report.halfTruth.heavyEchoCount} (target: 1 half-truth, 0 heavy)`,
    });
  }

  // 8. Front third-person rate: 0%
  if (report.frontThirdPerson) {
    checks.push({
      name: 'front-third-person',
      pass: report.frontThirdPerson.thirdPersonCount === 0,
      detail: `${report.frontThirdPerson.thirdPersonCount}/${report.frontThirdPerson.total} lines (target: 0)`,
    });
  }

  // 9. Behind/front divergence: overlap < 50%
  if (report.divergence.length > 0) {
    const avgOverlap =
      report.divergence.reduce((s, d) => s + d.overlapRatio, 0) /
      report.divergence.length;
    checks.push({
      name: 'behind-front-overlap',
      pass: avgOverlap <= 0.50,
      detail: `${(avgOverlap * 100).toFixed(0)}% avg (target <=50%)`,
    });

    // Front evaluative ratio should be low
    const avgEval =
      report.divergence.reduce((s, d) => s + d.frontEvaluativeRatio, 0) /
      report.divergence.length;
    checks.push({
      name: 'front-evaluative-ratio',
      pass: avgEval <= 0.15,
      detail: `${(avgEval * 100).toFixed(0)}% avg (target <=15%)`,
    });
  }

  return checks;
}
