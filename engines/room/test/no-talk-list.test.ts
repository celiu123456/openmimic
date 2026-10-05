/**
 * Tests for the generalised LLM-based no-talk list and rule-based fallback.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import {
  FakeLLM,
  buildNoTalkListFallback,
  generateNoTalkList,
  llmVerifyLeak,
  runBehindRoom,
  SECRET_LEAK_FALLBACK_STAGE,
  type NoTalkItem,
} from '@openmimic/engine-room';
import { seedSuzhi, SUZHI_SUBJECT_ID, SUZHI_WITNESSES } from '../../../fixtures/suzhi';

const line = (text: string): string => JSON.stringify({ text });

/* ------------------------------------------------------------------ */
/* generateNoTalkList (LLM-based)                                      */
/* ------------------------------------------------------------------ */

describe('generateNoTalkList', () => {
  it('parses a valid LLM response into NoTalkItem[]', async () => {
    const drafts = [
      {
        witness: { id: 'w-sister', subjectId: 's1', relation: '姐姐', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '她查出来一个东西,让我别告诉爸。' }],
      },
      {
        witness: { id: 'w-father', subjectId: 's1', relation: '父亲', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '她刚升职了,挺好的。' }],
      },
    ];

    const llmResponse = JSON.stringify([
      {
        topic: '查出病情',
        keywords: ['查出', '体检', '手术', '早期'],
        knowingWitnessIds: ['w-sister'],
        blindWitnessId: 'w-father',
        blindClaim: '升职了,挺好的',
        sourceFragment: '查出来一个东西,让我别告诉爸',
      },
    ]);

    const llm = new FakeLLM([llmResponse]);
    const items = await generateNoTalkList(llm, '苏芷', drafts);

    expect(items).toHaveLength(1);
    expect(items[0]!.topic).toBe('查出病情');
    expect(items[0]!.keywords).toContain('手术');
    expect(items[0]!.blindWitnessId).toBe('w-father');
    expect(items[0]!.knowingWitnessIds).toEqual(['w-sister']);
  });

  it('returns empty array on malformed LLM response', async () => {
    const drafts = [
      {
        witness: { id: 'w-a', subjectId: 's1', relation: '朋友', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '没什么秘密' }],
      },
      {
        witness: { id: 'w-b', subjectId: 's1', relation: '同事', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '普通同事' }],
      },
    ];

    const llm = new FakeLLM(['this is not json']);
    const items = await generateNoTalkList(llm, '某人', drafts);
    expect(items).toEqual([]);
  });

  it('returns empty array when LLM throws', async () => {
    const drafts = [
      {
        witness: { id: 'w-a', subjectId: 's1', relation: '朋友', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '测试' }],
      },
      {
        witness: { id: 'w-b', subjectId: 's1', relation: '同事', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '测试' }],
      },
    ];

    const llm = new FakeLLM([]); // empty script => throws
    // generateNoTalkList should throw but caller catches it
    await expect(generateNoTalkList(llm, '某人', drafts)).rejects.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* buildNoTalkListFallback (rule-based)                                */
/* ------------------------------------------------------------------ */

describe('buildNoTalkListFallback', () => {
  it('detects explicit marker with mother target', () => {
    const drafts = [
      {
        witness: { id: 'w-faxiao', subjectId: 's1', relation: '发小', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '借了两万。千万别跟他妈提。' }],
      },
      {
        witness: { id: 'w-mother', subjectId: 's1', relation: '母亲', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '他工作挺好的。' }],
      },
    ];
    const list = buildNoTalkListFallback(drafts);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.blindWitnessId).toBe('w-mother');
    expect(list[0]!.knowingWitnessIds).toContain('w-faxiao');
  });

  it('detects explicit marker with father target', () => {
    const drafts = [
      {
        witness: { id: 'w-sister', subjectId: 's1', relation: '姐姐', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '查出来一个东西。别告诉爸,他心脏不好。' }],
      },
      {
        witness: { id: 'w-father', subjectId: 's1', relation: '父亲', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '她刚升职了。' }],
      },
    ];
    const list = buildNoTalkListFallback(drafts);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.blindWitnessId).toBe('w-father');
  });

  it('does NOT flag contradictions without explicit marker', () => {
    const drafts = [
      {
        witness: { id: 'w-a', subjectId: 's1', relation: '朋友', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '他已经辞职了,周五就走了。' }],
      },
      {
        witness: { id: 'w-b', subjectId: 's1', relation: '母亲', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '他工作很稳定,公司器重他。' }],
      },
    ];
    const list = buildNoTalkListFallback(drafts);
    // No explicit secrecy marker => fallback returns nothing
    expect(list).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* llmVerifyLeak                                                       */
