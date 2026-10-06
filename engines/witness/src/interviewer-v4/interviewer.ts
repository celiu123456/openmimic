/**
 * v4 interviewer: single model, per-turn generation, full history.
 *
 * No questionnaire, no navigator, no planning. The model sees the
 * complete conversation and decides what to ask next.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ConsentLevel } from '@openmimic/shared';
import type { Store } from '@openmimic/kernel';
import { InterviewSessionInvalidError, InterviewStateError } from '../errors';
import { resolveInvite } from '../invite';
import { detectRetreat, detectReopen } from '../retreat';
import { computeCoverage } from '../coverage';
import { OBSERVER_DIMENSIONS, WITNESS_V2_QUESTIONNAIRES } from '../questionnaires/witness-v2';
import type { LLMClient, LLMCompletionRequest } from '../llm';
import { submitTestimony } from '../testimony';
import { classifyBasis } from '../basis';
import {
  buildSystemPrompt,
  buildMessages,
  validateSystemPrompt,
  buildRepairInstruction,
  RETREAT_BOUNDARY_INJECTION,
  type PromptContext,
} from './prompt';
import {
  sanitiseOutput,
  checkGuards,
  type GuardFailure,
} from './guards';
import {
  ChatSessionStateSchema,
  INTERVIEW_SESSION_TTL_MS,
  INTERVIEW_HISTORY_CHAR_LIMIT,
  createChatSession,
  addAssistantTurn,
  addUserTurn,
  addCautiousTopic,
  removeCautiousTopic,
  askedQuestions,
  type ChatSessionState,
} from './session';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ChatInterviewOptions {
  llm: LLMClient;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Id factory, injectable for deterministic tests. */
  newId?: () => string;
}

export interface StartChatResult {
  sessionId: string;
  message: { id: string; text: string };
  mode: 'informant' | 'self';
}

export interface SayResult {
  message?: { id: string; text: string };
  confirm?: { text: string };
}

export const SayInputSchema = z.object({
  text: z.string().min(1),
  source: z.enum(['text', 'speech']).optional(),
  asrConfidence: z.number().min(0).max(1).optional(),
});
export type SayInput = z.infer<typeof SayInputSchema>;

export const FinishChatInputSchema = z.object({
  relation: z.string().min(1).optional(),
  stance: z.string().min(1).optional(),
  consentLevel: z.enum(['quotable', 'synthesis_only']),
  freeText: z.string().min(1).optional(),
});
export type FinishChatInput = z.infer<typeof FinishChatInputSchema>;

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Low ASR confidence threshold: below this we ask for confirmation. */
const LOW_CONFIDENCE_THRESHOLD = 0.72;

/** LLM generation parameters. */
const LLM_TEMPERATURE = 0.4;
const LLM_MAX_TOKENS = 260;
const LLM_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------ */
/* Observability                                                       */
/* ------------------------------------------------------------------ */

/**
 * Emit a single log line when generation fails.
 *
 * Includes route context, session id, failure reason, finish_reason and
 * output length — but NOT the user's text or the model's full output
 * (at most the first 40 chars of the rejected output).
 */
function logGenerationFailure(opts: {
  route: 'start' | 'say';
  sessionId: string;
  reason: string;
  finishReason?: string;
  outputLength: number;
  outputHead?: string;
  errorName?: string;
  errorCode?: string;
}): void {
  const head = opts.outputHead
    ? ` output_head=${JSON.stringify(opts.outputHead.slice(0, 40))}`
    : '';
  const errPart = opts.errorName
    ? ` error=${opts.errorName}${opts.errorCode ? `(${opts.errorCode})` : ''}`
    : '';
  console.error(
    `[interview-v4] generation_failed route=${opts.route} session=${opts.sessionId}` +
    ` reason=${opts.reason} finish_reason=${opts.finishReason ?? 'unknown'}` +
    ` output_len=${opts.outputLength}${head}${errPart}`,
  );
}

