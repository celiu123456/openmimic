/**
 * mount-openai: OpenAI-compatible `/v1` surface as a plugin.
 *
 * The persona *is* the model: `persona/<id>` is a valid model name that
 * triggers persona context assembly and upstream chat forwarding.
 */
import { z } from 'zod';
import type { ServerResponse } from 'node:http';
import { assemblePersonaContext, type Store } from '@openmimic/kernel';
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
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...body.messages,
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
        return { status: 200, body: payload };
      }

      // SSE passthrough
      return {
        kind: 'stream' as const,
        run: async (response: ServerResponse) => {
          response.writeHead(200, {
            'content-type':
              upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
          });
          try {
            const streamBody = upstream.body;
            if (streamBody) {
              const reader = streamBody.getReader();
              try {
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (value) response.write(Buffer.from(value));
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
          response.end();
        },
      };
    });
  },
};
