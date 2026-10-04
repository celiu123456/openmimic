import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConsentLevelSchema, TestimonyAnswerSchema } from '@openmimic/shared';
import type { Store } from '@openmimic/kernel';
import { InterviewSessionInvalidError, InterviewStateError } from './errors';
import { resolveInvite } from './invite';
import {
  FRIEND_V1,
  type Questionnaire,
  type WitnessQuestion,
} from './questionnaires/friend-v1';
import {
  INTERVIEW_SESSION_TTL_MS,
  InterviewSessionStateSchema,
  advance,
  buildFollowupRequest,
  createInterviewState,
  parseFollowup,
  questionAt,
  shouldAskFollowup,
  stepOf,
  withAnswer,
  withFollowupCount,
  withFollowupText,
  withPending,
  withSkip,
  type InterviewSessionState,
  type InterviewStep,
} from './interview-state';
import type { LLMClient } from './llm';
import {
  submitTestimony,
  type SubmitTestimonyResult,
} from './testimony';

/* ------------------------------------------------------------------ */
/* Input contracts                                                     */
/* ------------------------------------------------------------------ */

/**
 * One turn of the question tree.
 *
 * `text` answers the current question; `skip` records an explicit silence and
 * moves on. `frontText`/`frontSkipped` carry the W2b "to their face" variant
 * that is collected on the same screen, and `qid` lets a client that kept a
 * local draft push an edit back for a question it has already moved past.
 */
export const AnswerQuestionInputSchema = z.union([
  z.object({
    qid: z.string().min(1).optional(),
    text: z.string().min(1),
    frontText: z.string().min(1).optional(),
    frontSkipped: z.boolean().optional(),
  }),
  z.object({
    qid: z.string().min(1).optional(),
    skip: z.literal(true),
  }),
]);
export type AnswerQuestionInput = z.infer<typeof AnswerQuestionInputSchema>;

/** One turn answering the interviewer's follow-up. */
export const AnswerFollowupInputSchema = z.union([
  z.object({ text: z.string().min(1) }),
  z.object({ skip: z.literal(true) }),
]);
export type AnswerFollowupInput = z.infer<typeof AnswerFollowupInputSchema>;

/** The closing form; the answers themselves already sit in the session. */
export const FinishInterviewInputSchema = z.object({
  relation: z.string().min(1),
  stance: z.string().min(1).optional(),
  consentLevel: ConsentLevelSchema,
  freeText: z.string().min(1).optional(),
  /**
   * Full answers from a client that kept its own draft.
   *
   * Optional and only needed by a client that edited earlier questions: when
   * present it is authoritative, when absent the session's own answers are
   * used. Either way there is exactly one append to the ledger.
   */
  answers: z
    .array(TestimonyAnswerSchema.extend({ behindText: z.string().min(1) }))
    .min(1)
    .optional(),
  /** Explicit skips from the same client-held draft. */
  avoidedQids: z.array(z.string().min(1)).optional(),
});
export type FinishInterviewInput = z.infer<typeof FinishInterviewInputSchema>;

/** What {@link startInterview} hands back: the session and its first question. */
export interface StartedInterview {
  sessionId: string;
  question: WitnessQuestion;
}

export interface InterviewOptions {
  /** The model that phrases follow-ups; absent means pure question tree. */
  llm?: LLMClient;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Id factory, injectable for deterministic tests. */
  newId?: () => string;
}

/* ------------------------------------------------------------------ */
/* Session plumbing                                                    */
/* ------------------------------------------------------------------ */

const clock = (options: InterviewOptions): Date => (options.now ?? (() => new Date()))();

/**
 * Load a session, purging it lazily if it is older than the TTL.
 *
 * The check lives here rather than on a timer because a self-hosted process
 * has no scheduler and the only moment a stale session matters is the moment
 * someone touches it.
 */
