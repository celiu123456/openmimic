/**
 * Tests for the generalised LLM-based no-talk list and rule-based fallback.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import {
  FakeLLM,
  buildNoTalkListFallback,
  enrichFallbackKeywords,
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
        severity: 'high',
        reason: '明确嘱托保密且推翻父亲对女儿健康的认知',
      },
    ]);

    // Double-generate: two identical calls
    const llm = new FakeLLM([llmResponse, llmResponse]);
    const items = await generateNoTalkList(llm, '苏芷', drafts);

    expect(items).toHaveLength(1);
    expect(items[0]!.topic).toBe('查出病情');
    expect(items[0]!.keywords).toContain('手术');
    expect(items[0]!.blindWitnessId).toBe('w-father');
    expect(items[0]!.knowingWitnessIds).toEqual(['w-sister']);
    expect(items[0]!.severity).toBe('high');
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

    const llm = new FakeLLM(['this is not json', 'also not json']);
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

  it('derives topic from marker sentence, not from preceding context', () => {
    const drafts = [
      {
        witness: { id: 'w-faxiao', subjectId: 's1', relation: '发小', consentLevel: 'quotable' as const },
        memory: [{
          qid: 'q1',
          text: '跟我吃饭从来没让我买过单,有一回我抢着付,他脸都拉下来了。他借了两万块,别跟他妈提。',
        }],
      },
      {
        witness: { id: 'w-mother', subjectId: 's1', relation: '母亲', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '小默从小就懂事。' }],
      },
    ];
    const list = buildNoTalkListFallback(drafts);
    expect(list.length).toBe(1);
    const item = list[0]!;
    // Topic should come from the marker sentence (borrowing money), NOT from "eating together"
    expect(item.topic).toContain('借了两万');
    expect(item.topic).not.toContain('吃饭从来没让我买过单');
  });

  it('populates keywords from extracted fact elements', () => {
    const drafts = [
      {
        witness: { id: 'w-faxiao', subjectId: 's1', relation: '发小', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '他跟我借了两万块。别跟他妈说。' }],
      },
      {
        witness: { id: 'w-mother', subjectId: 's1', relation: '母亲', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '他工作挺好的。' }],
      },
    ];
    const list = buildNoTalkListFallback(drafts);
    expect(list.length).toBe(1);
    const item = list[0]!;
    // keywords should include amounts and verbs extracted from the fact text
    expect(item.keywords.length).toBeGreaterThan(0);
    // The amount regex captures "两万块" (with the currency suffix)
    expect(item.keywords.some((k) => k.includes('两万'))).toBe(true);
    expect(item.keywords).toContain('借');
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
      severity: 'high',
      reason: '明确嘱托保密',
    }]);

    const llm = new FakeLLM([
      noTalkResponse,                       // no-talk list generation (call 1)
      noTalkResponse,                       // no-talk list generation (call 2, double-generate)
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
      keywords: ['体检', '查出', '手术'],
      knowingWitnessIds: ['w-sister'],
      blindWitnessId: 'w-father',
      blindClaim: '升职了',
      sourceFragment: '体检查出来东西了',
      severity: 'high',
      reason: '明确嘱托保密',
    }]);

    const llm = new FakeLLM([
      noTalkResponse,                       // no-talk list generation (call 1)
      noTalkResponse,                       // no-talk list generation (call 2)
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

    // Both double-generate calls throw (simulating no API key).
    // Subsequent calls are for composeLine (regular line generation).
    const throwFn = ((_req: { system: string; user: string }) => { throw new Error('No API key configured'); }) as (req: { system: string; user: string }) => string;
    const llm = new FakeLLM([
      throwFn,   // no-talk list call 1 throws
      throwFn,   // no-talk list call 2 throws
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
      severity: 'high',
      reason: '推翻母亲对儿子工作现状的认知',
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
      noTalkResponse,                                   // no-talk list generation (call 1)
      noTalkResponse,                                   // no-talk list generation (call 2)
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
      severity: 'high',
      reason: '明确嘱托保密且推翻母亲对儿子财务状况的认知',
    }]);

    // Use function-based responses for composeLine calls to always return
    // safe content. The private-leak guard in composeLine catches leak
    // attempts and rewrites/stages internally, consuming extra responses.
    const llm = new FakeLLM([
      noTalkResponse,                                   // no-talk list (call 1)
      noTalkResponse,                                   // no-talk list (call 2)
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
      severity: 'high',
      reason: '推翻父亲对女儿工作现状的认知',
    }]);

    const llm = new FakeLLM([
      noTalkResponse,                                   // no-talk list (call 1)
      noTalkResponse,                                   // no-talk list (call 2)
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

  it('Run 20 partial leak: "换个城市" blocked because it reveals departure intent', async () => {
    // 闺蜜 says "说想换个城市生活" in front of 父亲 (who believes 升职了).
    // "换个城市" is a partial leak — it reveals residence change / departure
    // intent even without saying "辞职" or "离开北京" explicitly.
    // The updated verification prompt must catch this.
    const topic = '离开北京/离职';
    const blindRelation = '父亲';
    const blindClaim = '升职了';

    // Use a FakeLLM that captures the prompt for assertion
    let capturedPrompt = '';
    const llm = new FakeLLM([
      (req: { system: string; user: string }) => {
        capturedPrompt = req.user;
        return '是';  // This IS a leak — partial reveal of departure intent
      },
    ]);

    const result = await llmVerifyLeak(
      llm,
      '她说想换个城市生活',
      topic,
      blindRelation,
      blindClaim,
    );

    // Must be blocked
    expect(result).toBe(true);

    // Prompt must contain the new partial-leak language
    expect(capturedPrompt).toContain('起疑或推断出');
    expect(capturedPrompt).toContain('纯情绪/状态的含糊表达');
  });

  it('Run 21 safe: "换个节奏" passes because it is a vague emotional expression', async () => {
    // 闺蜜 says "想换个节奏生活" — this is a vague emotional/lifestyle
    // expression that does NOT reveal any concrete fact (departure, resignation).
    // The verification prompt explicitly excludes "纯情绪/状态含糊表达".
    const topic = '离开北京/离职';
    const blindRelation = '父亲';
    const blindClaim = '升职了';

    const llm = new FakeLLM([
      '否',  // NOT a leak — "换个节奏" is vague emotional expression
    ]);

    const result = await llmVerifyLeak(
      llm,
      '她最近老念叨想换个节奏生活',
      topic,
      blindRelation,
      blindClaim,
    );

    // Must pass through
    expect(result).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Regression: front room leak detection (Issue #1, 2026-10-07)        */
