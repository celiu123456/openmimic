/**
 * v4 chat session state.
 *
 * Immutable-style state transitions; persistence is the caller's job.
 */

import { z } from 'zod';
import { INTERVIEW_SESSION_TTL_MS } from '../interview-state';

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export const ChatTurnSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['assistant', 'user']),
  text: z.string().min(1),
  at: z.string().min(1),
  /** True for assistant turns that were rejected by guards (audit only). */
  rejected: z.boolean().optional(),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

export const ChatSessionStateSchema = z.object({
  sessionId: z.string().min(1),
  inviteToken: z.string().min(1),
  mode: z.enum(['informant', 'self']),
  respondentName: z.string().min(1),
  relatedName: z.string().min(1),
  relation: z.string().min(1),
  turns: z.array(ChatTurnSchema),
  cautiousTopics: z.array(z.string()),
  createdAt: z.string().min(1),
  lastActiveAt: z.string().min(1),
});
export type ChatSessionState = z.infer<typeof ChatSessionStateSchema>;

/** Default history character limit before trimming. */
export const INTERVIEW_HISTORY_CHAR_LIMIT = 24_000;

/* Re-export the TTL so consumers don't need to import interview-state. */
export { INTERVIEW_SESSION_TTL_MS };

/* ------------------------------------------------------------------ */
/* State transitions                                                   */
/* ------------------------------------------------------------------ */

export interface NewChatSession {
  sessionId: string;
  inviteToken: string;
  mode: 'informant' | 'self';
  respondentName: string;
  relatedName: string;
  relation: string;
  now: Date;
}

export function createChatSession(args: NewChatSession): ChatSessionState {
  const at = args.now.toISOString();
  return {
    sessionId: args.sessionId,
    inviteToken: args.inviteToken,
    mode: args.mode,
    respondentName: args.respondentName,
    relatedName: args.relatedName,
    relation: args.relation,
    turns: [],
    cautiousTopics: [],
    createdAt: at,
    lastActiveAt: at,
  };
}

/** Append an assistant turn. */
export function addAssistantTurn(
  state: ChatSessionState,
  id: string,
  text: string,
  now: Date,
  rejected = false,
): ChatSessionState {
  const turn: ChatTurn = {
    id,
    role: 'assistant',
    text,
    at: now.toISOString(),
    ...(rejected ? { rejected: true } : {}),
  };
  return {
    ...state,
    turns: [...state.turns, turn],
    lastActiveAt: now.toISOString(),
  };
}

/** Append a user turn. */
export function addUserTurn(
  state: ChatSessionState,
  id: string,
  text: string,
  now: Date,
): ChatSessionState {
  const turn: ChatTurn = { id, role: 'user', text, at: now.toISOString() };
  return {
    ...state,
    turns: [...state.turns, turn],
    lastActiveAt: now.toISOString(),
  };
}

/** Add a topic to the cautious list. */
export function addCautiousTopic(
  state: ChatSessionState,
  topic: string,
): ChatSessionState {
  if (state.cautiousTopics.includes(topic)) return state;
  return { ...state, cautiousTopics: [...state.cautiousTopics, topic] };
}

/** Remove a topic from the cautious list (reopen). */
export function removeCautiousTopic(
  state: ChatSessionState,
  topic: string,
): ChatSessionState {
  return {
    ...state,
    cautiousTopics: state.cautiousTopics.filter((t) => t !== topic),
  };
}

/**
 * Extract all non-rejected assistant question texts from the session,
 * for dedup purposes.
 */
export function askedQuestions(state: ChatSessionState): string[] {
  return state.turns
    .filter((t) => t.role === 'assistant' && !t.rejected)
    .map((t) => t.text);
}
