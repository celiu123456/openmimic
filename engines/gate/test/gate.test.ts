import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { EventBus, PluginHost, Store } from '@openmimic/kernel';
import { Router, type RouteContext } from '@openmimic/server';
import type { Claim, CourtSession } from '@openmimic/shared';
import {
  gatePlugin,
  validateClaimText,
  canReraise,
  createGateState,
  contestClaim,
  uncontestClaim,
  filterSessionClaims,
  checkReraiseAfterCourt,
  GATE_DIAGNOSIS_WORDS,
  type ContestRecord,
  type GateState,
} from '@openmimic/engine-gate';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeCtx(body: unknown, params: Record<string, string> = {}): RouteContext {
  return { params, query: new URLSearchParams(), body };
}

function seedTestData(store: Store): {
  claim1: Claim;
  claim2: Claim;
  claim3: Claim;
} {
  store.putSubject({ id: 's1', displayName: '测试' });
  store.putWitness({
    id: 'w1', subjectId: 's1', relation: '发小',
    consentLevel: 'quotable',
  });
  store.putWitness({
    id: 'w2', subjectId: 's1', relation: '同事',
    consentLevel: 'quotable',
  });
  store.putWitness({
    id: 'w3', subjectId: 's1', relation: '同学',
    consentLevel: 'quotable',
  });
  store.addTestimony({
    id: 't1', witnessId: 'w1', subjectId: 's1',
    answers: [{ qid: 'q1', behindText: '他花钱很大方' }],
  });
  store.addTestimony({
    id: 't2', witnessId: 'w2', subjectId: 's1',
    answers: [{ qid: 'q1', behindText: '他对花钱比较谨慎' }],
  });
  store.addTestimony({
    id: 't3', witnessId: 'w3', subjectId: 's1',
    answers: [{ qid: 'q1', behindText: '他花钱还行' }],
  });

  const claim1 = store.putClaim({
    id: 'c1', subjectId: 's1', text: '花钱大方,请客不犹豫',
    conviction: 0.7, evidence: ['t1'], status: 'surviving',
    courtSessionId: 'cs1',
  });
  const claim2 = store.putClaim({
    id: 'c2', subjectId: 's1', text: '对人真诚',
    conviction: 0.6, evidence: ['t2'], status: 'surviving',
    courtSessionId: 'cs1',
  });
  const claim3 = store.putClaim({
    id: 'c3', subjectId: 's1', text: '他有抑郁症的倾向',
    conviction: 0.5, evidence: ['t1'], status: 'surviving',
    courtSessionId: 'cs1',
  });
  return { claim1, claim2, claim3 };
}

async function setupHost(store: Store) {
  const events = new EventBus();
  const host = new PluginHost(events);
  const router = new Router();
  host.providePreset('store', store);
  host.providePreset('events', events);
  host.providePreset('router', router);
  await host.load(gatePlugin);
  return { host, router, events };
}

/* ------------------------------------------------------------------ */
/* Tests: validateClaimText                                            */
/* ------------------------------------------------------------------ */

describe('validateClaimText', () => {
  it('passes a normal claim', () => {
    const result = validateClaimText('花钱大方,请客不犹豫');
    expect(result.valid).toBe(true);
  });

  it('blocks claim containing diagnosis word', () => {
    const result = validateClaimText('他有抑郁症的倾向');
    expect(result.valid).toBe(false);
    expect(result.blockedWord).toBe('抑郁症');
  });

  it('blocks claim containing crisis word', () => {
    const result = validateClaimText('他有时候想自杀');
    expect(result.valid).toBe(false);
    expect(result.blockedWord).toBe('自杀');
  });

  it('blocks 有病', () => {
    const result = validateClaimText('他脑子有病');
    expect(result.valid).toBe(false);
    expect(result.blockedWord).toBe('有病');
  });

  it('word list has >= 20 entries', () => {
    expect(GATE_DIAGNOSIS_WORDS.length).toBeGreaterThanOrEqual(20);
  });
});

/* ------------------------------------------------------------------ */
/* Tests: contest / uncontest                                          */
/* ------------------------------------------------------------------ */

