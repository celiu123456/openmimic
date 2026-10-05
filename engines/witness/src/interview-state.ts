import { z } from 'zod';
import { wrapUntrusted, appendGuardInstruction } from '@openmimic/shared';
import type { WitnessQuestion } from './questionnaires/friend-v1';
import type { LLMCompletionRequest } from './llm';
import type { EvidenceBasis } from './basis';

/**
 * The interviewer's pure state machine.
 *
 * Everything in this file is a plain function over plain data: no store, no
 * clock, no model. The wiring in `interview.ts` owns persistence and the LLM
 * call, so the rules below can be tested — and reasoned about — on their own.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Hard cap on follow-up questions per interview (also the LLM budget). */
export const MAX_FOLLOWUPS_PER_SESSION = 5;

/** Answer length at or above which the witness already told a story. */
export const FOLLOWUP_MIN_ANSWER_LENGTH = 40;

/** Time markers that signal an actual incident rather than a bare adjective. */
export const FOLLOWUP_TIME_WORDS = ['那次', '有一回', '去年', '上个月', '那天'] as const;

/**
 * Clue markers: the witness mentions a specific event, occasion, or quote
 * but hasn't expanded on it. These signal that a follow-up would draw out
 * genuinely new detail rather than mechanically demanding an example.
 */
export const FOLLOWUP_CLUE_WORDS = [
  '那次', '有一回', '有一次', '有件事', '记得', '当时', '那天',
  '那年', '上次', '以前', '后来', '结果', '比如', '举个例子',
] as const;

