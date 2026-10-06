/**
 * v4 server-side zero-model guards.
 *
 * Uses a v4-specific `isAcknowledgementPlusQuestion` that accepts the
 * output format v4 demands: "一句承接。你后来…？" — unlike `isSingleQuestion`
 * from interview-state.ts which rejects acknowledgement + question combos.
 *
 * Dedup and premature-ending checks reuse interview-state.ts.
 */

import {
  containsPrematureEnding,
  isDuplicateFollowup,
} from '../interview-state';

/* ------------------------------------------------------------------ */
/* Output sanitisation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Strip code fences wrapping the output.
 *
 * Some models wrap their reply in triple backticks; we strip those
 * before further checks.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:\w*)\s*([\s\S]*?)```$/s.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

/**
 * If the model output looks like JSON with a `question` field, extract it.
 */
export function extractQuestionFromJson(text: string): string | undefined {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'question' in parsed &&
      typeof (parsed as Record<string, unknown>).question === 'string'
    ) {
      return (parsed as Record<string, unknown>).question as string;
    }
  } catch {
    // Not JSON — try extracting braced content
    const braced = /\{[\s\S]*\}/.exec(trimmed);
    if (braced) {
      try {
        const inner = JSON.parse(braced[0]) as unknown;
        if (
          typeof inner === 'object' &&
          inner !== null &&
          'question' in inner &&
          typeof (inner as Record<string, unknown>).question === 'string'
        ) {
          return (inner as Record<string, unknown>).question as string;
        }
      } catch {
        // give up
      }
    }
  }
  return undefined;
}

/**
 * Sanitise raw model output: strip fences, try JSON extraction.
 */
export function sanitiseOutput(raw: string): string {
  let text = stripCodeFences(raw);
  const jsonQ = extractQuestionFromJson(text);
  if (jsonQ) text = jsonQ;
  return text.trim();
}

/* ------------------------------------------------------------------ */
/* v4-specific single-output validator                                 */
/* ------------------------------------------------------------------ */

/** Refusal / meta-start prefixes that must not appear anywhere in the text. */
const REFUSAL_META_RE =
  /^(?:抱歉|对不起|我不能|无法|不能回答|作为(?:一个)?AI|我会|下面|解释|说明|总结|建议)/u;

/**
 * Split text at the LAST sentence-ending punctuation among `。！!`.
 *
 * Returns `[acknowledgement, question]` where `acknowledgement` may be
 * empty (the text is a bare question with no lead-in sentence).
 *
 * The split point is the last occurrence of `。`, `！`, or `!` that has
 * text following it. Chinese period `。` is the most common case.
 */
function splitAcknowledgementAndQuestion(text: string): [string, string] {
  // Find the last 。/！/! that is followed by at least one non-whitespace char
  let lastIdx = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]!;
    if (ch === '。' || ch === '！' || ch === '!') {
      const after = text.slice(i + 1).trim();
      if (after.length > 0) {
        lastIdx = i;
        break;
      }
    }
  }
  if (lastIdx === -1) {
    return ['', text];
  }
  return [text.slice(0, lastIdx + 1), text.slice(lastIdx + 1).trim()];
}

/**
 * v4-specific output validator. Accepts the format v4 demands:
 * at most one acknowledgement sentence + one question ending with ?/？.
 *
 * Rules:
 * - Total length ≤ 500 chars.
 * - No newline anywhere.
 * - Refusal/meta-start regex must not match the whole text.
 * - Split at the LAST sentence-ending punctuation (。！!):
 *   - Question part: non-empty, ends with exactly one ?/？, contains no other ?/？.
 *   - Acknowledgement part: contains no ?/？; at most ONE sentence
 *     (≤1 of 。！! after the split, no newline).
 *
 * Returns the extracted question part on success (for dedup), or undefined on failure.
 */
export function isAcknowledgementPlusQuestion(text: string): string | undefined {
  const value = text.trim();
  if (!value || value.length > 500) return undefined;

  // No newline anywhere
  if (/\n/.test(value)) return undefined;

  // Refusal/meta-start check on the whole text
  if (REFUSAL_META_RE.test(value)) return undefined;

  const [ack, question] = splitAcknowledgementAndQuestion(value);

  // Question part must be non-empty
  if (!question) return undefined;

  // Question part must end with exactly one ?/？ and contain no other ?/？
  const qmarks = (question.match(/[?？]/g) || []).length;
  if (qmarks !== 1) return undefined;
  if (!/[?？]\s*$/.test(question)) return undefined;

  // Acknowledgement checks (only when non-empty)
  if (ack) {
    // No question marks in acknowledgement
    if (/[?？]/.test(ack)) return undefined;

    // At most ONE sentence in acknowledgement: count sentence-ending punctuation
    // The ack already ends with one (。/！/!), so we check if there's more than one
    const sentenceEnders = (ack.match(/[。！!]/g) || []).length;
    if (sentenceEnders > 1) return undefined;
  }

  return question;
}

/* ------------------------------------------------------------------ */
/* Composite guard                                                     */
/* ------------------------------------------------------------------ */

export type GuardFailure =
  | 'not_single_question'
  | 'premature_ending'
  | 'duplicate'
  | 'opening_identity';

/* ------------------------------------------------------------------ */
/* Opening-only identity guard                                         */
/* ------------------------------------------------------------------ */

/**
 * Pattern matching openings where the model claims to be a friend,
 * colleague, classmate, family member, relative, or teacher.
 */
const CLAIMS_HUMAN_IDENTITY_RE =
  /我是(?:你的|他的|她的|TA的)?(?:朋友|同事|同学|家人|亲戚|老师)/u;

/**
 * Check whether an opening turn properly identifies itself as AI.
 *
 * Rejects when:
 *   1. The output claims a human relationship identity, OR
 *   2. The output does not contain "AI" (case-insensitive).
 *
 * Only applied to opening turns — non-opening turns skip this guard.
 */
export function checkOpeningIdentity(candidate: string): boolean {
  if (CLAIMS_HUMAN_IDENTITY_RE.test(candidate)) return false;
  if (!/ai/i.test(candidate)) return false;
  return true;
}

/**
 * Run all guards on a candidate v4 output.
 *
 * @param candidate - sanitised model output
 * @param recentQuestions - the last N questions asked (for dedup)
 * @param isOpening - whether this is the opening turn (enables identity guard)
 * @returns undefined if passed, or the failure reason
 */
export function checkGuards(
  candidate: string,
  recentQuestions: readonly string[],
  isOpening: boolean = false,
): GuardFailure | undefined {
  // Opening-only identity guard
  if (isOpening && !checkOpeningIdentity(candidate)) return 'opening_identity';
  const questionPart = isAcknowledgementPlusQuestion(candidate);
  if (questionPart === undefined) return 'not_single_question';
  // Premature ending check on the whole text
  if (containsPrematureEnding(candidate)) return 'premature_ending';
  // Dedup against last 12 questions — on the question part only
  const last12 = recentQuestions.slice(-12);
  if (isDuplicateFollowup(questionPart, last12)) return 'duplicate';
  return undefined;
}
