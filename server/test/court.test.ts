import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import { FakeLLM } from '@openmimic/engine-court';
import { startServer, type RunningServer } from '@openmimic/server';
import { DEMO_COURT_SESSION_ID, DEMO_SUBJECT_ID } from '@openmimic/fixtures';

interface ApiResponse {
  status: number;
  text: string;
  body: Record<string, unknown>;
}

const asObject = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
const asArray = (value: unknown): Array<Record<string, unknown>> => value as Array<
  Record<string, unknown>
>;

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

const filing = (text: string, testimonyId: string): string =>
  JSON.stringify({
    episodes: [],
    claims: [{ text, evidenceTestimonyIds: [testimonyId] }],
  });

function seedTrial(store: Store): void {
  store.putSubject({ id: 's1', displayName: '被测者' });
  store.putWitness({ id: 'w1', subjectId: 's1', relation: '同事', consentLevel: 'quotable' });
  store.addTestimony({
    id: 't1',
    witnessId: 'w1',
    subjectId: 's1',
    answers: [{ qid: 'q1', behindText: '他会把压力自己扛下来。' }],
  });
}

describe('court API', () => {
  let store: Store;
  let server: RunningServer | undefined;
  let base: string;

  afterEach(async () => {
    if (server) await server.close();
    store.close();
  });

  it('retires every claim from the previous session on a full retrial', async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    store = new Store();
    seedTrial(store);
    const llm = new FakeLLM([
      filing('他会把压力自己扛下来。', 't1'),
      filing('他遇事更愿意一个人扛。', 't1'),
    ]);
    server = await startServer({ port: 0, store, llm, webDistDir: '' });
    base = server.url;

    const first = await api(base, 'POST', '/api/subjects/s1/court');
    expect(first.status).toBe(200);
    const firstSessionId = asObject(first.body.session).id as string;
    const firstClaims = asArray(first.body.claims);
    expect(firstClaims).toHaveLength(1);
    expect(firstClaims[0]?.status).toBe('surviving');
    const firstClaimId = firstClaims[0]?.id as string;

    const second = await api(base, 'POST', '/api/subjects/s1/court');
    expect(second.status).toBe(200);
    const secondSessionId = asObject(second.body.session).id as string;
    expect(secondSessionId).not.toBe(firstSessionId);
    const secondClaims = asArray(second.body.claims);
    expect(secondClaims).toHaveLength(1);
    expect(secondClaims[0]?.id).not.toBe(firstClaimId);

    const stored = store.listClaimsBySubject('s1');
    expect(stored).toHaveLength(2);
    const oldClaim = stored.find((claim) => claim.id === firstClaimId);
    const newClaim = stored.find((claim) => claim.id === secondClaims[0]?.id);
    expect(oldClaim?.status).toBe('retired');
    expect(newClaim?.status).toBe('surviving');
    expect(oldClaim?.courtSessionId).toBe(firstSessionId);
    expect(newClaim?.courtSessionId).toBe(secondSessionId);

    // The baseline route only offers the surviving session.
    const baseline = await api(base, 'GET', '/api/subjects/s1/claims');
    expect(baseline.status).toBe(200);
    const claims = asArray(baseline.body.claims);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.id).toBe(newClaim?.id);
  });

  it('withholds synthesis_only quotations in a transcript but keeps quotable words', async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    store = new Store();
    store.putSubject({ id: 's1', displayName: '被测者' });
    store.putWitness({ id: 'w-q', subjectId: 's1', relation: '发小', consentLevel: 'quotable' });
    store.putWitness({
      id: 'w-s',
      subjectId: 's1',
      relation: '同事',
      consentLevel: 'synthesis_only',
    });
    const quotable = '他不太爱说话但每次都会到场';
    const secret = '她其实特别害怕一个人待着';
    store.addTestimony({
      id: 't-q',
      witnessId: 'w-q',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: quotable }],
    });
    store.addTestimony({
      id: 't-s',
      witnessId: 'w-s',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: secret }],
    });
    const at = '2026-01-01T00:00:00.000Z';
    store.putCourtSession({
      id: 'sess-1',
      subjectId: 's1',
      startedAt: at,
      finishedAt: at,
      transcript: [
        {
          type: 'challenge',
          claimId: 'c1',
          witnessId: 'w-q',
          text: `质询:${secret},与另一证言冲突。`,
          at,
        },
        {
          type: 'defense',
          claimId: 'c1',
          witnessId: 'w-q',
          text: `他辩解:${quotable}。`,
          at,
        },
      ],
      report: {
        totalClaims: 1,
        surviving: 1,
        qualified: 0,
        rejected: 0,
        challengeCount: 1,
        evidenceCoverage: 1,
      },
    });
    server = await startServer({ port: 0, store, webDistDir: '' });
    base = server.url;

    const response = await api(base, 'GET', '/api/court/sess-1');
    expect(response.status).toBe(200);
    const transcript = asArray(response.body.transcript);
    const challenge = transcript[0]?.text as string;
    const defense = transcript[1]?.text as string;
    expect(challenge).toContain('[withheld]');
    expect(challenge).not.toContain(secret);
    expect(defense).toContain(quotable);
    expect(response.text).not.toContain(secret);
  });

  it('serves the pre-generated demo court without a key and 501s everyone else', async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    store = new Store();
    server = await startServer({ port: 0, store, webDistDir: '' });
    base = server.url;

    const demo = await api(base, 'POST', `/api/subjects/${DEMO_SUBJECT_ID}/court`);
    expect(demo.status).toBe(200);
    expect(asObject(demo.body.session).id).toBe(DEMO_COURT_SESSION_ID);
    expect(asArray(demo.body.claims)).toHaveLength(7);

    const created = await api(base, 'POST', '/api/subjects', { displayName: '普通对象' });
    const subjectId = created.body.id as string;
    const refused = await api(base, 'POST', `/api/subjects/${subjectId}/court`);
    expect(refused.status).toBe(501);
    expect(asObject(refused.body.error)).toMatchObject({ code: 'llm_unavailable' });
  });

  it('lists only surviving and qualified claims, never the retired or raw testimony', async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    store = new Store();
    server = await startServer({ port: 0, store, webDistDir: '' });
    base = server.url;

    const response = await api(base, 'GET', `/api/subjects/${DEMO_SUBJECT_ID}/claims`);
    expect(response.status).toBe(200);
    const claims = asArray(response.body.claims);
    // Only status=surviving reach the baseline; contested and retired are excluded
    expect(claims).toHaveLength(5);
    for (const claim of claims) {
      expect(claim.status).toBe('surviving');
      expect(Array.isArray(claim.evidence)).toBe(true);
      expect((claim.evidence as string[]).length).toBeGreaterThanOrEqual(1);
    }
    // Contested claim about emotional stability does not reach the baseline.
    expect(response.text).not.toContain('林默情绪稳定、很少发火。');
    // Evidence is expressed as ids; the testimony originals are not expanded.
    expect(response.text).not.toContain('behindText');
  });

  it('answers 404 for missing sessions, subjects and claims lists', async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    store = new Store();
    server = await startServer({ port: 0, store, webDistDir: '' });
    base = server.url;

    const session = await api(base, 'GET', '/api/court/nope');
    expect(session.status).toBe(404);
    expect(asObject(session.body.error)).toMatchObject({ code: 'session_not_found' });

    const court = await api(base, 'POST', '/api/subjects/nope/court');
    expect(court.status).toBe(404);
    expect(asObject(court.body.error)).toMatchObject({ code: 'subject_not_found' });

    const claims = await api(base, 'GET', '/api/subjects/nope/claims');
    expect(claims.status).toBe(404);
    expect(asObject(claims.body.error)).toMatchObject({ code: 'subject_not_found' });
  });
});