/** Sessions untouched for this long are purged the next time they are read. */
export const INTERVIEW_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const DIGIT_PATTERN = /[0-9０-９]/;
const QUOTE_PATTERN = /["'“”‘’「」『』]/;

/* ------------------------------------------------------------------ */
/* The heuristic pre-screen                                            */
/* ------------------------------------------------------------------ */

/**
 * True when an answer already contains a concrete incident, so asking for one
 * would be asking the witness to repeat themselves.
 *
 * Four cheap signals, any of which is enough: it is long enough to be a story,
 * it has a number, it has a quotation, or it names a time ("那次", "去年") the
 * way only a remembered incident does. A short bare judgement ("他人挺好的")
 * trips none of them and is the only case the model is asked about.
 */
export function hasConcreteDetail(text: string): boolean {
  const trimmed = text.trim();
  if (Array.from(trimmed).length >= FOLLOWUP_MIN_ANSWER_LENGTH) return true;
  if (DIGIT_PATTERN.test(trimmed)) return true;
  if (QUOTE_PATTERN.test(trimmed)) return true;
  return FOLLOWUP_TIME_WORDS.some((word) => trimmed.includes(word));
}

/**
 * True when an answer contains a clue — the witness mentioned something
 * specific (an event, a time reference, a "for example") but hasn't fully
 * told the story. A follow-up here deepens real content.
 */
export function hasClue(text: string): boolean {
  const trimmed = text.trim();
  return FOLLOWUP_CLUE_WORDS.some((word) => trimmed.includes(word));
}

/**
 * Whether the interviewer should spend one follow-up call on this answer.
 *
 * v2 policy (ported from the old platform's anti-mechanical-extraction rule):
 * - An answer with concrete detail (long, numbers, quotes, time markers):
 *   NEVER follow up — the witness already gave a story.
 * - An answer with a clue (mentions an event/occasion but doesn't expand):
 *   follow up — asking for the story deepens genuine content.
 * - A bare evaluation with no clue ("他人挺好的"):
 *   use at most ONE gentle prompt per interview, not a chain of demands.
 *
 * The budget caps the *calls*, not the successful follow-ups: a model that
 * fails to answer still costs the witness a question, so failures count.
 */
export function shouldAskFollowup(text: string, followupCount: number): boolean {
  if (followupCount >= MAX_FOLLOWUPS_PER_SESSION) return false;
  if (hasConcreteDetail(text)) return false;
  // Clue present: the witness gave us a thread to pull on — follow up.
  if (hasClue(text)) return true;
  // Bare evaluation with no clue: allow at most one gentle prompt in the
  // entire interview (the "有没有哪件事让你这么觉得" style). This prevents
  // the mechanical "give me an example" pattern that the old platform found
  // repels witnesses.
  return followupCount < 1;
}

/* ------------------------------------------------------------------ */
/* Follow-up prompt                                                    */
/* ------------------------------------------------------------------ */

/**
 * The interviewer's discipline, stated once.
 *
 * v2: casual "家常" style ported from the old platform's voice-note session.
 * Restrained, one sentence, conversational, no more than ~40 characters.
 * Includes a fallback question so the model never stalls.
 *
 * Key discipline from the old platform:
 * - Not a questionnaire, not an interrogation, not a counsellor.
 * - One spoken question at a time.
 * - Don't mechanically demand examples and quotes.
 * - If the witness criticises the question: acknowledge once, change direction.
 */
export const FOLLOWUP_SYSTEM_PROMPT = [
  '你是一位访谈员,正在和证人聊他们认识的一个人。',
  '规则:',
  '- 只问一句,口语,像家常聊天时轻声补了一句,不超过四十个字;',
  '- 不评价回答好坏,不说"说得好""理解了"这类话;',
  '- 不做心理分析,不贴标签,不替证人总结;',
  '- 不要连环问,不要机械索取"具体场景""原话""当时怎么想";',
  '- 只有证人已经提到了某件事或某个场合但没展开时,才追一层;',
  '- 如果证人只给了一个评价且没有线索,最多轻问一句"有没有哪件事让你这么觉得";',
  '- 兜底问句:"有没有哪件事让你印象特别深?"',
  '- 只输出 JSON,形如 {"followup":"你要问的那一句"},不要输出任何别的内容。',
].join('\n');

/** The user turn: the question the witness answered and what they said. */
export function buildFollowupUserPrompt(
  question: WitnessQuestion,
  answer: string,
): string {
  return appendGuardInstruction([
    `刚才的问题是:${question.prompt}`,
    `证人回答:${wrapUntrusted('witness_answer', answer.trim())}`,
    '如果证人提到了某件事但没展开,就顺着那件事轻问一句。',
    '如果只是一句评价且没有线索,就用兜底问句。',
    '只输出 {"followup":"..."}。',
  ].join('\n'));
}

/** Compose the completion request for one follow-up. */
export function buildFollowupRequest(
  question: WitnessQuestion,
  answer: string,
): LLMCompletionRequest {
  return {
    system: FOLLOWUP_SYSTEM_PROMPT,
    user: buildFollowupUserPrompt(question, answer),
  };
}

const FollowupResponseSchema = z.object({ followup: z.string().min(1) });

/**
 * Pull `{"followup": "..."}` out of a response that may be wrapped in prose or
 * a markdown fence. Throws when there is no usable question; the caller turns
 * that into "give up on the follow-up", never into a retry loop.
 */
export function parseFollowup(raw: string): string {
  const trimmed = raw.trim();
  const attempts = [trimmed];
  const braced = /\{[\s\S]*\}/.exec(trimmed);
  if (braced?.[0]) attempts.push(braced[0]);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) attempts.push(fenced[1].trim());

  for (const candidate of attempts) {
    try {
      return FollowupResponseSchema.parse(JSON.parse(candidate) as unknown).followup;
    } catch {
      /* try the next, more forgiving candidate */
    }
  }
  throw new Error('follow-up response did not contain a {"followup": ...} object');
}

/* ------------------------------------------------------------------ */
/* Quality gate (from old platform: direct-interview-orchestrator)     */
/* ------------------------------------------------------------------ */

