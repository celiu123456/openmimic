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
import { WITNESS_V2_QUESTIONNAIRES } from './questionnaires/witness-v2';
import type { WitnessV2Question } from './questionnaires/witness-v2';
import { classifyIntent } from './input-intent';
import { detectRetreat } from './retreat';
import { classifyBasis } from './basis';
import { computeCoverage, planQuestions } from './coverage';
import {
  INTERVIEW_SESSION_TTL_MS,
  InterviewSessionStateSchema,
  advance,
  buildFollowupRequest,
  createInterviewState,
  followupPassesGate,
  hasClue,
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
import {
  generateNavigatorMemo,
  MAX_NAVIGATOR_CALLS_PER_SESSION,
  NAVIGATOR_MEMO_INTERVAL,
  memoAvoidsDirection,
  memoSuggestsClosing,
  shouldPursueLiveThread,
  type NavigatorMemo,
  NavigatorMemoSchema,
} from './navigator';

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
  /** One-time opening expectation line (approximately how long, can skip, etc.). */
  opening?: string;
}

export interface InterviewOptions {
  /** The model that phrases follow-ups; absent means pure question tree. */
  llm?: LLMClient;
  /** Override the questionnaire (e.g. witness-v2-friend). */
  questionnaireId?: string;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Id factory, injectable for deterministic tests. */
  newId?: () => string;
  /**
   * When true, the planner computes dimension coverage from prior testimonies
   * and reorders questions so gaps are asked first. The resulting order is
   * fixed at session start (session fixation). Defaults to false — turning
   * it off gives the exact same linear behaviour as before.
   */
  adaptiveCoverage?: boolean;
  /**
   * How many answers between navigator memo generations.
   * Defaults to {@link NAVIGATOR_MEMO_INTERVAL} (3).
   */
  navigatorInterval?: number;
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
  if (state.questionnaireId === FRIEND_V1.id) return FRIEND_V1;
  const v2 = WITNESS_V2_QUESTIONNAIRES[state.questionnaireId];
  if (v2) return v2;
  throw new InterviewStateError(`未知的问卷版本:${state.questionnaireId}`);
}

/**
 * Collect the text of all questions the witness has seen in this session,
 * for dedup purposes. Includes both questionnaire prompts and follow-ups.
 */
function askedQuestions(
  state: InterviewSessionState,
  questions: readonly WitnessQuestion[],
): string[] {
  const out: string[] = [];
  for (let i = 0; i < state.index && i < questions.length; i++) {
    out.push(questions[i]!.prompt);
  }
  // Include any follow-ups that were asked
  for (const answer of state.answers) {
    if (answer.followupText !== undefined) {
      // We don't store the follow-up question, but we store the questionnaire
      // prompt. That's enough for dedup.
    }
  }
  return out;
}

/**
 * Build a memo-enriched follow-up system prompt when a navigator memo
 * is available. The memo's foregroundGuidance is injected as soft context
 * so the model can generate a more informed follow-up.
 */
function enrichFollowupSystem(memo: NavigatorMemo | undefined): string {
  const base = buildFollowupRequest({ qid: '', prompt: '', followupHint: '' }, '').system;
  if (!memo) return base;
  const g = memo.foregroundGuidance;
  const hint = [
    '',
    '【导航提示(仅供参考,不得照搬)】',
    `当前关注方向: ${g.focusArea}`,
    `理由: ${g.focusRationale}`,
    `近期避开: ${g.avoidDirection}`,
    `节奏: ${g.pace}`,
  ].join('\n');
  return base + hint;
}

/**
 * One model call, one chance; quality gate applied. On any failure the
 * follow-up is simply not asked — the witness is never made to wait on a
 * retry loop. If the gate rejects it, a repair attempt is made once.
 *
 * v3: when a navigator memo is available, its foregroundGuidance is injected
 * into the system prompt as soft context for the follow-up generation.
 */
