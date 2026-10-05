/**
 * mount-openai: OpenAI-compatible `/v1` surface as a plugin.
 *
 * The persona *is* the model: `persona/<id>` is a valid model name that
 * triggers persona context assembly and upstream chat forwarding.
 *
 * Message normalization: orphan tool messages are folded and tool_call fields
 * are stripped before forwarding to the upstream, because persona models do
 * not use tools.
 *
 * Reflux fingerprint: every persona reply (streamed or non-streamed) is
 * fingerprinted for AI-product reflux detection. Streamed responses are
 * fingerprinted once at the end of the stream against the accumulated text.
 *
 * Embedding protection: tokens with `persona.chat` scope cannot:
 * - Disable output-side fact checking or privacy filtering via parameters
 * - Read the full system prompt text (only metadata is exposed)
 */
import { z } from 'zod';
import type { ServerResponse } from 'node:http';
import {
  assemblePersonaContext,
  computeFingerprint,
  verifyPersonaResponse,
  type Store,
  type VerifyLLM,
} from '@openmimic/kernel';
import type { Plugin } from '@openmimic/kernel';
import type { ChatMessage } from '@openmimic/engine-court';
import type { LLMClient } from '@openmimic/engine-room';
import {
  findCrisisSignal,
  buildCrisisPrompt,
  createCrisisState,
  activateCrisis,
  isCrisisActive,
  checkCrisisActive,
  type CrisisState,
  type CrisisAuditEvent,
  type HelpResource,
} from '@openmimic/engine-gate';
import type { Router } from './router';
import type { ChatUpstream } from './server';
import { requireSubjectAccess } from './auth';
import type { AuthContext } from './scopes';

const PERSONA_MODEL_PREFIX = 'persona/';

/**
 * Whether output-side persona verification is enabled.
 * Default: on. Set PERSONA_VERIFY=0 / off / false to disable.
 */
function isVerifyEnabled(): boolean {
  const v = process.env.PERSONA_VERIFY;
  if (v === undefined || v === '') return true;
  return !['0', 'off', 'false'].includes(v.toLowerCase());
}

/** Conservative fallback when verification itself fails. */
const VERIFY_FAILED_RESPONSE = '嗯……这个我一时想不起来了,改天再聊?' as const;

/**
 * Split verified text into sentence-sized chunks for SSE re-emission.
 * Splits on Chinese sentence-end punctuation; falls back to a single chunk.
 */
function splitForSSE(text: string): string[] {
  if (!text) return [text];
  const parts = text.split(/(?<=[。！？；\n])/).filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

/**
 * Strip stage direction brackets from persona replies.
 * Matches Chinese and English parenthetical stage directions like
 * (停顿了一下), (沉默), (叹气), (sighs), etc.
 */
const STAGE_BRACKET_RE = /[（(][^)）]{1,20}[)）]/g;

function stripStageBrackets(text: string): string {
  return text.replace(STAGE_BRACKET_RE, '').replace(/\s{2,}/g, ' ').trim();
}

const ChatMessageSchema = z
  .object({
    role: z.string().min(1),
    content: z.unknown().optional(),
  })
  .passthrough();

const ChatCompletionBodySchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(ChatMessageSchema).min(1),
    stream: z.boolean().optional(),
    metadata: z
      .object({
        interlocutor: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const openAiError = (
  code: string,
  message: string,
  type: 'invalid_request_error' | 'server_error' = 'invalid_request_error',
): unknown => ({ error: { message, type, code } });

/* ------------------------------------------------------------------ */
/* Message normalization                                               */
/* ------------------------------------------------------------------ */

/**
 * Normalize messages before forwarding to the upstream:
 * 1. Remove orphan tool messages (tool role without a preceding assistant
 *    tool_call that matches their tool_call_id).
 * 2. Strip tool_call / tool_calls fields from assistant messages.
 *
 * Persona models never use tools -- these fields come from clients that
 * copy-paste their tool-use history into a persona conversation.
 */
function normalizeMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  // Collect tool_call_ids actually present in assistant tool_calls
  const validToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      for (const call of calls) {
        if (typeof (call as Record<string, unknown>).id === 'string') {
          validToolCallIds.add((call as Record<string, unknown>).id as string);
        }
      }
    }
  }

  const result: ChatMessage[] = [];
  for (const msg of messages) {
    // Drop orphan tool messages
    if (msg.role === 'tool') {
      const toolCallId = msg.tool_call_id;
      if (typeof toolCallId !== 'string' || !validToolCallIds.has(toolCallId)) {
        continue; // orphan -- drop
      }
      // Even matched tool messages are dropped for persona forwarding
      continue;
    }

    // Strip tool fields from assistant messages
    if (msg.role === 'assistant') {
      const cleaned: ChatMessage = { role: msg.role };
      if (msg.content !== undefined) cleaned.content = msg.content;
      // Copy other passthrough fields (e.g. name) but not tool fields
      for (const [key, value] of Object.entries(msg)) {
        if (key === 'role' || key === 'content' || key === 'tool_calls' || key === 'tool_call_id') continue;
        cleaned[key] = value;
      }
      result.push(cleaned);
      continue;
    }

    // Pass through other messages, stripping any embedded tool fields
    const cleaned: ChatMessage = { ...msg };
    delete cleaned.tool_calls;
    delete cleaned.tool_call_id;
    result.push(cleaned);
  }

  return result;
}

