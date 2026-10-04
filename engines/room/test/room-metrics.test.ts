import { describe, expect, it } from 'vitest';
import {
  tierRatio,
  lengthStats,
  extractPrivateFragments,
  detectLeaks,
  witnessDivergence,
  replyChainRate,
  buildReport,
  checkCriteria,
} from '../../../scripts/room-metrics';
import type { RoomUtterance } from '@openmimic/shared';

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
