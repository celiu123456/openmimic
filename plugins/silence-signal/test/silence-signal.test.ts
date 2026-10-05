import { describe, expect, it, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { EventBus, PluginHost, Store } from '@openmimic/kernel';
import { Router, type RouteContext } from '@openmimic/server';
import {
  silenceSignalPlugin,
  analyzeAvoidedQids,
  type AvoidedQidSummary,
} from '@openmimic/silence-signal';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeCtx(body: unknown, params: Record<string, string> = {}): RouteContext {
  return { params, query: new URLSearchParams(), body };
}

function seedWithSkips(store: Store, opts: {
  witnessCount: number;
  /** qids that each witness skips */
  avoidedQidsByWitness: string[][];
}) {
  store.putSubject({ id: 's1', displayName: '测试' });

  for (let i = 0; i < opts.witnessCount; i++) {
    const wId = `w${i + 1}`;
    store.putWitness({
      id: wId, subjectId: 's1', relation: `关系${i + 1}`,
      consentLevel: 'quotable',
    });
    store.addTestimony({
      id: `t${i + 1}`, witnessId: wId, subjectId: 's1',
      answers: [{ qid: 'q_answered', behindText: '回答了这个问题' }],
      avoidedQids: opts.avoidedQidsByWitness[i] ?? [],
    });
  }
}

async function setupHost(store: Store) {
  const events = new EventBus();
  const host = new PluginHost(events);
  const router = new Router();
  host.providePreset('store', store);
  host.providePreset('events', events);
  host.providePreset('router', router);
  await host.load(silenceSignalPlugin);
  return { host, router, events };
}

/* ------------------------------------------------------------------ */
/* Tests: pure analysis function                                       */
/* ------------------------------------------------------------------ */

describe('analyzeAvoidedQids', () => {
  it('returns empty when fewer than minCount witnesses exist', () => {
    const testimonies = [
      { witnessId: 'w1', avoidedQids: ['q1'] },
      { witnessId: 'w2', avoidedQids: ['q1'] },
    ];
    const result = analyzeAvoidedQids(testimonies);
    expect(result).toEqual([]);
  });

  it('detects a question skipped by >= half AND >= 3 witnesses', () => {
    const testimonies = [
      { witnessId: 'w1', avoidedQids: ['q1'] },
      { witnessId: 'w2', avoidedQids: ['q1'] },
      { witnessId: 'w3', avoidedQids: ['q1'] },
      { witnessId: 'w4', avoidedQids: [] },
      { witnessId: 'w5', avoidedQids: [] },
    ];
    const result = analyzeAvoidedQids(testimonies);
    expect(result.length).toBe(1);
    expect(result[0]!.qid).toBe('q1');
    expect(result[0]!.skipperIds).toHaveLength(3);
    expect(result[0]!.skipRatio).toBe(0.6);
    expect(result[0]!.totalWitnesses).toBe(5);
  });

  it('does not trigger when skip ratio < 0.5', () => {
    const testimonies = [
      { witnessId: 'w1', avoidedQids: ['q1'] },
      { witnessId: 'w2', avoidedQids: ['q1'] },
      { witnessId: 'w3', avoidedQids: [] },
      { witnessId: 'w4', avoidedQids: [] },
      { witnessId: 'w5', avoidedQids: [] },
      { witnessId: 'w6', avoidedQids: [] },
      { witnessId: 'w7', avoidedQids: [] },
    ];
    // 2/7 = 0.29, below 0.5
    const result = analyzeAvoidedQids(testimonies);
    expect(result).toEqual([]);
  });

  it('does not trigger when fewer than 3 skip (even if ratio >= 0.5)', () => {
    const testimonies = [
      { witnessId: 'w1', avoidedQids: ['q1'] },
      { witnessId: 'w2', avoidedQids: ['q1'] },
      { witnessId: 'w3', avoidedQids: [] },
    ];
    // 2/3 = 0.67 but only 2 skippers < 3
    const result = analyzeAvoidedQids(testimonies);
    expect(result).toEqual([]);
  });

  it('detects multiple avoided questions', () => {
    const testimonies = [
      { witnessId: 'w1', avoidedQids: ['q1', 'q2'] },
      { witnessId: 'w2', avoidedQids: ['q1', 'q2'] },
      { witnessId: 'w3', avoidedQids: ['q1', 'q2'] },
      { witnessId: 'w4', avoidedQids: [] },
    ];
    const result = analyzeAvoidedQids(testimonies);
    expect(result.length).toBe(2);
    const qids = result.map((r) => r.qid).sort();
    expect(qids).toEqual(['q1', 'q2']);
  });

  it('handles testimonies without avoidedQids field', () => {
    const testimonies = [
      { witnessId: 'w1' },
      { witnessId: 'w2' },
      { witnessId: 'w3' },
      { witnessId: 'w4' },
    ];
    const result = analyzeAvoidedQids(testimonies);
    expect(result).toEqual([]);
  });

  it('sorts by skipRatio descending', () => {
    const testimonies = [
      { witnessId: 'w1', avoidedQids: ['q1', 'q2'] },
      { witnessId: 'w2', avoidedQids: ['q1', 'q2'] },
      { witnessId: 'w3', avoidedQids: ['q1', 'q2'] },
      { witnessId: 'w4', avoidedQids: ['q2'] },
      { witnessId: 'w5', avoidedQids: [] },
      { witnessId: 'w6', avoidedQids: [] },
    ];
    // q1: 3/6 = 0.5, q2: 4/6 = 0.67
    const result = analyzeAvoidedQids(testimonies);
    expect(result[0]!.qid).toBe('q2');
    expect(result[1]!.qid).toBe('q1');
  });
});

/* ------------------------------------------------------------------ */
/* Tests: plugin routes                                                */
/* ------------------------------------------------------------------ */

describe('silence-signal plugin', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  it('provides silence-signal service', async () => {
    store = new Store();
    store.putSubject({ id: 's1', displayName: '测试' });
    const { host } = await setupHost(store);
    expect(host.hasService('silence-signal')).toBe(true);
  });

  it('POST scan detects silence signals', async () => {
    store = new Store();
    seedWithSkips(store, {
      witnessCount: 6,
      avoidedQidsByWitness: [
        ['q_family'],
        ['q_family'],
        ['q_family'],
        ['q_family'],
        [],
        [],
      ],
    });
    const { router } = await setupHost(store);

    const match = router.match('POST', '/api/subjects/s1/silence-signals/scan');
    expect(match).toBeDefined();
    const result = await match!.handler(makeCtx(undefined, { id: 's1' }));
    const body = (result as { body: { signals: unknown[]; count: number } }).body;
    expect(body.count).toBe(1);
    expect(body.signals).toHaveLength(1);
    const signal = body.signals[0] as { qid: string; skipRatio: number };
    expect(signal.qid).toBe('q_family');
    expect(signal.skipRatio).toBeCloseTo(4 / 6);
  });

  it('GET lists persisted signals', async () => {
    store = new Store();
    seedWithSkips(store, {
      witnessCount: 4,
      avoidedQidsByWitness: [
        ['q_money'],
        ['q_money'],
        ['q_money'],
        [],
      ],
    });
    const { router } = await setupHost(store);

    // Scan first
    const scanMatch = router.match('POST', '/api/subjects/s1/silence-signals/scan');
    await scanMatch!.handler(makeCtx(undefined, { id: 's1' }));

    // Then list
    const listMatch = router.match('GET', '/api/subjects/s1/silence-signals');
    const result = await listMatch!.handler(makeCtx(undefined, { id: 's1' }));
    const body = (result as { body: { signals: unknown[] } }).body;
    expect(body.signals).toHaveLength(1);
  });

  it('returns 404 for unknown subject', async () => {
    store = new Store();
    const { router } = await setupHost(store);

    const match = router.match('GET', '/api/subjects/nope/silence-signals');
    const result = await match!.handler(makeCtx(undefined, { id: 'nope' }));
    expect((result as { status: number }).status).toBe(404);
  });

  it('signals survive store restart', () => {
    const dbPath = join(tmpdir(), `openmimic-silence-test-${randomUUID()}.db`);
    const dbFiles = [dbPath];

    try {
      // Session 1: scan and persist
      {
        const s = new Store({ path: dbPath });
        seedWithSkips(s, {
          witnessCount: 4,
          avoidedQidsByWitness: [
            ['q_past'],
            ['q_past'],
            ['q_past'],
            [],
          ],
        });
        const events = new EventBus();
        const host = new PluginHost(events);
        host.providePreset('store', s);
        host.providePreset('events', events);
        host.load(silenceSignalPlugin);

        const svc = host.getService<{ scan: (id: string) => unknown[] }>('silence-signal');
        const signals = svc.scan('s1');
        expect(signals.length).toBe(1);
        s.close();
      }

      // Session 2: signals still there
      {
        const s = new Store({ path: dbPath });
        const events = new EventBus();
        const host = new PluginHost(events);
        const router = new Router();
        host.providePreset('store', s);
        host.providePreset('events', events);
        host.providePreset('router', router);
        host.load(silenceSignalPlugin);

        const match = router.match('GET', '/api/subjects/s1/silence-signals');
        const result = match!.handler(makeCtx(undefined, { id: 's1' }));
        const body = (result as { body: { signals: unknown[] } }).body;
        expect(body.signals).toHaveLength(1);
        s.close();
      }
    } finally {
      for (const f of dbFiles) {
        try { unlinkSync(f); } catch { /* ignore */ }
      }
    }
  });
});