/**
 * Check if an error is a transport/provider error (LLMTransportError from
 * the court engine, or any network-level error that is not a logic bug).
 * We check by name rather than importing from court to avoid a dependency.
 */
function isProviderError(err: unknown): boolean {
  return err instanceof Error && err.name === 'LLMTransportError';
}

/* ------------------------------------------------------------------ */
/* Session plumbing                                                    */
/* ------------------------------------------------------------------ */

const clock = (options: ChatInterviewOptions): Date =>
  (options.now ?? (() => new Date()))();

const newId = (options: ChatInterviewOptions): string =>
  (options.newId ?? (() => randomUUID()))();

function loadChatSession(
  store: Store,
  sessionId: string,
  options: ChatInterviewOptions,
): ChatSessionState {
  const record = store.getInterviewSession(sessionId);
  if (!record) throw new InterviewSessionInvalidError('访谈会话不存在或已过期');
  const now = clock(options);
  if (Date.parse(record.createdAt) + INTERVIEW_SESSION_TTL_MS <= now.getTime()) {
    store.purgeInterviewSession(sessionId);
    throw new InterviewSessionInvalidError('访谈会话已过期');
  }
  return ChatSessionStateSchema.parse(record.state);
}

function saveChatSession(
  store: Store,
  sessionId: string,
  state: ChatSessionState,
): void {
  const existing = store.getInterviewSession(sessionId);
  store.putInterviewSession({
    id: sessionId,
    inviteToken: state.inviteToken,
    state,
    createdAt: existing?.createdAt ?? state.createdAt,
  });
}

/* ------------------------------------------------------------------ */
/* Coverage helper                                                     */
/* ------------------------------------------------------------------ */

/**
 * Compute uncovered dimension labels from existing testimonies.
 * Returns at most 6 Chinese labels.
 */
function uncoveredAspects(store: Store, subjectId: string): string[] {
  const testimonies = store.listBySubject(subjectId);
  if (testimonies.length === 0) {
    // No prior testimonies — all dimensions uncovered
    return OBSERVER_DIMENSIONS.slice(0, 6).map((d) => d.label);
  }
  const witnesses = store.listWitnessesBySubject(subjectId);
  const allQuestionnaires = Object.values(WITNESS_V2_QUESTIONNAIRES);
  const coverage = computeCoverage(subjectId, testimonies, witnesses, allQuestionnaires);
  const uncovered = coverage.dimensions
    .filter((d) => d.state === 'untouched' || d.state === 'shallow')
    .map((d) => d.label);
  return uncovered.slice(0, 6);
}

/** Max tokens for the retry when the first call returns empty + finish_reason=length. */
const LLM_RETRY_MAX_TOKENS = 1200;

/* ------------------------------------------------------------------ */
/* LLM call                                                            */
/* ------------------------------------------------------------------ */

/**
 * Call the LLM with thinking disabled and bounded tokens.
 *
 * When the provider returns empty content with `finish_reason === 'length'`
 * (token budget exhausted), retries **once** with a larger budget before
 * giving up.  The retry is transparent to the caller; the call-count
 * invariant stays "1 call per normal turn" because the retry only fires
 * on the degenerate empty-content path.
 */
async function callLLM(
  llm: LLMClient,
  system: string,
  userText: string,
  state: ChatSessionState,
): Promise<string> {
  const messages = buildMessages(state, system, userText, INTERVIEW_HISTORY_CHAR_LIMIT);
  // The LLMClient interface expects {system, user} — we encode the full
  // conversation history in the user field with role markers.
  const request: LLMCompletionRequest = {
    system,
    user: buildConversationString(messages),
    purpose: 'interview-v4',
    maxTokens: LLM_MAX_TOKENS,
    thinking: 'disabled',
  };
  const result = await llm.complete(request);

  // Non-empty content — happy path
  if (result.trim().length > 0) return result;

  // Empty content with finish_reason=length: the token budget was too small.
  // Retry once with a larger budget.
  if (llm.lastFinishReason === 'length') {
    const retryRequest: LLMCompletionRequest = {
      ...request,
      maxTokens: LLM_RETRY_MAX_TOKENS,
    };
    return llm.complete(retryRequest);
  }

  // Empty for some other reason — return as-is (guards will catch it)
  return result;
}

