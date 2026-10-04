import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import { FakeLLM } from '@openmimic/engine-witness';
import { startServer, type RunningServer } from '@openmimic/server';

interface ApiResponse {
  status: number;
  text: string;
  body: Record<string, unknown>;
}

const asObject = (value: unknown): Record<string, unknown> =>
  value as Record<string, unknown>;

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

describe('interview API without a model', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0,
      store,
      asr: { apiKey: undefined },
      webDistDir: '',
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('runs the whole question tree, including a skip, and never follows up', async () => {
    const { subjectId, token } = await newInvite(base);

    const opened = await api(base, 'POST', `/api/invites/${token}/interview`);
    expect(opened.status).toBe(201);
    expect(opened.body.total).toBe(10);
    const sessionId = opened.body.sessionId as string;
    expect(asObject(opened.body.question)).toMatchObject({ qid: 'q1' });

    // Skip q1, then answer the remaining nine; no key means no follow-up ever.
    const skipped = await api(base, 'POST', `/api/interview/${sessionId}/answer`, {
      skip: true,
    });
    expect(skipped.status).toBe(200);
    expect(skipped.body).toMatchObject({ index: 1 });
    expect(skipped.body.followup).toBeUndefined();

    let last: ApiResponse = skipped;
    for (let index = 1; index < 10; index += 1) {
      last = await api(base, 'POST', `/api/interview/${sessionId}/answer`, {
        text: `第${index + 1}题的回答，很短。`,
      });
      expect(last.status).toBe(200);
      expect(last.body.followup).toBeUndefined();
    }
    expect(last.body).toEqual({ done: true });

    const finished = await api(base, 'POST', `/api/interview/${sessionId}/finish`, {
      relation: '大学同学',
      consentLevel: 'quotable',
    });
    expect(finished.status).toBe(201);
    expect(finished.body.count).toBe(1);

    const testimonyId = finished.body.testimonyId as string;
    const testimony = store.getTestimony(testimonyId);
    expect(testimony?.answers).toHaveLength(9);
    expect(testimony?.avoidedQids).toEqual(['q1']);
    expect(store.getInterviewSession(sessionId)).toBeUndefined();
    expect(store.listBySubject(subjectId)).toHaveLength(1);
  });

  it('answers 410 for unknown sessions and 400 for malformed bodies', async () => {
    const unknown = await api(base, 'POST', '/api/interview/nope/answer', { text: '嗯' });
    expect(unknown.status).toBe(410);
    expect(asObject(unknown.body.error)).toMatchObject({ code: 'session_invalid' });

    const { token } = await newInvite(base);
    const opened = await api(base, 'POST', `/api/invites/${token}/interview`);
    const sessionId = opened.body.sessionId as string;

    const empty = await api(base, 'POST', `/api/interview/${sessionId}/answer`, {});
    expect(empty.status).toBe(400);
    expect(asObject(empty.body.error)).toMatchObject({ code: 'validation_error' });

    const badFinish = await api(base, 'POST', `/api/interview/${sessionId}/finish`, {
      consentLevel: 'public',
    });
    expect(badFinish.status).toBe(400);
  });
});

describe('interview API with a model', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  let llm: FakeLLM;

  beforeEach(async () => {
    store = new Store();
    llm = new FakeLLM(['{"followup":"哪件事让你这么觉得？"}']);
    server = await startServer({
      port: 0,
      store,
      asr: { apiKey: undefined },
      // The witness collector drives any structurally compatible client.
      llm,
      webDistDir: '',
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('returns a follow-up for a bare answer and stores its reply separately', async () => {
    const { token } = await newInvite(base);
    const opened = await api(base, 'POST', `/api/invites/${token}/interview`);
    const sessionId = opened.body.sessionId as string;

    const step = await api(base, 'POST', `/api/interview/${sessionId}/answer`, {
      text: '他人挺好的。',
    });
    expect(step.status).toBe(200);
    expect(step.body).toEqual({ followup: '哪件事让你这么觉得？' });
    expect(llm.calls).toHaveLength(1);

    const after = await api(base, 'POST', `/api/interview/${sessionId}/followup`, {
      text: '上个月他帮我搬了家，什么也没说。',
    });
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ index: 1 });
    expect(llm.calls).toHaveLength(1);

    const finished = await api(base, 'POST', `/api/interview/${sessionId}/finish`, {
      relation: '朋友',
      consentLevel: 'quotable',
    });
    expect(finished.status).toBe(201);
    const testimony = store.getTestimony(finished.body.testimonyId as string);
    expect(testimony?.answers[0]?.behindText).toBe('他人挺好的。');
    expect(testimony?.answers[0]?.followupText).toBe('上个月他帮我搬了家，什么也没说。');
  });
});
