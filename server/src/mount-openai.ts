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
 */
import { z } from 'zod';
import type { ServerResponse } from 'node:http';
import { assemblePersonaContext, computeFingerprint, type Store } from '@openmimic/kernel';
import type { Plugin } from '@openmimic/kernel';
import type { ChatMessage } from '@openmimic/engine-court';
import type { Router } from './router';
import type { ChatUpstream } from './server';

const PERSONA_MODEL_PREFIX = 'persona/';

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
 * Persona models never use tools — these fields come from clients that
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
        continue; // orphan — drop
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

    router.get('/v1/models', () => {
      const data: unknown[] = [];
      for (const subject of store.listSubjects()) {
        const served = store
          .listClaimsBySubject(subject.id)
          .some((claim) => claim.status === 'surviving');
        if (!served) continue;
        data.push({
          id: `${PERSONA_MODEL_PREFIX}${subject.id}`,
          object: 'model',
          created: 0,
          owned_by: 'openmimic',
        });
      }
      return { status: 200, body: { object: 'list', data } };
    });

    router.post('/v1/chat/completions', async (context) => {
      const body = ChatCompletionBodySchema.parse(context.body);
      if (!body.model.startsWith(PERSONA_MODEL_PREFIX)) {
        return {
          status: 404,
          body: openAiError('model_not_found', `未知模型:${body.model}`),
        };
      }
      const subjectId = body.model.slice(PERSONA_MODEL_PREFIX.length);
      if (subjectId === '' || !store.getSubject(subjectId)) {
        return {
          status: 404,
          body: openAiError('model_not_found', `未知模型:${body.model}`),
        };
      }
      if (!chat || !chat.configured || !chat.hasApiKey) {
        return {
          status: 501,
          body: openAiError('llm_unavailable', '服务器未配置语言模型', 'server_error'),
        };
      }

      const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
      const query = typeof lastUser?.content === 'string' ? lastUser.content : undefined;
      const { systemPrompt } = await assemblePersonaContext(subjectId, store, {
        query,
        interlocutor: body.metadata?.interlocutor,
      });
      const normalized = normalizeMessages(body.messages);
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...normalized,
      ];
      const stream = body.stream === true;

      let upstream: Response;
      try {
        upstream = await chat.chatRaw(messages, { stream });
      } catch {
        return {
          status: 502,
          body: openAiError('upstream_error', '上游模型服务不可用', 'server_error'),
        };
      }
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        return {
          status: 502,
          body: openAiError(
            'upstream_error',
            `上游模型返回 ${upstream.status}${detail ? `:${detail.slice(0, 200)}` : ''}`,
            'server_error',
          ),
        };
      }

      if (!stream) {
        let payload: unknown;
        try {
          payload = await upstream.json();
        } catch {
          return {
            status: 502,
            body: openAiError('upstream_error', '上游返回了无法解析的响应', 'server_error'),
          };
        }
        // Reflux fingerprint for non-streamed persona replies
        try {
          const choices = (payload as Record<string, unknown>)?.choices;
          if (Array.isArray(choices)) {
            const content = (choices[0] as Record<string, unknown>)?.message;
            const text = typeof (content as Record<string, unknown>)?.content === 'string'
              ? (content as Record<string, unknown>).content as string
              : '';
            if (text.trim()) {
              store.putFingerprint(
                computeFingerprint(`persona:${subjectId}:${Date.now()}`, subjectId, text),
              );
            }
          }
        } catch {
          // Fingerprinting is best-effort; never block the response
        }
        return { status: 200, body: payload };
      }

      // SSE passthrough with reflux fingerprinting
      return {
        kind: 'stream' as const,
        run: async (response: ServerResponse) => {
          response.writeHead(200, {
            'content-type':
              upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
          });
          // Accumulate streamed text for end-of-stream fingerprinting.
          // We parse SSE data lines to extract content deltas. This is
          // best-effort: if parsing fails we still forward all bytes.
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
                    // Try to extract content deltas from SSE chunk
                    try {
                      const text = chunk.toString('utf-8');
                      for (const line of text.split('\n')) {
                        if (!line.startsWith('data: ')) continue;
                        const payload = line.slice(6).trim();
                        if (payload === '[DONE]') continue;
                        const parsed = JSON.parse(payload);
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
              `data: ${JSON.stringify(openAiError('upstream_error', '上游流中断', 'server_error'))}\n\n`,
            );
          }
          // End-of-stream reflux fingerprint
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
    });
  },
};