/**
 * Encode messages array into a single string for the LLMClient interface.
 * System is already separate; we encode assistant/user turns.
 */
function buildConversationString(
  messages: Array<{ role: string; content: string }>,
): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue; // handled separately
    if (msg.role === 'assistant') {
      parts.push(`[访谈员]: ${msg.content}`);
    } else {
      parts.push(`[受访者]: ${msg.content}`);
    }
  }
  return parts.join('\n');
}

/* ------------------------------------------------------------------ */
/* Core API                                                            */
/* ------------------------------------------------------------------ */

/**
 * Start a v4 chat interview. The first question is generated by the model.
 */
export async function startChat(
  store: Store,
  token: string,
  options: ChatInterviewOptions,
  mode?: 'informant' | 'self',
): Promise<StartChatResult> {
  const now = clock(options);
  const resolved = resolveInvite(store, token, { now });
  const subject = store.getSubject(resolved.subjectId);
  if (!subject) throw new InterviewStateError('当事人不存在');

  const effectiveMode = mode ?? resolved.mode ?? 'informant';
  const sessionId = newId(options);

  const state = createChatSession({
    sessionId,
    inviteToken: token,
    mode: effectiveMode,
    respondentName: effectiveMode === 'self' ? subject.displayName : '你',
    relatedName: subject.displayName,
    relation: '朋友', // default; overridden at finish
    now,
  });

  // Save initial state
  saveChatSession(store, sessionId, state);

  // Generate opening question
  const aspects = uncoveredAspects(store, resolved.subjectId);
  const ctx: PromptContext = {
    mode: effectiveMode,
    respondentName: state.respondentName,
    relatedName: state.relatedName,
    relation: state.relation,
    uncoveredAspects: aspects,
    isOpening: true,
  };
  const systemPrompt = buildSystemPrompt(ctx);
  validateSystemPrompt(systemPrompt);

  let raw: string;
  try {
    raw = await callLLM(options.llm, systemPrompt, '', state);
  } catch (err: unknown) {
    if (isProviderError(err)) {
      const te = err as Error & { code?: string };
      logGenerationFailure({
        route: 'start',
        sessionId,
        reason: 'provider_error',
        outputLength: 0,
        errorName: te.name,
        errorCode: te.code,
      });
      throw new InterviewStateError('interview_generation_failed');
    }
    throw err;
  }
  const sanitised = sanitiseOutput(raw);

  // Guards on opening (with identity check, repair once)
  const failure = checkGuards(sanitised, [], true);
  if (failure) {
    // Repair once
    const repairCtx: PromptContext = { ...ctx, repairInjection: buildRepairInstruction(sanitised) };
    const repairSystem = buildSystemPrompt(repairCtx);
    let repairRaw: string;
    try {
      repairRaw = await callLLM(options.llm, repairSystem, '', state);
    } catch (repairErr: unknown) {
      if (isProviderError(repairErr)) {
        const te = repairErr as Error & { code?: string };
        logGenerationFailure({
          route: 'start',
          sessionId,
          reason: 'provider_error',
          outputLength: 0,
          errorName: te.name,
          errorCode: te.code,
        });
        throw new InterviewStateError('interview_generation_failed');
      }
      throw repairErr;
    }
    const repairSanitised = sanitiseOutput(repairRaw);
    const repairFailure = checkGuards(repairSanitised, [], true);
    if (repairFailure) {
      logGenerationFailure({
        route: 'start',
        sessionId,
        reason: repairFailure,
        finishReason: options.llm.lastFinishReason,
        outputLength: repairSanitised.length,
        outputHead: repairSanitised,
      });
      throw new InterviewStateError('interview_generation_failed');
    }
    const turnId = newId(options);
    const updated = addAssistantTurn(state, turnId, repairSanitised, now);
    saveChatSession(store, sessionId, updated);
    return { sessionId, message: { id: turnId, text: repairSanitised }, mode: effectiveMode };
  }

  const turnId = newId(options);
  const updated = addAssistantTurn(state, turnId, sanitised, now);
  saveChatSession(store, sessionId, updated);
  return { sessionId, message: { id: turnId, text: sanitised }, mode: effectiveMode };
}