export interface MountOpenAIConfig {
  chat?: ChatUpstream;
}

export const mountOpenaiPlugin: Plugin<MountOpenAIConfig> = {
  name: 'mount-openai',
  kind: 'mount',
  version: '0.0.1',
  inject: ['store', 'router'],
  apply(ctx, config) {
    const store = ctx.get<Store>('store');
    const router = ctx.get<Router>('router');
    const chat = config?.chat;
    // LLM for verification calls (optional -- if absent, verify is disabled)
    const llm: LLMClient | undefined = ctx.has('llm') ? ctx.get<LLMClient>('llm') : undefined;

    router.get('/v1/models', (context) => {
      const auth = context.auth;
      const data: unknown[] = [];
      for (const subject of store.listSubjects()) {
        // Subject binding enforcement
        if (auth && auth.subjectIds.length > 0 && !auth.subjectIds.includes(subject.id)) {
          continue;
        }
        const served = store
          .listClaimsBySubject(subject.id)
          .some((claim) => claim.status === 'surviving');
        if (!served) continue;
        // Only expose non-sensitive metadata (no system prompt)
        data.push({
          id: `${PERSONA_MODEL_PREFIX}${subject.id}`,
          object: 'model',
          created: 0,
          owned_by: 'openmimic',
        });
      }
      return { status: 200, body: { object: 'list', data } };
    }, { scope: 'persona.read' });

    // Per-session crisis state (keyed by a simple session identifier).
    // In a real deployment this would be backed by a session store; here
    // we use an in-memory map keyed by the first 8 chars of the auth
    // token or a per-request fallback. This is sufficient for the crisis
    // quiet period to work within a single server process.
    const crisisStates = new Map<string, CrisisState>();
    const crisisAuditFn: ((e: CrisisAuditEvent) => void) | undefined =
      ctx.has('crisisAudit')
        ? ctx.get<(e: CrisisAuditEvent) => void>('crisisAudit')
        : undefined;
    // Help resources: configurable, empty by default (no fabricated numbers)
    const helpResources: HelpResource[] = [];

    router.post('/v1/chat/completions', async (context) => {
      const auth = context.auth;
      const body = ChatCompletionBodySchema.parse(context.body);
      if (!body.model.startsWith(PERSONA_MODEL_PREFIX)) {
        return {
          status: 404,
          body: openAiError('model_not_found', `Unknown model: ${body.model}`),
        };
      }
      const subjectId = body.model.slice(PERSONA_MODEL_PREFIX.length);
      if (subjectId === '' || !store.getSubject(subjectId)) {
        return {
          status: 404,
          body: openAiError('model_not_found', `Unknown model: ${body.model}`),
        };
      }

      // Subject binding enforcement
      if (auth) {
        requireSubjectAccess(auth, subjectId);
      }

      if (!chat || !chat.configured || !chat.hasApiKey) {
        return {
          status: 501,
          body: openAiError('llm_unavailable', 'LLM not configured', 'server_error'),
        };
      }

      const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
      const query = typeof lastUser?.content === 'string' ? lastUser.content : undefined;

      // --- Crisis detection ---
      // Session key for crisis state tracking
      const sessionKey = auth?.tokenId ?? `anon-${subjectId}`;
      let crisisState = crisisStates.get(sessionKey) ?? createCrisisState();

      // Check if quiet period has expired
      crisisState = checkCrisisActive(crisisState);

      // Scan incoming user message for crisis signals
      let crisisTriggered = false;
      if (query) {
        const crisisWord = findCrisisSignal(query);
        if (crisisWord && !crisisState.active) {
          crisisState = activateCrisis(crisisState, crisisWord);
          crisisTriggered = true;
          // Audit: record crisis activation (no raw text)
          if (crisisAuditFn) {
            crisisAuditFn({
              at: new Date().toISOString(),
              type: 'crisis_activated',
              source: 'persona_chat',
              subjectId,
              sessionKey,
            });
          }
        }
      }

      crisisStates.set(sessionKey, crisisState);
      const inCrisisMode = isCrisisActive(crisisState);

      // --- Build messages ---
      // In crisis mode: ZERO-CACHE PATH. Do NOT reuse any cached persona
      // assembly. Build the crisis prompt from scratch.
      let effectiveSystemPrompt: string;
      let excludedPrivateTopics: string[] = [];

      if (inCrisisMode) {
        const displayName = store.getSubject(subjectId)?.displayName ?? subjectId;
        effectiveSystemPrompt = buildCrisisPrompt(displayName, helpResources);
      } else {
        const assembled = await assemblePersonaContext(subjectId, store, {
          query,
          interlocutor: body.metadata?.interlocutor,
        });
        effectiveSystemPrompt = assembled.systemPrompt;
        excludedPrivateTopics = assembled.excludedPrivateTopics;
      }

      const normalized = normalizeMessages(body.messages);
      const messages: ChatMessage[] = [
        { role: 'system', content: effectiveSystemPrompt },
        ...normalized,
      ];
      const stream = body.stream === true;

      let upstream: Response;
      try {
        upstream = await chat.chatRaw(messages, { stream });
      } catch {
        return {
          status: 502,
          body: openAiError('upstream_error', 'Upstream model service unavailable', 'server_error'),
        };
      }
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        return {
          status: 502,
          body: openAiError(
            'upstream_error',
            `Upstream returned ${upstream.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
            'server_error',
          ),
        };
      }

      const verifyEnabled = isVerifyEnabled() && !!llm;
      const userMessage = query ?? '';
      const displayName = store.getSubject(subjectId)?.displayName ?? subjectId;

      if (!stream) {
        let payload: unknown;
        try {
          payload = await upstream.json();
        } catch {
          return {
            status: 502,
            body: openAiError('upstream_error', 'Upstream returned unparseable response', 'server_error'),
          };
        }
        // Post-process: strip stage brackets, verify, and fingerprint
        const headers: Record<string, string> = {};
        if (inCrisisMode) {
          headers['x-openmimic-crisis'] = 'active';
        }
        try {
          const choices = (payload as Record<string, unknown>)?.choices;
          if (Array.isArray(choices)) {
            const msg = (choices[0] as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
            if (msg && typeof msg.content === 'string') {
              // Strip stage direction brackets from persona output
              let cleaned = stripStageBrackets(msg.content);

              // Output-side verification (skipped in crisis mode)
              if (verifyEnabled && cleaned.trim() && !inCrisisMode) {
                try {
                  const vResult = await verifyPersonaResponse({
                    systemPrompt: effectiveSystemPrompt,
                    userMessage,
                    response: cleaned,
                    llm: llm as VerifyLLM,
                    displayName,
                    excludedPrivateTopics,
                  });
                  cleaned = vResult.finalResponse;
                  if (vResult.verified && !vResult.passed) {
                    headers['x-openmimic-verify'] = 'rewritten';
                  } else if (vResult.verified) {
                    headers['x-openmimic-verify'] = 'passed';
                  }
                } catch {
                  // Verification failed (timeout, budget, etc.) — return
                  // conservative response, never the unverified original
                  cleaned = VERIFY_FAILED_RESPONSE;
                  headers['x-openmimic-verify'] = 'failed';
                }
              }

              msg.content = cleaned;
              // Reflux fingerprint on the FINAL response
              if (cleaned.trim()) {
                store.putFingerprint(
                  computeFingerprint(`persona:${subjectId}:${Date.now()}`, subjectId, cleaned),
                );
              }
            }
          }
        } catch {
          // Post-processing is best-effort; never block the response
        }
        return { status: 200, body: payload, headers };
      }

      // --- Streaming path ---
      // When verify is enabled, buffer the full response, verify, then
      // re-emit as SSE. When verify is disabled, pass through directly.

      if (!verifyEnabled) {
        // Direct SSE passthrough (original behavior)
        return {
          kind: 'stream' as const,
          run: async (response: ServerResponse) => {
            response.writeHead(200, {
              'content-type':
                upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8',
              'cache-control': 'no-cache',
            });
            const textChunks: string[] = [];
            try {
              const streamBody = upstream.body;
              if (streamBody) {
                const reader = streamBody.getReader();
                try {
                  for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                      const chunk = Buffer.from(value);
                      response.write(chunk);
                      try {
                        const text = chunk.toString('utf-8');
                        for (const line of text.split('\n')) {
                          if (!line.startsWith('data: ')) continue;
                          const p = line.slice(6).trim();
                          if (p === '[DONE]') continue;
                          const parsed = JSON.parse(p);
                          const delta = parsed?.choices?.[0]?.delta?.content;
                          if (typeof delta === 'string') textChunks.push(delta);
                        }
                      } catch {
                        // SSE parsing is best-effort
                      }
                    }
                  }
                } finally {
                  reader.releaseLock();
                }
              }
            } catch {
              response.write(
                `data: ${JSON.stringify(openAiError('upstream_error', 'Upstream stream interrupted', 'server_error'))}\n\n`,
              );
            }
            try {
              const fullText = textChunks.join('');
              if (fullText.trim()) {
                store.putFingerprint(
                  computeFingerprint(`persona:${subjectId}:${Date.now()}`, subjectId, fullText),
                );
              }
            } catch {
              // Fingerprinting is best-effort
            }
            response.end();
          },
        };
      }

      // Verify-enabled streaming: buffer → verify → re-emit
      return {
        kind: 'stream' as const,
        run: async (response: ServerResponse) => {
          // 1. Buffer the full upstream response
          const textChunks: string[] = [];
          let modelId = '';
          try {
            const streamBody = upstream.body;
            if (streamBody) {
              const reader = streamBody.getReader();
              try {
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (value) {
                    try {
                      const text = Buffer.from(value).toString('utf-8');
                      for (const line of text.split('\n')) {
                        if (!line.startsWith('data: ')) continue;
                        const p = line.slice(6).trim();
                        if (p === '[DONE]') continue;
                        const parsed = JSON.parse(p);
                        const delta = parsed?.choices?.[0]?.delta?.content;
                        if (typeof delta === 'string') textChunks.push(delta);
                        if (!modelId && parsed?.model) modelId = parsed.model;
                      }
                    } catch {
                      // SSE parsing is best-effort
                    }
                  }
                }
              } finally {
                reader.releaseLock();
              }
            }
          } catch {
            // Upstream interrupted — proceed with whatever we have
          }

          let finalText = stripStageBrackets(textChunks.join(''));
          let verifyHeader = 'buffered';

          // 2. Verify (skipped in crisis mode)
          if (finalText.trim() && !inCrisisMode) {
            try {
              const vResult = await verifyPersonaResponse({
                systemPrompt: effectiveSystemPrompt,
                userMessage,
                response: finalText,
                llm: llm as VerifyLLM,
                displayName,
                excludedPrivateTopics,
              });
              finalText = vResult.finalResponse;
              if (vResult.verified && !vResult.passed) {
                verifyHeader = 'buffered-rewritten';
              } else if (vResult.verified) {
                verifyHeader = 'buffered-passed';
              }
            } catch {
              finalText = VERIFY_FAILED_RESPONSE;
              verifyHeader = 'failed';
            }
          }

          // 3. Emit as SSE
          response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            'x-openmimic-verify': verifyHeader,
          });

          // Emit the verified response in sentence-sized chunks to
          // maintain the SSE streaming contract
          const chatId = `chatcmpl-${Date.now()}`;
          const chunks = splitForSSE(finalText);
          for (let i = 0; i < chunks.length; i++) {
            const delta: Record<string, unknown> = { content: chunks[i] };
            if (i === 0) delta.role = 'assistant';
            const ssePayload = {
              id: chatId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: modelId || `persona/${subjectId}`,
              choices: [{ index: 0, delta, finish_reason: i === chunks.length - 1 ? 'stop' : null }],
            };
            response.write(`data: ${JSON.stringify(ssePayload)}\n\n`);
          }
          response.write('data: [DONE]\n\n');

          // 4. Reflux fingerprint on the FINAL (verified) response
          try {
            if (finalText.trim()) {
              store.putFingerprint(
                computeFingerprint(`persona:${subjectId}:${Date.now()}`, subjectId, finalText),
              );
            }
          } catch {
            // Fingerprinting is best-effort
          }
          response.end();
        },
      };
    }, { scope: 'persona.chat' });
  },
};
