import { describe, expect, it } from 'vitest';
import {
  tierRatio,
  lengthStats,
  extractPrivateFragments,
  detectLeaks,
  witnessDivergence,
  replyChainRate,
  repetitionRate,
  hasContiguousOverlap,
  frontTextAnchorRate,
  halfTruthCheck,
  hasInterruptedEnding,
  frontThirdPersonRate,
  buildReport,
  checkCriteria,
} from '../../../scripts/room-metrics';
import type { RoomUtterance } from '@openmimic/shared';
import {
  extractFactElements,
  hasFactLevelLeak,
  sanitiseMemory,
  buildNoTalkListFallback,
} from '@openmimic/engine-room';

const u = (
  overrides: Partial<RoomUtterance> & { text: string },
): RoomUtterance => ({
  witnessId: overrides.witnessId ?? 'w-a',
  displayLabel: overrides.displayLabel ?? '发小',
  text: overrides.text,
  kind: overrides.kind ?? 'speech',
  at: overrides.at ?? '2026-01-01T00:00:00Z',
  tier: overrides.tier ?? 'extrapolate',
  anchors: overrides.anchors ?? [],
});

describe('tierRatio', () => {
  it('counts tiers correctly', () => {
    const utterances = [
      u({ text: 'a', tier: 'quote' }),
      u({ text: 'b', tier: 'paraphrase' }),
      u({ text: 'c', tier: 'extrapolate' }),
      u({ text: 'd', tier: 'extrapolate' }),
    ];
    const r = tierRatio(utterances);
    expect(r.quote).toBe(1);
    expect(r.paraphrase).toBe(1);
    expect(r.extrapolate).toBe(2);
    expect(r.total).toBe(4);
    expect(r.extrapolateRatio).toBe(0.5);
  });

  it('treats missing tier as extrapolate', () => {
    const utterances = [u({ text: 'a', tier: undefined })];
    expect(tierRatio(utterances).extrapolate).toBe(1);
  });

  it('handles empty input', () => {
    const r = tierRatio([]);
    expect(r.total).toBe(0);
    expect(r.extrapolateRatio).toBe(0);
  });
});

describe('lengthStats', () => {
  it('computes median and p90 for speech only', () => {
    const utterances = [
      u({ text: '短句' }), // 2
      u({ text: '中等长度句子' }), // 6
      u({ text: '比较长的一句话在这里' }), // 10
      u({ text: '舞台', kind: 'stage' }), // skipped
    ];
    const s = lengthStats(utterances);
    expect(s.lengths).toEqual([2, 6, 10]);
    expect(s.median).toBe(6);
    expect(s.max).toBe(10);
  });

  it('handles empty input', () => {
    const s = lengthStats([]);
    expect(s.median).toBe(0);
  });
});

describe('extractPrivateFragments', () => {
  it('finds private markers and extracts context', () => {
    const testimonies = [
      {
        witnessId: 'w-a',
        answers: [
          {
            qid: 'q1',
            behindText: '他借了两万。还嘱咐我千万别跟他妈提。',
          },
        ],
      },
    ];
    const frags = extractPrivateFragments(testimonies);
    expect(frags.length).toBe(1);
    expect(frags[0]!.text).toContain('借了两万');
    expect(frags[0]!.text).toContain('千万别');
  });

  it('returns empty for non-private testimony', () => {
    const testimonies = [
      {
        witnessId: 'w-a',
        answers: [{ qid: 'q1', behindText: '他是个好人。' }],
      },
    ];
    expect(extractPrivateFragments(testimonies)).toEqual([]);
  });
});

describe('detectLeaks', () => {
  it('detects substring overlap of 8+ chars', () => {
    const frags = [
      { witnessId: 'w-a', qid: 'q1', text: '借了两万还嘱咐我千万别跟他妈提' },
    ];
    const utterances = [
      u({ text: '他借了两万还嘱咐我不许说', witnessId: 'w-a' }),
    ];
    const leaks = detectLeaks(utterances, frags);
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks[0]!.matchType).toBe('substring');
  });

  it('detects numeric match', () => {
    const frags = [
      { witnessId: 'w-a', qid: 'q1', text: '他借了20000块' },
    ];
    const utterances = [
      u({ text: '听说他最近借了20000', witnessId: 'w-a' }),
    ];
    const leaks = detectLeaks(utterances, frags);
    expect(leaks.length).toBeGreaterThan(0);
  });

  it('skips stage directions', () => {
    const frags = [
      { witnessId: 'w-a', qid: 'q1', text: '借了两万还嘱咐我千万别跟他妈提' },
    ];
    const utterances = [
      u({ text: '借了两万还嘱咐我千万别跟他妈提', kind: 'stage' }),
    ];
    expect(detectLeaks(utterances, frags)).toEqual([]);
  });
});

