/**
 * v4 server-side zero-model guards.
 *
 * Reuses existing implementations from interview-state.ts (single-question
 * check, 2-gram dedup, closing regex) — no re-implementation.
 */

import {
  isSingleQuestion,
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
/*承接句 (acknowledgement) check                                      */
/* ------------------------------------------------------------------ */

/**
 * True when the acknowledgement part (everything before the final question)
 * contains a question mark — which would make it a chained question.
 *
 * Simple approach: count question marks. The guard `isSingleQuestion`
 * already enforces exactly one `?/？`, so this catches the case where
 * the acknowledgement sentence (before the actual question) contains one.
 * We check if removing the trailing question sentence still leaves a `?`.
 */
export function acknowledgementContainsQuestion(text: string): boolean {
  const trimmed = text.trim();
  const qmarks = (trimmed.match(/[?？]/g) || []).length;
  // If there are 2+ question marks, the acknowledgement has one
  return qmarks >= 2;
}

/* ------------------------------------------------------------------ */
/* Composite guard                                                     */
/* ------------------------------------------------------------------ */

export type GuardFailure =
  | 'not_single_question'
  | 'premature_ending'
  | 'duplicate'
  | 'acknowledgement_has_question';

/**
 * Run all guards on a candidate v4 output.
 *
 * @param candidate - sanitised model output
 * @param recentQuestions - the last N questions asked (for dedup)
 * @returns undefined if passed, or the failure reason
 */
export function checkGuards(
  candidate: string,
  recentQuestions: readonly string[],
): GuardFailure | undefined {
  if (!isSingleQuestion(candidate)) return 'not_single_question';
  if (containsPrematureEnding(candidate)) return 'premature_ending';
  // Dedup against last 12 questions
  const last12 = recentQuestions.slice(-12);
  if (isDuplicateFollowup(candidate, last12)) return 'duplicate';
  if (acknowledgementContainsQuestion(candidate)) return 'acknowledgement_has_question';
  return undefined;
}