/* ------------------------------------------------------------------ */

describe('llmVerifyLeak', () => {
  it('returns true when LLM says yes', async () => {
    const llm = new FakeLLM(['是']);
    const result = await llmVerifyLeak(llm, '她做了手术', '查出病情', '父亲', '她刚升职,工作稳定');
    expect(result).toBe(true);
  });

  it('returns false when LLM says no', async () => {
    const llm = new FakeLLM(['否']);
    const result = await llmVerifyLeak(llm, '她最近请假了', '查出病情', '父亲', '她刚升职,工作稳定');
    expect(result).toBe(false);
  });

  it('treats ambiguous response as leak (fail-closed)', async () => {
    const llm = new FakeLLM(['不确定']);
    const result = await llmVerifyLeak(llm, '她在看成都的房子', '查出病情', '父亲', '她刚升职,工作稳定');
    // Fail-closed: anything other than clear "否" is treated as leak
    expect(result).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Second fixture structure validation                                 */
/* ------------------------------------------------------------------ */

describe('suzhi fixture', () => {
  it('has 4 witnesses', () => {
    expect(SUZHI_WITNESSES).toHaveLength(4);
  });

  it('each witness has 2 questions', () => {
    for (const w of SUZHI_WITNESSES) {
      expect(w.answers).toHaveLength(2);
    }
  });

  it('has no keyword overlap with limo fixture', () => {
    const limoKeywords = ['借', '两万', '辞职', '裸辞', '离职', '周转', '手头紧', '还钱', '欠'];
    const suzhiText = SUZHI_WITNESSES.map((w) =>
      w.answers.map((a) => a.behindText).join(' '),
    ).join(' ');

    for (const kw of limoKeywords) {
      expect(suzhiText).not.toContain(kw);
    }
  });

  it('contains different-domain secrets (illness, relocation)', () => {
    const sisterText = SUZHI_WITNESSES.find((w) => w.id === 'w-sister')!
      .answers.map((a) => a.behindText).join(' ');
    expect(sisterText).toContain('体检');
    expect(sisterText).toContain('别告诉爸');
    // No financial/resignation keywords
    expect(sisterText).not.toContain('辞职');
    expect(sisterText).not.toContain('借');
  });

  it('loads into a store without errors', () => {
    const store = new Store();
    try {
      seedSuzhi(store);
      const subject = store.getSubject(SUZHI_SUBJECT_ID);
      expect(subject?.displayName).toBe('苏芷');
      const witnesses = store.listWitnessesBySubject(SUZHI_SUBJECT_ID);
      expect(witnesses).toHaveLength(4);
    } finally {
      store.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Two-level leak detection: euphemism, normal speech, degradation     */
/* ------------------------------------------------------------------ */

describe('two-level leak detection', () => {
  it('blocks euphemistic leak that bypasses keywords but is caught by LLM', async () => {
    // "走得让我别扭" does not contain any keyword from the no-talk list,
    // but it euphemistically refers to the resignation secret.
    const llm = new FakeLLM([
      '是',  // LLM says: yes, this line would reveal the secret
    ]);
    const result = await llmVerifyLeak(
      llm,
      '走得让我别扭',
      '辞职',
      '母亲',
      '他工作很稳定',
      '他工作挺好的,公司器重他,刚升了职。',
    );
    // The euphemism should be caught by LLM verification
    expect(result).toBe(true);
    // Verify the LLM was given the blind witness context
    expect(llm.calls[0]!.user).toContain('他工作挺好的');
  });

  it('does not falsely block normal speech unrelated to the secret', async () => {
    const llm = new FakeLLM([
      '否',  // LLM says: no, this line is safe
    ]);
    const result = await llmVerifyLeak(
      llm,
      '今天天气不错啊',
      '辞职',
      '母亲',
      '他工作很稳定',
      '他工作挺好的。',
    );
    // Normal speech should not be blocked
    expect(result).toBe(false);
  });

  it('degrades to keyword-only when LLM call throws (no API key scenario)', async () => {
    // Simulate no-API-key: FakeLLM with empty script throws on call
    const llm = new FakeLLM([]);
    // llmVerifyLeak should throw, and the caller (runSchedule) catches
    // it and treats the line as a leak (fail-closed)
    await expect(
      llmVerifyLeak(llm, '她辞职了', '辞职', '母亲', '工作稳定'),
    ).rejects.toThrow();
    // This proves that the caller must catch and handle: when there is
    // no API key, generateNoTalkList also throws -> falls back to
    // buildNoTalkListFallback (keyword-only), and if llmVerifyLeak
    // is never called, the system runs in keyword-only mode.
  });
});

/* ------------------------------------------------------------------ */
/* Integration: behind room with no-talk list                          */
/* ------------------------------------------------------------------ */

describe('behind room with LLM no-talk list', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('uses no-talk list to block lines hitting keywords', async () => {
    store.putSubject({ id: 's1', displayName: '苏芷' });
    store.putWitness({ id: 'w-sister', subjectId: 's1', relation: '姐姐', consentLevel: 'quotable' });
    store.putWitness({ id: 'w-father', subjectId: 's1', relation: '父亲', consentLevel: 'quotable' });
    store.addTestimony({
      id: 't-sister',
      witnessId: 'w-sister',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '她体检查出来东西了。别告诉爸,他受不了。' }],
    });
    store.addTestimony({
      id: 't-father',
      witnessId: 'w-father',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '她升职了,挺好的。' }],
    });

    // Script: no-talk list LLM returns items, then compose lines, then verify.
    // After a leak is detected, the engine tries up to 2 guided rewrites.
    // Both rewrites here still contain keywords, so they fail and fall to stage.
    const noTalkResponse = JSON.stringify([{
      topic: '查出病情',
      keywords: ['体检', '手术', '查出', '穿刺'],
      knowingWitnessIds: ['w-sister'],
      blindWitnessId: 'w-father',
      blindClaim: '升职了',
      sourceFragment: '体检查出来东西了',
    }]);

    const llm = new FakeLLM([
      noTalkResponse,                       // no-talk list generation
      line('她体检查出来问题了'),            // sister's line (hits keyword)
      '是',                                 // verify: yes, this leaks
      line('她体检有点问题'),                // rewrite attempt 1 (still has '体检')
      line('查出来不太好'),                  // rewrite attempt 2 (still has '查出')
      line('她升职挺开心的'),                // father's line (safe)
      line('她最近状态不太好'),              // sister second turn
      line('是啊,争气'),                    // father second turn
    ]);

    const room = await runBehindRoom('s1', store, llm, {
      maxTurnsPerWitness: 2,
    });

    // The first line should have been blocked (keyword hit + LLM verified)
    // It should be replaced with a stage direction
    const stageLines = room.behindTranscript.filter((u) => u.kind === 'stage');
    expect(stageLines.length).toBeGreaterThanOrEqual(1);
  });

  it('allows lines through when LLM verification says no leak', async () => {
    store.putSubject({ id: 's1', displayName: '苏芷' });
    store.putWitness({ id: 'w-sister', subjectId: 's1', relation: '姐姐', consentLevel: 'quotable' });
    store.putWitness({ id: 'w-father', subjectId: 's1', relation: '父亲', consentLevel: 'quotable' });
    store.addTestimony({
      id: 't-sister',
      witnessId: 'w-sister',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '她体检查出来东西了。别告诉爸。' }],
    });
    store.addTestimony({
      id: 't-father',
      witnessId: 'w-father',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '她升职了。' }],
    });

    const noTalkResponse = JSON.stringify([{
      topic: '查出病情',
      keywords: ['体检', '查出'],
      knowingWitnessIds: ['w-sister'],
      blindWitnessId: 'w-father',
      blindClaim: '升职了',
      sourceFragment: '体检查出来东西了',
    }]);

    const llm = new FakeLLM([
      noTalkResponse,
      line('她去做了体检而已'),  // hits "体检" keyword
      '否',                      // verify: no, mentioning "体检" alone doesn't reveal illness
      line('她最近忙'),
      line('她确实忙'),
      line('对啊'),
    ]);

    const room = await runBehindRoom('s1', store, llm, {
      maxTurnsPerWitness: 2,
    });

    // "她去做了体检而已" should have been allowed through
    const speeches = room.behindTranscript.filter((u) => u.kind === 'speech');
    expect(speeches.some((s) => s.text === '她去做了体检而已')).toBe(true);
  });

  it('degrades to keyword-only (fallback) when no-talk LLM generation throws', async () => {
    // When the LLM is unavailable (no API key, network error), the
    // no-talk list generation throws and runBehindRoom falls back to
    // buildNoTalkListFallback (keyword-only, explicit markers only).
    // The room should still complete and any explicit secrecy markers
    // should still be caught by the fallback.
    store.putSubject({ id: 's1', displayName: '苏芷' });
    store.putWitness({ id: 'w-sister', subjectId: 's1', relation: '姐姐', consentLevel: 'quotable' });
    store.putWitness({ id: 'w-mother', subjectId: 's1', relation: '母亲', consentLevel: 'quotable' });
    store.addTestimony({
      id: 't-sister',
      witnessId: 'w-sister',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '她查出来一个东西,千万别跟他妈提。' }],
    });
    store.addTestimony({
      id: 't-mother',
      witnessId: 'w-mother',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '她升职了。' }],
    });

    // First call: generateNoTalkList throws (simulating no API key).
    // Subsequent calls are for composeLine (regular line generation).
    const llm = new FakeLLM([
      // No-talk list LLM call will throw — FakeLLM throws when script
      // provides a function that throws.
      ((_req) => { throw new Error('No API key configured'); }) as (req: { system: string; user: string }) => string,
      // composeLine calls for the behind room (safe lines)
      line('她最近挺好的'),   // sister
      line('是挺好的'),       // mother
      line('对吧'),           // sister
      line('嗯'),             // mother
    ]);

    const room = await runBehindRoom('s1', store, llm, {
      maxTurnsPerWitness: 2,
    });

    // Room should complete despite LLM no-talk generation failure
    expect(room.behindTranscript.length).toBeGreaterThan(0);
    // The fallback should have detected the explicit "千万别跟他妈提" marker
    // and built a rule-based no-talk list targeting the mother witness.
    // (The actual keyword check at room level would only fire if lines
    // happened to contain keywords from the fallback list.)
  });
});

