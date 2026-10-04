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
 */

import type { RoomUtterance, UtteranceTier } from '@openmimic/shared';

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
  /** The type of match (substring or numeric). */
  matchType: 'substring' | 'numeric';
}

/**
 * Check whether any room line leaks private content.
 *
 * A "leak" is a line that has either:
 *   - >=8 contiguous characters in common with a private fragment, OR
 *   - the same specific number/amount that appears in the private fragment.
 */
export function detectLeaks(
  utterances: readonly RoomUtterance[],
  privateFragments: readonly PrivateFragment[],
): LeakResult[] {
  const leaks: LeakResult[] = [];

  // Extract numbers from private fragments
  const numberPattern = /\d[\d,.]*\d|\d/g;

  for (const u of utterances) {
    if (u.kind === 'stage') continue;
    for (const frag of privateFragments) {
      // Substring overlap: >= 8 contiguous characters
      const fragText = frag.text;
      for (let start = 0; start + 8 <= fragText.length; start++) {
        const sub = fragText.slice(start, start + 8);
        if (u.text.includes(sub)) {
          leaks.push({
            witnessId: u.witnessId,
            fragment: frag,
            utteranceText: u.text,
            matchType: 'substring',
          });
          break; // one match per fragment-utterance pair is enough
        }
      }

      // Numeric match: same specific number appears
      const fragNumbers = [...fragText.matchAll(numberPattern)].map((m) => m[0]);
      if (fragNumbers.length === 0) continue;
      const uttNumbers = [...u.text.matchAll(numberPattern)].map((m) => m[0]);
      for (const n of fragNumbers) {
        // Only flag numbers >= 2 digits (single digits are too generic)
        if (n.length >= 2 && uttNumbers.includes(n)) {
          // Check if the leak hasn't already been recorded as substring
          const already = leaks.some(
            (l) => l.utteranceText === u.text && l.fragment === frag,
          );
          if (!already) {
            leaks.push({
              witnessId: u.witnessId,
              fragment: frag,
              utteranceText: u.text,
              matchType: 'numeric',
            });
          }
          break;
        }
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
/* Full report                                                         */
/* ------------------------------------------------------------------ */

export interface RoomReport {
  phase: 'behind' | 'front';
  tierRatio: TierRatio;
  length: LengthStats;
  leaks: LeakResult[];
  replyChain: { replyCount: number; eligible: number; rate: number };
}

export interface FullReport {
  behind: RoomReport;
  front: RoomReport | null;
  divergence: WitnessDivergence[];
}

export function buildReport(
  behind: readonly RoomUtterance[],
  front: readonly RoomUtterance[] | undefined,
  privateFragments: readonly PrivateFragment[],
): FullReport {
  const behindReport: RoomReport = {
    phase: 'behind',
    tierRatio: tierRatio(behind),
    length: lengthStats(behind),
    leaks: detectLeaks(behind, privateFragments),
    replyChain: replyChainRate(behind),
  };

  let frontReport: RoomReport | null = null;
  if (front && front.length > 0) {
    frontReport = {
      phase: 'front',
      tierRatio: tierRatio(front),
      length: lengthStats(front),
      leaks: detectLeaks(front, privateFragments),
      replyChain: replyChainRate(front),
    };
  }

  const divergence =
    front && front.length > 0 ? witnessDivergence(behind, front) : [];

  return { behind: behindReport, front: frontReport, divergence };
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

  // 5. Behind/front divergence: overlap < 50%
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