/**
 * Process one user message and generate the next question.
 */
export async function say(
  store: Store,
  sessionId: string,
  input: SayInput,
  options: ChatInterviewOptions,
): Promise<SayResult> {
  const now = clock(options);
  let state = loadChatSession(store, sessionId, options);

  // Low-confidence speech confirmation
  if (
    input.source === 'speech' &&
    input.asrConfidence !== undefined &&
    input.asrConfidence < LOW_CONFIDENCE_THRESHOLD
  ) {
    return { confirm: { text: input.text } };
  }

  const text = input.text.trim();

  // Idempotent user turn: if the last effective turn is a user turn with
  // the same text, the client is retrying after a failed generation — do
  // not append a duplicate.
  const effectiveTurns = state.turns.filter((t) => !t.rejected);
  const lastTurn = effectiveTurns[effectiveTurns.length - 1];
  const isRetry = lastTurn?.role === 'user' && lastTurn.text === text;

  if (!isRetry) {
    const userTurnId = newId(options);
    state = addUserTurn(state, userTurnId, text, now);
    // Persist user turn so it survives a provider error
    saveChatSession(store, sessionId, state);
  }

  // Retreat detection
  const retreat = detectRetreat(text);
  let retreatInjection: string | undefined;
  if (retreat) {
    state = addCautiousTopic(state, text.slice(0, 20));
    retreatInjection = RETREAT_BOUNDARY_INJECTION;
  }

  // Reopen detection
  const reopen = detectReopen(text);
  if (reopen && state.cautiousTopics.length > 0) {
    // Remove the most recent cautious topic
    state = removeCautiousTopic(state, state.cautiousTopics[state.cautiousTopics.length - 1]!);
  }

  // Build prompt context
  const subject = store.getSubject(
    resolveInvite(store, state.inviteToken, { now }).subjectId,
  );
  const subjectId = resolveInvite(store, state.inviteToken, { now }).subjectId;
  const aspects = uncoveredAspects(store, subjectId);

  const ctx: PromptContext = {
    mode: state.mode,
    respondentName: state.respondentName,
    relatedName: state.relatedName,
    relation: state.relation,
    uncoveredAspects: aspects,
    isOpening: false,
    ...(retreatInjection ? { retreatInjection } : {}),
  };
  const systemPrompt = buildSystemPrompt(ctx);
  validateSystemPrompt(systemPrompt);

  // Generate response
  let raw: string;
  try {
    raw = await callLLM(options.llm, systemPrompt, text, state);
  } catch (err: unknown) {
    if (isProviderError(err)) {
      const te = err as Error & { code?: string };
      logGenerationFailure({
        route: 'say',
        sessionId,
        reason: 'provider_error',
        outputLength: 0,
        errorName: te.name,
        errorCode: te.code,
      });
      // User turn is already persisted; client can retry same text
      throw new InterviewStateError('interview_generation_failed');
    }
    throw err;
  }
  const sanitised = sanitiseOutput(raw);
  const recentQs = askedQuestions(state);
  const failure = checkGuards(sanitised, recentQs);

  if (!failure) {
    // Passed
    const turnId = newId(options);
    state = addAssistantTurn(state, turnId, sanitised, now);
    saveChatSession(store, sessionId, state);
    return { message: { id: turnId, text: sanitised } };
  }

  // Record rejected turn for audit
  const rejectedId = newId(options);
  state = addAssistantTurn(state, rejectedId, sanitised, now, true);

  // One repair attempt
  const repairCtx: PromptContext = { ...ctx, repairInjection: buildRepairInstruction(sanitised) };
  const repairSystem = buildSystemPrompt(repairCtx);
  let repairRaw: string;
  try {
    repairRaw = await callLLM(options.llm, repairSystem, text, state);
  } catch (repairErr: unknown) {
    if (isProviderError(repairErr)) {
      const te = repairErr as Error & { code?: string };
      logGenerationFailure({
        route: 'say',
        sessionId,
        reason: 'provider_error',
        outputLength: 0,
        errorName: te.name,
        errorCode: te.code,
      });
      throw new InterviewStateError('interview_generation_failed');
    }
    throw repairErr;
  }
  const repairSanitised = sanitiseOutput(repairRaw);
  const repairFailure = checkGuards(repairSanitised, recentQs);

  if (!repairFailure) {
    const turnId = newId(options);
    state = addAssistantTurn(state, turnId, repairSanitised, now);
    saveChatSession(store, sessionId, state);
    return { message: { id: turnId, text: repairSanitised } };
  }

  // Both failed — record second rejection too
  const rejectedId2 = newId(options);
  state = addAssistantTurn(state, rejectedId2, repairSanitised, now, true);
  saveChatSession(store, sessionId, state);
  logGenerationFailure({
    route: 'say',
    sessionId,
    reason: repairFailure,
    finishReason: options.llm.lastFinishReason,
    outputLength: repairSanitised.length,
    outputHead: repairSanitised,
  });
  throw new InterviewStateError('interview_generation_failed');
}

