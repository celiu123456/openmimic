import { createServer, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import { OpenAICompatClient } from '@openmimic/engine-court';
import { startServer, type RunningServer } from '@openmimic/server';
import { DEMO_SUBJECT_ID } from '@openmimic/fixtures';

interface ApiResponse {
  status: number;
  text: string;
  body: Record<string, unknown>;
  contentType: string | null;
  bytes: Buffer;
}

const asObject = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

async function api(
  base: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString('utf8');
  return {
    status: response.status,
    text,
    body: text === '' ? {} : (JSON.parse(text) as unknown as Record<string, unknown>),
    contentType: response.headers.get('content-type'),
    bytes,
  };
}

interface UpstreamRequest {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

interface FakeUpstream {
  url: string;
  requests: UpstreamRequest[];
  close(): Promise<void>;
}

/** A real loopback HTTP server standing in for the model provider. */
function startUpstream(
  respond: (request: UpstreamRequest, response: ServerResponse) => void,
): Promise<FakeUpstream> {
  const requests: UpstreamRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const record: UpstreamRequest = {
        url: req.url ?? '',
        method: req.method ?? '',
        headers: req.headers,
        body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
      };
      requests.push(record);
      respond(record, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

const clearLlmEnv = (): void => {
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_API_KEY;
};

describe('OpenAI-compatible persona surface', () => {
  let store: Store | undefined;
  let server: RunningServer | undefined;
  let upstream: FakeUpstream | undefined;

  afterEach(async () => {
    if (server) await server.close();
    if (upstream) await upstream.close();
    if (store) store.close();
    store = undefined;
    server = undefined;
    upstream = undefined;
  });

  it('lists only subjects with a surviving claim as persona models', async () => {
    clearLlmEnv();
    store = new Store();
    server = await startServer({ port: 0, store, webDistDir: '' });
    const base = server.url;

    const empty = await api(base, 'POST', '/api/subjects', { displayName: '空对象' });
    const emptyId = empty.body.id as string;

    const response = await api(base, 'GET', '/v1/models');
    expect(response.status).toBe(200);
    expect(response.body.object).toBe('list');
    const ids = (response.body.data as Array<Record<string, unknown>>).map((model) => model.id);
    expect(ids).toContain(`persona/${DEMO_SUBJECT_ID}`);
    expect(ids).not.toContain(`persona/${emptyId}`);
  });

  it('prepends the persona system prompt and keeps a client system message after it', async () => {
    clearLlmEnv();
    upstream = await startUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          choices: [
            { index: 0, message: { role: 'assistant', content: '你好。' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
        }),
      );
    });
    store = new Store();
    server = await startServer({
      port: 0,
      store,
      chat: new OpenAICompatClient({
        baseUrl: upstream.url,
        apiKey: 'test-key',
        model: 'upstream-model',
      }),
      webDistDir: '',
    });
    const base = server.url;

    const response = await api(base, 'POST', '/v1/chat/completions', {
      model: `persona/${DEMO_SUBJECT_ID}`,
      messages: [
        { role: 'user', content: '你好' },
        { role: 'system', content: 'CLIENT-SYSTEM' },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.usage).toEqual({
      prompt_tokens: 11,
      completion_tokens: 3,
      total_tokens: 14,
    });

    expect(upstream.requests).toHaveLength(1);
    const forwarded = upstream.requests[0]?.body as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content?: unknown }>;
    };
    expect(forwarded.model).toBe('upstream-model');
    expect(forwarded.messages[0]?.role).toBe('system');
    expect(String(forwarded.messages[0]?.content)).toContain('这是人格模拟,不是本人。');
    const clientSystemIndex = forwarded.messages.findIndex(
      (message) => message.content === 'CLIENT-SYSTEM',
    );
    expect(clientSystemIndex).toBeGreaterThan(0);
    expect(clientSystemIndex).toBe(2);
  });

  it('pipes an upstream SSE stream through byte for byte', async () => {
    clearLlmEnv();
    const payload =
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
      'data: [DONE]\n\n';
    upstream = await startUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      // Deliberately split across writes: passthrough must not re-chunk.
      response.write(payload.slice(0, 17));
      response.write(payload.slice(17, 40));
      response.end(payload.slice(40));
    });
    store = new Store();
    server = await startServer({
      port: 0,
      store,
      chat: new OpenAICompatClient({
        baseUrl: upstream.url,
        apiKey: 'test-key',
        model: 'upstream-model',
      }),
      webDistDir: '',
    });
    const base = server.url;

    const raw = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: `persona/${DEMO_SUBJECT_ID}`,
        messages: [{ role: 'user', content: '讲一句' }],
        stream: true,
      }),
    });
    const bytes = Buffer.from(await raw.arrayBuffer());

    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-type')).toContain('text/event-stream');
    expect(bytes.equals(Buffer.from(payload, 'utf8'))).toBe(true);
    expect((upstream.requests[0]?.body as { stream?: boolean }).stream).toBe(true);
  });

  it('answers 404 model_not_found for anything that is not persona/<id>', async () => {
    clearLlmEnv();
    store = new Store();
    server = await startServer({ port: 0, store, webDistDir: '' });
    const base = server.url;

    const wrongPrefix = await api(base, 'POST', '/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(wrongPrefix.status).toBe(404);
    expect(asObject(wrongPrefix.body.error)).toMatchObject({ code: 'model_not_found' });

    const unknownPersona = await api(base, 'POST', '/v1/chat/completions', {
      model: 'persona/ghost',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(unknownPersona.status).toBe(404);
    expect(asObject(unknownPersona.body.error)).toMatchObject({ code: 'model_not_found' });
  });

  it('answers 501 llm_unavailable when no key is configured', async () => {
    clearLlmEnv();
    store = new Store();
    server = await startServer({ port: 0, store, webDistDir: '' });
    const base = server.url;

    const response = await api(base, 'POST', '/v1/chat/completions', {
      model: `persona/${DEMO_SUBJECT_ID}`,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.status).toBe(501);
    expect(asObject(response.body.error)).toMatchObject({ code: 'llm_unavailable' });
  });

  it('turns an upstream failure into an OpenAI-shaped error', async () => {
    clearLlmEnv();
    upstream = await startUpstream((_request, response) => {
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end('upstream exploded');
    });
    store = new Store();
    server = await startServer({
      port: 0,
      store,
      chat: new OpenAICompatClient({
        baseUrl: upstream.url,
        apiKey: 'test-key',
        model: 'upstream-model',
      }),
      webDistDir: '',
    });
    const base = server.url;

    const response = await api(base, 'POST', '/v1/chat/completions', {
      model: `persona/${DEMO_SUBJECT_ID}`,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.status).toBe(502);
    expect(asObject(response.body.error)).toMatchObject({
      code: 'upstream_error',
      type: 'server_error',
    });
  });

  it('strips orphan tool messages and tool_calls fields before forwarding', async () => {
    clearLlmEnv();
    upstream = await startUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'chatcmpl-2',
          object: 'chat.completion',
          choices: [
            { index: 0, message: { role: 'assistant', content: '好的' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
      );
    });
    store = new Store();
    server = await startServer({
      port: 0,
      store,
      chat: new OpenAICompatClient({
        baseUrl: upstream.url,
        apiKey: 'test-key',
        model: 'upstream-model',
      }),
      webDistDir: '',
    });
    const base = server.url;

    const response = await api(base, 'POST', '/v1/chat/completions', {
      model: `persona/${DEMO_SUBJECT_ID}`,
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'foo', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'result' },
        { role: 'tool', tool_call_id: 'orphan_id', content: 'orphan' },
        { role: 'user', content: 'now reply' },
      ],
    });

    expect(response.status).toBe(200);
    const forwarded = upstream.requests[0]?.body as {
      messages: Array<{ role: string; content?: unknown; tool_calls?: unknown }>;
    };
    // System prompt + user("hello") + assistant(no tool_calls) + user("now reply")
    // The tool messages should be stripped, and tool_calls removed from assistant
    const roles = forwarded.messages.map((m) => m.role);
    expect(roles).not.toContain('tool');
    const assistantMsgs = forwarded.messages.filter((m) => m.role === 'assistant');
    for (const msg of assistantMsgs) {
      expect(msg.tool_calls).toBeUndefined();
    }
  });

  it('registers reflux fingerprint for non-streamed persona reply', async () => {
    clearLlmEnv();
    upstream = await startUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'chatcmpl-fp',
          object: 'chat.completion',
          choices: [
            { index: 0, message: { role: 'assistant', content: '这是一段足够长的人格回复测试文本' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    });
    store = new Store();
    server = await startServer({
      port: 0,
      store,
      chat: new OpenAICompatClient({
        baseUrl: upstream.url,
        apiKey: 'test-key',
        model: 'upstream-model',
      }),
      webDistDir: '',
    });
    const base = server.url;

    const before = store.listFingerprints(DEMO_SUBJECT_ID);

    await api(base, 'POST', '/v1/chat/completions', {
      model: `persona/${DEMO_SUBJECT_ID}`,
      messages: [{ role: 'user', content: '你好' }],
    });

    const after = store.listFingerprints(DEMO_SUBJECT_ID);
    // At least one new fingerprint should have been registered
    expect(after.length).toBeGreaterThan(before.length);
    const newFp = after.find((fp) => fp.artifactId.startsWith('persona:'));
    expect(newFp).toBeDefined();
  });
});