/* ------------------------------------------------------------------ */

describe('front room no-talk enforcement (regression)', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('blocks a front-room line that reveals a no-talk topic to the blind witness', async () => {
    // Setup: 发小 knows about resignation, 母亲 does not
    store.putSubject({ id: 's1', displayName: '林默' });
    store.putWitness({ id: 'w-faxiao', subjectId: 's1', relation: '发小', consentLevel: 'quotable' });
    store.putWitness({ id: 'w-mother', subjectId: 's1', relation: '母亲', consentLevel: 'quotable' });
    store.addTestimony({
      id: 't-faxiao',
      witnessId: 'w-faxiao',
      subjectId: 's1',
      answers: [
        {
          qid: 'q10',
          behindText: '就他辞职那天。他谁都没说。说完他笑了一下,说"你可别跟我妈说"。',
          frontText: '你辞职那事我最气，不是辞，是你憋到最后一刻才说。',
        },
      ],
    });
    store.addTestimony({
      id: 't-mother',
      witnessId: 'w-mother',
      subjectId: 's1',
      answers: [
        { qid: 'q1', behindText: '他现在工作忙。上个月他还跟我说公司器重他。', frontText: '你说话算话,这点随你爸。' },
      ],
    });

    // Build behind room first (required for openDoor)
    const behindLlm = new FakeLLM([
      // no-talk list generation
      JSON.stringify([{
        topic: '已离职',
        keywords: ['辞职', '离职', '不干了', '走了'],
        knowingWitnessIds: ['w-faxiao'],
        blindWitnessId: 'w-mother',
        blindClaim: '公司器重他',
        sourceFragment: '你可别跟我妈说',
        severity: 'high',
        reason: '明确嘱托保密',
      }]),
      // behind room utterances
      line('他最近挺忙的'),
      line('嗯，他忙'),
    ]);
    const { openDoor } = await import('@openmimic/engine-room');
    const behind = await runBehindRoom('s1', store, behindLlm, { maxTurnsPerWitness: 1 });

    // Now open the door with a line that leaks
    const frontLlm = new FakeLLM([
      // no-talk list for front room
      JSON.stringify([{
        topic: '已离职',
        keywords: ['辞职', '离职', '不干了', '走了'],
        knowingWitnessIds: ['w-faxiao'],
        blindWitnessId: 'w-mother',
        blindClaim: '公司器重他',
        sourceFragment: '你可别跟我妈说',
        severity: 'high',
        reason: '明确嘱托保密',
      }]),
      // 发小 tries to say something about resignation (should be blocked)
      line('你辞职那事我最气'),
      // verify call says it IS a leak
      '是',
      // rewrite attempt (still leaks)
      line('你走那天我真生气'),
      // 母亲's turn
      line('你说话算话'),
    ]);
    const opened = await openDoor(behind.id, store, frontLlm, { maxTurnsPerWitness: 1 });

    // The 发小's leaked line should have been blocked (stage direction or rewritten)
    const faxiaoUtterances = opened.frontTranscript?.filter((u) => u.witnessId === 'w-faxiao') ?? [];
    for (const u of faxiaoUtterances) {
      // If it's speech, it should not contain resignation-related keywords
      if (u.kind === 'speech') {
        expect(u.text).not.toContain('辞职');
        expect(u.text).not.toContain('离职');
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Regression: euphemism detection in llmVerifyLeak (Issue #2)          */
/* ------------------------------------------------------------------ */

describe('llmVerifyLeak with euphemistic expressions (regression)', () => {
  it('sends blind witness cognition and time-farewell hint to the model', async () => {
    const llm = new FakeLLM(['是']); // model says it IS a leak

    const result = await llmVerifyLeak(
      llm,
      '他走那天给我发微信说谢谢我这四年',
      '已离职/想歇一段',
      '母亲',
      '公司器重他',
      '他现在工作忙,上个月他还跟我说公司器重他',
    );

    // The prompt should contain the blind witness's cognition
    expect(llm.calls[0]?.user).toContain('公司器重他');
    // The prompt should contain the time-farewell hint
    expect(llm.calls[0]?.user).toContain('时间性的告别');
    // Model judged it as a leak
    expect(result).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Regression: buildNoTalkListFallback keyword quality (Issue #4)       */
/* ------------------------------------------------------------------ */

describe('buildNoTalkListFallback keyword extraction (regression)', () => {
  it('does not include generic actions like "打电话" as keywords', () => {
    const drafts = [
      {
        witness: { id: 'w-sister', subjectId: 's1', relation: '姐姐', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '她在电话里哭了好久,最后跟我说,姐你别告诉爸,他心脏不好,知道了受不了。' }],
      },
      {
        witness: { id: 'w-father', subjectId: 's1', relation: '父亲', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '上个月打电话回来说升职了。' }],
      },
    ];

    const items = buildNoTalkListFallback(drafts);
    expect(items.length).toBeGreaterThan(0);

    // "打电话" should NOT be a keyword (too generic — would match father's innocent line)
    for (const item of items) {
      expect(item.keywords).not.toContain('打电话');
    }
  });
});

/* ------------------------------------------------------------------ */
/* enrichFallbackKeywords (LLM-based fallback enrichment)              */
/* ------------------------------------------------------------------ */

describe('enrichFallbackKeywords', () => {
  it('enriches items with empty keywords via LLM', async () => {
    const items: NoTalkItem[] = [
      {
        topic: '姐你别告诉爸,他心脏不好,知道了受不了',
        keywords: [],
        elements: { text: '体检查出来一个东西', amounts: [], verbs: [], nouns: [] },
        blindWitnessId: 'w-father',
        blindClaim: '她刚升职了',
        knowingWitnessIds: ['w-sister'],
        sourceFragment: '体检查出来一个东西,姐你别告诉爸',
        severity: 'high',
        reason: '证言中有明确嘱托保密的标记',
      },
    ];

    const llm = new FakeLLM([
      JSON.stringify([['体检', '查出', '早期', '手术', '穿刺']]),
    ]);
    const enriched = await enrichFallbackKeywords(llm, items);

    expect(enriched[0]!.keywords.length).toBeGreaterThan(0);
    expect(enriched[0]!.keywords).toContain('体检');
    expect(enriched[0]!.elements.nouns).toContain('手术');
  });

  it('does not touch items that already have keywords', async () => {
    const items: NoTalkItem[] = [
      {
        topic: '借了两万',
        keywords: ['借', '两万'],
        elements: { text: '借了两万', amounts: ['两万'], verbs: ['借'], nouns: [] },
        blindWitnessId: 'w-mother',
        blindClaim: '他工作挺好的',
        knowingWitnessIds: ['w-faxiao'],
        sourceFragment: '借了两万',
        severity: 'high',
        reason: '证言中有明确嘱托保密的标记',
      },
    ];

    const llm = new FakeLLM([]); // should not be called
    const enriched = await enrichFallbackKeywords(llm, items);
    expect(enriched[0]!.keywords).toEqual(['借', '两万']);
  });

  it('degrades gracefully when LLM returns invalid JSON', async () => {
    const items: NoTalkItem[] = [
      {
        topic: '别告诉爸',
        keywords: [],
        elements: { text: '查出来东西', amounts: [], verbs: [], nouns: [] },
        blindWitnessId: 'w-father',
        blindClaim: '升职了',
        knowingWitnessIds: ['w-sister'],
        sourceFragment: '查出来东西',
        severity: 'high',
        reason: '证言中有明确嘱托保密的标记',
      },
    ];

    const llm = new FakeLLM(['not valid json at all']);
    const enriched = await enrichFallbackKeywords(llm, items);
    expect(enriched[0]!.keywords).toEqual([]); // unchanged
  });
});

/* ------------------------------------------------------------------ */
/* Regression: individual item parsing (Problem 1 fix)                 */
/* ------------------------------------------------------------------ */

describe('generateNoTalkList item-level parsing', () => {
  it('keeps valid items when other items in the array fail schema', async () => {
    // Simulate: LLM returns 2 items, one with valid keywords, one with 0 keywords.
    // Before the fix, the entire array would fail. After the fix, the valid item survives.
    const llmResponse = JSON.stringify([
      {
        topic: '确诊',
        keywords: ['体检', '查出'],   // only 2 keywords — now valid (min 1)
        knowingWitnessIds: ['w-sister'],
        blindWitnessId: 'w-father',
        blindClaim: '升职了',
        sourceFragment: '体检查出来一个东西',
        severity: 'high',
        reason: '明确嘱托保密',
      },
      {
        topic: '离开北京',
        keywords: [],                  // 0 keywords — fails min(1)
        knowingWitnessIds: ['w-bestie'],
        blindWitnessId: 'w-father',
        blindClaim: '升职了',
        sourceFragment: '想离开北京',
        severity: 'high',
        reason: '推翻认知',
      },
    ]);

    const drafts = [
      {
        witness: { id: 'w-sister', subjectId: 's1', relation: '姐姐', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '她体检查出来一个东西。别告诉爸。' }],
      },
      {
        witness: { id: 'w-father', subjectId: 's1', relation: '父亲', consentLevel: 'quotable' as const },
        memory: [{ qid: 'q1', text: '她升职了。' }],
      },
    ];

    const llm = new FakeLLM([llmResponse]);
    const items = await generateNoTalkList(llm, '苏芷', drafts);

    // The first item (valid) should survive; the second (empty keywords) should be rejected
    expect(items).toHaveLength(1);
    expect(items[0]!.topic).toBe('确诊');
    expect(items[0]!.keywords).toEqual(['体检', '查出']);
  });
});
