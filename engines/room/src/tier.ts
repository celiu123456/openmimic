/**
 * Tier classification for room utterances.
 *
 * Every line in a room is AI-generated from testimony. The tier tells the
 * viewer how close it is to the witness's own words:
 *
 * - `quote`:       ≥12 contiguous characters of verbatim overlap with a
 *                  testimony answer, AND the witness has `consentLevel='quotable'`.
 *                  A `synthesis_only` witness can never reach this tier (the
 *                  existing ≥8-char consent guard would have rewritten the line,
 *                  but even if it slipped through, classification caps them at
 *                  `paraphrase`).
 * - `paraphrase`:  anchored (the model cited at least one qid that belongs to
 *                  the witness and whose answer text shares some word-level
 *                  overlap with the line), but not verbatim.
 * - `extrapolate`: unanchored filler — greetings, agreement, stage directions.
 *
 * The tier is determined by **rules after generation**, not by the model
 * self-reporting. The model is asked to cite qids; those citations are then
 * validated here.
 */

import type { ConsentLevel, UtteranceAnchor, UtteranceTier } from '@openmimic/shared';
import type { TestimonyAnswer } from '@openmimic/shared';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Minimum contiguous character overlap to qualify as a direct quote. */
export const QUOTE_OVERLAP_LENGTH = 12;

/**
 * Minimum word overlap between an utterance and an answer text to
 * validate an anchor as genuine (not hallucinated by the model).
 * A word here is any run of non-whitespace characters ≥2 chars long.
 */
export const ANCHOR_MIN_WORD_OVERLAP = 2;

/* ------------------------------------------------------------------ */
/* Word tokenisation (Chinese-aware, minimal)                          */
/* ------------------------------------------------------------------ */

/**
 * Extract "words" from a Chinese/mixed text for overlap checking.
 *
 * For Chinese text, individual characters (CJK unified ideographs) are treated
 * as tokens. For ASCII/Latin text, whitespace-delimited words are kept.
 * This is intentionally simple — it does not need to be a real tokeniser,
 * just good enough to detect whether an utterance relates to a testimony answer.
 */
function extractTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  // CJK characters as individual tokens
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) {
      tokens.add(char);
    }
  }
  // Also extract bigrams for better Chinese matching
  for (let i = 0; i < text.length - 1; i++) {
    const a = text.codePointAt(i) ?? 0;
    const b = text.codePointAt(i + 1) ?? 0;
    if (a >= 0x4e00 && a <= 0x9fff && b >= 0x4e00 && b <= 0x9fff) {
      tokens.add(text.slice(i, i + 2));
    }
  }
  // Latin words (≥2 chars)
  for (const word of text.split(/\s+/)) {
    if (word.length >= 2 && /^[a-zA-Z0-9]+$/.test(word)) {
      tokens.add(word.toLowerCase());
    }
  }
  return tokens;
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count++;
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Verbatim overlap detection                                          */
/* ------------------------------------------------------------------ */

/**
 * Normalize pronouns for front-mode tier comparison: replace 他/她/TA with 你.
 * This ensures that a front-room line using second person ("你") can still
 * match against frontText that was originally written in third person ("他").
 */
export function normalizePronoun(text: string): string {
  return text.replace(/他|她|TA/g, '你');
}

/**
 * Check if `text` contains a contiguous run of at least `length` characters
 * from any of `sources`.
 *
 * When `pronounNormalize` is true, both text and sources are pronoun-normalised
 * (他/她/TA → 你) before comparison. This is used for front-room tier
 * classification where the generated line uses second person but the original
 * frontText may use third person.
 */