describe('contestClaim', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  it('sets claim status to contested', () => {
    store = new Store();
    seedTestData(store);
    const gateState = createGateState();

    contestClaim('c1', store, gateState);
    const claim = store.getClaim('c1');
    expect(claim?.status).toBe('contested');
  });

  it('records evidence snapshot', () => {
    store = new Store();
    seedTestData(store);
    const gateState = createGateState();

    const record = contestClaim('c1', store, gateState);
    expect(record).toBeDefined();
    expect(record!.evidenceSnapshot).toEqual(['t1']);
    expect(gateState.contestRecords.get('c1')).toHaveLength(1);
  });

  it('returns undefined for nonexistent claim', () => {
    store = new Store();
    const gateState = createGateState();
    const record = contestClaim('nope', store, gateState);
    expect(record).toBeUndefined();
  });
});

describe('uncontestClaim', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  it('restores claim to surviving', () => {
    store = new Store();
    seedTestData(store);
    const gateState = createGateState();

    contestClaim('c1', store, gateState);
    expect(store.getClaim('c1')?.status).toBe('contested');

    uncontestClaim('c1', store, gateState);
    expect(store.getClaim('c1')?.status).toBe('surviving');
  });

  it('clears contest records', () => {
    store = new Store();
    seedTestData(store);
    const gateState = createGateState();

    contestClaim('c1', store, gateState);
    expect(gateState.contestRecords.has('c1')).toBe(true);

    uncontestClaim('c1', store, gateState);
    expect(gateState.contestRecords.has('c1')).toBe(false);
  });

  it('returns false for non-contested claim', () => {
    store = new Store();
    seedTestData(store);
    const gateState = createGateState();

    const result = uncontestClaim('c1', store, gateState);
    expect(result).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Tests: canReraise                                                   */
/* ------------------------------------------------------------------ */

describe('canReraise', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  it('returns false when contested >= 2 times (sealed)', () => {
    store = new Store();
    seedTestData(store);

    const records: ContestRecord[] = [
      { claimId: 'c1', at: '2026-01-01', evidenceSnapshot: ['t1'] },
      { claimId: 'c1', at: '2026-01-02', evidenceSnapshot: ['t1'] },
    ];
    const claim = store.getClaim('c1')!;
    const result = canReraise(claim, records, [], store);
    expect(result).toBe(false);
  });

  it('returns false when < 2 new distinct witnesses', () => {
    store = new Store();
    seedTestData(store);

    const records: ContestRecord[] = [
      { claimId: 'c1', at: '2026-01-01', evidenceSnapshot: ['t1'] },
    ];
    // claim evidence only has t1 (same witness)
    const claim = store.getClaim('c1')!;
    const result = canReraise(claim, records, [], store);
    expect(result).toBe(false);
  });

  it('returns true when >= 2 new distinct witnesses added', () => {
    store = new Store();
    seedTestData(store);

    // Contest c1 which has evidence ['t1'] (w1)
    const records: ContestRecord[] = [
      { claimId: 'c1', at: '2026-01-01', evidenceSnapshot: ['t1'] },
    ];

    // Now add evidence from w2 and w3
    const claim = store.getClaim('c1')!;
    const updatedClaim = { ...claim, evidence: ['t1', 't2', 't3'] };
    store.putClaim(updatedClaim);

    const result = canReraise(updatedClaim, records, [], store);
    expect(result).toBe(true);
  });

  it('returns false when 1 new witness (need 2)', () => {
    store = new Store();
    seedTestData(store);

    const records: ContestRecord[] = [
      { claimId: 'c1', at: '2026-01-01', evidenceSnapshot: ['t1'] },
    ];

    const claim = store.getClaim('c1')!;
    const updatedClaim = { ...claim, evidence: ['t1', 't2'] };
    store.putClaim(updatedClaim);

    const result = canReraise(updatedClaim, records, [], store);
    expect(result).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Tests: checkReraiseAfterCourt sets reraised field                    */
/* ------------------------------------------------------------------ */

describe('checkReraiseAfterCourt', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  it('sets reraised: true on re-raised claim instead of qualifier hack', () => {
    store = new Store();
    seedTestData(store);
    const gateState = createGateState();

    // Contest c1 which has evidence ['t1'] (w1)
    contestClaim('c1', store, gateState);
    expect(store.getClaim('c1')?.status).toBe('contested');

    // Expand evidence to include w2 and w3 (>= 2 new distinct witnesses)
    const claim = store.getClaim('c1')!;
    store.putClaim({ ...claim, evidence: ['t1', 't2', 't3'] });

    // Run re-raise check
    const session = { id: 'cs1', subjectId: 's1', startedAt: '2026-01-01', transcript: [] } as CourtSession;
    const reraised = checkReraiseAfterCourt(session, store, gateState);

    expect(reraised).toContain('c1');
    const updated = store.getClaim('c1')!;
    expect(updated.status).toBe('surviving');
    expect(updated.reraised).toBe(true);
    // Should NOT have the old qualifier string
    expect(updated.qualifiers ?? []).not.toContain('重新提出:又有人提到类似的事');
  });
});

/* ------------------------------------------------------------------ */
/* Tests: permission wall (filterSessionClaims)                        */
/* ------------------------------------------------------------------ */

describe('filterSessionClaims', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  it('retires claims with diagnosis words', () => {
    store = new Store();
    seedTestData(store);
    const gateState = createGateState();

    const session: CourtSession = {
      id: 'cs1',
      subjectId: 's1',
      startedAt: '2026-01-01',
      transcript: [],
    };

    filterSessionClaims(session, store, gateState);

    // c3 contains '抑郁症' -> should be retired
    const c3 = store.getClaim('c3');
    expect(c3?.status).toBe('retired');

    // c1 and c2 should still be surviving
    expect(store.getClaim('c1')?.status).toBe('surviving');
    expect(store.getClaim('c2')?.status).toBe('surviving');

    // Wall transcript should record the blocked claim
    expect(gateState.wallTranscript).toHaveLength(1);
    expect(gateState.wallTranscript[0]!.claimId).toBe('c3');
  });
});

/* ------------------------------------------------------------------ */
/* Tests: gate plugin routes                                           */
/* ------------------------------------------------------------------ */

describe('gate plugin routes', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  it('POST /api/claims/:id/contest contests a claim', async () => {
    store = new Store();
    seedTestData(store);
    const { router } = await setupHost(store);

    const match = router.match('POST', '/api/claims/c1/contest');
    expect(match).toBeDefined();
    const result = await match!.handler(makeCtx(undefined, { id: 'c1' }));
    expect('status' in result && result.status).toBe(200);

    expect(store.getClaim('c1')?.status).toBe('contested');
  });

  it('POST /api/claims/:id/contest 404 for unknown claim', async () => {
    store = new Store();
    seedTestData(store);
    const { router } = await setupHost(store);

    const match = router.match('POST', '/api/claims/nope/contest');
    const result = await match!.handler(makeCtx(undefined, { id: 'nope' }));
    expect('status' in result && result.status).toBe(404);
  });

  it('POST /api/claims/:id/contest 409 if already contested', async () => {
    store = new Store();
    seedTestData(store);
    const { router } = await setupHost(store);

    const match = router.match('POST', '/api/claims/c1/contest');
    await match!.handler(makeCtx(undefined, { id: 'c1' }));
    const result2 = await match!.handler(makeCtx(undefined, { id: 'c1' }));
    expect('status' in result2 && result2.status).toBe(409);
  });

  it('POST /api/claims/:id/uncontest restores claim', async () => {
    store = new Store();
    seedTestData(store);
    const { router } = await setupHost(store);

    // Contest first
    const contestMatch = router.match('POST', '/api/claims/c1/contest');
    await contestMatch!.handler(makeCtx(undefined, { id: 'c1' }));
    expect(store.getClaim('c1')?.status).toBe('contested');

    // Uncontest
    const uncontestMatch = router.match('POST', '/api/claims/c1/uncontest');
    const result = await uncontestMatch!.handler(makeCtx(undefined, { id: 'c1' }));
    expect('status' in result && result.status).toBe(200);
    expect(store.getClaim('c1')?.status).toBe('surviving');
  });

  it('POST /api/claims/:id/uncontest 409 if not contested', async () => {
    store = new Store();
    seedTestData(store);
    const { router } = await setupHost(store);

    const match = router.match('POST', '/api/claims/c1/uncontest');
    const result = await match!.handler(makeCtx(undefined, { id: 'c1' }));
    expect('status' in result && result.status).toBe(409);
  });

  it('GET /api/subjects/:id/contested lists contested claims', async () => {
    store = new Store();
    seedTestData(store);
    const { router } = await setupHost(store);

    // Contest two claims
    const contestMatch = router.match('POST', '/api/claims/c1/contest');
    await contestMatch!.handler(makeCtx(undefined, { id: 'c1' }));
    const contestMatch2 = router.match('POST', '/api/claims/c2/contest');
    await contestMatch2!.handler(makeCtx(undefined, { id: 'c2' }));

    const listMatch = router.match('GET', '/api/subjects/s1/contested');
    const result = await listMatch!.handler(makeCtx(undefined, { id: 's1' }));
    const body = (result as { body: unknown }).body as { contested: unknown[] };
    expect(body.contested).toHaveLength(2);
  });

  it('court.finished triggers permission wall', async () => {
    store = new Store();
    seedTestData(store);
    const { events } = await setupHost(store);

    // c3 has '抑郁症' and should be retired by the wall
    const session: CourtSession = {
      id: 'cs1',
      subjectId: 's1',
      startedAt: '2026-01-01',
      transcript: [],
    };

    events.emit('court.finished', session);
    expect(store.getClaim('c3')?.status).toBe('retired');
  });

  it('plugin disabled -> routes 404', async () => {
    store = new Store();
    const events = new EventBus();
    const host = new PluginHost(events);
    const router = new Router();
    host.providePreset('store', store);
    host.providePreset('events', events);
    host.providePreset('router', router);
    // Don't load the gate plugin
    const match = router.match('POST', '/api/claims/c1/contest');
    expect(match).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Tests: contested claims excluded from persona assembly               */
/* ------------------------------------------------------------------ */

describe('contested claims and persona assembly', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  it('persona assembly already filters by status=surviving (existing behavior)', async () => {
    store = new Store();
    seedTestData(store);

    // Import assemblePersonaContext
    const { assemblePersonaContext } = await import('@openmimic/kernel');

    // Before contest: c1 should be in the prompt
    const before = await assemblePersonaContext('s1', store);
    expect(before.meta.includedClaimIds).toContain('c1');

    // Contest c1
    const gateState = createGateState();
    contestClaim('c1', store, gateState);

    // After contest: c1 should NOT be in the prompt
    const after = await assemblePersonaContext('s1', store);
    expect(after.meta.includedClaimIds).not.toContain('c1');
  });
});

/* ------------------------------------------------------------------ */
/* Persistence: contest records survive a store restart                 */
/* ------------------------------------------------------------------ */

describe('gate plugin persistence', () => {
  const dbFiles: string[] = [];

  afterEach(() => {
    for (const f of dbFiles) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
    dbFiles.length = 0;
  });

  function makeDbPath(): string {
    const p = join(tmpdir(), `openmimic-gate-test-${randomUUID()}.db`);
    dbFiles.push(p);
    return p;
  }

  function setupWithFile(dbPath: string) {
    const store = new Store({ path: dbPath });
    const events = new EventBus();
    const host = new PluginHost(events);
    const router = new Router();
    host.providePreset('store', store);
    host.providePreset('router', router);
    host.providePreset('events', events);
    return { store, host, router, events };
  }

  it('contest records survive store close and reopen', async () => {
    const dbPath = makeDbPath();

    // Session 1: seed data, contest a claim, close
    {
      const { store, host, router } = setupWithFile(dbPath);
      seedTestData(store);
      host.load(gatePlugin);

      const match = router.match('POST', '/api/claims/c1/contest');
      const result = await match!.handler(makeCtx(undefined, { id: 'c1' }));
      expect((result as { status: number }).status).toBe(200);
      expect(store.getClaim('c1')?.status).toBe('contested');

      store.close();
    }

    // Session 2: reopen — the gate state must have the contest record
    {
      const { store, host, router } = setupWithFile(dbPath);
      host.load(gatePlugin);

      const gateState = host.getService<GateState>('gate');
      expect(gateState.contestRecords.has('c1')).toBe(true);
      expect(gateState.contestRecords.get('c1')!.length).toBe(1);

      // The claim itself is still contested in the DB
      expect(store.getClaim('c1')?.status).toBe('contested');

      // Listing should show it
      const listMatch = router.match('GET', '/api/subjects/s1/contested');
      const listResult = await listMatch!.handler(makeCtx(undefined, { id: 's1' }));
      const body = (listResult as { body: { contested: unknown[] } }).body;
      expect(body.contested.length).toBe(1);

      store.close();
    }
  });

  it('contest table is append-only — rejects updates', () => {
    const dbPath = makeDbPath();
    const store = new Store({ path: dbPath });

    const table = store.registerPluginTable(
      'gate', 'contest_records',
      `CREATE TABLE IF NOT EXISTS plugin_gate_contest_records (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL,
        at TEXT NOT NULL,
        evidence_snapshot TEXT NOT NULL
      )`,
      { appendOnly: true },
    );

    table.insert({
      id: 'rec-1', claim_id: 'c1', at: new Date().toISOString(),
      evidence_snapshot: '["e1"]',
    });

    expect(() => table.update({ at: 'never' }, 'id = ?', ['rec-1'])).toThrow(/append-only/);
    expect(() => table.delete('id = ?', ['rec-1'])).toThrow(/append-only/);

    store.close();
  });
});