/**
 * True when the text is exactly one real question (ends with ?, has exactly
 * one question mark, and doesn't start with refusal/meta-talk patterns).
 *
 * Ported from direct-interview-orchestrator.ts:261-267.
 */
export function isSingleQuestion(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 500) return false;
  if ((value.match(/[?？]/g) || []).length !== 1 || !/[?？]\s*$/u.test(value)) return false;
  if (/^(?:抱歉|对不起|我不能|无法|不能回答|作为(?:一个)?AI|我会|下面|解释|说明|总结|建议)/u.test(value)) return false;
  // Multiple sentences with question marks inside = chained questions
  if (/\n|[。！？!?]\s*(?:请|你|您|能否|可否|是否|为什么|怎么|怎样|什么|哪)/u.test(value.slice(0, -1))) return false;
  return true;
}

/**
 * True when the text looks like a premature ending ("最后一个问题", etc.).
 *
 * Ported from direct-interview-orchestrator.ts:322-324.
 */
export function containsPrematureEnding(text: string): boolean {
  return /(?:最后(?:再)?问(?:一个|个)?|最后一个问题|收尾(?:问题|一下)?|今天(?:就)?先聊到(?:这|这里|这儿)|(?:今天|这次)访谈(?:就)?到(?:这|这里|这儿)|后续.{0,12}(?:再来找你|再聊)|谢谢(?:你|您的)(?:参与|分享)?)/u.test(text);
}

/**
 * Character 2-gram set of a string (for deduplication).
 *
 * Ported from direct-interview-orchestrator.ts:283-289.
 */
export function twoGrams(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/(?:请问|能不能|可以|可不可以|你能|您能|跟我说说|聊聊|具体说说|有没有)/g, '')
    .replace(/[\s，。！？、,.!?;；:'"""''（）()]/g, '');
  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    grams.add(normalized.slice(i, i + 2));
  }
  return grams;
}

/** Jaccard similarity between two 2-gram sets. */
export function twoGramJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

/** Containment ratio: fraction of the smaller set contained in the larger. */
export function twoGramContainment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection++;
  }
  return intersection / Math.min(a.size, b.size);
}

/** Thresholds from old platform: Jaccard >= 0.58 OR containment >= 0.72. */
export const DEDUP_JACCARD_THRESHOLD = 0.58;
export const DEDUP_CONTAINMENT_THRESHOLD = 0.72;

/**
 * True when a candidate follow-up is too similar to any previously asked
 * question in this session.
 *
 * Ported from direct-interview-orchestrator.ts:270-280.
 */
export function isDuplicateFollowup(
  candidate: string,
  previousQuestions: readonly string[],
): boolean {
  const candidateGrams = twoGrams(candidate);
  for (const prev of previousQuestions) {
    const prevGrams = twoGrams(prev);
    if (twoGramJaccard(candidateGrams, prevGrams) >= DEDUP_JACCARD_THRESHOLD) return true;
    if (twoGramContainment(candidateGrams, prevGrams) >= DEDUP_CONTAINMENT_THRESHOLD) return true;
  }
  return false;
}

/**
 * Run the full quality gate on a candidate follow-up.
 *
 * Returns `true` if the follow-up passes. A failed follow-up should be
 * repaired once; if it fails again, give up on this follow-up entirely.
 */
