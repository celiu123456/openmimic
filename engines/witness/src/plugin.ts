import type { Plugin, Store } from '@openmimic/kernel';
import {
  createInvite,
  resolveInvite,
  type CreateInviteOptions,
  type CreatedInvite,
  type ResolveInviteOptions,
  type ResolvedInvite,
} from './invite';
import {
  answerFollowup,
  answerQuestion,
  finishInterview,
  startInterview,
  type AnswerFollowupInput,
  type AnswerQuestionInput,
  type FinishInterviewInput,
  type InterviewOptions,
  type StartedInterview,
} from './interview';
import type { InterviewStep } from './interview-state';
import type { LLMClient } from './llm';
import { FRIEND_V1, type Questionnaire } from './questionnaires/friend-v1';
import {
  WITNESS_V2_FRIEND,
  WITNESS_V2_FAMILY,
  WITNESS_V2_COLLEAGUE,
  WITNESS_V2_QUESTIONNAIRES,
} from './questionnaires/witness-v2';
import {
  submitTestimony,
  type SubmitTestimonyInput,
  type SubmitTestimonyOptions,
  type SubmitTestimonyResult,
} from './testimony';
import {
  startChat,
  say,
  finishChat,
  getChatHistory,
  type ChatInterviewOptions,
  type StartChatResult,
  type SayInput,
  type SayResult,
  type FinishChatInput,
} from './interviewer-v4/interviewer';

/** The collector surface once a {@link Store} is bound to it. */
export interface WitnessCollector {
  /** The questionnaire every invite currently hands out. */
  readonly questionnaire: Questionnaire;
  createInvite(subjectId: string, options?: CreateInviteOptions): CreatedInvite;
  resolveInvite(token: string, options?: ResolveInviteOptions): ResolvedInvite;
  submitTestimony(
    token: string,
    input: SubmitTestimonyInput,
    options?: SubmitTestimonyOptions,
  ): SubmitTestimonyResult;
  /** Open an interview session and hand back its first question. */
  startInterview(token: string): StartedInterview;
  /** Answer (or skip) the current question; may return a follow-up to ask. */
  answerQuestion(sessionId: string, input: AnswerQuestionInput): Promise<InterviewStep>;
  /** Answer (or skip) the follow-up that is currently waiting. */
  answerFollowup(sessionId: string, input: AnswerFollowupInput): InterviewStep;
  /** Close the session and append the assembled testimony. */
  finishInterview(
    sessionId: string,
    input: FinishInterviewInput,
  ): SubmitTestimonyResult;
}

/** Bind the WitnessEngine functions to one store. */
export function createWitnessCollector(
  store: Store,
  options: InterviewOptions = {},
): WitnessCollector {
  return {
    questionnaire: FRIEND_V1,
    createInvite: (subjectId, inviteOptions) =>
      createInvite(store, subjectId, inviteOptions),
    resolveInvite: (token, resolveOptions) => resolveInvite(store, token, resolveOptions),
    submitTestimony: (token, input, submitOptions) =>
      submitTestimony(store, token, input, submitOptions),
    startInterview: (token) => startInterview(store, token, options),
    answerQuestion: (sessionId, input) =>
      answerQuestion(store, sessionId, input, options),
    answerFollowup: (sessionId, input) =>
      answerFollowup(store, sessionId, input, options),
    finishInterview: (sessionId, input) =>
      finishInterview(store, sessionId, input, options),
  };
}

/**
 * Standard Plugin object for the official WitnessCollector.
 *
 * Registered as `kind: 'collector'`: this is the intake surface that gathers
 * evidence from friends, and it goes through the same plugin path as any
 * third-party plugin.
 */
export const witnessPlugin: Plugin = {
  name: 'witness',
  kind: 'collector',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx) {
    const store = ctx.get<Store>('store');
    const llm = ctx.has('llm') ? ctx.get<LLMClient>('llm') : undefined;
    const collector = createWitnessCollector(store, llm ? { llm } : {});
    ctx.provide('witness', collector);
  },
};

/** The v4 chat collector surface once a {@link Store} is bound. */
export interface ChatCollector {
  startChat(token: string, mode?: 'informant' | 'self'): Promise<StartChatResult>;
  say(sessionId: string, input: SayInput): Promise<SayResult>;
  finishChat(sessionId: string, input: FinishChatInput): ReturnType<typeof finishChat>;
  getChatHistory(sessionId: string): ReturnType<typeof getChatHistory>;
}

/** Bind the v4 ChatCollector functions to one store. */
export function createChatCollector(
  store: Store,
  options: ChatInterviewOptions,
): ChatCollector {
  return {
    startChat: (token, mode) => startChat(store, token, options, mode),
    say: (sessionId, input) => say(store, sessionId, input, options),
    finishChat: (sessionId, input) => finishChat(store, sessionId, input, options),
    getChatHistory: (sessionId) => getChatHistory(store, sessionId, options),
  };
}

/**
 * Plugin for the v4 chat-based interviewer.
 *
 * Registered as `kind: 'collector'`, `name: 'chat'`: coexists with the
 * question-tree `witness` collector. Requires an LLM.
 */
export const chatPlugin: Plugin = {
  name: 'chat',
  kind: 'collector',
  version: '0.0.1',
  inject: ['store', 'llm'],
  apply(ctx) {
    const store = ctx.get<Store>('store');
    const llm = ctx.get<LLMClient>('llm');
    const collector = createChatCollector(store, { llm });
    ctx.provide('chat', collector);
  },
};

/* ------------------------------------------------------------------ */
/* Legacy compat — kept so old code paths continue to compile          */
/* ------------------------------------------------------------------ */

/** @deprecated Use {@link witnessPlugin} instead. */
export const WITNESS_COLLECTOR_MANIFEST = {
  name: 'witness',
  kind: 'collector',
  version: '0.0.1',
  description: 'Friend questionnaire, reusable invites and testimony intake',
} as const;

/** @deprecated */
export interface WitnessCollectorContext {
  store: Store;
  collectors: Record<string, unknown>;
  llm?: LLMClient;
}

/** @deprecated Use {@link witnessPlugin} instead. */
export async function registerWitnessCollector(
  host: { register: (manifest: unknown, setup: (ctx: unknown) => void | Promise<void>) => Promise<void> },
): Promise<void> {
  await host.register(WITNESS_COLLECTOR_MANIFEST, (context: unknown) => {
    const ctx = context as WitnessCollectorContext;
    ctx.collectors[WITNESS_COLLECTOR_MANIFEST.name] = createWitnessCollector(
      ctx.store,
      ctx.llm ? { llm: ctx.llm } : {},
    );
  });
}