describe('witnessDivergence', () => {
  it('computes overlap for same witness across phases', () => {
    const behind = [u({ text: '他最近联系少了约饭推了', witnessId: 'w-a' })];
    const front = [u({ text: '他最近挺好的', witnessId: 'w-a' })];
    const div = witnessDivergence(behind, front);
    expect(div.length).toBe(1);
    expect(div[0]!.witnessId).toBe('w-a');
    expect(div[0]!.overlapRatio).toBeGreaterThan(0);
    expect(div[0]!.overlapRatio).toBeLessThan(1);
  });

  it('skips witnesses present in only one phase', () => {
    const behind = [u({ text: '背后', witnessId: 'w-a' })];
    const front = [u({ text: '当面', witnessId: 'w-b' })];
    expect(witnessDivergence(behind, front)).toEqual([]);
  });
});

describe('replyChainRate', () => {
  it('detects replies via shared bigrams', () => {
    const utterances = [
      u({ text: '他最近联系少了', witnessId: 'w-a' }),
      u({ text: '确实联系少了很多', witnessId: 'w-b' }),
      u({ text: '完全不相关的新话题', witnessId: 'w-c' }),
    ];
    const r = replyChainRate(utterances);
    expect(r.eligible).toBe(2);
    expect(r.replyCount).toBe(1); // 2nd line shares bigrams with 1st
    expect(r.rate).toBe(0.5);
  });

  it('handles single utterance', () => {
    const r = replyChainRate([u({ text: '独白' })]);
    expect(r.eligible).toBe(0);
    expect(r.rate).toBe(0);
  });
});

describe('hasContiguousOverlap', () => {
  it('detects 5-char contiguous overlap', () => {
    // "最近挺忙的" = 5 chars shared contiguously
    expect(hasContiguousOverlap('他最近挺忙的吧', '确实最近挺忙的', 5)).toBe(true);
  });

  it('returns false when overlap is shorter than threshold', () => {
    expect(hasContiguousOverlap('他最近忙', '她最近好', 5)).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(hasContiguousOverlap('', '他最近挺忙的', 5)).toBe(false);
  });
});

describe('repetitionRate', () => {
  it('counts pairs with ≥5-char contiguous overlap', () => {
    const utterances = [
      u({ text: '他最近挺忙的', witnessId: 'w-a' }),
      u({ text: '确实最近挺忙', witnessId: 'w-b' }), // overlaps with #0: "最近挺忙"=4 chars, not 5... let me use longer
      u({ text: '完全不同的话题讨论', witnessId: 'w-c' }),
    ];
    // "最近挺忙" is 4 chars, need 5 for overlap
    const r = repetitionRate(utterances);
    expect(r.totalPairs).toBe(3); // 3 pairs: (0,1), (0,2), (1,2)
  });

  it('detects repeated phrases', () => {
    const utterances = [
      u({ text: '坐吧先喝口水', witnessId: 'w-a' }),
      u({ text: '来了坐吧先喝口水', witnessId: 'w-b' }), // shares "坐吧先喝口水" (6 chars)
      u({ text: '最近工作还顺利吗', witnessId: 'w-c' }),
    ];
    const r = repetitionRate(utterances);
    expect(r.duplicatePairs).toBe(1); // only (0,1) overlaps
    expect(r.totalPairs).toBe(3);
    // rate = 1/3 ≈ 33%
    expect(r.rate).toBeCloseTo(1 / 3, 2);
  });

  it('returns 0 for no overlaps', () => {
    const utterances = [
      u({ text: '天气真好', witnessId: 'w-a' }),
      u({ text: '去吃饭吧', witnessId: 'w-b' }),
    ];
    const r = repetitionRate(utterances);
    expect(r.duplicatePairs).toBe(0);
    expect(r.rate).toBe(0);
  });

  it('skips stage directions', () => {
    const utterances = [
      u({ text: '坐吧先喝口水', witnessId: 'w-a' }),
      u({ text: '坐吧先喝口水', kind: 'stage', witnessId: 'w-b' }),
    ];
    const r = repetitionRate(utterances);
    expect(r.totalPairs).toBe(0); // only 1 speech, no pairs
  });
});

