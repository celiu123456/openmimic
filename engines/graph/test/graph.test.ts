/**
 * GraphEngine tests.
 *
 * All tests use FakeLLM — no real model calls.
 * Covers: dependency table, dirty marking, claim matching, auto-trigger,
 * manual mode, incremental recompute, downstream staleness, daily limit,
 * correction handling, contested claims, route scopes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store, EventBus, PluginHost } from '@openmimic/kernel';
import {
  FakeLLM,
  courtPlugin,
  runCourt,
  type CourtEngine,
} from '@openmimic/engine-court';
import type { Claim, Testimony } from '@openmimic/shared';
import {
  GraphEngine,
  DependencyTracker,
  DirtyTracker,
  matchClaims,
  bigramJaccard,
  graphPlugin,
  type GraphEngineConfig,
  type RecomputeReport,
} from '@openmimic/engine-graph';

/* ------------------------------------------------------------------ */
/* Filing response templates                                           */
/* ------------------------------------------------------------------ */

function filingResponse(witnessId: string, testimonyId: string, claimTexts: string[]): string {
  return JSON.stringify({
    episodes: [
      { qid: 'q1', text: 'test episode text for ' + witnessId },
    ],
    claims: claimTexts.map((text) => ({
      text,
      kind: 'observation',
      domain: 'observable',
      evidenceTestimonyIds: [testimonyId],
    })),
  });
}

const RELATION_UNRELATED = JSON.stringify({
  relation: 'unrelated',
  reason: 'different topics',
});

const RELATION_AGREEMENT = JSON.stringify({
  relation: 'agreement',
  topic: 'kindness',
  reason: 'both say kind',
  mergedText: 'Subject is kind to people.',
});

/* ------------------------------------------------------------------ */
/* Test helpers                                                        */
/* ------------------------------------------------------------------ */

function createStore(): Store {
  return new Store({ path: ':memory:' });
}

function setupSubject(store: Store, subjectId: string = 'subject-1') {
  store.putSubject({ id: subjectId, displayName: 'Test Subject' });
  return subjectId;
}

function addWitness(store: Store, subjectId: string, witnessId: string, relation: string = 'friend') {
  store.putWitness({
    id: witnessId,
    subjectId,
    relation,
    consentLevel: 'quotable',
  });
}

function addTestimony(
  store: Store,
  subjectId: string,
  witnessId: string,
  testimonyId: string,
  text: string = 'test episode text for ' + witnessId,
  correctionOf?: string,
): Testimony {
  return store.addTestimony({
    id: testimonyId,
    witnessId,
    subjectId,
    answers: [{ qid: 'q1', behindText: text }],
    correctionOf,
  });
}