export function followupPassesGate(
  candidate: string,
  previousQuestions: readonly string[],
): boolean {
  if (!isSingleQuestion(candidate)) return false;
  if (containsPrematureEnding(candidate)) return false;
  if (isDuplicateFollowup(candidate, previousQuestions)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Phase tracking (from old platform: phase-reminder)                  */
/* ------------------------------------------------------------------ */

/**
 * Interview phase based on answer count.
 *
 * Phases are soft guidance for the follow-up prompt, not hard rules.
 * Ported from interview-direct-prompts.v1.json (phase-reminder).
 */
export type InterviewPhase =
  | 'icebreaker'       // 0-3: warm up, build trust
  | 'concrete_events'  // 4-6: specific incidents
  | 'feeling_meaning'  // 7-8: feelings and significance
  | 'pattern_contrast'; // 9+: patterns, counterexamples

/**
 * Determine the interview phase from the number of answers given.
 *
 * Used only as a soft hint in the follow-up prompt, not as a gate.
 */
export function phaseOf(answerCount: number): InterviewPhase {
  if (answerCount <= 3) return 'icebreaker';
  if (answerCount <= 6) return 'concrete_events';
  if (answerCount <= 8) return 'feeling_meaning';
  return 'pattern_contrast';
}

/* ------------------------------------------------------------------ */
/* Session state                                                       */
/* ------------------------------------------------------------------ */

/** One answer gathered so far. `behindText` and `followupText` stay apart. */
export const InterviewAnswerSchema = z.object({
  qid: z.string().min(1),
  behindText: z.string(),
  frontText: z.string().optional(),
  /** True only after an explicit "当面我不会说" press. */
  frontSkipped: z.boolean().optional(),
  /** What the interviewer's follow-up drew out, if one was asked. */
  followupText: z.string().optional(),
  /** Epistemic basis: witnessed / heard / inferred / unknown. Added in v2. */
  basis: z.enum(['witnessed', 'heard', 'inferred', 'unknown']).optional(),
  /** When true, this answer must not appear in any subject-visible view. */
  doNotRaiseToSubject: z.boolean().optional(),
});
export type InterviewAnswer = z.infer<typeof InterviewAnswerSchema>;

/** A generated follow-up waiting for the witness's reply. */
export const PendingFollowupSchema = z.object({
  qid: z.string().min(1),
  question: z.string().min(1),
});
export type PendingFollowup = z.infer<typeof PendingFollowupSchema>;

/** The JSON blob the kernel stores verbatim for one interview session. */
export const InterviewSessionStateSchema = z.object({
  token: z.string().min(1),
  subjectId: z.string().min(1),
  questionnaireId: z.string().min(1),
  /** Index of the question the witness is on. */
  index: z.number().int().nonnegative(),
  /** Follow-up generations spent so far (the budget counter). */
  followupCount: z.number().int().nonnegative(),
  answers: z.array(InterviewAnswerSchema),
  avoidedQids: z.array(z.string().min(1)),
  pending: PendingFollowupSchema.optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  /**
   * Accumulated fatigue score (0..n). When it exceeds the threshold, no more
   * follow-ups are asked for the rest of the session. Added in v2.
   */
  fatigue: z.number().nonnegative().optional(),
  /**
   * Adaptive question order: when the planner schedules questions based on
   * prior coverage, the ordered qid list is fixed at session start and stored
   * here. When absent, the default questionnaire order is used. Added in v3.
   */
  questionOrder: z.array(z.string().min(1)).optional(),
  /**
   * Latest navigator memo: structured stocktake generated every N answers.
   * Influences follow-up generation and next-question selection as a soft
   * signal. Never enters testimony or court. Added in v3.
   */
  navigatorMemo: z.unknown().optional(),
  /**
   * How many navigator memo calls have been spent. The budget is separate
   * from followupCount but both count toward the session's total LLM budget.
   * Added in v3.
   */
  navigatorCallCount: z.number().int().nonnegative().optional(),
  /**
   * Whether the witness has been shown the opening expectation line.
   * Added in v3.
   */
  openingShown: z.boolean().optional(),
  /**
   * Consecutive short-answer count for graceful closing detection.
   * Reset on a substantive answer. Added in v3.
   */
  consecutiveShortAnswers: z.number().int().nonnegative().optional(),
});
export type InterviewSessionState = z.infer<typeof InterviewSessionStateSchema>;

/** One step of the interview, as handed back to a caller. */
export type InterviewStep =
  | { followup: string }
  | { question: WitnessQuestion; index: number; closingSuggested?: boolean }
  | { done: true };

export interface NewInterviewState {
  token: string;
  subjectId: string;
  questionnaireId: string;
  now: Date;
}

/** Start a fresh session at question zero. */
export function createInterviewState(args: NewInterviewState): InterviewSessionState {
  const at = args.now.toISOString();
  return {
    token: args.token,
    subjectId: args.subjectId,
    questionnaireId: args.questionnaireId,
    index: 0,
    followupCount: 0,
    answers: [],
    avoidedQids: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * The question the witness is currently on, or `undefined` when finished.
 *
 * When the session carries a `questionOrder` (adaptive scheduling), the
 * order follows that qid list instead of the questionnaire's natural order.
 */
export function questionAt(
  state: InterviewSessionState,
  questions: readonly WitnessQuestion[],
): WitnessQuestion | undefined {
  if (state.questionOrder) {
    const qid = state.questionOrder[state.index];
    if (qid === undefined) return undefined;
    return questions.find((q) => q.qid === qid);
  }
  return questions[state.index];
}

/** True once every question has been answered or skipped. */
export function isFinished(
  state: InterviewSessionState,
  questions: readonly WitnessQuestion[],
): boolean {
  const total = state.questionOrder ? state.questionOrder.length : questions.length;
  return state.index >= total;
}

/** The step to return after a transition. */
export function stepOf(
  state: InterviewSessionState,
  questions: readonly WitnessQuestion[],
  options?: { closingSuggested?: boolean },
): InterviewStep {
  const question = questionAt(state, questions);
  if (!question) return { done: true };
  return options?.closingSuggested
    ? { question, index: state.index, closingSuggested: true }
    : { question, index: state.index };
}

function withTimestamps(
  state: InterviewSessionState,
  now: Date,
): InterviewSessionState {
  return { ...state, updatedAt: now.toISOString() };
}

/** Insert or replace the answer for a qid; the index does not move. */
export function withAnswer(
  state: InterviewSessionState,
  answer: InterviewAnswer,
  now: Date,
): InterviewSessionState {
  const answers = state.answers.filter((entry) => entry.qid !== answer.qid);
  answers.push(answer);
  return withTimestamps({ ...state, answers }, now);
}

/** Record an explicit skip: a silence signal, never an empty answer. */
export function withSkip(
  state: InterviewSessionState,
  qid: string,
  now: Date,
): InterviewSessionState {
  const avoidedQids = state.avoidedQids.includes(qid)
    ? state.avoidedQids
    : [...state.avoidedQids, qid];
  return withTimestamps(
    {
      ...state,
      index: state.index + 1,
      answers: state.answers.filter((entry) => entry.qid !== qid),
      avoidedQids,
      pending: undefined,
    },
    now,
  );
}

/** Move on to the next question, dropping any pending follow-up. */
export function advance(
  state: InterviewSessionState,
  now: Date,
): InterviewSessionState {
  return withTimestamps({ ...state, index: state.index + 1, pending: undefined }, now);
}

/** Attach the generated follow-up question that is now on screen. */
export function withPending(
  state: InterviewSessionState,
  pending: PendingFollowup,
  now: Date,
): InterviewSessionState {
  return withTimestamps({ ...state, pending }, now);
}

/** Spend one unit of the follow-up budget. */
export function withFollowupCount(
  state: InterviewSessionState,
  followupCount: number,
  now: Date,
): InterviewSessionState {
  return withTimestamps({ ...state, followupCount }, now);
}

/** Store the witness's reply to the pending follow-up. */
export function withFollowupText(
  state: InterviewSessionState,
  qid: string,
  text: string,
  now: Date,
): InterviewSessionState {
  const answers = state.answers.map((entry) =>
    entry.qid === qid ? { ...entry, followupText: text } : entry,
  );
  return withTimestamps({ ...state, answers }, now);
}
