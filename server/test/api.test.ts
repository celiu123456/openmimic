import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import { createInvite } from '@openmimic/engine-witness';
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

const createSubject = async (
  base: string,
  displayName: string,
  selfReport?: string,
): Promise<string> => {
  const response = await api(base, 'POST', '/api/subjects', {
    displayName,
    ...(selfReport !== undefined ? { selfReport } : {}),
  });
  expect(response.status).toBe(201);
  return response.body.id as string;
};

const createInviteViaApi = async (base: string, subjectId: string): Promise<string> => {
  const response = await api(base, 'POST', `/api/subjects/${subjectId}/invites`);
  expect(response.status).toBe(201);
  return response.body.token as string;
};

describe('collection API', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;

  beforeEach(async () => {
    store = new Store();
    server = await startServer({ port: 0, store });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('runs the invite flow end to end: subject, invite, two friends, progress', async () => {
    const subjectId = await createSubject(base, '林小满');
    const token = await createInviteViaApi(base, subjectId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const inviteResponse = await api(base, 'GET', `/api/invites/${token}`);
    expect(inviteResponse.status).toBe(200);
    expect(inviteResponse.body.subjectDisplayName).toBe('林小满');
    const questionnaire = asObject(inviteResponse.body.questionnaire);
    expect(questionnaire.id).toBe('friend-v1');
    expect(questionnaire.questions).toHaveLength(10);

    const first = await api(base, 'POST', `/api/invites/${token}/testimony`, {
      relation: '大学同学',
      consentLevel: 'quotable',
      answers: [{ qid: 'q1', behindText: '上次聚餐她提前把单买了，谁都没发现。' }],
    });
    expect(first.status).toBe(201);
    expect(first.body.count).toBe(1);

    const second = await api(base, 'POST', `/api/invites/${token}/testimony`, {
      relation: '发小',
      stance: '偏正面',
      consentLevel: 'quotable',
      answers: [
        { qid: 'q1', behindText: '她嘴上说不饿，然后把我的那份也吃了。' },
        { qid: 'q2', behindText: '她生气就不说话，但第二天自己会好。' },
      ],
    });
    expect(second.status).toBe(201);
    expect(second.body.count).toBe(2);

    const progress = await api(base, 'GET', `/api/subjects/${subjectId}/progress`);
    expect(progress.status).toBe(200);
    expect(progress.body).toEqual({ testimonyCount: 2, witnessCount: 2 });

    const ledger = store.listBySubject(subjectId);
    expect(ledger).toHaveLength(2);
    expect(ledger.map((entry) => entry.witnessId).sort()).toEqual(
      [first.body.witnessId, second.body.witnessId].sort(),
    );
    expect(store.getTestimony(first.body.testimonyId as string)?.witnessId).toBe(
      first.body.witnessId,
    );
    expect(store.getTestimony(second.body.testimonyId as string)?.witnessId).toBe(
      second.body.witnessId,
    );
  });

  it('answers 410 for an expired or unknown token and writes nothing', async () => {
    const subjectId = await createSubject(base, '林小满');

    const expired = createInvite(store, subjectId, { ttlMs: -1000 });
    const expiryProbe = await api(base, 'GET', `/api/invites/${expired.token}`);
    expect(expiryProbe.status).toBe(410);
    expect(asObject(expiryProbe.body.error)).toMatchObject({ code: 'invite_invalid' });

    const submitToExpired = await api(
      base,
      'POST',
      `/api/invites/${expired.token}/testimony`,
      {
        relation: '同事',
        consentLevel: 'quotable',
        answers: [{ qid: 'q1', behindText: 'words' }],
      },
    );
    expect(submitToExpired.status).toBe(410);

    const unknown = await api(base, 'GET', '/api/invites/never-existed');
    expect(unknown.status).toBe(410);

    expect(store.listBySubject(subjectId)).toEqual([]);
  });

  it('answers 400 on invalid bodies and leaves the ledger untouched', async () => {
    const subjectId = await createSubject(base, '林小满');
    const token = await createInviteViaApi(base, subjectId);
    const endpoint = `/api/invites/${token}/testimony`;

    const missingBehindText = await api(base, 'POST', endpoint, {
      relation: '同事',
      consentLevel: 'quotable',
      answers: [{ qid: 'q1' }],
    });
    expect(missingBehindText.status).toBe(400);
    expect(asObject(missingBehindText.body.error)).toMatchObject({
      code: 'validation_error',
    });

    const badConsent = await api(base, 'POST', endpoint, {
      relation: '同事',
      consentLevel: 'public',
      answers: [{ qid: 'q1', behindText: 'words' }],
    });
    expect(badConsent.status).toBe(400);
    expect(asObject(badConsent.body.error)).toMatchObject({ code: 'validation_error' });

    expect(store.listBySubject(subjectId)).toEqual([]);
    expect(store.listWitnessesBySubject(subjectId)).toEqual([]);
  });

  it('never leaks synthesis_only words or selfReport through any GET route', async () => {
    const selfReport = 'SELFREPORT-只在本人主页出现的描述';
    const behindText = 'LEAK-BEHIND-她说她其实很怕黑';
    const freeText = 'LEAK-FREE-这段只该留在账本里';

    const subjectId = await createSubject(base, '林小满', selfReport);
    const token = await createInviteViaApi(base, subjectId);

    const submitted = await api(base, 'POST', `/api/invites/${token}/testimony`, {
      relation: '同事',
      consentLevel: 'synthesis_only',
      answers: [
        { qid: 'q1', behindText, frontText: 'LEAK-FRONT-当面的说法' },
      ],
      freeText,
    });
    expect(submitted.status).toBe(201);

    const getPaths = [
      '/api/health',
      `/api/invites/${token}`,
      `/api/subjects/${subjectId}/progress`,
    ];
    for (const path of getPaths) {
      const response = await api(base, 'GET', path);
      expect(response.status).toBe(200);
      expect(response.text).not.toContain(behindText);
      expect(response.text).not.toContain(freeText);
      expect(response.text).not.toContain(selfReport);
      expect(response.text).not.toContain('LEAK-FRONT');
      expect(response.text).not.toContain('behindText');
    }
  });

  it('reports health and uses one JSON error shape for unknown routes', async () => {
    const health = await api(base, 'GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true });
    expect(typeof health.body.version).toBe('string');

    const missing = await api(base, 'GET', '/api/nope');
    expect(missing.status).toBe(404);
    const error = asObject(missing.body.error);
    expect(typeof error.code).toBe('string');
    expect(typeof error.message).toBe('string');
  });
});