describe('frontTextAnchorRate', () => {
  it('counts lines anchored to frontText qids', () => {
    const front = [
      u({
        text: '最近忙不忙啊',
        witnessId: 'w-a',
        tier: 'paraphrase',
        anchors: [{ qid: 'q1', testimonyId: 't1' }],
      }),
      u({
        text: '来了来了',
        witnessId: 'w-b',
        tier: 'extrapolate',
        anchors: [],
      }),
      u({
        text: '听说你换工作了',
        witnessId: 'w-c',
        tier: 'quote',
        anchors: [{ qid: 'q2', testimonyId: 't2' }],
      }),
    ];
    const frontTextEntries = [
      { witnessId: 'w-a', qid: 'q1', frontText: '我会问他最近忙不忙' },
      { witnessId: 'w-c', qid: 'q2', frontText: '我会说听说你换工作了' },
    ];
    const r = frontTextAnchorRate(front, frontTextEntries);
    expect(r.anchored).toBe(2);
    expect(r.total).toBe(3);
    expect(r.rate).toBeCloseTo(2 / 3, 2);
  });

  it('rejects anchors to qids without frontText', () => {
    const front = [
      u({
        text: '哟来了',
        witnessId: 'w-a',
        tier: 'paraphrase',
        anchors: [{ qid: 'q1', testimonyId: 't1' }],
      }),
    ];
    // q1 of w-a has no frontText entry
    const r = frontTextAnchorRate(front, []);
    expect(r.anchored).toBe(0);
    expect(r.rate).toBe(0);
  });

  it('returns 0 for empty front', () => {
    const r = frontTextAnchorRate([], []);
    expect(r.total).toBe(0);
    expect(r.rate).toBe(0);
  });
});

describe('hasInterruptedEnding', () => {
  it('detects ellipsis ending', () => {
    expect(hasInterruptedEnding('你走那会儿我其实……')).toBe(true);
  });

  it('detects "算了" ending', () => {
    expect(hasInterruptedEnding('你那时候……算了')).toBe(true);
  });

  it('detects "不说了" ending', () => {
    expect(hasInterruptedEnding('你那件事……不说了')).toBe(true);
  });

  it('rejects complete sentences', () => {
    expect(hasInterruptedEnding('他走的方式,像个逃兵。')).toBe(false);
  });

  it('rejects regular endings', () => {
    expect(hasInterruptedEnding('最近还好吗')).toBe(false);
  });
});

describe('halfTruthCheck', () => {
  it('passes with exactly 1 interrupted half-truth and no heavy echoes', () => {
    const front = [
      u({ text: '来了快坐', witnessId: 'w-a' }),
      u({ text: '你从小就这样……算了', witnessId: 'w-b' }), // 4-char overlap, ≤25 chars, interrupted
      u({ text: '喝杯茶', witnessId: 'w-c' }),
    ];
    const behindTexts = [
      { witnessId: 'w-b', qid: 'q1', behindText: '他从小就这样的,说不听' },
    ];
    const r = halfTruthCheck(front, behindTexts);
    expect(r.halfTruthCount).toBe(1);
    expect(r.heavyEchoCount).toBe(0);
    expect(r.pass).toBe(true);
  });

  it('rejects a short overlap line without interrupted ending', () => {
    const front = [
      u({ text: '你从小就这样。', witnessId: 'w-b' }), // overlap but no interruption
    ];
    const behindTexts = [
      { witnessId: 'w-b', qid: 'q1', behindText: '他从小就这样的' },
    ];
    const r = halfTruthCheck(front, behindTexts);
    expect(r.halfTruthCount).toBe(0); // not counted as half-truth without interruption
  });

  it('fails with 0 half-truths', () => {
    const front = [
      u({ text: '来了', witnessId: 'w-a' }),
      u({ text: '快坐', witnessId: 'w-b' }),
    ];
    const behindTexts = [
      { witnessId: 'w-b', qid: 'q1', behindText: '他最近变化很大感觉不对劲' },
    ];
    const r = halfTruthCheck(front, behindTexts);
    expect(r.halfTruthCount).toBe(0);
    expect(r.pass).toBe(false);
  });

  it('fails with heavy echo (≥8 char overlap)', () => {
    const longText = '他借了两万还嘱咐我千万别跟别人提这事啊咱们都要注意一下';
    const front = [
      u({ text: longText, witnessId: 'w-a' }),
    ];
    const behindTexts = [
      { witnessId: 'w-a', qid: 'q1', behindText: '他借了两万还嘱咐我千万别跟他妈提' },
    ];
    const r = halfTruthCheck(front, behindTexts);
    expect(r.heavyEchoCount).toBe(1);
    expect(r.pass).toBe(false);
  });
});

