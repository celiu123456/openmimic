import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import { startServer, type RunningServer } from '@openmimic/server';

async function api(
  base: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
  };
}

describe('access control', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  const ADMIN_TOKEN = 'test-admin-secret-42';

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0,
      store,
      skipDemo: true,
      webDistDir: '',
      adminToken: ADMIN_TOKEN,
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('rejects admin routes without token', async () => {
    const res = await api(base, 'POST', '/api/subjects', { displayName: 'Test' });
    expect(res.status).toBe(401);
  });

  it('rejects admin routes with wrong token', async () => {
    const res = await api(base, 'POST', '/api/subjects', { displayName: 'Test' }, {
      authorization: 'Bearer wrong-token',
    });
    expect(res.status).toBe(401);
  });

  it('allows admin routes with correct Bearer token', async () => {
    const res = await api(base, 'POST', '/api/subjects', { displayName: 'Test' }, {
      authorization: `Bearer ${ADMIN_TOKEN}`,
    });
    expect(res.status).toBe(201);
  });

  it('allows admin routes with _token query parameter', async () => {
    const res = await api(base, 'POST', `/api/subjects?_token=${ADMIN_TOKEN}`, { displayName: 'Test2' });
    expect(res.status).toBe(201);
  });

  it('allows health check without token', async () => {
    const res = await api(base, 'GET', '/api/health');
    expect(res.status).toBe(200);
  });

  it('allows invite routes without admin token', async () => {
    // First create a subject with admin token
    const subRes = await api(base, 'POST', '/api/subjects', { displayName: 'Subject' }, {
      authorization: `Bearer ${ADMIN_TOKEN}`,
    });
    const subjectId = subRes.body.id as string;

    // Create invite with admin token
    const invRes = await api(base, 'POST', `/api/subjects/${subjectId}/invites`, undefined, {
      authorization: `Bearer ${ADMIN_TOKEN}`,
    });
    const token = invRes.body.token as string;

    // Resolve invite without admin token (friend path)
    const resolve = await api(base, 'GET', `/api/invites/${token}`);
    expect(resolve.status).toBe(200);

    // Submit testimony without admin token
    const submit = await api(base, 'POST', `/api/invites/${token}/testimony`, {
      relation: 'friend',
      consentLevel: 'quotable',
      answers: [
        { qid: 'q1', behindText: 'Test behind text for this question.' },
      ],
    });
    expect(submit.status).toBe(201);
  });

  it('blocks invite token from accessing admin routes', async () => {
    // Create a subject
    const subRes = await api(base, 'POST', '/api/subjects', { displayName: 'X' }, {
      authorization: `Bearer ${ADMIN_TOKEN}`,
    });
    const subjectId = subRes.body.id as string;

    // Create invite
    const invRes = await api(base, 'POST', `/api/subjects/${subjectId}/invites`, undefined, {
      authorization: `Bearer ${ADMIN_TOKEN}`,
    });
    const inviteToken = invRes.body.token as string;

    // Try to use invite token as admin token
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/progress`, undefined, {
      authorization: `Bearer ${inviteToken}`,
    });
    expect(res.status).toBe(401);
  });

  it('protects OpenAI-compatible endpoint', async () => {
    const res = await api(base, 'GET', '/v1/models');
    expect(res.status).toBe(401);
  });
});

describe('rate limiting', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0,
      store,
      skipDemo: true,
      webDistDir: '',
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('rate-limits testimony submission', async () => {
    // Create subject and invite
    const subRes = await api(base, 'POST', '/api/subjects', { displayName: 'RL Test' });
    const subjectId = subRes.body.id as string;
    const invRes = await api(base, 'POST', `/api/subjects/${subjectId}/invites`);
    const token = invRes.body.token as string;

    // Rapid-fire: the default limit is 30/min; send 35 requests
    const results: number[] = [];
    for (let i = 0; i < 35; i++) {
      const res = await api(base, 'POST', `/api/invites/${token}/testimony`, {
        relation: 'friend',
        consentLevel: 'quotable',
        answers: [{ qid: 'q1', behindText: `Answer ${i}` }],
      });
      results.push(res.status);
    }

    // At least one should be 429
    expect(results).toContain(429);
    // The first few should succeed (201)
    expect(results[0]).toBe(201);
  });
});