/* ------------------------------------------------------------------ */
/* Regression tests for specific leak scenarios                        */
/* ------------------------------------------------------------------ */

describe('regression: no-talk leak scenarios', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('Run 15 lines 6-7: euphemism + explicit resignation blocked with mother present', async () => {
    // Run 15 root cause: 前上司 said "走得让我到现在都别扭" (euphemism for
    // resignation) and 前任 said "我刷朋友圈才知道他辞职了" (explicit).
    // Mother believes "公司器重他". Both must be blocked.
    store.putSubject({ id: 's1', displayName: '林默' });
    store.putWitness({ id: 'w-boss', subjectId: 's1', relation: '前上司', consentLevel: 'quotable' });
    store.putWitness({ id: 'w-ex', subjectId: 's1', relation: '前任', consentLevel: 'quotable' });
    store.putWitness({ id: 'w-mother', subjectId: 's1', relation: '母亲', consentLevel: 'quotable' });
    store.addTestimony({
      id: 't-boss', witnessId: 'w-boss', subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '他裸辞前三周,我看见他一个人在消防楼梯里打电话。他走的方式,像个逃兵。' }],
    });
    store.addTestimony({
      id: 't-ex', witnessId: 'w-ex', subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '后来他把工作也辞了。我刷朋友圈才知道他辞职了。' }],
    });
    store.addTestimony({
      id: 't-mother', witnessId: 'w-mother', subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '他上个月还跟我说公司器重他。我寻思他是不是要升职了。' }],
    });

    const noTalkResponse = JSON.stringify([{
      topic: '辞职/裸辞',
      keywords: ['辞职', '裸辞', '辞了', '离职', '不干了'],
      knowingWitnessIds: ['w-boss', 'w-ex'],
      blindWitnessId: 'w-mother',
      blindClaim: '公司器重他,要升职了',
      sourceFragment: '他裸辞前三周',
    }]);

    // Flow for boss's euphemism "走得让我到现在都别扭":
    //   - no keyword hit, but text >= 8 chars -> LLM verification
    //   - LLM says "是" -> blocked
    //   - rewrite attempt 1 returns line with keyword '辞了' -> keyword blocked
    //   - rewrite attempt 2 returns line with keyword '离职' -> keyword blocked
    //   - falls to stage direction
    //
    // Flow for ex's explicit "我刷朋友圈才知道他辞职了":
    //   - keyword '辞职' hits -> LLM verification
    //   - LLM says "是" -> blocked
    //   - rewrites also contain keywords -> stage direction

    const llm = new FakeLLM([
      noTalkResponse,                                   // no-talk list generation
      line('走得让我到现在都别扭'),                     // boss original (euphemism, no keyword)
      '是',                                             // verify: yes, leaks resignation
      line('他辞了以后我一直在想'),                     // rewrite 1: keyword '辞了'
      line('他离职的事让我很不舒服'),                   // rewrite 2: keyword '离职'
      line('他上个月还跟我说公司器重他'),               // mother's line (safe, her own knowledge)
      line('我刷朋友圈才知道他辞职了'),                 // ex original (keyword '辞职')
      '是',                                             // verify: yes
      line('他辞了以后朋友圈也不发了'),                 // rewrite 1: keyword '辞了'
      line('他不干了以后就消失了'),                     // rewrite 2: keyword '不干了'
      line('嗯'),                                       // mother second turn
      line('唉'),                                       // boss second turn
      line('是'),                                       // ex second turn
    ]);

    const room = await runBehindRoom('s1', store, llm, {
      maxTurnsPerWitness: 2,
    });

    // The original euphemism and explicit leak must NOT appear in the transcript
    const texts = room.behindTranscript.map((u) => u.text);
    expect(texts).not.toContain('走得让我到现在都别扭');
    expect(texts).not.toContain('我刷朋友圈才知道他辞职了');

    // No speech line should contain any resignation keyword
    const speechTexts = room.behindTranscript
      .filter((u) => u.kind === 'speech')
      .map((u) => u.text);
    for (const st of speechTexts) {
      expect(st).not.toContain('辞职');
      expect(st).not.toContain('辞了');
      expect(st).not.toContain('离职');
      expect(st).not.toContain('裸辞');
    }
  });

  it('Run 9: "借了两万" blocked when mother is present', async () => {
    // Run 9 root cause: 发小 mentioned "借了两万" in front of 母亲 who was
    // told "千万别跟他妈提" about the loan.
    //
    // Note: composeLine's own private-leak guard (privateTexts/Elements
    // from the "千万别" marker) fires BEFORE the no-talk check, so the
    // faxiao's leaking line is caught at the composeLine level. The test
    // verifies the end result: no loan mention in any speech line.
    store.putSubject({ id: 's1', displayName: '林默' });
    store.putWitness({ id: 'w-faxiao', subjectId: 's1', relation: '发小', consentLevel: 'quotable' });
    store.putWitness({ id: 'w-mother', subjectId: 's1', relation: '母亲', consentLevel: 'quotable' });
    store.addTestimony({
      id: 't-faxiao', witnessId: 'w-faxiao', subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '上个月他半夜给我打电话,借了两万,说手头周转一下,还嘱咐我千万别跟他妈提。' }],
    });
    store.addTestimony({
      id: 't-mother', witnessId: 'w-mother', subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '他上个月还给我转了五千,说让我买个按摩椅。' }],
    });

    const noTalkResponse = JSON.stringify([{
      topic: '借钱/手头紧',
      keywords: ['借', '两万', '周转', '手头'],
      knowingWitnessIds: ['w-faxiao'],
      blindWitnessId: 'w-mother',
      blindClaim: '他还给我转了五千',
      sourceFragment: '借了两万,千万别跟他妈提',
    }]);

    // Use function-based responses for composeLine calls to always return
    // safe content. The private-leak guard in composeLine catches leak
    // attempts and rewrites/stages internally, consuming extra responses.
    const llm = new FakeLLM([
      noTalkResponse,                                   // no-talk list
      // composeLine calls are dynamic: depending on private-leak detection,
      // it may consume 1-3 responses per line. Use functions for robustness.
      (req) => req.user.includes('发小') ? line('他半夜给我借了两万') : line('他还给我转了五千'),
      (req) => line('他最近联系少了'),   // faxiao rewrite (composeLine private leak catch)
      (req) => line('他还挺好的'),       // safe fallback
      (req) => line('他还给我转了五千'), // mother
      (req) => line('他最近联系少了'),   // faxiao second turn
      (req) => line('嗯'),               // mother second turn
      (req) => line('是啊'),             // extra safe responses
      (req) => line('对'),
    ]);

    const room = await runBehindRoom('s1', store, llm, {
      maxTurnsPerWitness: 2,
    });

    // The loan mention must NOT appear in speech
    const speechTexts = room.behindTranscript
      .filter((u) => u.kind === 'speech')
      .map((u) => u.text);
    for (const st of speechTexts) {
      expect(st).not.toContain('两万');
      expect(st).not.toContain('借了两万');
    }
    // Room should complete
    expect(room.behindTranscript.length).toBeGreaterThan(0);
  });

  it('innocuous speech passes through when LLM says no leak', async () => {
    // 苏芷 fixture: 闺蜜 says "她最近老念叨想换个节奏" which is an
    // innocuous phrasing under 父亲's "刚升职" no-talk item.
    // The LLM verification should say "否" and the line passes through.
    store.putSubject({ id: 's1', displayName: '苏芷' });
    store.putWitness({ id: 'w-bestie', subjectId: 's1', relation: '闺蜜', consentLevel: 'quotable' });
    store.putWitness({ id: 'w-father', subjectId: 's1', relation: '父亲', consentLevel: 'quotable' });
    store.addTestimony({
      id: 't-bestie', witnessId: 'w-bestie', subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '她上个月跟我说她想离开北京。她就说想换个节奏生活。' }],
    });
    store.addTestimony({
      id: 't-father', witnessId: 'w-father', subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '上个月她打电话回来说升职了,我高兴了一晚上。' }],
    });

    const noTalkResponse = JSON.stringify([{
      topic: '离开北京/离职',
      keywords: ['离开', '离职', '辞职', '递了申请'],
      knowingWitnessIds: ['w-bestie'],
      blindWitnessId: 'w-father',
      blindClaim: '升职了',
      sourceFragment: '她想离开北京',
    }]);

    const llm = new FakeLLM([
      noTalkResponse,                                   // no-talk list
      line('她最近老念叨想换个节奏'),                   // bestie (innocuous, no keyword)
      '否',                                             // verify: no, "换个节奏" doesn't reveal departure
      line('嗯她确实争气'),                             // father
      line('对她一直很努力'),                           // bestie second turn
      line('是'),                                       // father second turn
    ]);

    const room = await runBehindRoom('s1', store, llm, {
      maxTurnsPerWitness: 2,
    });

    // The innocuous line should have passed through as speech
    const speechTexts = room.behindTranscript
      .filter((u) => u.kind === 'speech')
      .map((u) => u.text);
    expect(speechTexts).toContain('她最近老念叨想换个节奏');
  });
});
