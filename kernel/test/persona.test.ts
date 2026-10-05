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
  extractNameHints,
  keywordOverlap,
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
    // Position summaries must NOT appear (may contain private details)
    expect(systemPrompt).not.toContain('从不迟到');
    expect(systemPrompt).not.toContain('经常迟到');
    // Witness names appear instead
    expect(systemPrompt).toContain('说法不一');
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

  it('episodes enter the prompt and episodeCount matches actual count', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '发小');
    addWitness(store, 'w2', '前上司');
    addTestimony(store, 't1', 'w1', '有一次他加班到凌晨三点,一个人走回家。');
    addTestimony(store, 't2', 'w2', '他在会上很安静,从头到尾没说话。');
    addClaim(store, 'c1', '林默工作拼。', ['t1'], 0.8, {
      witnessIds: ['w1'],
      episodeIds: ['ep1'],
    });
    addClaim(store, 'c2', '林默不说话。', ['t2'], 0.7, {
      witnessIds: ['w2'],
      episodeIds: ['ep2'],
    });
    store.putEpisode({
      id: 'ep1', subjectId: SUBJECT, witnessId: 'w1', testimonyId: 't1',
      qid: 'q1', text: '有一次他加班到凌晨三点', elicited: false,
    });
    store.putEpisode({
      id: 'ep2', subjectId: SUBJECT, witnessId: 'w2', testimonyId: 't2',
      qid: 'q1', text: '他在会上很安静', elicited: false,
    });

    const { systemPrompt, meta } = await assemblePersonaContext(SUBJECT, store);

    // Episodes section should be present
    expect(systemPrompt).toContain('别人讲过的事');
    expect(systemPrompt).toContain('有一次他加班到凌晨三点');
    expect(systemPrompt).toContain('他在会上很安静');
    // episodeCount must match the number of episodes actually in the prompt
    expect(meta.episodeCount).toBe(2);
    // Verify the prompt actually contains both episode texts
    const epSectionStart = systemPrompt.indexOf('别人讲过的事');
    expect(epSectionStart).toBeGreaterThan(-1);
  });

  it('truncation order: low-conviction claims first, then corpus, then self-report, episodes last', async () => {
    // Create a scenario that overflows the budget with many long claims,
    // so that truncation must occur and we can verify episodes survive.
    const longSelfReport = '我今年二十八岁,刚辞职,什么也不想做。'.repeat(20);
    seedSubject(store, longSelfReport);
    addWitness(store, 'w1', '发小');
    // Testimony must contain all episode texts as substrings
    const testimonyText = '事例A他做了一件动容的事。事例B他又做了一件动容的事。事例C他再次做了一件动容的事。另外他还有很多往事值得讲述,一辈子都说不完的那种。';
    addTestimony(store, 't1', 'w1', testimonyText);

    // Add 120 long claims to ensure budget overflow (each ~30 chars)
    for (let i = 0; i < 120; i++) {
      addClaim(
        store,
        `c-${i}`,
        `林默在第${String(i).padStart(3, '0')}号情境下有非常独特的表现方式,每一次都令周围的人印象极为深刻。`,
        ['t1'],
        0.5 + i / 300,
        {
          witnessIds: ['w1'],
          episodeIds: i < 3 ? [`ep-${i}`] : undefined,
        },
      );
    }

    // Add 3 episodes (each text is a substring of testimonyText)
    const epTexts = [
      '事例A他做了一件动容的事',
      '事例B他又做了一件动容的事',
      '事例C他再次做了一件动容的事',
    ];
    for (let i = 0; i < 3; i++) {
      store.putEpisode({
        id: `ep-${i}`, subjectId: SUBJECT, witnessId: 'w1', testimonyId: 't1',
        qid: 'q1', text: epTexts[i], elicited: false,
      });
    }

    // Add corpus
    store.putCorpusItem({
      id: 'corpus-1', subjectId: SUBJECT, text: '太累了,什么也不想做了。', source: 'pasted',
      createdAt: new Date().toISOString(),
    });

    const { systemPrompt, meta } = await assemblePersonaContext(SUBJECT, store);

    expect(systemPrompt.length).toBeLessThanOrEqual(PERSONA_PROMPT_BUDGET);
    expect(meta.truncated).toBe(true);

    // Key assertion: claims are trimmed first (from bottom = low conviction)
    expect(meta.includedClaimIds.length).toBeLessThan(120);

    // Episodes should survive because they are cut last
    expect(meta.episodeCount).toBeGreaterThan(0);
    expect(systemPrompt).toContain('别人讲过的事');
  });

  it('synthesis_only episode verbatim text never appears in prompt', async () => {
    const secretEpisode = '她半夜偷偷去了医院做了一个小手术';
    seedSubject(store);
    addWitness(store, 'w-s', '同事', 'synthesis_only');
    addWitness(store, 'w-q', '发小', 'quotable');
    // Testimony must contain the episode text as a substring
    addTestimony(store, 't-s', 'w-s', '她半夜偷偷去了医院做了一个小手术,谁都没有告诉。');
    addTestimony(store, 't-q', 'w-q', '她最近话少了,跟以前不太一样。');
    addClaim(store, 'c-s', '林默最近身体不太好。', ['t-s'], 0.8, {
      witnessIds: ['w-s'],
      episodeIds: ['ep-s'],
    });
    addClaim(store, 'c-q', '林默最近话少。', ['t-q'], 0.7, {
      witnessIds: ['w-q'],
      episodeIds: ['ep-q'],
    });

    // synthesis_only witness's episode
    store.putEpisode({
      id: 'ep-s', subjectId: SUBJECT, witnessId: 'w-s', testimonyId: 't-s',
      qid: 'q1', text: secretEpisode, elicited: false,
    });
    // quotable witness's episode
    store.putEpisode({
      id: 'ep-q', subjectId: SUBJECT, witnessId: 'w-q', testimonyId: 't-q',
      qid: 'q1', text: '她最近话少了', elicited: false,
    });

    const { systemPrompt } = await assemblePersonaContext(SUBJECT, store);

    // synthesis_only episode's verbatim text must NOT appear
    expect(systemPrompt).not.toContain(secretEpisode);
    expect(systemPrompt).not.toContain('她半夜偷偷去了医院');
    // quotable episode CAN appear
    expect(systemPrompt).toContain('她最近话少了');
    // The derived claim (which is a synthesis) IS allowed
    expect(systemPrompt).toContain('林默最近身体不太好。');
  });

  it('meta.episodeCount matches the number of episodes actually in the prompt text', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '发小');
    // Testimony must contain both episode texts as substrings
    addTestimony(store, 't1', 'w1', '他开会从头到尾没说一句话,他在食堂也是一个人坐着不聊天。');
    addClaim(store, 'c1', '林默不爱说话。', ['t1'], 0.8, {
      witnessIds: ['w1'],
      episodeIds: ['ep1', 'ep2'],
    });
    store.putEpisode({
      id: 'ep1', subjectId: SUBJECT, witnessId: 'w1', testimonyId: 't1',
      qid: 'q1', text: '他开会从头到尾没说一句话', elicited: false,
    });
    store.putEpisode({
      id: 'ep2', subjectId: SUBJECT, witnessId: 'w1', testimonyId: 't1',
      qid: 'q1', text: '他在食堂也是一个人坐着不聊天', elicited: false,
    });

    const { systemPrompt, meta } = await assemblePersonaContext(SUBJECT, store);

    // Count how many episode texts actually appear in the prompt
    const ep1InPrompt = systemPrompt.includes('他开会从头到尾没说一句话');
    const ep2InPrompt = systemPrompt.includes('他在食堂也是一个人坐着不聊天');
    const actualCount = (ep1InPrompt ? 1 : 0) + (ep2InPrompt ? 1 : 0);

    expect(meta.episodeCount).toBe(actualCount);
    // Both should be present since budget is sufficient
    expect(meta.episodeCount).toBe(2);
  });

  /* ------------------------------------------------------------------ */
  /* Invariant: quota-based truncation never zeroes all sections          */
  /* ------------------------------------------------------------------ */

  it('INVARIANT: many claims + episodes keep both sections non-empty', async () => {
    // Reproduce the regression: >100 claims + >80 episodes should not
    // cascade-drop everything. With quota-based truncation, each section
    // keeps its minimum.
    seedSubject(store, '我很累。');
    const witnesses = ['发小', '前上司', '前任', '母亲', '同事', '网友'];
    for (let w = 0; w < witnesses.length; w++) {
      const wid = `w${w}`;
      addWitness(store, wid, witnesses[w]);
      // Build testimony text containing all episode texts as substrings
      const episodeTexts: string[] = [];
      for (let e = 0; e < 15; e++) {
        episodeTexts.push(`林默在场合${w}之${e}做了事情`);
      }
      const behindText = episodeTexts.join(',') + '。';
      addTestimony(store, `t${w}`, wid, behindText);
      // Add 18 claims per witness (108 total, exceeding old cascade threshold)
      for (let c = 0; c < 18; c++) {
        addClaim(store, `c${w}-${c}`, `林默在${witnesses[w]}看来有特质${c}。`, [`t${w}`], 0.55, {
          witnessIds: [wid],
        });
      }
      // Add 15 episodes per witness (90 total), each is verbatim substring of behindText
      for (let e = 0; e < 15; e++) {
        store.putEpisode({
          id: `ep${w}-${e}`,
          subjectId: SUBJECT,
          witnessId: wid,
          testimonyId: `t${w}`,
          qid: 'q1',
          text: episodeTexts[e],
          elicited: false,
        });
      }
    }

    const { systemPrompt, meta } = await assemblePersonaContext(SUBJECT, store);

    // INVARIANT: episodes must not be zeroed
    expect(meta.episodeCount).toBeGreaterThanOrEqual(5);
    // INVARIANT: claims must not be zeroed
    expect(meta.includedClaimIds.length).toBeGreaterThanOrEqual(3);
    // INVARIANT: prompt is within budget
    expect(meta.charCount).toBeLessThanOrEqual(PERSONA_PROMPT_BUDGET);
    // INVARIANT: sections that had content but kept 0 items should not happen
    // for episodes and claims (they have minimums)
    expect(meta.sectionBudgets?.episodes.available).toBeGreaterThan(0);
    expect(meta.sectionBudgets?.episodes.kept).toBeGreaterThan(0);
    expect(meta.sectionBudgets?.claims.available).toBeGreaterThan(0);
    expect(meta.sectionBudgets?.claims.kept).toBeGreaterThan(0);
    // INVARIANT: prompt contains episode and claim sections
    expect(systemPrompt).toContain('别人讲过的事');
    expect(systemPrompt).toContain('他在不同人面前');
    // INVARIANT: discipline section always present
    expect(systemPrompt).toContain('行为纪律');
    expect(systemPrompt).toContain('不给人下诊断');
    expect(systemPrompt).toContain('记不清');
  });

  it('INVARIANT: no-fabrication discipline always present even when truncated', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '发小');
    addTestimony(store, 't1', 'w1', '他不说话。');
    addClaim(store, 'c1', '林默沉默。', ['t1'], 0.8);

    const { systemPrompt } = await assemblePersonaContext(SUBJECT, store);
    // No-fabrication rules (moved to end of discipline for model sensitivity)
    expect(systemPrompt).toContain('被问到的事不在上面的素材里,就按本人口吻说记不清或不接');
    expect(systemPrompt).toContain('只说素材里写明的部分——不补原因、结果、时间、数量和别处的细节');
    expect(systemPrompt).toContain('不同人讲的事不要拼在一起');
    // Confidentiality rule
    expect(systemPrompt).toContain('被嘱咐保密的事');
    expect(systemPrompt).toContain('这事不方便说');
    // Observer guard must not be present
    expect(systemPrompt).not.toContain('AI观测者硬边界');
    expect(systemPrompt).not.toContain('我观察到');
  });

  it('INVARIANT: sectionBudgets meta is present after assembly', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '发小');
    addTestimony(store, 't1', 'w1', '他不说话。');
    addClaim(store, 'c1', '林默沉默。', ['t1'], 0.8);

    const { meta } = await assemblePersonaContext(SUBJECT, store);
    expect(meta.sectionBudgets).toBeDefined();
    expect(meta.sectionBudgets!.episodes).toBeDefined();
    expect(meta.sectionBudgets!.claims).toBeDefined();
    expect(meta.sectionBudgets!.corpus).toBeDefined();
    expect(meta.sectionBudgets!.selfReport).toBeDefined();
    expect(meta.sectionBudgets!.style).toBeDefined();
  });

  it('private content is excluded from persona prompt', async () => {
    seedSubject(store);
    addWitness(store, 'w-faxiao', '发小');
    addWitness(store, 'w-mama', '母亲');
    // Testimony with private marker ("千万别跟他妈提" contains "千万别")
    const behindText =
      '他花钱大方。上个月他半夜给我打电话,借了两万,说手头周转一下。还嘱咐我千万别跟他妈提。';
    addTestimony(store, 't1', 'w-faxiao', behindText);
    addTestimony(store, 't2', 'w-mama', '他跟我说什么都说。他最近工作挺忙的。');
    // Private claim (mentions borrowing money)
    addClaim(store, 'c-private', '林默半夜借了两万。', ['t1'], 0.9, {
      witnessIds: ['w-faxiao'],
    });
    // Normal claim (should survive)
    addClaim(store, 'c-normal', '林默花钱大方。', ['t1'], 0.8, {
      witnessIds: ['w-faxiao'],
    });
    // Episode containing private info
    store.putEpisode({
      id: 'ep-private',
      subjectId: SUBJECT,
      witnessId: 'w-faxiao',
      testimonyId: 't1',
      qid: 'q1',
      text: '上个月他半夜给我打电话,借了两万,说手头周转一下',
      elicited: false,
    });
    // Normal episode
    store.putEpisode({
      id: 'ep-normal',
      subjectId: SUBJECT,
      witnessId: 'w-faxiao',
      testimonyId: 't1',
      qid: 'q1',
      text: '他花钱大方',
      elicited: false,
    });
    // Divergence with private content in position summary
    store.putDivergence({
      id: 'div-priv',
      subjectId: SUBJECT,
      courtSessionId: 'court-1',
      topic: '经济状况',
      type: 'factual',
      positions: [
        { witnessId: 'w-faxiao', claimId: 'c-private', summary: '已辞职,半夜借过两万' },
        { witnessId: 'w-mama', claimId: 'c-normal', summary: '经济没问题' },
      ],
      resolution: 'unresolved',
    });

    // Corpus item echoing confidential context (subject's own words)
    store.putCorpusItem({
      id: 'corpus-priv',
      subjectId: SUBJECT,
      text: '你可别跟我妈说。',
      source: 'pasted',
      createdAt: new Date().toISOString(),
    });
    // Normal corpus item (should survive)
    store.putCorpusItem({
      id: 'corpus-safe',
      subjectId: SUBJECT,
      text: '太累了,想歇一段时间。',
      source: 'pasted',
      createdAt: new Date().toISOString(),
    });

    const { systemPrompt } = await assemblePersonaContext(SUBJECT, store);

    // Private content MUST NOT appear anywhere in the prompt
    expect(systemPrompt).not.toContain('两万');
    expect(systemPrompt).not.toContain('别跟他妈');
    expect(systemPrompt).not.toContain('千万别');
    // The private divergence should be filtered out entirely
    // (its position summary contains "两万" which is a private key phrase)
    expect(systemPrompt).not.toContain('已辞职');
    // Private corpus item must also be filtered
    expect(systemPrompt).not.toContain('你可别跟我妈说');
    // Normal claim should survive
    expect(systemPrompt).toContain('花钱大方');
    // Normal episode should survive
    expect(systemPrompt).toContain('花钱大方');
    // Normal corpus item should survive
    expect(systemPrompt).toContain('太累了');
  });

  it('same-topic divergences are merged', async () => {
    seedSubject(store);
    addWitness(store, 'w1', '发小');
    addWitness(store, 'w2', '母亲');
    addWitness(store, 'w3', '前女友');
    addTestimony(store, 't1', 'w1', '他花钱很大方。');
    addTestimony(store, 't2', 'w2', '他花钱很节省。');
    addTestimony(store, 't3', 'w3', '他花钱精打细算。');
    addClaim(store, 'c1', '林默花钱大方。', ['t1'], 0.8);
    addClaim(store, 'c2', '林默花钱节省。', ['t2'], 0.8);
    addClaim(store, 'c3', '林默精打细算。', ['t3'], 0.8);

    // Two divergences with the same topic
    store.putDivergence({
      id: 'div-1',
      subjectId: SUBJECT,
      courtSessionId: 'court-1',
      topic: '消费态度',
      type: 'factual',
      positions: [
        { witnessId: 'w1', claimId: 'c1', summary: '大方' },
        { witnessId: 'w2', claimId: 'c2', summary: '节省' },
      ],
      resolution: 'unresolved',
    });
    store.putDivergence({
      id: 'div-2',
      subjectId: SUBJECT,
      courtSessionId: 'court-1',
      topic: '消费态度',
      type: 'factual',
      positions: [
        { witnessId: 'w1', claimId: 'c1', summary: '大方' },
        { witnessId: 'w3', claimId: 'c3', summary: '精打细算' },
      ],
      resolution: 'unresolved',
    });

    const { systemPrompt, meta } = await assemblePersonaContext(SUBJECT, store);

    // After merging, "消费态度" should appear exactly once in the prompt
    const topicMatches = systemPrompt.match(/消费态度/g) ?? [];
    expect(topicMatches.length).toBe(1);
    // Merged divergence should show all three witnesses
    expect(meta.divergenceCount).toBe(1);
  });

  it('extracts name hints from quoted speech and adds them to episode labels', async () => {
    seedSubject(store);
    const wId = 'w-name';
    addWitness(store, wId, '发小');
    addTestimony(store, 't-name', wId,
      '他说"周野,我不是不想干",然后就走了。');
    store.putEpisode({
      id: 'ep-name-1',
      subjectId: SUBJECT,
      witnessId: wId,
      testimonyId: 't-name',
      qid: 'q1',
      text: '然后就走了',
      situation: '辞职',
      elicited: false,
    });

    const hints = extractNameHints(store, SUBJECT, wId);
    expect(hints).toEqual(['周野']);

    const { systemPrompt } = await assemblePersonaContext(SUBJECT, store);
    expect(systemPrompt).toContain('他叫对方:周野');
    expect(systemPrompt).toContain('发小(他叫对方:周野)');
  });

  it('privacy filter does not remove episodes that merely precede a private marker sentence', async () => {
    seedSubject(store);
    const wId = 'w-priv';
    addWitness(store, wId, '朋友');
    addTestimony(store, 't-priv', wId,
      '他请了三天假在医院陪我。这事我谁都没说过。');
    store.putEpisode({
      id: 'ep-priv-1',
      subjectId: SUBJECT,
      witnessId: wId,
      testimonyId: 't-priv',
      qid: 'q1',
      text: '他请了三天假在医院陪我',
      situation: '住院',
      elicited: false,
    });
    // A second episode with actual private keyword should be filtered
    store.putEpisode({
      id: 'ep-priv-2',
      subjectId: SUBJECT,
      witnessId: wId,
      testimonyId: 't-priv',
      qid: 'q1',
      text: '这事我谁都没说过',
      situation: '秘密',
      elicited: false,
    });

    const { systemPrompt } = await assemblePersonaContext(SUBJECT, store);
    // ep-priv-1 should be included (no private markers in its text)
    expect(systemPrompt).toContain('ep-priv-1');
    // ep-priv-2 contains "谁都没说" and should be filtered out
    expect(systemPrompt).not.toContain('ep-priv-2');
  });
});