describe('frontThirdPersonRate', () => {
  it('counts lines using 他/她 for the subject', () => {
    const front = [
      u({ text: '你最近忙不忙', witnessId: 'w-a' }), // second person - OK
      u({ text: '他人挺好的', witnessId: 'w-b' }), // third person - bad
      u({ text: '默哥来了啊', witnessId: 'w-c' }), // name - OK
    ];
    const r = frontThirdPersonRate(front);
    expect(r.thirdPersonCount).toBe(1);
    expect(r.total).toBe(3);
    expect(r.rate).toBeCloseTo(1 / 3, 2);
  });

  it('returns 0 for all second-person lines', () => {
    const front = [
      u({ text: '你最近怎么样', witnessId: 'w-a' }),
      u({ text: '你吃了没', witnessId: 'w-b' }),
    ];
    const r = frontThirdPersonRate(front);
    expect(r.thirdPersonCount).toBe(0);
    expect(r.rate).toBe(0);
  });

  it('allows 他们 without counting as third-person', () => {
    const front = [
      u({ text: '他们都在等你', witnessId: 'w-a' }),
    ];
    const r = frontThirdPersonRate(front);
    expect(r.thirdPersonCount).toBe(0);
  });

  it('skips stage directions', () => {
    const front = [
      u({ text: '他低头喝了口水', kind: 'stage', witnessId: 'w-a' }),
    ];
    const r = frontThirdPersonRate(front);
    expect(r.total).toBe(0);
  });
});