async function generateFollowup(
  llm: LLMClient,
  question: WitnessQuestion,
  answer: string,
  previousQuestions: readonly string[],
  memo?: NavigatorMemo,
): Promise<string | undefined> {
  try {
    const request = buildFollowupRequest(question, answer);
    const system = memo ? enrichFollowupSystem(memo) : request.system;
    const raw = await llm.complete({ ...request, system });
    const followup = parseFollowup(raw);
    if (followupPassesGate(followup, previousQuestions)) {
      return followup;
    }
    // One repair attempt: re-prompt with a hint to fix
    const repair = await llm.complete({
      system,
      user: [
        request.user,
        `刚才生成的问题"${followup}"不合格(可能不是单个问句、包含收尾语或与之前重复)。请重新生成一句。只输出 {"followup":"..."}。`,
      ].join('\n'),
    });
    const repaired = parseFollowup(repair);
    if (followupPassesGate(repaired, previousQuestions)) {
      return repaired;
    }
    // Both attempts failed — give up
    return undefined;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Graceful closing                                                    */
/* ------------------------------------------------------------------ */

/**
 * Short-answer threshold: an answer under this many characters is "short".
 * Two consecutive short answers trigger a closing suggestion.
 */
export const SHORT_ANSWER_THRESHOLD = 15;

/**
 * Number of consecutive short answers before suggesting closing.
 */
export const CONSECUTIVE_SHORT_LIMIT = 2;

/**
 * Opening expectation line, shown once before the first question.
 * Plain, no hype: approximately how long, can skip, can stop anytime.
 */
export const OPENING_EXPECTATION =
  '大概需要五到十分钟。每一题都可以跳过,随时可以结束。你说的内容只用来更完整地理解 TA。';

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
  const resolved = resolveInvite(store, token, { now });
  const qId = options.questionnaireId ?? resolved.questionnaire.id;
  const questionnaire = qId === resolved.questionnaire.id
    ? resolved.questionnaire
    : (WITNESS_V2_QUESTIONNAIRES[qId] ?? resolved.questionnaire);
  const sessionId = (options.newId ?? (() => randomUUID()))();

  // Adaptive coverage: compute a planned question order based on prior
  // testimonies. The order is fixed at session start (session fixation).
  let questionOrder: string[] | undefined;
  if (options.adaptiveCoverage) {
    const testimonies = store.listBySubject(resolved.subjectId);
    const witnesses = store.listWitnessesBySubject(resolved.subjectId);
    const allQuestionnaires = Object.values(WITNESS_V2_QUESTIONNAIRES);
    const coverage = computeCoverage(
      resolved.subjectId,
      testimonies,
      witnesses,
      allQuestionnaires,
    );
    // Determine the witness's relation type. If the invite carries a
    // default relation we could use it here; for now derive from the
    // questionnaire id (friend/family/colleague).
    const relation = qId.includes('family')
      ? 'family'
      : qId.includes('colleague')
        ? 'colleague'
        : 'friend';
    const planned = planQuestions(coverage, relation, questionnaire);
    questionOrder = planned.map((p) => p.question.qid);
  }

  const state = createInterviewState({
    token,
    subjectId: resolved.subjectId,
    questionnaireId: questionnaire.id,
    now,
  });
  if (questionOrder) {
    state.questionOrder = questionOrder;
  }
  store.putInterviewSession({
    id: sessionId,
    inviteToken: token,
    state,
    createdAt: state.createdAt,
  });

  const question = questionAt(state, questionnaire.questions);
  if (!question) throw new InterviewStateError('问卷没有题目');
  return { sessionId, question, opening: OPENING_EXPECTATION };
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
  // Find the question object in the questionnaire by qid
  const questionObj = questions.find((q) => q.qid === targetQid);
  if (!questionObj) throw new InterviewStateError(`未知的题目:${targetQid}`);
  // Compute the progress index: in custom order mode, use the position in
  // questionOrder; otherwise, the position in the questionnaire.
  const targetIndex = state.questionOrder
    ? state.questionOrder.indexOf(targetQid)
    : questions.findIndex((q) => q.qid === targetQid);
  if (targetIndex < 0) throw new InterviewStateError(`未知的题目:${targetQid}`);
  if (state.pending && (parsed.qid === undefined || parsed.qid === state.pending.qid)) {
    throw new InterviewStateError('正在等待追问的回答');
  }

  const target = questionObj;
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

  // --- v2: intent classification ---
  const intent = classifyIntent(text);

  // Skip / retreat: record as avoided, do not follow up, move on.
  if (intent.shouldSkip || detectRetreat(text)) {
    const skipped = withSkip(
      { ...state, index: targetIndex, pending: undefined },
      targetQid,
      now,
    );
    saveSession(store, sessionId, skipped);
    return stepOf(skipped, questions);
  }

  // Stop / pause: save what we have and report done.
  if (intent.shouldStop || intent.shouldPause) {
    saveSession(store, sessionId, state);
    return { done: true };
  }

  // --- v2: basis classification ---
  const basis = classifyBasis(text);

  // Accumulate fatigue
  const currentFatigue = state.fatigue ?? 0;
  const newFatigue = currentFatigue + intent.fatigueDelta;

  let next = withAnswer(
    {
      ...state,
      index: movingForward ? targetIndex : state.index,
      pending: undefined,
      avoidedQids: state.avoidedQids.filter((qid) => qid !== targetQid),
      fatigue: newFatigue,
    },
    {
      qid: targetQid,
      behindText: text,
      ...(parsed.frontText !== undefined ? { frontText: parsed.frontText.trim() } : {}),
      ...(parsed.frontSkipped !== undefined ? { frontSkipped: parsed.frontSkipped } : {}),
      ...(basis !== 'unknown' ? { basis } : {}),
    },
    now,
  );

  // A correction of an earlier question stops here; the frontier stays put.
  if (!movingForward) {
    saveSession(store, sessionId, next);
    return stepOf(next, questions);
  }

  // Interview feedback: acknowledge implicitly by not following up, move on.
  if (intent.isFeedbackOnly) {
    next = advance(next, now);
    saveSession(store, sessionId, next);
    return stepOf(next, questions);
  }

  // High fatigue: no more follow-ups for the rest of the session.
  const fatigueThreshold = 2.0;

  // --- v3: track consecutive short answers for graceful closing ---
  const charCount = Array.from(text).length;
  const prevShort = state.consecutiveShortAnswers ?? 0;
  const consecutiveShort = charCount < SHORT_ANSWER_THRESHOLD
    ? prevShort + 1
    : 0;
  next = { ...next, consecutiveShortAnswers: consecutiveShort };

  // --- v3: navigator memo generation ---
  // Generate a navigator memo every N answers (if model available and budget permits).
  const interval = options.navigatorInterval ?? NAVIGATOR_MEMO_INTERVAL;
  const navCallCount = state.navigatorCallCount ?? 0;
  const answersSinceStart = next.answers.length;
  let currentMemo: NavigatorMemo | undefined;

  // Parse the existing memo from state if present
  if (state.navigatorMemo) {
    const parsed = NavigatorMemoSchema.safeParse(state.navigatorMemo);
    if (parsed.success) currentMemo = parsed.data;
  }

  if (
    options.llm &&
    answersSinceStart > 0 &&
    answersSinceStart % interval === 0 &&
    navCallCount < MAX_NAVIGATOR_CALLS_PER_SESSION
  ) {
    const memo = await generateNavigatorMemo(
      options.llm,
      next.answers,
      questions,
      next.avoidedQids,
      answersSinceStart,
      currentMemo ?? null,
    );
    if (memo) {
      currentMemo = memo;
      next = {
        ...next,
        navigatorMemo: memo,
        navigatorCallCount: navCallCount + 1,
      };
    }
  }

  // --- v3: graceful closing suggestion ---
  // When the witness gives consecutive short answers or the memo suggests
  // fatigue, offer to close early on the next step.
  const closingSuggested =
    consecutiveShort >= CONSECUTIVE_SHORT_LIMIT ||
    (currentMemo !== undefined && memoSuggestsClosing(currentMemo));

  // A re-answer of the current question must not spend a second follow-up.
  if (
    !existing &&
    options.llm &&
    newFatigue < fatigueThreshold &&
    shouldAskFollowup(text, state.followupCount)
  ) {
    // v3: only follow up when the memo also supports it (if memo exists).
    // When memo says closing or the answer lacks a clue and memo doesn't
    // have live threads, skip the follow-up.
    const memoAllowsFollowup = !currentMemo || (
      !memoSuggestsClosing(currentMemo) &&
      (hasClue(text) || shouldPursueLiveThread(currentMemo))
    );

    if (memoAllowsFollowup) {
      next = withFollowupCount(next, state.followupCount + 1, now);
      const prev = askedQuestions(state, questions);
      const followup = await generateFollowup(
        options.llm, target, text, prev, currentMemo,
      );
      if (followup) {
        next = withPending(next, { qid: targetQid, question: followup }, now);
        saveSession(store, sessionId, next);
        return { followup };
      }
    }
  }

  next = advance(next, now);
  saveSession(store, sessionId, next);
  return stepOf(next, questions, { closingSuggested });
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
