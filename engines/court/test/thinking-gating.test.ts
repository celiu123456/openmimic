/**
 * Tests for the thinking/reasoning gating in OpenAICompatClient.
 *
 * Uses a fake fetch to inspect the request body — zero network.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenAICompatClient } from '@openmimic/engine-court';

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
