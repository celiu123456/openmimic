import { z } from 'zod';
import type { WitnessQuestion } from './questionnaires/friend-v1';
import type { LLMCompletionRequest } from './llm';

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
 * Whether the interviewer should spend one follow-up call on this answer.
 *
 * The budget caps the *calls*, not the successful follow-ups: a model that
 * fails to answer still costs the witness a question, so failures count.
 */
export function shouldAskFollowup(text: string, followupCount: number): boolean {
  return followupCount < MAX_FOLLOWUPS_PER_SESSION && !hasConcreteDetail(text);
}

/* ------------------------------------------------------------------ */
/* Follow-up prompt                                                    */
/* ------------------------------------------------------------------ */

/**
 * The interviewer's discipline, stated once.
 *
 * One judgement, one sentence, one concrete example — no chained questions, no
 * praise or grading of the answer, and no psychological reading of the person
 * being described.
 */
export const FOLLOWUP_SYSTEM_PROMPT = [
  '你是一位访谈员。你的唯一任务:把对方刚才的一个笼统判断,变成一件具体发生过的事。',
  '规则:',
  '- 只问一句,口语,像对面的人轻声补了一句;',
  '- 只问那一个判断对应的事例,不要顺带问别的,不要连环问;',
  '- 不评价对方的回答好坏,不说"说得好""你说得对"这类话;',
  '- 不做任何心理分析或性格诊断,不贴标签;',
  '- 只输出 JSON,形如 {"followup":"你要问的那一句"},不要输出任何别的内容。',
].join('\n');

/** The user turn: the question the witness answered and what they said. */
export function buildFollowupUserPrompt(
  question: WitnessQuestion,
  answer: string,
): string {
  return [
    `刚才的问题是:${question.prompt}`,
    `对方回答:${answer.trim()}`,
    '请就这句话要一个具体的事例。只输出 {"followup":"..."}。',
  ].join('\n');
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
});
export type InterviewSessionState = z.infer<typeof InterviewSessionStateSchema>;

/** One step of the interview, as handed back to a caller. */
export type InterviewStep =
  | { followup: string }
  | { question: WitnessQuestion; index: number }
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

/** The question the witness is currently on, or `undefined` when finished. */
export function questionAt(
  state: InterviewSessionState,
  questions: readonly WitnessQuestion[],
): WitnessQuestion | undefined {
  return questions[state.index];
}

/** True once every question has been answered or skipped. */
export function isFinished(
  state: InterviewSessionState,
  questions: readonly WitnessQuestion[],
): boolean {
  return state.index >= questions.length;
}

/** The step to return after a transition. */
export function stepOf(
  state: InterviewSessionState,
  questions: readonly WitnessQuestion[],
): InterviewStep {
  const question = questionAt(state, questions);
  return question ? { question, index: state.index } : { done: true };
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