function loadSession(
  store: Store,
  sessionId: string,
  options: InterviewOptions,
): InterviewSessionState {
  const record = store.getInterviewSession(sessionId);
  if (!record) throw new InterviewSessionInvalidError('访谈会话不存在或已过期');
  const now = clock(options);
  if (Date.parse(record.createdAt) + INTERVIEW_SESSION_TTL_MS <= now.getTime()) {
    store.purgeInterviewSession(sessionId);
    throw new InterviewSessionInvalidError('访谈会话已过期');
  }
  return InterviewSessionStateSchema.parse(record.state);
}

/** Persist a session while keeping its original creation time (the TTL anchor). */
function saveSession(
  store: Store,
  sessionId: string,
  state: InterviewSessionState,
): void {
  const existing = store.getInterviewSession(sessionId);
  store.putInterviewSession({
    id: sessionId,
    inviteToken: state.token,
    state,
    createdAt: existing?.createdAt ?? state.createdAt,
  });
}

/** The questionnaire a session was opened with. */
function questionnaireFor(state: InterviewSessionState): Questionnaire {
  if (state.questionnaireId !== FRIEND_V1.id) {
    throw new InterviewStateError(`未知的问卷版本:${state.questionnaireId}`);
  }
  return FRIEND_V1;
}

/**
 * One model call, one chance. On any failure the follow-up is simply not
 * asked — the witness is never made to wait on a retry loop.
 */
