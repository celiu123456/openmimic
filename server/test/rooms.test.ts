import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import { FakeLLM } from '@openmimic/engine-room';
import { startServer, type RunningServer } from '@openmimic/server';
import {
  DEMO_ROOM_ID,
  DEMO_SUBJECT_ID,
  DEMO_WITNESSES,
  seedDemo,
} from '@openmimic/fixtures';

interface ApiResponse {
  status: number;
  text: string;
  body: Record<string, unknown>;
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
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: text === '' ? {} : (JSON.parse(text) as unknown as Record<string, unknown>),
  };
}

const line = (text: string): string => JSON.stringify({ text });

describe('demo seed and room API (no LLM key)', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;

  beforeEach(async () => {
    // Force the key-less path regardless of the ambient environment.
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    store = new Store();
    server = await startServer({ port: 0, store, webDistDir: '' });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('auto-seeds the demo exactly once and ships the full corpus', () => {
    expect(store.getSubject(DEMO_SUBJECT_ID)?.displayName).toBe('林默');
    expect(store.listWitnessesBySubject(DEMO_SUBJECT_ID)).toHaveLength(6);
    expect(store.listBySubject(DEMO_SUBJECT_ID)).toHaveLength(6);

    const answerCount = store
      .listBySubject(DEMO_SUBJECT_ID)
      .reduce((total, testimony) => total + testimony.answers.length, 0);
    expect(answerCount).toBe(60);

    for (const witness of store.listWitnessesBySubject(DEMO_SUBJECT_ID)) {
      expect(witness.consentLevel).toBe('quotable');
    }

    // At least two witnesses explicitly skip the "to their face" column, and
    // at least one of them skips all ten (so the door stage has stage-only
    // evidence to show).
    const withSkippedFront = DEMO_WITNESSES.filter((witness) =>
      witness.answers.some((answer) => answer.frontText === undefined),
    );
    expect(withSkippedFront.length).toBeGreaterThanOrEqual(2);
    const skippingAll = DEMO_WITNESSES.filter((witness) =>
      witness.answers.every((answer) => answer.frontText === undefined),
    );
    expect(skippingAll.length).toBeGreaterThanOrEqual(1);
    const partial = DEMO_WITNESSES.filter(
      (witness) =>
        witness.answers.some((answer) => answer.frontText === undefined) &&
        witness.answers.some((answer) => answer.frontText !== undefined),
    );
    expect(partial.length).toBeGreaterThanOrEqual(1);

    // Idempotent: a second seed writes nothing.
    expect(seedDemo(store)).toBe(false);
    expect(store.listBySubject(DEMO_SUBJECT_ID)).toHaveLength(6);

    // The pre-generated court is stored and its report adds up.
    const session = store.listCourtSessionsBySubject(DEMO_SUBJECT_ID)[0];
    expect(session?.report).toMatchObject({
      totalClaims: 7,
      surviving: 3,
      qualified: 2,
      contested: 2,
      challengeCount: 6,
      evidenceCoverage: 1,
    });
    const claims = store.listClaimsBySubject(DEMO_SUBJECT_ID);
    expect(claims).toHaveLength(7);
    for (const claim of claims) {
      for (const evidence of claim.evidence) {
        expect(store.getTestimony(evidence)).toBeDefined();
      }
    }
  });

  it('serves the pre-generated double transcript for the demo subject', async () => {
    const created = await api(base, 'POST', `/api/subjects/${DEMO_SUBJECT_ID}/rooms`, {});
    expect(created.status).toBe(201);
    expect(created.body.id).toBe(DEMO_ROOM_ID);
    expect(created.body.status).toBe('door_opened');
    expect(created.body.behindTranscript).toHaveLength(12);
    expect(created.body.frontTranscript).toHaveLength(10);

    const fetched = await api(base, 'GET', `/api/rooms/${DEMO_ROOM_ID}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.behindTranscript).toHaveLength(12);

    const listed = await api(base, 'GET', `/api/subjects/${DEMO_SUBJECT_ID}/rooms`);
    expect(listed.status).toBe(200);
    const rooms = listed.body.rooms as unknown[];
    expect(rooms).toHaveLength(1);

    const opened = await api(base, 'POST', `/api/rooms/${DEMO_ROOM_ID}/door`);
    expect(opened.status).toBe(200);
    expect(opened.body.frontTranscript).toHaveLength(10);
    // The door stage is part of the demo's honest contrast: the netizen, who
    // never wrote a front answer, only ever gets stage directions.
    const netizenLines = (opened.body.frontTranscript as Array<Record<string, unknown>>).filter(
      (entry) => entry.witnessId === 'w-netizen',
    );
    expect(netizenLines.length).toBeGreaterThan(0);
    for (const entry of netizenLines) expect(entry.kind).toBe('stage');
  });

  it('answers 501 for non-demo subjects while key-less', async () => {
    const created = await api(base, 'POST', '/api/subjects', { displayName: '普通对象' });
    const subjectId = created.body.id as string;

    const rooms = await api(base, 'POST', `/api/subjects/${subjectId}/rooms`, {});
    expect(rooms.status).toBe(501);
    expect(asObject(rooms.body.error)).toMatchObject({ code: 'llm_unavailable' });

    store.putRoom({
      id: 'r-plain',
      subjectId,
      topicSeed: '最近怎么看 TA',
      status: 'behind_only',
      behindTranscript: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const door = await api(base, 'POST', '/api/rooms/r-plain/door');
    expect(door.status).toBe(501);
    expect(asObject(door.body.error)).toMatchObject({ code: 'llm_unavailable' });
  });

  it('refuses a crisis topic with 422', async () => {
    const refused = await api(base, 'POST', `/api/subjects/${DEMO_SUBJECT_ID}/rooms`, {
      topicSeed: '他是不是想不开、想自杀',
    });
    expect(refused.status).toBe(422);
    expect(asObject(refused.body.error)).toMatchObject({ code: 'room_refused' });
  });

  it('returns 404 for unknown rooms and unknown subjects', async () => {
    const missingRoom = await api(base, 'GET', '/api/rooms/nope');
    expect(missingRoom.status).toBe(404);
    expect(asObject(missingRoom.body.error)).toMatchObject({ code: 'room_not_found' });

    const missingSubject = await api(base, 'GET', '/api/subjects/nope/rooms');
    expect(missingSubject.status).toBe(404);
    expect(asObject(missingSubject.body.error)).toMatchObject({ code: 'subject_not_found' });
  });
});

describe('room API with an injected LLM', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;

  beforeEach(async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    store = new Store();
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('runs behind and door through the injected FakeLLM, and door is idempotent', async () => {
    const llm = new FakeLLM([line('背后第一句'), line('背后第二句'), line('当面第一句'), line('当面第二句')]);
    server = await startServer({ port: 0, store, llm, webDistDir: '' });
    base = server.url;

    const created = await api(base, 'POST', '/api/subjects', { displayName: '被测者' });
    const subjectId = created.body.id as string;
    store.putWitness({ id: 'w-1', subjectId, relation: '发小', consentLevel: 'quotable' });
    store.addTestimony({
      id: 't-1',
      witnessId: 'w-1',
      subjectId,
      answers: [{ qid: 'q1', behindText: '背后的记忆', frontText: '当面的说法' }],
    });

    const rooms = await api(base, 'POST', `/api/subjects/${subjectId}/rooms`, {});
    expect(rooms.status).toBe(201);
    expect(rooms.body.behindTranscript).toHaveLength(2);
    expect(rooms.body.topicSeed).toBe('最近怎么看 TA');

    const roomId = rooms.body.id as string;
    const opened = await api(base, 'POST', `/api/rooms/${roomId}/door`);
    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('door_opened');
    expect(opened.body.frontTranscript).toHaveLength(2);

    const callsAfterOpen = llm.calls.length;
    const again = await api(base, 'POST', `/api/rooms/${roomId}/door`);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(opened.body);
    expect(llm.calls.length).toBe(callsAfterOpen);
  });

  it('skips the demo seed when told to', async () => {
    server = await startServer({ port: 0, store, skipDemo: true, webDistDir: '' });
    base = server.url;

    expect(store.listSubjects()).toEqual([]);
    const demo = await api(base, 'GET', `/api/rooms/${DEMO_ROOM_ID}`);
    expect(demo.status).toBe(404);
  });
});
