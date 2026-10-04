/**
 * Persona assembly v2 tests.
 *
 * Rewritten from v1: assemblePersonaContext is now async; section headers
 * changed ("他在不同人面前", "别人讲过的事", "他本人说过的话"); style samples
 * come from corpus items, not witness sentences; episodes and divergences
 * are new sections.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FakeEmbedding,
  PERSONA_PROMPT_BUDGET,
  Store,
  assemblePersonaContext,
  personaIdentityLine,
} from '@openmimic/kernel';

const SUBJECT = 's1';

function seedSubject(store: Store, selfReport?: string): void {
  store.putSubject({
    id: SUBJECT,
    displayName: '林默',
    ...(selfReport !== undefined ? { selfReport } : {}),
  });
}

function addWitness(
  store: Store,
  id: string,
  relation: string,
  consentLevel: 'quotable' | 'synthesis_only' = 'quotable',
): void {
  store.putWitness({ id, subjectId: SUBJECT, relation, consentLevel });
}

function addTestimony(
  store: Store,
  id: string,
  witnessId: string,
  behindText: string,
): void {
  store.addTestimony({
    id,
    witnessId,
    subjectId: SUBJECT,
    answers: [{ qid: 'q1', behindText }],
  });
}

function addClaim(
  store: Store,
  id: string,
  text: string,
  evidence: string[],
  conviction = 0.8,
  extras?: {
    qualifiers?: string[];
    witnessIds?: string[];
    episodeIds?: string[];
    context?: { audience?: string; situation?: string; period?: string };
  },
): void {
  store.putClaim({
    id,
    subjectId: SUBJECT,
    text,
    conviction,
    evidence,
    ...(extras?.qualifiers !== undefined ? { qualifiers: extras.qualifiers } : {}),
    ...(extras?.witnessIds !== undefined ? { witnessIds: extras.witnessIds } : {}),
    ...(extras?.episodeIds !== undefined ? { episodeIds: extras.episodeIds } : {}),
    ...(extras?.context !== undefined ? { context: extras.context } : {}),
    status: 'surviving',
    courtSessionId: 'court-1',
  });
}

describe('assemblePersonaContext v2', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('always opens with the non-negotiable identity declaration', async () => {
    seedSubject(store, '我今年二十八。');
    addWitness(store, 'w1', '发小');
    addTestimony(store, 't1', 'w1', '他总是最后一个走。');
    addClaim(store, 'c1', '林默习惯自己扛。', ['t1']);

    const { systemPrompt, meta } = await assemblePersonaContext(SUBJECT, store);

    expect(systemPrompt.startsWith(personaIdentityLine('林默'))).toBe(true);
    expect(systemPrompt).toContain('你正在扮演基于他人证言构建的林默。');
    expect(systemPrompt).toContain('这是人格模拟,不是本人。');
    expect(meta.displayName).toBe('林默');
    expect(meta.includedClaimIds).toEqual(['c1']);
  });

  it('drops claims below 0.5 conviction and records them as excluded', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '同事');
    addTestimony(store, 't1', 'w1', '他开会从不抢话。');
    addClaim(store, 'c-high', '林默在压力下会沉默。', ['t1'], 0.8);
    addClaim(store, 'c-low', '林默其实讨厌猫。', ['t1'], 0.49);

    const { systemPrompt, meta } = await assemblePersonaContext(SUBJECT, store);

    expect(systemPrompt).toContain('林默在压力下会沉默。');
    expect(systemPrompt).not.toContain('林默其实讨厌猫。');
    expect(meta.includedClaimIds).toEqual(['c-high']);
    expect(meta.excludedClaimIds).toContain('c-low');
  });

  it('never quotes synthesis_only episodes in the prompt', async () => {
    const secret = '她其实特别害怕一个人待着而且半夜会反复检查门锁是否锁好';
    seedSubject(store);
    addWitness(store, 'w-q', '发小', 'quotable');
    addWitness(store, 'w-s', '同事', 'synthesis_only');
    addTestimony(store, 't-q', 'w-q', '他话不多,他总是最后一个走。');
    addTestimony(store, 't-s', 'w-s', secret);
    addClaim(store, 'c-q', '林默话不多。', ['t-q'], 0.8);
    addClaim(store, 'c-s', '林默独处时会反复确认安全。', ['t-s'], 0.7);

    // Add episode from synthesis_only witness
    store.putEpisode({
      id: 'ep-s',
      subjectId: SUBJECT,
      witnessId: 'w-s',
      testimonyId: 't-s',
      qid: 'q1',
      text: '她其实特别害怕一个人待着',
      elicited: false,
    });

    // Add episode from quotable witness
    store.putEpisode({
      id: 'ep-q',
      subjectId: SUBJECT,
      witnessId: 'w-q',
      testimonyId: 't-q',
      qid: 'q1',
      text: '他话不多',
      elicited: false,
    });

    const { systemPrompt } = await assemblePersonaContext(SUBJECT, store);

    // synthesis_only episode text must NOT appear
    expect(systemPrompt).not.toContain('她其实特别害怕一个人待着');
    // quotable episode text CAN appear
    expect(systemPrompt).toContain('他话不多');
    // The derived claim is allowed
    expect(systemPrompt).toContain('林默独处时会反复确认安全。');
  });

  it('keeps the identity line after truncating an over-budget prompt', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '同事');
    addTestimony(store, 't1', 'w1', '他很少解释自己。');
    // With budget=6000, need more claims to overflow
    for (let index = 0; index < 120; index += 1) {
      addClaim(
        store,
        `c-${index}`,
        `林默在工作里会把压力全部压在自己身上,遇到${index}号问题也从不主动开口求助别人。`,
        ['t1'],
        0.5 + index / 300,
      );
    }

    const { systemPrompt, meta } = await assemblePersonaContext(SUBJECT, store);

    expect(systemPrompt.length).toBeLessThanOrEqual(PERSONA_PROMPT_BUDGET);
    expect(systemPrompt.startsWith(personaIdentityLine('林默'))).toBe(true);
    expect(systemPrompt).toContain('这是人格模拟,不是本人。');
    expect(meta.truncated).toBe(true);
    expect(meta.includedClaimIds.length).toBeLessThan(120);
    // Highest conviction survives; the lowest is cut first.
    expect(meta.includedClaimIds).toContain('c-119');
    expect(meta.includedClaimIds).not.toContain('c-0');
  });

  it('uses corpus items for style section, not witness sentences', async () => {
    seedSubject(store, '我今年二十八,刚把工作辞了。');
    addWitness(store, 'w1', '发小');
    addTestimony(
      store,
      't1',
      'w1',
      '他总是最后一个走。他喜欢坐在角落。他喝咖啡不加糖。',
    );
    addClaim(store, 'c1', '林默话不多。', ['t1']);

    // Add corpus items (subject's own words)
    store.putCorpusItem({
      id: 'corpus-1',
      subjectId: SUBJECT,
      text: '太累了,想歇一段时间。',
      source: 'pasted',
      createdAt: new Date().toISOString(),
    });

    const { systemPrompt, meta } = await assemblePersonaContext(SUBJECT, store);

    // v2: no witness sentences as style samples
    expect(systemPrompt).not.toContain('说话风格参照（来自已授权原话）');
    // v2: corpus section present
    expect(systemPrompt).toContain('他本人说过的话（说话风格只参照这里）');
    expect(systemPrompt).toContain('太累了,想歇一段时间。');
    // v2: self-report title changed
    expect(systemPrompt).toContain('内心感受以自述为准');
    expect(systemPrompt).toContain('能力、评价和外在行为以旁人观察为准');
    expect(meta.selfReportIncluded).toBe(true);
    expect(meta.corpusCount).toBe(1);
  });

  it('omits the corpus section when no corpus items exist', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '发小');
    addTestimony(store, 't1', 'w1', '他总是最后一个走。');
    addClaim(store, 'c1', '林默话不多。', ['t1']);

    const { systemPrompt } = await assemblePersonaContext(SUBJECT, store);

    // No corpus → no style section; also no witness sentences as fallback
    expect(systemPrompt).not.toContain('他本人说过的话');
    expect(systemPrompt).not.toContain('说话风格参照');
    // Witness sentence should NOT appear as style sample
    expect(systemPrompt).not.toContain('发小:「他总是最后一个走。」');
  });

  it('stays within budget even without any claims or self-report', async () => {
    seedSubject(store);

    const { systemPrompt, meta } = await assemblePersonaContext(SUBJECT, store);

    expect(systemPrompt.length).toBeLessThanOrEqual(PERSONA_PROMPT_BUDGET);
    expect(systemPrompt.startsWith(personaIdentityLine('林默'))).toBe(true);
    expect(meta.includedClaimIds).toEqual([]);
    expect(meta.truncated).toBe(false);
  });

  it('groups claims by witness relation and puts interlocutor match first', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '同事');
    addWitness(store, 'w2', '母亲');
    addTestimony(store, 't1', 'w1', '他开会时很安静。');
    addTestimony(store, 't2', 'w2', '他在家很话多。');
    addClaim(store, 'c1', '林默开会时很安静。', ['t1'], 0.8, {
      witnessIds: ['w1'],
      context: { audience: '对同事' },
    });
    addClaim(store, 'c2', '林默在家很话多。', ['t2'], 0.8, {
      witnessIds: ['w2'],
      context: { audience: '对家人' },
    });

    const { systemPrompt } = await assemblePersonaContext(SUBJECT, store, {
      interlocutor: '母亲',
    });

    expect(systemPrompt).toContain('他在不同人面前');
    // The mother group should be marked as current interlocutor
    expect(systemPrompt).toContain('你现在面对的是这类人');
    // Mother section should appear before colleagues (grouped by witness relation)
    const motherPos = systemPrompt.indexOf('母亲');
    const colleaguePos = systemPrompt.indexOf('同事');
    expect(motherPos).toBeLessThan(colleaguePos);
  });

  it('includes episodes from quotable witnesses in the prompt', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '发小');
    addTestimony(store, 't1', 'w1', '有一次他在公司加班到凌晨三点,没有告诉任何人。');
    addClaim(store, 'c1', '林默习惯默默承受。', ['t1'], 0.8, {
      episodeIds: ['ep1'],
    });
    store.putEpisode({
      id: 'ep1',
      subjectId: SUBJECT,
      witnessId: 'w1',
      testimonyId: 't1',
      qid: 'q1',
      text: '有一次他在公司加班到凌晨三点',
      elicited: false,
    });

    const { systemPrompt, meta } = await assemblePersonaContext(SUBJECT, store);

    expect(systemPrompt).toContain('别人讲过的事');
    expect(systemPrompt).toContain('有一次他在公司加班到凌晨三点');
    expect(meta.episodeCount).toBe(1);
  });

  it('ranks episodes by embedding similarity when query is provided', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '发小');
    addTestimony(
      store,
      't1',
      'w1',
      '有一次他在公司加班到凌晨三点。他喜欢喝咖啡,每天早上必须来一杯。',
    );
    addClaim(store, 'c1', '林默工作很拼。', ['t1'], 0.8, { episodeIds: ['ep1'] });
    addClaim(store, 'c2', '林默爱喝咖啡。', ['t1'], 0.7, { episodeIds: ['ep2'] });
    store.putEpisode({
      id: 'ep1',
      subjectId: SUBJECT,
      witnessId: 'w1',
      testimonyId: 't1',
      qid: 'q1',
      text: '有一次他在公司加班到凌晨三点',
      elicited: false,
    });
    store.putEpisode({
      id: 'ep2',
      subjectId: SUBJECT,
      witnessId: 'w1',
      testimonyId: 't1',
      qid: 'q1',
      text: '他喜欢喝咖啡,每天早上必须来一杯',
      elicited: false,
    });

    const embedding = new FakeEmbedding();

    // Query about coffee should rank coffee episode higher
    const { systemPrompt: coffeePrompt } = await assemblePersonaContext(SUBJECT, store, {
      query: '他喝咖啡吗',
      embedding,
    });
    const coffeePos = coffeePrompt.indexOf('喝咖啡');
    const workPos = coffeePrompt.indexOf('加班到凌晨三点');
    // Both should be present, coffee first
    expect(coffeePos).toBeGreaterThan(-1);
    expect(workPos).toBeGreaterThan(-1);
    expect(coffeePos).toBeLessThan(workPos);
  });

  it('includes divergence section for factual unresolved divergences', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '同事');
    addWitness(store, 'w2', '朋友');
    addTestimony(store, 't1', 'w1', '他从不迟到。');
    addTestimony(store, 't2', 'w2', '他经常迟到。');
    addClaim(store, 'c1', '林默从不迟到。', ['t1'], 0, {
      witnessIds: ['w1'],
    });
    addClaim(store, 'c2', '林默经常迟到。', ['t2'], 0, {
      witnessIds: ['w2'],
    });
    // Mark both contested
    store.putClaim({
      id: 'c1', subjectId: SUBJECT, text: '林默从不迟到。',
      conviction: 0, evidence: ['t1'], status: 'contested', courtSessionId: 'court-1',
    });
    store.putClaim({
      id: 'c2', subjectId: SUBJECT, text: '林默经常迟到。',
      conviction: 0, evidence: ['t2'], status: 'contested', courtSessionId: 'court-1',
    });

    store.putDivergence({
      id: 'div-1',
      subjectId: SUBJECT,
      courtSessionId: 'court-1',
      topic: '守时',
      type: 'factual',
      positions: [
        { witnessId: 'w1', claimId: 'c1', summary: '从不迟到' },
        { witnessId: 'w2', claimId: 'c2', summary: '经常迟到' },
      ],
      resolution: 'unresolved',
    });

    const { systemPrompt, meta } = await assemblePersonaContext(SUBJECT, store);

    expect(systemPrompt).toContain('说法不一的事');
    expect(systemPrompt).toContain('守时');
    expect(systemPrompt).toContain('不主动断言任何一方的说法');
    expect(meta.divergenceCount).toBe(1);
  });

  it('round-robin episodes by witness when no query is given', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '发小');
    addWitness(store, 'w2', '前上司');
    addWitness(store, 'w3', '母亲');
    addTestimony(store, 't1', 'w1',
      '有一次他帮我搬家。他请我吃了大餐。他还借了我两万。');
    addTestimony(store, 't2', 'w2',
      '他在公司加班到凌晨。他评审会上一言不发。');
    addTestimony(store, 't3', 'w3',
      '他给我转了五千块。');
    addClaim(store, 'c1', '林默很忠诚。', ['t1'], 0.8, {
      witnessIds: ['w1'],
      episodeIds: ['ep-w1-1', 'ep-w1-2', 'ep-w1-3'],
    });
    addClaim(store, 'c2', '林默工作拼命。', ['t2'], 0.8, {
      witnessIds: ['w2'],
      episodeIds: ['ep-w2-1', 'ep-w2-2'],
    });
    addClaim(store, 'c3', '林默孝顺。', ['t3'], 0.8, {
      witnessIds: ['w3'],
      episodeIds: ['ep-w3-1'],
    });

    // Add episodes from each witness
    for (const [id, wid, tid, text] of [
      ['ep-w1-1', 'w1', 't1', '有一次他帮我搬家'],
      ['ep-w1-2', 'w1', 't1', '他请我吃了大餐'],
      ['ep-w1-3', 'w1', 't1', '他还借了我两万'],
      ['ep-w2-1', 'w2', 't2', '他在公司加班到凌晨'],
      ['ep-w2-2', 'w2', 't2', '他评审会上一言不发'],
      ['ep-w3-1', 'w3', 't3', '他给我转了五千块'],
    ] as const) {
      store.putEpisode({
        id, subjectId: SUBJECT, witnessId: wid, testimonyId: tid,
        qid: 'q1', text, elicited: false,
      });
    }

    const { systemPrompt } = await assemblePersonaContext(SUBJECT, store);

    // All three witnesses should have episodes in the prompt
    expect(systemPrompt).toContain('发小');
    expect(systemPrompt).toContain('前上司');
    expect(systemPrompt).toContain('母亲');

    // Check that episodes from different witnesses appear in round-robin order
    // (w1's first, then w2's first, then w3's first, then w1's second, etc.)
    const ep1Pos = systemPrompt.indexOf('有一次他帮我搬家');
    const ep2Pos = systemPrompt.indexOf('他在公司加班到凌晨');
    const ep3Pos = systemPrompt.indexOf('他给我转了五千块');
    expect(ep1Pos).toBeGreaterThan(-1);
    expect(ep2Pos).toBeGreaterThan(-1);
    expect(ep3Pos).toBeGreaterThan(-1);

    // Each witness's first episode should come before any witness's third
    const ep1Third = systemPrompt.indexOf('他还借了我两万');
    expect(ep3Pos).toBeLessThan(ep1Third);
  });
});