export function hasVerbatimOverlap(
  text: string,
  sources: readonly string[],
  length: number = QUOTE_OVERLAP_LENGTH,
  pronounNormalize: boolean = false,
): boolean {
  const compareText = pronounNormalize ? normalizePronoun(text) : text;
  if (compareText.length < length) return false;
  for (const source of sources) {
    const compareSource = pronounNormalize ? normalizePronoun(source) : source;
    if (compareSource.length < length) continue;
    for (let start = 0; start + length <= compareSource.length; start++) {
      if (compareText.includes(compareSource.slice(start, start + length))) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Anchor validation                                                   */
/* ------------------------------------------------------------------ */

export interface WitnessTestimony {
  testimonyId: string;
  witnessId: string;
  answers: TestimonyAnswer[];
}

/**
 * Validate model-cited anchors against actual testimony.
 *
 * A cited anchor `{ testimonyId, qid }` is valid when:
 * 1. The testimony belongs to the given witness.
 * 2. The qid exists in that testimony.
 * 3. The utterance text shares enough token overlap with the answer text
 *    (behindText or frontText) to show the model actually drew from it.
 *
 * Invalid anchors are silently dropped; the caller demotes the tier accordingly.
 */
export function validateAnchors(
  utteranceText: string,
  citedAnchors: readonly UtteranceAnchor[],
  witnessId: string,
  testimonies: readonly WitnessTestimony[],
): UtteranceAnchor[] {
  const uttTokens = extractTokens(utteranceText);
  const valid: UtteranceAnchor[] = [];

  for (const anchor of citedAnchors) {
    const testimony = testimonies.find(
      (t) => t.testimonyId === anchor.testimonyId && t.witnessId === witnessId,
    );
    if (!testimony) continue;

    const answer = testimony.answers.find((a) => a.qid === anchor.qid);
    if (!answer) continue;

    // Check overlap with behindText, frontText, or followupText
    const answerTexts = [answer.behindText, answer.frontText, answer.followupText].filter(
      (t): t is string => typeof t === 'string' && t.length > 0,
    );

    const answerTokens = new Set<string>();
    for (const text of answerTexts) {
      for (const token of extractTokens(text)) {
        answerTokens.add(token);
      }
    }

    if (tokenOverlap(uttTokens, answerTokens) >= ANCHOR_MIN_WORD_OVERLAP) {
      valid.push({ testimonyId: anchor.testimonyId, qid: anchor.qid });
    }
  }

  return valid;
}

/* ------------------------------------------------------------------ */
/* Tier classification                                                 */
/* ------------------------------------------------------------------ */

export interface ClassifyInput {
  /** The generated utterance text. */
  text: string;
  /** The utterance kind (speech vs stage). */
  kind: 'speech' | 'stage';
  /** The witness who spoke this line. */
  witnessId: string;
  /** The witness's consent level. */
  consentLevel: ConsentLevel;
  /** Model-cited anchors (may be empty or invalid). */
  citedAnchors: readonly UtteranceAnchor[];
  /** All testimonies for this witness. */
  testimonies: readonly WitnessTestimony[];
  /**
   * When true, pronoun-normalize (他/她/TA → 你) before verbatim overlap
   * comparison. Used for front-room lines where the generated text uses second
   * person but the source frontText may use third person.
   */
  pronounNormalize?: boolean;
}

export interface ClassifyResult {
  tier: UtteranceTier;
  anchors: UtteranceAnchor[];
}

/**
 * Classify an utterance's tier by post-generation rules.
 *
 * The classification chain:
 * 1. Stage directions are always `extrapolate` with no anchors.
 * 2. Validate cited anchors against actual testimony.
 * 3. If the witness is `quotable` and the text has ≥12-char verbatim overlap
 *    with an anchored answer, tier is `quote`.
 * 4. If there are valid anchors, tier is `paraphrase`.
 * 5. Otherwise, `extrapolate`.
 */
export function classifyUtterance(input: ClassifyInput): ClassifyResult {
  // Stage directions are always extrapolate
  if (input.kind === 'stage') {
    return { tier: 'extrapolate', anchors: [] };
  }

  // Validate the model's cited anchors
  const validAnchors = validateAnchors(
    input.text,
    input.citedAnchors,
    input.witnessId,
    input.testimonies,
  );

  // No valid anchors => extrapolate
  if (validAnchors.length === 0) {
    return { tier: 'extrapolate', anchors: [] };
  }

  // Check for verbatim overlap to decide quote vs paraphrase
  // synthesis_only witnesses can never reach 'quote'
  if (input.consentLevel === 'quotable') {
    // Collect the answer texts for the anchored qids
    const anchoredTexts: string[] = [];
    for (const anchor of validAnchors) {
      const testimony = input.testimonies.find(
        (t) => t.testimonyId === anchor.testimonyId && t.witnessId === input.witnessId,
      );
      if (!testimony) continue;
      const answer = testimony.answers.find((a) => a.qid === anchor.qid);
      if (!answer) continue;
      if (answer.behindText) anchoredTexts.push(answer.behindText);
      if (answer.frontText) anchoredTexts.push(answer.frontText);
      if (answer.followupText) anchoredTexts.push(answer.followupText);
    }

    if (hasVerbatimOverlap(input.text, anchoredTexts, QUOTE_OVERLAP_LENGTH, input.pronounNormalize)) {
      return { tier: 'quote', anchors: validAnchors };
    }
  }

  // Has valid anchors but no verbatim overlap (or synthesis_only) => paraphrase
  return { tier: 'paraphrase', anchors: validAnchors };
}

/* ------------------------------------------------------------------ */
/* Tier statistics                                                     */
/* ------------------------------------------------------------------ */

export interface TierDistribution {
  quote: number;
  paraphrase: number;
  extrapolate: number;
  total: number;
}

/**
 * Count the three-tier distribution over a transcript.
 * Utterances without a `tier` field are counted as `extrapolate`.
 */
export function tierDistribution(
  utterances: readonly { tier?: UtteranceTier }[],
): TierDistribution {
  let quote = 0;
  let paraphrase = 0;
  let extrapolate = 0;
  for (const u of utterances) {
    switch (u.tier) {
      case 'quote':
        quote++;
        break;
      case 'paraphrase':
        paraphrase++;
        break;
      default:
        extrapolate++;
        break;
    }
  }
  return { quote, paraphrase, extrapolate, total: utterances.length };
}