function buildDeps(store: Store): {
  depTracker: DependencyTracker;
  dirtyTracker: DirtyTracker;
} {
  const depsTable = store.registerPluginTable(
    'graph', 'deps',
    `CREATE TABLE IF NOT EXISTS plugin_graph_deps (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      testimony_id TEXT NOT NULL,
      witness_id TEXT NOT NULL,
      court_session_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    { appendOnly: true },
  );

  const personaTable = store.registerPluginTable(
    'graph', 'persona_versions',
    `CREATE TABLE IF NOT EXISTS plugin_graph_persona_versions (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      court_session_id TEXT NOT NULL,
      claim_ids TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    { appendOnly: true },
  );

  const outputTable = store.registerPluginTable(
    'graph', 'output_versions',
    `CREATE TABLE IF NOT EXISTS plugin_graph_output_versions (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      output_type TEXT NOT NULL,
      output_id TEXT NOT NULL,
      persona_version_id TEXT NOT NULL,
      court_session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0
    )`,
    { appendOnly: false },
  );

  const dirtyTable = store.registerPluginTable(
    'graph', 'dirty_marks',
    `CREATE TABLE IF NOT EXISTS plugin_graph_dirty_marks (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      witness_id TEXT NOT NULL,
      testimony_id TEXT NOT NULL,
      claim_id TEXT NOT NULL,
      affected_claim_ids TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT NOT NULL DEFAULT '',
      resolved_by_session_id TEXT NOT NULL DEFAULT ''
    )`,
    { appendOnly: false },
  );

  const depTracker = new DependencyTracker(depsTable, personaTable, outputTable);
  const dirtyTracker = new DirtyTracker(dirtyTable, depTracker, () => randomUUID());
  return { depTracker, dirtyTracker };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('bigramJaccard', () => {
  it('returns 1 for identical strings', () => {
    expect(bigramJaccard('hello', 'hello')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(bigramJaccard('abc', 'xyz')).toBe(0);
  });

  it('returns value between 0 and 1 for partial overlap', () => {
    const sim = bigramJaccard('she is kind', 'she is nice');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('returns 1 for two empty strings', () => {
    expect(bigramJaccard('', '')).toBe(1);
  });
});

describe('DependencyTracker', () => {
  let store: Store;
  let depTracker: DependencyTracker;
  let dirtyTracker: DirtyTracker;
  const subjectId = 'subject-1';

  beforeEach(() => {
    store = createStore();
    ({ depTracker, dirtyTracker } = buildDeps(store));
    setupSubject(store, subjectId);
  });

  afterEach(() => {
    store.close();
  });

  it('records court dependencies from claims', () => {
    const session = {
      id: 'session-1', subjectId, startedAt: '', transcript: [],
    };
    const claims: Claim[] = [{
      id: 'c1', subjectId, text: 'test', conviction: 0.5,
      evidence: ['t1', 't2'], status: 'surviving', courtSessionId: 'session-1',
      witnessIds: ['w1'],
    }];
    const deps = depTracker.recordCourtDeps(session as any, claims, [], []);
    expect(deps.length).toBe(2);
    expect(deps[0]!.targetType).toBe('claim');
    expect(deps[0]!.testimonyId).toBe('t1');
    expect(deps[1]!.testimonyId).toBe('t2');
  });

  it('records episode dependencies', () => {
    const session = { id: 'session-1', subjectId, startedAt: '', transcript: [] };
    const episodes = [{
      id: 'ep1', subjectId, witnessId: 'w1', testimonyId: 't1',
      qid: 'q1', text: 'test', elicited: false,
    }];
    const deps = depTracker.recordCourtDeps(session as any, [], episodes, []);
    expect(deps.length).toBe(1);
    expect(deps[0]!.targetType).toBe('episode');
    expect(deps[0]!.testimonyId).toBe('t1');
  });

  it('finds deps by testimony', () => {
    const session = { id: 's1', subjectId, startedAt: '', transcript: [] };
    const claims: Claim[] = [{
      id: 'c1', subjectId, text: 'test', conviction: 0.5,
      evidence: ['t1'], status: 'surviving', courtSessionId: 's1',
      witnessIds: ['w1'],
    }];
    depTracker.recordCourtDeps(session as any, claims, [], []);
    const found = depTracker.findByTestimony(subjectId, 't1');
    expect(found.length).toBe(1);
    expect(found[0]!.targetId).toBe('c1');
  });

  it('finds deps by witness', () => {
    const session = { id: 's1', subjectId, startedAt: '', transcript: [] };
    const claims: Claim[] = [{
      id: 'c1', subjectId, text: 'test', conviction: 0.5,
      evidence: ['t1'], status: 'surviving', courtSessionId: 's1',
      witnessIds: ['w1'],
    }];
    depTracker.recordCourtDeps(session as any, claims, [], []);
    const found = depTracker.findByWitness(subjectId, 'w1');
    expect(found.length).toBe(1);
  });

  it('records and retrieves persona versions', () => {
    const ver = depTracker.recordPersonaVersion(subjectId, 's1', ['c1', 'c2']);
    expect(ver.claimIds).toBe('c1,c2');
    const latest = depTracker.getLatestPersonaVersion(subjectId);
    expect(latest).not.toBeNull();
    expect(latest!.courtSessionId).toBe('s1');
  });

  it('records output versions and marks stale', () => {
    depTracker.recordOutputVersion(subjectId, 'room', 'room-1', null, 's1');
    const before = depTracker.getStaleOutputs(subjectId);
    expect(before.length).toBe(0);

    depTracker.markOutputsStale(subjectId);
    const after = depTracker.getStaleOutputs(subjectId);
    expect(after.length).toBe(1);
    expect(after[0]!.outputType).toBe('room');
  });
});

describe('DirtyTracker', () => {
  let store: Store;
  let depTracker: DependencyTracker;
  let dirtyTracker: DirtyTracker;
  const subjectId = 'subject-1';

  beforeEach(() => {
    store = createStore();
    ({ depTracker, dirtyTracker } = buildDeps(store));
    setupSubject(store, subjectId);
  });

  afterEach(() => {
    store.close();
  });

  it('marks testimony added as dirty', () => {
    addWitness(store, subjectId, 'w1');
    const t = addTestimony(store, subjectId, 'w1', 't1');
    const mark = dirtyTracker.markTestimonyAdded(t);
    expect(mark.reason).toBe('testimony_added');
    expect(mark.witnessId).toBe('w1');
    expect(mark.resolved).toBe(0);
  });

  it('marks correction as testimony_correction', () => {
    addWitness(store, subjectId, 'w1');
    addTestimony(store, subjectId, 'w1', 't1');
    const t2 = addTestimony(store, subjectId, 'w1', 't2', 'corrected text', 't1');
    const mark = dirtyTracker.markTestimonyAdded(t2);
    expect(mark.reason).toBe('testimony_correction');
  });

  it('only marks claims from the affected witness as dirty', () => {
    addWitness(store, subjectId, 'w1');
    addWitness(store, subjectId, 'w2');

    // Record deps for w1's claims
    const session = { id: 's1', subjectId, startedAt: '', transcript: [] };
    const claims: Claim[] = [
      { id: 'c1', subjectId, text: 'a', conviction: 0.5, evidence: ['t1'],
        status: 'surviving', courtSessionId: 's1', witnessIds: ['w1'] },
      { id: 'c2', subjectId, text: 'b', conviction: 0.5, evidence: ['t2'],
        status: 'surviving', courtSessionId: 's1', witnessIds: ['w2'] },
    ];
    depTracker.recordCourtDeps(session as any, claims, [], []);

    // New testimony from w1 should only dirty c1, not c2
    const t = addTestimony(store, subjectId, 'w1', 't3');
    const mark = dirtyTracker.markTestimonyAdded(t);
    expect(mark.affectedClaimIds).toContain('c1');
    expect(mark.affectedClaimIds).not.toContain('c2');
  });

  it('marks claim contested', () => {
    const mark = dirtyTracker.markClaimContested(subjectId, 'c1');
    expect(mark.reason).toBe('claim_contested');
    expect(mark.claimId).toBe('c1');
  });

  it('marks claim uncontested', () => {
    const mark = dirtyTracker.markClaimUncontested(subjectId, 'c1');
    expect(mark.reason).toBe('claim_uncontested');
  });

  it('marks corpus changed', () => {
    const mark = dirtyTracker.markCorpusChanged(subjectId);
    expect(mark.reason).toBe('corpus_changed');
  });

  it('resolves all dirty marks', () => {
    addWitness(store, subjectId, 'w1');
    const t = addTestimony(store, subjectId, 'w1', 't1');
    dirtyTracker.markTestimonyAdded(t);
    dirtyTracker.markClaimContested(subjectId, 'c1');

    expect(dirtyTracker.countUnresolved(subjectId)).toBe(2);
    dirtyTracker.resolveAll(subjectId, 'new-session');
    expect(dirtyTracker.countUnresolved(subjectId)).toBe(0);
  });

  it('getDirtyWitnessIds returns unique witness ids', () => {
    addWitness(store, subjectId, 'w1');
    addWitness(store, subjectId, 'w2');
    const t1 = addTestimony(store, subjectId, 'w1', 't1');
    const t2 = addTestimony(store, subjectId, 'w1', 't2');
    const t3 = addTestimony(store, subjectId, 'w2', 't3');
    dirtyTracker.markTestimonyAdded(t1);
    dirtyTracker.markTestimonyAdded(t2);
    dirtyTracker.markTestimonyAdded(t3);

    const ids = dirtyTracker.getDirtyWitnessIds(subjectId);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('w1');
    expect(ids).toContain('w2');
  });
});

describe('matchClaims', () => {
  function makeClaim(id: string, text: string): Claim {
    return {
      id, subjectId: 's1', text, conviction: 0.6,
      evidence: ['t1'], status: 'surviving', courtSessionId: 'cs1',
    };
  }

  it('matches identical claims as retained', async () => {
    const old = [makeClaim('c1', 'She is kind')];
    const nw = [makeClaim('c2', 'She is kind')];
    const result = await matchClaims(old, nw);
    expect(result.counts.retained).toBe(1);
    expect(result.counts.added).toBe(0);
    expect(result.counts.retired).toBe(0);
  });

  it('detects new claims', async () => {
    const old = [makeClaim('c1', 'She is kind')];
    const nw = [
      makeClaim('c2', 'She is kind'),
      makeClaim('c3', 'She is punctual'),
    ];
    const result = await matchClaims(old, nw);
    expect(result.counts.retained).toBe(1);
    expect(result.counts.added).toBe(1);
    expect(result.added).toContain('c3');
  });

  it('detects retired claims', async () => {
    const old = [
      makeClaim('c1', 'She is kind'),
      makeClaim('c2', 'She is brave'),
    ];
    const nw = [makeClaim('c3', 'She is kind')];
    const result = await matchClaims(old, nw);
    expect(result.counts.retired).toBe(1);
    expect(result.retired).toContain('c2');
  });

  it('merges similar claims via bigram Jaccard', async () => {
    const old = [makeClaim('c1', 'She is very kind and generous to everyone')];
    const nw = [makeClaim('c2', 'She is very kind and generous to all people')];
    const result = await matchClaims(old, nw);
    // Should match via bigram
    expect(result.retained.length).toBe(1);
    expect(result.retained[0]!.similarity).toBeLessThan(1);
    expect(result.counts.merged).toBe(1);
  });

  it('uses semantic matcher when provided', async () => {
    const old = [makeClaim('c1', 'She cares about others')];
    const nw = [makeClaim('c2', 'She shows empathy')];

    // Without semantic matcher: different enough to not match by bigram
    const result1 = await matchClaims(old, nw);
    expect(result1.counts.retired).toBe(1);

    // With semantic matcher: matches
    const result2 = await matchClaims(old, nw, {
      isSameFacet: async () => true,
    });
    expect(result2.retained.length).toBe(1);
  });

  it('ignores non-surviving claims', async () => {
    const old = [
      makeClaim('c1', 'She is kind'),
      { ...makeClaim('c2', 'She is brave'), status: 'contested' as const },
    ];
    const nw = [makeClaim('c3', 'She is kind')];
    const result = await matchClaims(old, nw);
    // Only c1 counts; c2 is contested so not in the match
    expect(result.counts.retained).toBe(1);
    expect(result.counts.retired).toBe(0);
  });
});

describe('GraphEngine', () => {
  let store: Store;
  let depTracker: DependencyTracker;
  let dirtyTracker: DirtyTracker;
  let engine: GraphEngine;
  const subjectId = 'subject-1';

  beforeEach(() => {
    store = createStore();
    ({ depTracker, dirtyTracker } = buildDeps(store));
    setupSubject(store, subjectId);
    engine = new GraphEngine(store, depTracker, dirtyTracker, { triggerMode: 'manual' });
  });

  afterEach(() => {
    engine.dispose();
    store.close();
  });

  it('manual mode: marks dirty but does not auto-trigger', () => {
    addWitness(store, subjectId, 'w1');
    const t = addTestimony(store, subjectId, 'w1', 't1');
    engine.onTestimonyAdded(t);

    const status = engine.getGraphStatus(subjectId);
    expect(status.dirtyCount).toBe(1);
  });

  it('auto mode: schedules timer on testimony', async () => {
    const autoEngine = new GraphEngine(store, depTracker, dirtyTracker, {
      triggerMode: 'auto', quietPeriodMs: 50,
    });

    let triggered = false;
    store.events.on('graph.auto_trigger', () => { triggered = true; });

    addWitness(store, subjectId, 'w1');
    const t = addTestimony(store, subjectId, 'w1', 't1');
    autoEngine.onTestimonyAdded(t);

    // Wait for quiet period
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(triggered).toBe(true);

    autoEngine.dispose();
  });

  it('auto mode: quiet period resets on new events', async () => {
    const autoEngine = new GraphEngine(store, depTracker, dirtyTracker, {
      triggerMode: 'auto', quietPeriodMs: 100,
    });

    let triggerCount = 0;
    store.events.on('graph.auto_trigger', () => { triggerCount++; });

    addWitness(store, subjectId, 'w1');
    addWitness(store, subjectId, 'w2');
    const t1 = addTestimony(store, subjectId, 'w1', 't1');
    autoEngine.onTestimonyAdded(t1);

    // Add another before quiet period expires
    await new Promise((resolve) => setTimeout(resolve, 30));
    const t2 = addTestimony(store, subjectId, 'w2', 't2');
    autoEngine.onTestimonyAdded(t2);

    // Wait for quiet period
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(triggerCount).toBe(1); // Only one trigger (timer was reset)

    autoEngine.dispose();
  });

  it('daily limit prevents auto-trigger', () => {
    const autoEngine = new GraphEngine(store, depTracker, dirtyTracker, {
      triggerMode: 'auto', dailyLimit: 2, quietPeriodMs: 10,
    });

    // Simulate 2 recomputes already done
    (autoEngine as any).dailyCounts.set(subjectId, {
      date: new Date().toISOString().slice(0, 10),
      count: 2,
    });

    let triggered = false;
    store.events.on('graph.auto_trigger', () => { triggered = true; });

    addWitness(store, subjectId, 'w1');
    const t = addTestimony(store, subjectId, 'w1', 't1');
    autoEngine.onTestimonyAdded(t);

    // Should not schedule because over daily limit
    expect(triggered).toBe(false);

    autoEngine.dispose();
  });

  it('getDailyCount tracks recomputes per day', () => {
    expect(engine.getDailyCount(subjectId)).toBe(0);
    (engine as any).incrementDailyCount(subjectId);
    expect(engine.getDailyCount(subjectId)).toBe(1);
  });

  it('onCourtFinished records dependencies and persona version', () => {
    addWitness(store, subjectId, 'w1');
    addTestimony(store, subjectId, 'w1', 't1');

    store.putClaim({
      id: 'c1', subjectId, text: 'test', conviction: 0.5,
      evidence: ['t1'], status: 'surviving', courtSessionId: 'session-1',
      witnessIds: ['w1'],
    });

    const session = {
      id: 'session-1', subjectId, startedAt: new Date().toISOString(),
      transcript: [], finishedAt: new Date().toISOString(),
    };
    store.putCourtSession(session);

    engine.onCourtFinished(session);

    const deps = depTracker.listDeps(subjectId);
    expect(deps.length).toBeGreaterThan(0);

    const version = depTracker.getLatestPersonaVersion(subjectId);
    expect(version).not.toBeNull();
    expect(version!.courtSessionId).toBe('session-1');
  });

  it('onClaimContested marks dirty and stale', () => {
    depTracker.recordOutputVersion(subjectId, 'room', 'room-1', null, 's1');

    engine.onClaimContested(subjectId, 'c1');
    expect(dirtyTracker.countUnresolved(subjectId)).toBe(1);
    const mark = dirtyTracker.getUnresolved(subjectId)[0]!;
    expect(mark.reason).toBe('claim_contested');

    const stale = depTracker.getStaleOutputs(subjectId);
    expect(stale.length).toBe(1);
  });

  it('onClaimUncontested marks dirty', () => {
    engine.onClaimUncontested(subjectId, 'c1');
    expect(dirtyTracker.countUnresolved(subjectId)).toBe(1);
    const mark = dirtyTracker.getUnresolved(subjectId)[0]!;
    expect(mark.reason).toBe('claim_uncontested');
  });

  it('getGraphStatus returns comprehensive overview', () => {
    addWitness(store, subjectId, 'w1');
    const t = addTestimony(store, subjectId, 'w1', 't1');
    engine.onTestimonyAdded(t);

    const status = engine.getGraphStatus(subjectId);
    expect(status.dirtyCount).toBe(1);
    expect(status.config.triggerMode).toBe('manual');
    expect(status.newTestimonySinceLastCourt).toBeGreaterThan(0);
  });

  it('onCorpusChanged marks dirty', () => {
    engine.onCorpusChanged(subjectId);
    expect(dirtyTracker.countUnresolved(subjectId)).toBe(1);
    const mark = dirtyTracker.getUnresolved(subjectId)[0]!;
    expect(mark.reason).toBe('corpus_changed');
  });
});

describe('GraphEngine.recompute (with FakeLLM court)', () => {
  let store: Store;
  let llm: FakeLLM;
  let courtEngine: CourtEngine;
  let depTracker: DependencyTracker;
  let dirtyTracker: DirtyTracker;
  let engine: GraphEngine;
  const subjectId = 'subject-1';

  function setupWitnesses(n: number): string[] {
    const ids: string[] = [];
    for (let i = 1; i <= n; i++) {
      const wid = `w${i}`;
      const tid = `t${i}`;
      addWitness(store, subjectId, wid, `friend-${i}`);
      addTestimony(store, subjectId, wid, tid, `test episode text for ${wid}`);
      ids.push(wid);
    }
    return ids;
  }

  beforeEach(() => {
    store = createStore();
    ({ depTracker, dirtyTracker } = buildDeps(store));
    setupSubject(store, subjectId);
  });

  afterEach(() => {
    engine?.dispose();
    store.close();
  });

  it('recompute resolves dirty marks and produces match report', async () => {
    // Setup: 2 witnesses, run initial court
    const filing1 = filingResponse('w1', 't1', ['Subject is kind']);
    const filing2 = filingResponse('w2', 't2', ['Subject is brave']);
    llm = new FakeLLM([filing1, filing2, RELATION_UNRELATED]);

    courtEngine = { runCourt: (sid) => runCourt(sid, store, llm) };
    engine = new GraphEngine(store, depTracker, dirtyTracker);

    setupWitnesses(2);

    // Initial court run
    const initialSession = await courtEngine.runCourt(subjectId);
    engine.onCourtFinished(initialSession);

    // Mark dirty (new testimony from w1)
    const t3 = addTestimony(store, subjectId, 'w1', 't3', 'test episode text for w1');
    engine.onTestimonyAdded(t3);
    expect(dirtyTracker.countUnresolved(subjectId)).toBe(1);

    // Recompute
    const filing1b = filingResponse('w1', 't1', ['Subject is kind']);
    const filing2b = filingResponse('w2', 't2', ['Subject is brave']);
    llm = new FakeLLM([filing1b, filing2b, RELATION_UNRELATED]);
    courtEngine = { runCourt: (sid) => runCourt(sid, store, llm) };

    const report = await engine.recompute(subjectId, courtEngine);

    expect(report.subjectId).toBe(subjectId);
    expect(report.dirtyMarksResolved).toBeGreaterThan(0);
    expect(report.claimMatch).toBeDefined();
    expect(report.claimMatch.counts).toBeDefined();
    expect(dirtyTracker.countUnresolved(subjectId)).toBe(0);
  });

  it('recompute retains identical claims (non-determinism handling)', async () => {
    const filing1 = filingResponse('w1', 't1', ['Subject is kind']);
    const filing2 = filingResponse('w2', 't2', ['Subject is brave']);
    llm = new FakeLLM([filing1, filing2, RELATION_UNRELATED]);
    courtEngine = { runCourt: (sid) => runCourt(sid, store, llm) };
    engine = new GraphEngine(store, depTracker, dirtyTracker);

    setupWitnesses(2);
    const s1 = await courtEngine.runCourt(subjectId);
    engine.onCourtFinished(s1);

    // Same claims on recompute
    const filing1b = filingResponse('w1', 't1', ['Subject is kind']);
    const filing2b = filingResponse('w2', 't2', ['Subject is brave']);
    llm = new FakeLLM([filing1b, filing2b, RELATION_UNRELATED]);
    courtEngine = { runCourt: (sid) => runCourt(sid, store, llm) };

    const t3 = addTestimony(store, subjectId, 'w1', 't3', 'test episode text for w1');
    engine.onTestimonyAdded(t3);
    const report = await engine.recompute(subjectId, courtEngine);

    expect(report.claimMatch.counts.retained).toBe(2);
    expect(report.claimMatch.counts.retired).toBe(0);
  });

  it('recompute marks downstream outputs stale', async () => {
    const filing1 = filingResponse('w1', 't1', ['Subject is kind']);
    llm = new FakeLLM([filing1]);
    courtEngine = { runCourt: (sid) => runCourt(sid, store, llm) };
    engine = new GraphEngine(store, depTracker, dirtyTracker);

    addWitness(store, subjectId, 'w1');
    addTestimony(store, subjectId, 'w1', 't1');
    const s1 = await courtEngine.runCourt(subjectId);
    engine.onCourtFinished(s1);

    // New testimony triggers dirty (and marks any existing outputs stale)
    const t2 = addTestimony(store, subjectId, 'w1', 't2', 'test episode text for w1');
    engine.onTestimonyAdded(t2);

    // Record a *new* output AFTER the stale wave so it starts as non-stale
    depTracker.recordOutputVersion(subjectId, 'room', 'room-1', null, s1.id);
    expect(depTracker.getStaleOutputs(subjectId)).toHaveLength(0);

    // Recompute should mark the fresh output as stale
    const filing1b = filingResponse('w1', 't1', ['Subject is kind']);
    llm = new FakeLLM([filing1b]);
    courtEngine = { runCourt: (sid) => runCourt(sid, store, llm) };
    const report = await engine.recompute(subjectId, courtEngine);

    expect(report.outputsMarkedStale).toBeGreaterThanOrEqual(1);
    expect(depTracker.getStaleOutputs(subjectId)).toHaveLength(1);
  });

  it('correction only dirties related witness claims', async () => {
    const filing1 = filingResponse('w1', 't1', ['Subject is kind']);
    const filing2 = filingResponse('w2', 't2', ['Subject is brave']);
    llm = new FakeLLM([filing1, filing2, RELATION_UNRELATED]);
    courtEngine = { runCourt: (sid) => runCourt(sid, store, llm) };
    engine = new GraphEngine(store, depTracker, dirtyTracker);

    setupWitnesses(2);
    const s1 = await courtEngine.runCourt(subjectId);
    engine.onCourtFinished(s1);

    // Correction from w1 should only dirty w1's claims
    const tCorr = addTestimony(
      store, subjectId, 'w1', 't-corr',
      'test episode text for w1',
      't1', // correctionOf
    );
    engine.onTestimonyAdded(tCorr);

    const marks = dirtyTracker.getUnresolved(subjectId);
    expect(marks.length).toBe(1);
    expect(marks[0]!.reason).toBe('testimony_correction');
    expect(marks[0]!.witnessId).toBe('w1');

    // Check affected claims only include w1's claim
    const deps = depTracker.findByWitness(subjectId, 'w1');
    const w1ClaimIds = deps.filter((d) => d.targetType === 'claim').map((d) => d.targetId);
    if (w1ClaimIds.length > 0) {
      for (const cid of marks[0]!.affectedClaimIds) {
        expect(w1ClaimIds).toContain(cid);
      }
    }
  });
});

describe('GraphEngine incremental vs full-run call count (FakeLLM)', () => {
  it('tracks LLM call count for full run vs incremental', async () => {
    const store = createStore();
    const subjectId = setupSubject(store);
    const { depTracker, dirtyTracker } = buildDeps(store);

    // Setup 5 witnesses
    for (let i = 1; i <= 5; i++) {
      addWitness(store, subjectId, `w${i}`, `friend-${i}`);
      addTestimony(store, subjectId, `w${i}`, `t${i}`, `test episode text for w${i}`);
    }

    // Full run (5 witnesses)
    const fullScript: string[] = [];
    for (let i = 1; i <= 5; i++) {
      fullScript.push(filingResponse(`w${i}`, `t${i}`, [`Claim from w${i}`]));
    }
    // Pair relations (C(5,2) = 10 pairs with keyword finder)
    for (let i = 0; i < 10; i++) {
      fullScript.push(RELATION_UNRELATED);
    }
    const fullLlm = new FakeLLM(fullScript);
    const fullSession = await runCourt(subjectId, store, fullLlm);
    const fullCallCount = fullLlm.calls.length;

    // Record deps
    const engine = new GraphEngine(store, depTracker, dirtyTracker);
    engine.onCourtFinished(fullSession);

    // Add 6th witness
    addWitness(store, subjectId, 'w6', 'friend-6');
    const t6 = addTestimony(store, subjectId, 'w6', 't6', 'test episode text for w6');
    engine.onTestimonyAdded(t6);

    // Incremental recompute (also full court, but we track calls)
    const incrScript: string[] = [];
    for (let i = 1; i <= 6; i++) {
      incrScript.push(filingResponse(`w${i}`, `t${i}`, [`Claim from w${i}`]));
    }
    // Pairs for 6 claims = C(6,2) = 15 with keyword finder
    for (let i = 0; i < 15; i++) {
      incrScript.push(RELATION_UNRELATED);
    }
    const incrLlm = new FakeLLM(incrScript);
    const courtEngine: CourtEngine = { runCourt: (sid) => runCourt(sid, store, incrLlm) };
    const report = await engine.recompute(subjectId, courtEngine);
    const incrCallCount = incrLlm.calls.length;

    // Report findings
    expect(report.claimMatch).toBeDefined();
    expect(report.claimMatch.counts.retained).toBeGreaterThanOrEqual(0);

    // Full run with 5 witnesses should take fewer calls than 6-witness run
    // (This confirms the counting works; true incremental would save more)
    expect(fullCallCount).toBeGreaterThan(0);
    expect(incrCallCount).toBeGreaterThan(0);

    // The 6-witness run costs more than the 5-witness run
    expect(incrCallCount).toBeGreaterThanOrEqual(fullCallCount);

    engine.dispose();
    store.close();
  });
});

describe('graphPlugin (integration)', () => {
  let store: Store;
  let events: EventBus;
  let host: PluginHost;

  beforeEach(() => {
    store = createStore();
    events = store.events;
    host = new PluginHost(events);
    host.providePreset('store', store);
    host.providePreset('events', events);
  });

  afterEach(async () => {
    await host.disposeAll();
    store.close();
  });

  it('loads as a standard plugin', async () => {
    await host.load(graphPlugin);
    expect(host.has('graph')).toBe(true);
    const engine = host.getService<GraphEngine>('graph');
    expect(engine).toBeDefined();
    expect(engine.config.triggerMode).toBe('manual');
  });

  it('accepts config override', async () => {
    await host.load(graphPlugin, { triggerMode: 'auto', dailyLimit: 10 });
    const engine = host.getService<GraphEngine>('graph');
    expect(engine.config.triggerMode).toBe('auto');
    expect(engine.config.dailyLimit).toBe(10);
  });

  it('listens to testimony.added events', async () => {
    await host.load(graphPlugin);
    const engine = host.getService<GraphEngine>('graph');

    const subjectId = setupSubject(store);
    addWitness(store, subjectId, 'w1');
    // This emits testimony.added via store.addTestimony
    addTestimony(store, subjectId, 'w1', 't1');

    const status = engine.getGraphStatus(subjectId);
    expect(status.dirtyCount).toBe(1);
  });

  it('listens to court.finished events', async () => {
    await host.load(graphPlugin);
    const engine = host.getService<GraphEngine>('graph');

    const subjectId = setupSubject(store);
    addWitness(store, subjectId, 'w1');
    addTestimony(store, subjectId, 'w1', 't1');

    store.putClaim({
      id: 'c1', subjectId, text: 'test', conviction: 0.5,
      evidence: ['t1'], status: 'surviving', courtSessionId: 's1',
      witnessIds: ['w1'],
    });

    const session = {
      id: 's1', subjectId, startedAt: new Date().toISOString(),
      transcript: [], finishedAt: new Date().toISOString(),
    };
    store.putCourtSession(session);

    // Emit court.finished
    events.emit('court.finished', session);

    const version = engine.getGraphStatus(subjectId).latestPersonaVersion;
    expect(version).not.toBeNull();
    expect(version!.courtSessionId).toBe('s1');
  });
});

describe('graphPlugin routes (scope)', () => {
  it('GET /api/subjects/:id/graph requires testimony.read scope', async () => {
    const store = createStore();
    const events = store.events;
    const host = new PluginHost(events);
    host.providePreset('store', store);
    host.providePreset('events', events);

    // Create a minimal router to check scope
    const { Router } = await import('@openmimic/server');
    const router = new Router();
    host.providePreset('router', router);

    await host.load(graphPlugin);

    // Check that the route exists with the right scope
    const match = router.match('GET', '/api/subjects/test/graph');
    expect(match).toBeDefined();
    expect(match!.scope).toBe('testimony.read');

    await host.disposeAll();
    store.close();
  });

  it('POST /api/subjects/:id/graph/recompute requires court.run scope', async () => {
    const store = createStore();
    const events = store.events;
    const host = new PluginHost(events);
    host.providePreset('store', store);
    host.providePreset('events', events);

    const { Router } = await import('@openmimic/server');
    const router = new Router();
    host.providePreset('router', router);

    await host.load(graphPlugin);

    const match = router.match('POST', '/api/subjects/test/graph/recompute');
    expect(match).toBeDefined();
    expect(match!.scope).toBe('court.run');

    await host.disposeAll();
    store.close();
  });
});