describe('checkCriteria', () => {
  it('passes for a well-balanced room', () => {
    // Build a room that meets all criteria
    const behind: RoomUtterance[] = [
      u({ text: '最近还好吗', tier: 'extrapolate', witnessId: 'w-a' }),
      u({ text: '嗯还行', tier: 'extrapolate', witnessId: 'w-b' }),
      u({ text: '他吃饭比以前多了', tier: 'paraphrase', witnessId: 'w-c' }),
      u({ text: '确实多了不少', tier: 'extrapolate', witnessId: 'w-a' }),
      u({ text: '他话少了', tier: 'paraphrase', witnessId: 'w-b' }),
    ];
    const front: RoomUtterance[] = [
      u({ text: '哟来了', tier: 'extrapolate', witnessId: 'w-a' }),
      u({ text: '快坐', tier: 'extrapolate', witnessId: 'w-c' }),
    ];

    const report = buildReport(behind, front, []);
    const checks = checkCriteria(report);
    const extrapolateCheck = checks.find((c) => c.name === 'behind-extrapolate-ratio');
    expect(extrapolateCheck?.pass).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Fact-level private content detection                                */
/* ------------------------------------------------------------------ */

describe('extractFactElements', () => {
  it('extracts Chinese amounts', () => {
    const el = extractFactElements('借了两万,说手头周转一下');
    expect(el.amounts).toContain('两万');
  });

  it('extracts action verbs', () => {
    const el = extractFactElements('上个月他半夜给我打电话,借了两万');
    expect(el.verbs).toContain('借');
    expect(el.verbs).toContain('打电话');
  });

  it('extracts nouns', () => {
    const el = extractFactElements('还嘱咐我千万别跟他妈提借钱的事');
    expect(el.nouns.length).toBeGreaterThan(0);
  });
});

describe('hasFactLevelLeak', () => {
  const privateText = '上个月他半夜给我打电话,借了两万,说手头周转一下,还嘱咐我千万别跟他妈提';
  const elements = [extractFactElements(privateText)];

  it('catches Run 9 regression: paraphrased private content (borrowing money)', () => {
    // This is the EXACT line from Run 9 that leaked private content
    expect(hasFactLevelLeak(
      '上个月他还跟我借了两万,让我千万别跟您提',
      elements,
    )).toBe(true);
  });

  it('catches paraphrased borrowing even without secrecy clause', () => {
    expect(hasFactLevelLeak(
      '他跟我借了两万,手头有点紧',
      elements,
    )).toBe(true);
  });

  it('allows vague hesitation without fact elements', () => {
    // This line has no specific amount, no borrowing verb -- just vague worry
    expect(hasFactLevelLeak(
      '他最近手头好像有点紧……算了不说了',
      elements,
    )).toBe(false);
  });

  it('allows unrelated conversation', () => {
    expect(hasFactLevelLeak(
      '他最近联系少了,约他吃饭老说忙',
      elements,
    )).toBe(false);
  });
});

describe('detectLeaks (fact-level regression)', () => {
  it('catches Run 9 regression line via fact-level detection', () => {
    const frags = [
      {
        witnessId: 'w-faxiao',
        qid: 'q1',
        text: '上个月他半夜给我打电话,借了两万,说手头周转一下,还嘱咐我千万别跟他妈提',
      },
    ];
    const utterances = [
      // The EXACT leak from Run 9
      u({ text: '上个月他还跟我借了两万,让我千万别跟您提', witnessId: 'w-faxiao' }),
    ];
    const leaks = detectLeaks(utterances, frags);
    expect(leaks.length).toBeGreaterThan(0);
  });

  it('catches Chinese amount match (两万)', () => {
    const frags = [
      { witnessId: 'w-a', qid: 'q1', text: '他借了两万还嘱咐我千万别说' },
    ];
    const utterances = [
      u({ text: '听说两万的事了吧', witnessId: 'w-a' }),
    ];
    const leaks = detectLeaks(utterances, frags);
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks[0]!.matchType).toBe('numeric');
  });

  it('allows vague hesitation that does not leak facts', () => {
    const frags = [
      {
        witnessId: 'w-faxiao',
        qid: 'q1',
        text: '上个月他半夜给我打电话,借了两万,说手头周转一下,还嘱咐我千万别跟他妈提',
      },
    ];
    const utterances = [
      u({ text: '他最近手头好像有点紧……算了不说了', witnessId: 'w-faxiao' }),
    ];
    expect(detectLeaks(utterances, frags)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Memory sanitisation                                                 */
/* ------------------------------------------------------------------ */

describe('sanitiseMemory', () => {
  it('strips private sentences and replaces with marker', () => {
    const text = '他花钱分裂。上个月他半夜给我打电话,借了两万。还嘱咐我千万别跟他妈提。他最近联系确实少了。';
    const sanitised = sanitiseMemory(text);
    expect(sanitised).not.toContain('借了两万');
    expect(sanitised).not.toContain('千万别');
    expect(sanitised).toContain('嘱咐别外传的事');
    expect(sanitised).toContain('他花钱分裂');
    expect(sanitised).toContain('他最近联系确实少了');
  });

  it('returns original text when no private markers', () => {
    const text = '他最近联系少了,约他吃饭老说忙。';
    expect(sanitiseMemory(text)).toBe(text);
  });
});

/* ------------------------------------------------------------------ */
/* Cross-witness knowledge conflicts                                   */
/* ------------------------------------------------------------------ */

describe('buildNoTalkListFallback', () => {
  it('detects private marker targeting mother', () => {
    const drafts = [
      {
        witness: { id: 'w-faxiao', subjectId: 's1', relation: '发小', consentLevel: 'quotable' as const },
        memory: [
          { qid: 'q1', text: '上个月他半夜给我打电话,借了两万。还嘱咐我千万别跟他妈提。' },
        ],
      },
      {
        witness: { id: 'w-mother', subjectId: 's1', relation: '母亲', consentLevel: 'quotable' as const },
        memory: [
          { qid: 'q1', text: '他现在工作忙,上个月还跟我说公司器重他。' },
        ],
      },
    ];
    const list = buildNoTalkListFallback(drafts);
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((item: { blindWitnessId: string }) => item.blindWitnessId === 'w-mother')).toBe(true);
  });

  it('does NOT do domain-specific guessing without explicit marker', () => {
    // No "千万别" or other explicit marker -- fallback should NOT flag anything
    const drafts = [
      {
        witness: { id: 'w-faxiao', subjectId: 's1', relation: '发小', consentLevel: 'quotable' as const },
        memory: [
          { qid: 'q10', text: '就他辞职那天。他谁都没说,周五下班把工牌往桌上一放就走了。' },
        ],
      },
      {
        witness: { id: 'w-mother', subjectId: 's1', relation: '母亲', consentLevel: 'quotable' as const },
        memory: [
          { qid: 'q1', text: '他现在工作忙,周末也加班。上个月他还跟我说公司器重他。' },
        ],
      },
    ];
    const list = buildNoTalkListFallback(drafts);
    // Fallback only handles explicit secrecy markers, not domain contradictions
    expect(list.length).toBe(0);
  });
});
