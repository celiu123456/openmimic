/**
 * Server-level tests for the v4 chat API routes.
 *
 * All tests use FakeLLM — zero real network.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import { FakeLLM } from '@openmimic/engine-witness';
import { startServer, type RunningServer } from '@openmimic/server';

interface ApiResponse {
  status: number;
  text: string;
  body: Record<string, unknown>;
}

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
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: text === '' ? {} : (JSON.parse(text) as unknown as Record<string, unknown>),
  };
}

async function newInvite(base: string): Promise<{ subjectId: string; token: string }> {
  const subject = await api(base, 'POST', '/api/subjects', { displayName: '林小满' });
  const subjectId = subject.body.id as string;
  const invite = await api(base, 'POST', `/api/subjects/${subjectId}/invites`);
  return { subjectId, token: invite.body.token as string };
}

describe('v4 chat API routes', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  let llm: FakeLLM;

  beforeEach(async () => {
    store = new Store();
    llm = new FakeLLM([]);
    server = await startServer({
      port: 0,
      store,
      asr: { apiKey: undefined },
      llm,
      webDistDir: '',
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('POST /api/invites/:token/chat starts a chat session', async () => {
    const { token } = await newInvite(base);
    llm.push('你好，我是访谈员，这段对话用来更完整地理解林小满，随时可以停。你们是怎么认识的？');

    const opened = await api(base, 'POST', `/api/invites/${token}/chat`);
    expect(opened.status).toBe(201);
    expect(opened.body.sessionId).toBeTruthy();
    expect((opened.body.message as Record<string, unknown>).text).toBeTruthy();
    expect((opened.body.message as Record<string, unknown>).id).toBeTruthy();
  });

  it('POST /api/chat/:sid/say returns a message', async () => {
    const { token } = await newInvite(base);
    llm.push('你好，我是访谈员。你们是怎么认识的？');
    const opened = await api(base, 'POST', `/api/invites/${token}/chat`);
    const sid = opened.body.sessionId as string;

    llm.push('大学啊。你们经常一起做什么？');
    const step = await api(base, 'POST', `/api/chat/${sid}/say`, {
      text: '大学认识的',
    });
    expect(step.status).toBe(200);
    expect((step.body.message as Record<string, unknown>).text).toBeTruthy();
  });

  it('POST /api/chat/:sid/say returns 503 on generation failure', async () => {
    const { token } = await newInvite(base);
    llm.push('你好，我是访谈员。你们是怎么认识的？');
    const opened = await api(base, 'POST', `/api/invites/${token}/chat`);
    const sid = opened.body.sessionId as string;

    // Both attempts will fail guards (no question mark)
    llm.push('废话没有问号');
    llm.push('还是废话没有问号');

    const step = await api(base, 'POST', `/api/chat/${sid}/say`, {
      text: '他人挺好的',
    });
    expect(step.status).toBe(503);
    expect((step.body.error as Record<string, unknown>).code).toBe(
      'interview_generation_failed',
    );
  });

  it('POST /api/chat/:sid/finish submits testimony', async () => {
    const { token, subjectId } = await newInvite(base);
    llm.push('你好，我是访谈员。你们是怎么认识的？');
    const opened = await api(base, 'POST', `/api/invites/${token}/chat`);
    const sid = opened.body.sessionId as string;

    llm.push('那你觉得他是什么样的人？');
    await api(base, 'POST', `/api/chat/${sid}/say`, { text: '大学认识的' });

    const finished = await api(base, 'POST', `/api/chat/${sid}/finish`, {
      consentLevel: 'quotable',
      relation: '大学同学',
    });
    expect(finished.status).toBe(201);
    expect(finished.body.count).toBe(1);
    expect(store.listBySubject(subjectId)).toHaveLength(1);
  });

  it('GET /api/chat/:sid returns session history', async () => {
    const { token } = await newInvite(base);
    llm.push('你好，我是访谈员。你们是怎么认识的？');
    const opened = await api(base, 'POST', `/api/invites/${token}/chat`);
    const sid = opened.body.sessionId as string;

    const history = await api(base, 'GET', `/api/chat/${sid}`);
    expect(history.status).toBe(200);
    expect(Array.isArray(history.body.turns)).toBe(true);
    expect((history.body.turns as unknown[]).length).toBeGreaterThan(0);
  });

  it('old interview routes still work (deprecated)', async () => {
    const { token } = await newInvite(base);
    const opened = await api(base, 'POST', `/api/invites/${token}/interview`);
    expect(opened.status).toBe(201);
    expect(opened.body.total).toBe(10);
  });
});

describe('chat routes without LLM', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0,
      store,
      asr: { apiKey: undefined },
      // No LLM — chat plugin not loaded
      webDistDir: '',
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('chat routes return 404 when collector:chat is not loaded', async () => {
    const subject = await api(base, 'POST', '/api/subjects', { displayName: '林小满' });
    const subjectId = subject.body.id as string;
    const invite = await api(base, 'POST', `/api/subjects/${subjectId}/invites`);
    const token = invite.body.token as string;

    const opened = await api(base, 'POST', `/api/invites/${token}/chat`);
    expect(opened.status).toBe(404);

    // Old routes still work
    const oldOpened = await api(base, 'POST', `/api/invites/${token}/interview`);
    expect(oldOpened.status).toBe(201);
  });
});