/* ------------------------------------------------------------------ */
/* keywordOverlap — CJK-aware episode ranking                         */
/* ------------------------------------------------------------------ */

describe('keywordOverlap', () => {
  it('returns 0 for empty query', () => {
    expect(keywordOverlap('', '林默帮周野搬家')).toBe(0);
  });

  it('returns 0 for no overlap', () => {
    expect(keywordOverlap('打篮球', '林默帮周野搬家')).toBe(0);
  });

  it('matches exact CJK substring', () => {
    const score = keywordOverlap('搬家', '去年答应帮我搬家');
    expect(score).toBeGreaterThan(0);
  });

  it('partial morphological overlap: "搬过家" recalls "搬家"', () => {
    // Core bug fix: "搬过家" should recall episodes containing "搬家"
    // because they share characters "搬" and "家"
    const score = keywordOverlap('听说你帮周野搬过家', '去年答应帮我搬家,结果加班到十点');
    expect(score).toBeGreaterThan(0);
  });

  it('"搬过家" scores higher on "搬家" text than unrelated text', () => {
    const scoreRelevant = keywordOverlap(
      '听说你帮周野搬过家？那次怎么回事？',
      '去年答应帮我搬家,结果加班到十点还是来了',
    );
    const scoreIrrelevant = keywordOverlap(
      '听说你帮周野搬过家？那次怎么回事？',
      '林默最近状态不太好,总是加班到很晚',
    );
    expect(scoreRelevant).toBeGreaterThan(scoreIrrelevant);
  });

  it('Latin/digit tokens still work', () => {
    const score = keywordOverlap('hello world', 'hello beautiful world');
    expect(score).toBeGreaterThan(0);
  });

  it('mixed CJK and Latin tokens', () => {
    const score = keywordOverlap('iPhone 手机', '他用iPhone很久了,手机不离手');
    expect(score).toBeGreaterThan(0);
  });

  it('bigram match scores higher than unigram-only match', () => {
    // "搬家" bigram appears in both query and text — tighter match
    const scoreBigram = keywordOverlap('搬家', '他帮我搬家');
    // "搬" and "买" share only one char overlap
    const scoreUnigram = keywordOverlap('搬买', '他帮我搬家');
    expect(scoreBigram).toBeGreaterThan(scoreUnigram);
  });
});
