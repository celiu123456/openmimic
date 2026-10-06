/**
 * Tests for the thinking/reasoning gating and transport retry in OpenAICompatClient.
 *
 * Uses a fake fetch to inspect the request body — zero network.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenAICompatClient, LLMTransportError } from '@openmimic/engine-court';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Build a fake fetch that captures the request body and returns a
 * canned 200 response with a valid chat completion.
 */
function capturingFetch(captured: CapturedRequest[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
    captured.push({ url, body });
    return new Response(
      JSON.stringify({
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('thinking field gating', () => {
  it('sends thinking field when baseUrl contains deepseek and env is unset', async () => {
    setEnv('LLM_THINKING_PARAM', undefined);
    const captured: CapturedRequest[] = [];
    const client = new OpenAICompatClient({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-flash',
      fetchImpl: capturingFetch(captured),
    });

    await client.complete({ system: 'sys', user: 'usr' });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.body.thinking).toEqual({ type: 'disabled' });
  });

  it('sends thinking field when per-call thinking=disabled on deepseek', async () => {
    setEnv('LLM_THINKING_PARAM', undefined);
    const captured: CapturedRequest[] = [];
    const client = new OpenAICompatClient({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-flash',
      fetchImpl: capturingFetch(captured),
      disableThinking: false, // constructor says no
    });

    await client.complete({ system: 'sys', user: 'usr', thinking: 'disabled' });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.body.thinking).toEqual({ type: 'disabled' });
  });

  it('does NOT send thinking field when LLM_THINKING_PARAM=off', async () => {
    setEnv('LLM_THINKING_PARAM', 'off');
    const captured: CapturedRequest[] = [];
    const client = new OpenAICompatClient({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-flash',
      fetchImpl: capturingFetch(captured),
    });

    await client.complete({ system: 'sys', user: 'usr', thinking: 'disabled' });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.body.thinking).toBeUndefined();
  });

  it('sends thinking field when LLM_THINKING_PARAM=on even on non-deepseek URL', async () => {
    setEnv('LLM_THINKING_PARAM', 'on');
    const captured: CapturedRequest[] = [];
    const client = new OpenAICompatClient({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      fetchImpl: capturingFetch(captured),
      disableThinking: false,
    });

    await client.complete({ system: 'sys', user: 'usr', thinking: 'disabled' });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.body.thinking).toEqual({ type: 'disabled' });
  });

  it('does NOT send thinking field on non-deepseek URL when env is unset', async () => {
    setEnv('LLM_THINKING_PARAM', undefined);
    const captured: CapturedRequest[] = [];
    const client = new OpenAICompatClient({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      fetchImpl: capturingFetch(captured),
      disableThinking: false,
    });

    await client.complete({ system: 'sys', user: 'usr', thinking: 'disabled' });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.body.thinking).toBeUndefined();
  });

  it('surfaces finish_reason on lastFinishReason', async () => {
    setEnv('LLM_THINKING_PARAM', 'off');
    const captured: CapturedRequest[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
      captured.push({ url, body });
      return new Response(
        JSON.stringify({
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'hello' },
            finish_reason: 'length',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const client = new OpenAICompatClient({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      fetchImpl: fakeFetch,
      disableThinking: false,
    });

    const result = await client.complete({ system: 'sys', user: 'usr' });
    expect(result).toBe('hello');
    expect(client.lastFinishReason).toBe('length');
  });

  it('passes maxTokens to the wire body', async () => {
    setEnv('LLM_THINKING_PARAM', 'off');
    const captured: CapturedRequest[] = [];
    const client = new OpenAICompatClient({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      fetchImpl: capturingFetch(captured),
      disableThinking: false,
    });

    await client.complete({ system: 'sys', user: 'usr', maxTokens: 260 });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.body.max_tokens).toBe(260);
  });
});

/* ------------------------------------------------------------------ */
/* Transport retry tests                                               */
/* ------------------------------------------------------------------ */

const OK_RESPONSE = JSON.stringify({
  choices: [{
    index: 0,
    message: { role: 'assistant', content: 'ok' },
    finish_reason: 'stop',
  }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

function makeOkResponse(): Response {
  return new Response(OK_RESPONSE, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('transport retry', () => {
  const sleepCalls: number[] = [];
  const noopSleep = (ms: number): Promise<void> => {
    sleepCalls.push(ms);
    return Promise.resolve();
  };

  beforeEach(() => { sleepCalls.length = 0; });

  function makeClient(fetchImpl: typeof fetch): OpenAICompatClient {
    return new OpenAICompatClient({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      fetchImpl,
      sleep: noopSleep,
      perAttemptTimeoutMs: 8000,
      disableThinking: false,
    });
  }

  it('transport error then success → 1 result, 2 attempts', async () => {
    setEnv('LLM_THINKING_PARAM', 'off');
    let callCount = 0;
    const fakeFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        const err = new TypeError('fetch failed');
        (err as unknown as { cause: { code: string } }).cause = { code: 'ENOTFOUND' };
        throw err;
      }
      return makeOkResponse();
    }) as typeof fetch;

    const client = makeClient(fakeFetch);
    const result = await client.complete({ system: 'sys', user: 'usr' });
    expect(result).toBe('ok');
    expect(callCount).toBe(2);
    expect(sleepCalls).toEqual([300]); // one backoff
  });

  it('3 transport failures → throws LLMTransportError', async () => {
    setEnv('LLM_THINKING_PARAM', 'off');
    let callCount = 0;
    const fakeFetch = (async () => {
      callCount++;
      const err = new TypeError('fetch failed');
      (err as unknown as { cause: { code: string } }).cause = { code: 'ECONNRESET' };
      throw err;
    }) as typeof fetch;

    const client = makeClient(fakeFetch);
    await expect(client.complete({ system: 'sys', user: 'usr' })).rejects.toThrow(
      LLMTransportError,
    );
    expect(callCount).toBe(3); // 1 original + 2 retries
    expect(sleepCalls).toEqual([300, 1200]); // two backoffs
  });

  it('401 is NOT retried', async () => {
    setEnv('LLM_THINKING_PARAM', 'off');
    let callCount = 0;
    const fakeFetch = (async () => {
      callCount++;
      return new Response('Unauthorized', { status: 401 });
    }) as typeof fetch;

    const client = makeClient(fakeFetch);
    await expect(client.complete({ system: 'sys', user: 'usr' })).rejects.toThrow(
      /LLM request failed: 401/,
    );
    expect(callCount).toBe(1); // no retry
    expect(sleepCalls).toEqual([]); // no backoff
  });

  it('429 is NOT retried', async () => {
    setEnv('LLM_THINKING_PARAM', 'off');
    let callCount = 0;
    const fakeFetch = (async () => {
      callCount++;
      return new Response('Too many requests', { status: 429 });
    }) as typeof fetch;

    const client = makeClient(fakeFetch);
    await expect(client.complete({ system: 'sys', user: 'usr' })).rejects.toThrow(
      /LLM request failed: 429/,
    );
    expect(callCount).toBe(1);
  });

  it('502 is retried', async () => {
    setEnv('LLM_THINKING_PARAM', 'off');
    let callCount = 0;
    const fakeFetch = (async () => {
      callCount++;
      if (callCount <= 2) {
        return new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
      }
      return makeOkResponse();
    }) as typeof fetch;

    const client = makeClient(fakeFetch);
    const result = await client.complete({ system: 'sys', user: 'usr' });
    expect(result).toBe('ok');
    expect(callCount).toBe(3);
  });

  it('backoff uses injected sleep', async () => {
    setEnv('LLM_THINKING_PARAM', 'off');
    let callCount = 0;
    const fakeFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Service Unavailable', { status: 503 });
      }
      return makeOkResponse();
    }) as typeof fetch;

    const client = makeClient(fakeFetch);
    await client.complete({ system: 'sys', user: 'usr' });
    expect(sleepCalls).toEqual([300]);
  });

  it('LLMTransportError includes error code', async () => {
    setEnv('LLM_THINKING_PARAM', 'off');
    const fakeFetch = (async () => {
      const err = new TypeError('fetch failed');
      (err as unknown as { cause: { code: string } }).cause = { code: 'ETIMEDOUT' };
      throw err;
    }) as typeof fetch;

    const client = makeClient(fakeFetch);
    try {
      await client.complete({ system: 'sys', user: 'usr' });
      expect.unreachable('should have thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(LLMTransportError);
      expect((err as LLMTransportError).code).toBe('ETIMEDOUT');
      expect((err as LLMTransportError).name).toBe('LLMTransportError');
    }
  });
});
