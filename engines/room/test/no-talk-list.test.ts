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

    // Script: no-talk list LLM returns items, then compose lines, then verify
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
      line('她最近状态不太好'),              // sister retry (after stage direction budget used)
      line('她升职挺开心的'),                // father's line (safe)
      line('她确实很努力'),                  // sister second turn
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
});
