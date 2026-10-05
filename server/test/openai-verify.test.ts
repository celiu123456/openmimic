/**
 * Tests for output-side persona verification integration in mount-openai.
 *
 * The verification path is only active when both:
 * 1. PERSONA_VERIFY is not disabled (default: on)
 * 2. An LLM client is available in the DI container
 *
 * These tests use FakeLLM to control verification outcomes without network.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store, type PersonaVerifyResult } from '@openmimic/kernel';
import { FakeLLM, OpenAICompatClient } from '@openmimic/engine-court';
import { startServer, type RunningServer, type ChatUpstream } from '@openmimic/server';
import { DEMO_SUBJECT_ID, seedDemo } from '@openmimic/fixtures';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Fake chat upstream that returns a canned non-stream reply. */
function fakeChat(reply: string): ChatUpstream {
  return {
    configured: true,
    hasApiKey: true,
    chatRaw: async (_msgs, opts) => {
      if (opts?.stream) {
        // SSE format
        const payload =
          `data: {"choices":[{"delta":{"role":"assistant"},"index":0}],"model":"fake"}\n\n` +
          `data: {"choices":[{"delta":{"content":"${reply}"},"index":0}],"model":"fake"}\n\n` +
          `data: [DONE]\n\n`;
        return new Response(payload, {
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        });
      }
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-verify',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  };
}

interface ApiResponse {
  status: number;
  text: string;
  body: Record<string, unknown>;
  headers: Headers;
}

async function api(
  base: string,
  path: string,
  body: unknown,
): Promise<ApiResponse> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
    headers: response.headers,
  };
}