async function generateFollowup(
  llm: LLMClient,
  question: WitnessQuestion,
  answer: string,
): Promise<string | undefined> {
  try {
    return parseFollowup(await llm.complete(buildFollowupRequest(question, answer)));
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* The state-machine API                                               */
/* ------------------------------------------------------------------ */

/** Open a session and return the first question. */
export function startInterview(
  store: Store,
  token: string,
  options: InterviewOptions = {},
): StartedInterview {
  const now = clock(options);
  const { subjectId, questionnaire } = resolveInvite(store, token, { now });
  const sessionId = (options.newId ?? (() => randomUUID()))();
  const state = createInterviewState({
    token,
    subjectId,
    questionnaireId: questionnaire.id,
    now,
  });
  store.putInterviewSession({
    id: sessionId,
    inviteToken: token,
    state,
    createdAt: state.createdAt,
  });

  const question = questionAt(state, questionnaire.questions);
  if (!question) throw new InterviewStateError('问卷没有题目');
  return { sessionId, question };
}

/**
 * Answer (or skip) a question.
 *
 * With no `qid` this is the linear state machine the API promises: it acts on
 * the current question and moves on. When a client supplies `qid` the session
 * is positioned at that question first, which lets the client jump forward
 * (resuming after a refresh) or correct an earlier answer. Corrections never
 * move the session backwards and never spend a second follow-up.
 */
export async function answerQuestion(
  store: Store,
  sessionId: string,
  input: AnswerQuestionInput,
  options: InterviewOptions = {},
): Promise<InterviewStep> {
  const parsed = AnswerQuestionInputSchema.parse(input);
  const now = clock(options);
  const state = loadSession(store, sessionId, options);
  const { questions } = questionnaireFor(state);

  const targetQid = parsed.qid ?? questionAt(state, questions)?.qid;
  if (targetQid === undefined) throw new InterviewStateError('这一场访谈已经结束了');
  const targetIndex = questions.findIndex((question) => question.qid === targetQid);
  if (targetIndex < 0) throw new InterviewStateError(`未知的题目:${targetQid}`);
  if (state.pending && (parsed.qid === undefined || parsed.qid === state.pending.qid)) {
    throw new InterviewStateError('正在等待追问的回答');
  }

  const target = questions[targetIndex] as WitnessQuestion;
  const existing = state.answers.find((answer) => answer.qid === targetQid);
  const movingForward = targetIndex >= state.index;

  if ('skip' in parsed) {
    if (existing) throw new InterviewStateError('已经回答过的题目不能改判为跳过');
    const skipped = withSkip(
      { ...state, index: targetIndex, pending: undefined },
      targetQid,
      now,
    );
    saveSession(store, sessionId, skipped);
    return stepOf(skipped, questions);
  }

  const text = parsed.text.trim();
  let next = withAnswer(
    {
      ...state,
      index: movingForward ? targetIndex : state.index,
      pending: undefined,
      avoidedQids: state.avoidedQids.filter((qid) => qid !== targetQid),
    },
    {
      qid: targetQid,
      behindText: text,
      ...(parsed.frontText !== undefined ? { frontText: parsed.frontText.trim() } : {}),
      ...(parsed.frontSkipped !== undefined ? { frontSkipped: parsed.frontSkipped } : {}),
    },
    now,
  );

  // A correction of an earlier question stops here; the frontier stays put.
  if (!movingForward) {
    saveSession(store, sessionId, next);
    return stepOf(next, questions);
  }

  // A re-answer of the current question must not spend a second follow-up.
  if (!existing && options.llm && shouldAskFollowup(text, state.followupCount)) {
    next = withFollowupCount(next, state.followupCount + 1, now);
    const followup = await generateFollowup(options.llm, target, text);
    if (followup) {
      next = withPending(next, { qid: targetQid, question: followup }, now);
      saveSession(store, sessionId, next);
      return { followup };
    }
  }

  next = advance(next, now);
  saveSession(store, sessionId, next);
  return stepOf(next, questions);
}

/** Answer (or skip) the follow-up that is currently waiting. */
export function answerFollowup(
  store: Store,
  sessionId: string,
  input: AnswerFollowupInput,
  options: InterviewOptions = {},
): InterviewStep {
  const parsed = AnswerFollowupInputSchema.parse(input);
  const now = clock(options);
  const state = loadSession(store, sessionId, options);
  const { questions } = questionnaireFor(state);
  const pending = state.pending;
  if (!pending) throw new InterviewStateError('当前没有等待回答的追问');

  let next = state;
  if ('text' in parsed) {
    next = withFollowupText(next, pending.qid, parsed.text.trim(), now);
  }
  next = advance(next, now);
  saveSession(store, sessionId, next);
  return stepOf(next, questions);
}

/**
 * Close the interview: assemble the testimony from the session and append it
 * through the normal intake path, then purge the draft.
 *
 * The session never becomes evidence itself — only the returned testimony id
 * is — and the append stays append-only.
 */
export function finishInterview(
  store: Store,
  sessionId: string,
  input: FinishInterviewInput,
  options: InterviewOptions = {},
): SubmitTestimonyResult {
  const parsed = FinishInterviewInputSchema.parse(input);
  const state = loadSession(store, sessionId, options);

  // A client-held draft wins when supplied; otherwise the session is the
  // source of truth. The words are the same either way.
  const answers = (
    parsed.answers ??
    state.answers
      .filter((answer) => answer.behindText.length > 0)
      .map((answer) => ({
        qid: answer.qid,
        behindText: answer.behindText,
        ...(answer.frontText !== undefined ? { frontText: answer.frontText } : {}),
        ...(answer.followupText !== undefined
          ? { followupText: answer.followupText }
          : {}),
      }))
  ).map((answer) => ({ ...answer }));

  const avoidedQids = parsed.avoidedQids ?? state.avoidedQids;

  const result = submitTestimony(
    store,
    state.token,
    {
      relation: parsed.relation,
      ...(parsed.stance !== undefined ? { stance: parsed.stance } : {}),
      consentLevel: parsed.consentLevel,
      answers,
      ...(avoidedQids.length > 0 ? { avoidedQids: [...avoidedQids] } : {}),
      ...(parsed.freeText !== undefined ? { freeText: parsed.freeText } : {}),
    },
    { now: clock(options), ...(options.newId ? { newId: options.newId } : {}) },
  );

  store.purgeInterviewSession(sessionId);
  return result;
}
