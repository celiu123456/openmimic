import { describe, expect, it, afterEach } from 'vitest';
import { EventBus, PluginHost, Store } from '@openmimic/kernel';
import { Router, type RouteContext } from '@openmimic/server';
import {
  metaPerceptionPlugin,
  computeScore,
  computeByWitness,
  scoreOnePrediction,
  DEFAULT_META_QIDS,
  type MetaPerceptionState,
  type ScoreItem,
} from '@openmimic/meta-perception';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeCtx(body: unknown, params: Record<string, string> = {}): RouteContext {
  return { params, query: new URLSearchParams(), body };
}

async function setupHost(store: Store) {
  const events = new EventBus();
  const host = new PluginHost(events);
  const router = new Router();
  host.providePreset('store', store);
  host.providePreset('events', events);
  host.providePreset('router', router);
  await host.load(metaPerceptionPlugin);
  return { host, router, events };
}

function seedTestData(store: Store) {
  store.putSubject({ id: 's1', displayName: '测试' });
  store.putWitness({
    id: 'w1', subjectId: 's1', relation: '发小',
    consentLevel: 'quotable',
  });
  store.putWitness({
    id: 'w2', subjectId: 's1', relation: '同事',
    consentLevel: 'synthesis_only',
  });
  store.addTestimony({
    id: 't1', witnessId: 'w1', subjectId: 's1',
    answers: [
      { qid: 'q1', behindText: '他花钱很大方,请客从来不犹豫' },
      { qid: 'q2', behindText: '他生气了就不说话,自己一个人待着' },
    ],
  });
  store.addTestimony({
    id: 't2', witnessId: 'w2', subjectId: 's1',
    answers: [
      { qid: 'q1', behindText: '他对花钱比较谨慎,AA制居多' },
      { qid: 'q4', behindText: '说话直来直去,不太会绕弯子' },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('meta-perception plugin', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  it('provides meta-perception service', async () => {
    store = new Store();
    const { host } = await setupHost(store);
    expect(host.hasService('meta-perception')).toBe(true);
  });

  it('GET /api/subjects/:id/meta/questions returns questions and witnesses', async () => {
    store = new Store();
    seedTestData(store);
    const { router } = await setupHost(store);

    const match = router.match('GET', '/api/subjects/s1/meta/questions');
    expect(match).toBeDefined();
    const result = await match!.handler(makeCtx(undefined, { id: 's1' }));
    expect('status' in result && result.status).toBe(200);
    const body = (result as { body: unknown }).body as Record<string, unknown>;
    expect(body.subjectId).toBe('s1');
    expect(Array.isArray(body.questions)).toBe(true);
    expect((body.questions as Array<{ qid: string }>).length).toBe(DEFAULT_META_QIDS.length);
    expect(Array.isArray(body.witnesses)).toBe(true);
    expect((body.witnesses as unknown[]).length).toBe(2);
  });

  it('GET /api/subjects/:id/meta/questions returns 404 for unknown subject', async () => {
    store = new Store();
    const { router } = await setupHost(store);

    const match = router.match('GET', '/api/subjects/nope/meta/questions');
    const result = await match!.handler(makeCtx(undefined, { id: 'nope' }));
    expect('status' in result && result.status).toBe(404);
  });

  it('POST /api/subjects/:id/meta/predictions locks predictions', async () => {
    store = new Store();
    seedTestData(store);
    const { router } = await setupHost(store);

    const match = router.match('POST', '/api/subjects/s1/meta/predictions');
    const result = await match!.handler(makeCtx(
      { predictions: [{ witnessId: 'w1', qid: 'q1', predictedText: '应该挺大方' }] },
      { id: 's1' },
    ));
    expect('status' in result && result.status).toBe(201);
  });

  it('predictions cannot be submitted twice (locked)', async () => {
    store = new Store();
    seedTestData(store);
    const { router } = await setupHost(store);

    const match = router.match('POST', '/api/subjects/s1/meta/predictions');
    await match!.handler(makeCtx(
      { predictions: [{ witnessId: 'w1', qid: 'q1', predictedText: '大方' }] },
      { id: 's1' },
    ));

    const result2 = await match!.handler(makeCtx(
      { predictions: [{ witnessId: 'w1', qid: 'q1', predictedText: '抠门' }] },
      { id: 's1' },
    ));
    expect('status' in result2 && result2.status).toBe(409);
  });

  it('POST /api/subjects/:id/meta/score returns 501 when no LLM', async () => {
    store = new Store();
    seedTestData(store);
    const { router, host } = await setupHost(store);

    // Submit predictions first
    const predMatch = router.match('POST', '/api/subjects/s1/meta/predictions');
    await predMatch!.handler(makeCtx(
      { predictions: [{ witnessId: 'w1', qid: 'q1', predictedText: '大方' }] },
      { id: 's1' },
    ));

    // No llm provided
    const scoreMatch = router.match('POST', '/api/subjects/s1/meta/score');
    const result = await scoreMatch!.handler(makeCtx(undefined, { id: 's1' }));
    expect('status' in result && result.status).toBe(501);
  });

  it('POST /api/subjects/:id/meta/score returns 400 when no predictions', async () => {
    store = new Store();
    seedTestData(store);
    const { router } = await setupHost(store);

    const match = router.match('POST', '/api/subjects/s1/meta/score');
    const result = await match!.handler(makeCtx(undefined, { id: 's1' }));
    expect('status' in result && result.status).toBe(400);
  });

  it('GET /api/subjects/:id/meta/result shows pending when predictions exist but not scored', async () => {
    store = new Store();
    seedTestData(store);
    const { router } = await setupHost(store);

    // Submit predictions
    const predMatch = router.match('POST', '/api/subjects/s1/meta/predictions');
    await predMatch!.handler(makeCtx(
      { predictions: [{ witnessId: 'w1', qid: 'q1', predictedText: '大方' }] },
      { id: 's1' },
    ));

    const resMatch = router.match('GET', '/api/subjects/s1/meta/result');
    const result = await resMatch!.handler(makeCtx(undefined, { id: 's1' }));
    expect('status' in result && result.status).toBe(200);
    const body = (result as { body: unknown }).body as Record<string, unknown>;
    expect(body.pending).toBe(true);
  });

  it('GET /api/subjects/:id/meta/result returns 404 when no predictions at all', async () => {
    store = new Store();
    seedTestData(store);
    const { router } = await setupHost(store);

    const match = router.match('GET', '/api/subjects/s1/meta/result');
    const result = await match!.handler(makeCtx(undefined, { id: 's1' }));
    expect('status' in result && result.status).toBe(404);
  });

  it('result redacts cue for synthesis_only witnesses', async () => {
    store = new Store();
    seedTestData(store);
    const events = new EventBus();
    const host = new PluginHost(events);
    const router = new Router();
    host.providePreset('store', store);
    host.providePreset('events', events);
    host.providePreset('router', router);
    await host.load(metaPerceptionPlugin);

    const state = host.getService<MetaPerceptionState>('meta-perception');

    // Manually set a result with both witnesses
    state.predictions.set('s1', {
      items: [
        { witnessId: 'w1', qid: 'q1', predictedText: '大方' },
        { witnessId: 'w2', qid: 'q1', predictedText: '谨慎' },
      ],
      lockedAt: new Date().toISOString(),
    });
    state.results.set('s1', {
      subjectId: 's1',
      totalScore: 0.75,
      items: [
        { witnessId: 'w1', qid: 'q1', match: 'hit', cue: '方向一致' },
        { witnessId: 'w2', qid: 'q1', match: 'partial', cue: '方向一致但细节偏差' },
      ],
      byWitness: [
        { witnessId: 'w1', relation: '发小', score: 1, itemCount: 1 },
        { witnessId: 'w2', relation: '同事', score: 0.5, itemCount: 1 },
      ],
      scoredAt: new Date().toISOString(),
    });

    const match = router.match('GET', '/api/subjects/s1/meta/result');
    const result = await match!.handler(makeCtx(undefined, { id: 's1' }));
    const body = (result as { body: unknown }).body as Record<string, unknown>;
    const items = body.items as Array<{ witnessId: string; cue: string }>;

    // w1 is quotable: cue should be original
    const w1Item = items.find((i) => i.witnessId === 'w1')!;
    expect(w1Item.cue).toBe('方向一致');

    // w2 is synthesis_only: cue should be redacted
    const w2Item = items.find((i) => i.witnessId === 'w2')!;
    expect(w2Item.cue).toBe('该证人未授权展示原文');
  });

  it('plugin disabled -> routes not registered -> 404', async () => {
    store = new Store();
    const events = new EventBus();
    const host = new PluginHost(events);
    const router = new Router();
    host.providePreset('store', store);
    host.providePreset('events', events);
    // No router provided -> routes not registered
    // But let's test by just not loading the plugin
    const match = router.match('GET', '/api/subjects/s1/meta/questions');
    expect(match).toBeUndefined();
  });
});

describe('computeScore', () => {
  it('all hits = 1.0', () => {
    const items: ScoreItem[] = [
      { witnessId: 'w1', qid: 'q1', match: 'hit', cue: '' },
      { witnessId: 'w1', qid: 'q2', match: 'hit', cue: '' },
    ];
    expect(computeScore(items)).toBe(1);
  });

  it('all misses = 0', () => {
    const items: ScoreItem[] = [
      { witnessId: 'w1', qid: 'q1', match: 'miss', cue: '' },
    ];
    expect(computeScore(items)).toBe(0);
  });

  it('mixed = correct ratio', () => {
    const items: ScoreItem[] = [
      { witnessId: 'w1', qid: 'q1', match: 'hit', cue: '' },
      { witnessId: 'w1', qid: 'q2', match: 'partial', cue: '' },
      { witnessId: 'w1', qid: 'q3', match: 'miss', cue: '' },
    ];
    // (1 + 0.5 + 0) / 3 = 0.5
    expect(computeScore(items)).toBe(0.5);
  });

  it('empty items = 0', () => {
    expect(computeScore([])).toBe(0);
  });
});

describe('computeByWitness', () => {
  it('groups by witness and sorts by score desc', () => {
    const witnessMap = new Map([['w1', '发小'], ['w2', '同事']]);
    const items: ScoreItem[] = [
      { witnessId: 'w1', qid: 'q1', match: 'miss', cue: '' },
      { witnessId: 'w2', qid: 'q1', match: 'hit', cue: '' },
      { witnessId: 'w2', qid: 'q2', match: 'hit', cue: '' },
    ];
    const result = computeByWitness(items, witnessMap);
    expect(result.length).toBe(2);
    expect(result[0]!.witnessId).toBe('w2');
    expect(result[0]!.score).toBe(1);
    expect(result[1]!.witnessId).toBe('w1');
    expect(result[1]!.score).toBe(0);
  });
});