/**
 * Finish the interview: convert turns to testimony answers, submit through
 * the existing submitTestimony path.
 */
export function finishChat(
  store: Store,
  sessionId: string,
  input: FinishChatInput,
  options: ChatInterviewOptions,
): { witnessId: string; testimonyId: string; count: number } {
  const now = clock(options);
  const state = loadChatSession(store, sessionId, options);

  // Convert turns to TestimonyAnswer[] format
  // Each assistant question + user response pair becomes one answer
  const effectiveTurns = state.turns.filter((t) => !t.rejected);
  const answers: Array<{
    qid: string;
    behindText: string;
    question: string;
    basis?: 'witnessed' | 'heard' | 'inferred' | 'unknown';
  }> = [];

  for (let i = 0; i < effectiveTurns.length; i++) {
    const turn = effectiveTurns[i]!;
    if (turn.role === 'assistant') {
      // Look for a following user response
      const next = effectiveTurns[i + 1];
      if (next && next.role === 'user') {
        const basis = classifyBasis(next.text);
        answers.push({
          qid: `v4:${turn.id}`,
          behindText: next.text,
          question: turn.text,
          ...(basis !== 'unknown' ? { basis } : {}),
        });
        i++; // skip the user turn
      }
    }
  }

  if (answers.length === 0) {
    throw new InterviewStateError('没有可提交的回答');
  }

  // Ensure qids are unique
  const qids = new Set(answers.map((a) => a.qid));
  if (qids.size !== answers.length) {
    throw new InterviewStateError('回答 ID 不唯一');
  }

  const relation = input.relation ?? state.relation;

  const result = submitTestimony(
    store,
    state.inviteToken,
    {
      relation,
      ...(input.stance ? { stance: input.stance } : {}),
      consentLevel: input.consentLevel as ConsentLevel,
      answers: answers.map((a) => ({
        qid: a.qid,
        behindText: a.behindText,
        ...(a.basis ? { basis: a.basis } : {}),
      })),
      ...(input.freeText ? { freeText: input.freeText } : {}),
    },
    { now, ...(options.newId ? { newId: options.newId } : {}) },
  );

  store.purgeInterviewSession(sessionId);
  return result;
}

/**
 * Get the current chat session state (for refresh recovery).
 */
export function getChatHistory(
  store: Store,
  sessionId: string,
  options: ChatInterviewOptions,
): { turns: ChatSessionState['turns']; mode: string } {
  const state = loadChatSession(store, sessionId, options);
  return {
    turns: state.turns.filter((t) => !t.rejected),
    mode: state.mode,
  };
}