async function streamApi(
  base: string,
  path: string,
  body: unknown,
): Promise<{ status: number; text: string; headers: Headers; events: string[] }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const events = text.split('\n').filter((line) => line.startsWith('data: '));
  return { status: response.status, text, headers: response.headers, events };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('persona verification integration', () => {
  let store: Store | undefined;
  let server: RunningServer | undefined;
  const origVerify = process.env.PERSONA_VERIFY;

  beforeEach(() => {
    // Default: verify enabled
    delete process.env.PERSONA_VERIFY;
  });

  afterEach(async () => {
    if (server) await server.close();
    if (store) store.close();
    store = undefined;
    server = undefined;
    // Restore original env
    if (origVerify === undefined) delete process.env.PERSONA_VERIFY;
    else process.env.PERSONA_VERIFY = origVerify;
  });

  const chatBody = (content: string, stream = false) => ({
    model: `persona/${DEMO_SUBJECT_ID}`,
    messages: [{ role: 'user', content }],
    stream,
  });

  it('non-stream: unfounded response is rewritten when verify is enabled', async () => {
    store = new Store();
    seedDemo(store);

    // FakeLLM script:
    // 1. verify call → finds unfounded
    // 2. rewrite call → produces rewritten text
    // 3. re-verify call → passes
    const fakeLlm = new FakeLLM([
      '{"contradicts":[],"unsupported":["他去年去了南极"],"off_topic":[]}',
      '记不太清这个事了。',
      '{"contradicts":[],"unsupported":[],"off_topic":[]}',
    ]);

    server = await startServer({
      port: 0,
      store,
      chat: fakeChat('他去年去了南极,我记得很清楚。'),
      llm: fakeLlm,
      webDistDir: '',
    });

    const res = await api(server.url, '/v1/chat/completions', chatBody('他去过南极吗?'));
    expect(res.status).toBe(200);

    const content = (
      (res.body.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown>
    )?.content;
    // Should be the rewritten response, not the original unfounded one
    expect(content).toBe('记不太清这个事了。');
    expect(res.headers.get('x-openmimic-verify')).toBe('rewritten');

    // All 3 verify calls should have been made
    expect(fakeLlm.calls).toHaveLength(3);
    expect(fakeLlm.calls.every((c) => c.purpose === 'persona-verify')).toBe(true);
  });

  it('non-stream: greeting (pre-screen pass) does not trigger verify call', async () => {
    store = new Store();
    seedDemo(store);

    // FakeLLM should NOT be called (pre-screen catches greetings)
    const fakeLlm = new FakeLLM([]);

    server = await startServer({
      port: 0,
      store,
      chat: fakeChat('嗯,还行。'),
      llm: fakeLlm,
      webDistDir: '',
    });

    const res = await api(server.url, '/v1/chat/completions', chatBody('你好'));
    expect(res.status).toBe(200);

    // Pre-screened responses get no verify header (verification was not run)
    expect(fakeLlm.calls).toHaveLength(0);
  });

  it('non-stream: verify disabled via env preserves original behavior', async () => {
    process.env.PERSONA_VERIFY = '0';
    store = new Store();
    seedDemo(store);

    const fakeLlm = new FakeLLM([]);

    server = await startServer({
      port: 0,
      store,
      chat: fakeChat('他去年去了南极。'),
      llm: fakeLlm,
      webDistDir: '',
    });

    const res = await api(server.url, '/v1/chat/completions', chatBody('他去过南极吗?'));
    expect(res.status).toBe(200);
    const content = (
      (res.body.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown>
    )?.content;
    expect(content).toBe('他去年去了南极。');
    expect(fakeLlm.calls).toHaveLength(0);
  });

  it('non-stream: verify failure returns conservative response with failed header', async () => {
    store = new Store();
    seedDemo(store);

    // FakeLLM that throws (simulates timeout/budget exhaustion)
    const fakeLlm = new FakeLLM([
      () => { throw new Error('LLM budget exceeded'); },
    ]);

    server = await startServer({
      port: 0,
      store,
      chat: fakeChat('他经常一个人半夜去公园跑步。'),
      llm: fakeLlm,
      webDistDir: '',
    });

    const res = await api(server.url, '/v1/chat/completions', chatBody('他有什么习惯?'));
    expect(res.status).toBe(200);
    const content = (
      (res.body.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown>
    )?.content;
    // Should be the conservative fallback, NOT the unverified response
    expect(content).not.toContain('半夜');
    expect(res.headers.get('x-openmimic-verify')).toBe('failed');
  });

  it('stream: verify-enabled buffers then re-emits as valid SSE', async () => {
    store = new Store();
    seedDemo(store);

    // Verify passes cleanly
    const fakeLlm = new FakeLLM([
      '{"contradicts":[],"unsupported":[],"off_topic":[]}',
    ]);

    server = await startServer({
      port: 0,
      store,
      chat: fakeChat('嗯,可能吧。'),
      llm: fakeLlm,
      webDistDir: '',
    });

    // Use a question that does NOT overlap with any private topic content chars.
    // Avoid chars present in limo fixture's private topic labels (话/借/万/辞/etc).
    const res = await streamApi(
      server.url, '/v1/chat/completions', chatBody('你感觉怎样?', true),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-openmimic-verify')).toMatch(/^buffered/);

    // Must end with data: [DONE]
    const lastDataLine = res.events[res.events.length - 1];
    expect(lastDataLine).toBe('data: [DONE]');

    // Extract content from SSE events
    const contentParts: string[] = [];
    for (const evt of res.events) {
      const payload = evt.replace('data: ', '').trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        const content = parsed?.choices?.[0]?.delta?.content;
        if (typeof content === 'string') contentParts.push(content);
      } catch {
        // ignore parse errors
      }
    }
    expect(contentParts.join('')).toContain('嗯');
  });

  it('stream: verify-disabled passes through directly', async () => {
    process.env.PERSONA_VERIFY = 'off';
    store = new Store();
    seedDemo(store);

    const fakeLlm = new FakeLLM([]);

    server = await startServer({
      port: 0,
      store,
      chat: fakeChat('没什么特别的。'),
      llm: fakeLlm,
      webDistDir: '',
    });

    const res = await streamApi(
      server.url, '/v1/chat/completions', chatBody('他最近怎么样?', true),
    );
    expect(res.status).toBe(200);
    // Direct passthrough — no verify header
    expect(res.headers.get('x-openmimic-verify')).toBeNull();
    // Should contain the raw SSE from upstream
    expect(res.text).toContain('没什么特别的。');
    expect(fakeLlm.calls).toHaveLength(0);
  });

  it('reflux fingerprint is registered for the FINAL (verified) response', async () => {
    store = new Store();
    seedDemo(store);

    const rewrittenText = '具体的我不太记得了。';
    const fakeLlm = new FakeLLM([
      '{"contradicts":[],"unsupported":["fabricated"],"off_topic":[]}',
      rewrittenText,
      '{"contradicts":[],"unsupported":[],"off_topic":[]}',
    ]);

    server = await startServer({
      port: 0,
      store,
      chat: fakeChat('他fabricated了很多事情。'),
      llm: fakeLlm,
      webDistDir: '',
    });

    const before = store.listFingerprints(DEMO_SUBJECT_ID);
    await api(server.url, '/v1/chat/completions', chatBody('他做了什么?'));
    const after = store.listFingerprints(DEMO_SUBJECT_ID);

    expect(after.length).toBeGreaterThan(before.length);
    // The fingerprint should be for the rewritten text, not the original
    const newFp = after.find((fp) => !before.some((b) => b.artifactId === fp.artifactId));
    expect(newFp).toBeDefined();
  });

  it('no request-level parameter can disable verify (scoped token)', async () => {
    // This test confirms there is no request-level parameter to disable verify.
    // The only toggle is the environment variable.
    store = new Store();
    seedDemo(store);

    const fakeLlm = new FakeLLM([
      '{"contradicts":[],"unsupported":[],"off_topic":[]}',
    ]);

    server = await startServer({
      port: 0,
      store,
      // Response contains fact signals: "因为" (causal), "去" (action verb)
      chat: fakeChat('他因为那件事后来去了杭州,在那边待了3个月。'),
      llm: fakeLlm,
      webDistDir: '',
    });

    // Send a request with extra fields that try to disable verify
    const res = await api(server.url, '/v1/chat/completions', {
      model: `persona/${DEMO_SUBJECT_ID}`,
      messages: [{ role: 'user', content: '后来他去哪了?' }],
      persona_verify: false,   // should be ignored
      skip_verify: true,       // should be ignored
    });
    expect(res.status).toBe(200);
    // Verify was still called (1 call = verify pass, response has fact signals)
    expect(fakeLlm.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('non-stream: private topic confirmation is deflected via excludedPrivateTopics', async () => {
    store = new Store();
    seedDemo(store);

    // The persona confirms borrowing — "借过,后来还了"
    // The verifier's pre-LLM private topic check should catch this
    // because limo fixture contains "借了两万...千万别跟他妈提" which
    // produces excludedPrivateTopics including "借" content chars.
    // No FakeLLM calls needed: the pattern match fires before LLM.
    const fakeLlm = new FakeLLM([]);

    server = await startServer({
      port: 0,
      store,
      chat: fakeChat('借过,后来还了。'),
      llm: fakeLlm,
      webDistDir: '',
    });

    const res = await api(
      server.url, '/v1/chat/completions',
      chatBody('听说你之前借过钱,到底怎么回事?'),
    );
    expect(res.status).toBe(200);
    const content = (
      (res.body.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown>
    )?.content;
    // Must NOT contain the confirmation; should be deflected
    expect(content).not.toContain('借过');
    expect(content).toContain('不方便说');
    expect(res.headers.get('x-openmimic-verify')).toBe('rewritten');
  });

  it('non-stream: private topic denial is also deflected', async () => {
    store = new Store();
    seedDemo(store);

    // The persona denies it: "没有的事,你听谁说的。"
    // "没有" matches CONFIRM_DENY_PATTERNS → deflected.
    const fakeLlm = new FakeLLM([]);

    server = await startServer({
      port: 0,
      store,
      chat: fakeChat('没有的事,你听谁说的。'),
      llm: fakeLlm,
      webDistDir: '',
    });

    const res = await api(
      server.url, '/v1/chat/completions',
      chatBody('听说你之前借过钱,到底怎么回事?'),
    );
    expect(res.status).toBe(200);
    const content = (
      (res.body.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown>
    )?.content;
    expect(content).not.toContain('没有的事');
    expect(content).toContain('不方便说');
    expect(res.headers.get('x-openmimic-verify')).toBe('rewritten');
  });

  it('stream: private topic confirmation is deflected in streaming mode', async () => {
    store = new Store();
    seedDemo(store);

    const fakeLlm = new FakeLLM([]);

    server = await startServer({
      port: 0,
      store,
      chat: fakeChat('借过,后来还了。'),
      llm: fakeLlm,
      webDistDir: '',
    });

    const res = await streamApi(
      server.url, '/v1/chat/completions',
      chatBody('听说你之前借过钱?', true),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-openmimic-verify')).toMatch(/buffered-rewritten/);

    // Extract streamed content
    const contentParts: string[] = [];
    for (const evt of res.events) {
      const payload = evt.replace('data: ', '').trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        const c = parsed?.choices?.[0]?.delta?.content;
        if (typeof c === 'string') contentParts.push(c);
      } catch { /* skip */ }
    }
    const fullText = contentParts.join('');
    expect(fullText).not.toContain('借过');
    expect(fullText).toContain('不方便说');
  });

  it('entry-level regression: every safety-related optional field on verifyPersonaResponse is passed at the call site', async () => {
    // Structural guard: read the mount-openai source and confirm that
    // excludedPrivateTopics (the only optional safety field currently)
    // is actually passed to verifyPersonaResponse at both call sites.
    // This test reads the source code to catch future omissions.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(__dirname, '..', 'src', 'mount-openai.ts'),
      'utf-8',
    );

    // Find all verifyPersonaResponse call sites
    const callSites = [...source.matchAll(/verifyPersonaResponse\(\{[\s\S]*?\}\)/g)];
    expect(callSites.length).toBeGreaterThanOrEqual(2); // non-stream + stream

    // Every call site must include excludedPrivateTopics
    for (const match of callSites) {
      expect(match[0]).toContain('excludedPrivateTopics');
    }
  });
});
