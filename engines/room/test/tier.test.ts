import { describe, expect, it } from 'vitest';
import {
  ANCHOR_MIN_WORD_OVERLAP,
  QUOTE_OVERLAP_LENGTH,
  classifyUtterance,
  hasVerbatimOverlap,
  tierDistribution,
  validateAnchors,
  type WitnessTestimony,
} from '@openmimic/engine-room';

/* ------------------------------------------------------------------ */
/* Shared test data                                                    */
/* ------------------------------------------------------------------ */

const QUOTABLE_TESTIMONY: WitnessTestimony = {
  testimonyId: 't-1',
  witnessId: 'w-a',
  answers: [
    {
      qid: 'q1',
      behindText: '他花钱这事特别分裂。跟我吃饭从来没让我买过单,有一回我抢着付,他脸都拉下来了',
    },
    {
      qid: 'q2',
      behindText: '他不怎么当众发火,但你能感觉到',
    },
    {
      qid: 'q3',
      behindText: '答应我的事他基本都做到',
    },
  ],
};

const SYNTHESIS_TESTIMONY: WitnessTestimony = {
  testimonyId: 't-syn',
  witnessId: 'w-syn',
  answers: [
    {
      qid: 'q1',
      behindText: '他其实特别怕一个人待着,晚上必须开着灯,而且从来不关门',
    },
  ],
};

/* ------------------------------------------------------------------ */
/* hasVerbatimOverlap                                                  */
/* ------------------------------------------------------------------ */

describe('hasVerbatimOverlap', () => {
  it('detects a 12-char verbatim overlap', () => {
    const source = '他花钱这事特别分裂跟我吃饭从来没让我买过单';
    // 12 chars: '他花钱这事特别分裂跟我吃'
    expect(hasVerbatimOverlap('他花钱这事特别分裂跟我吃', [source], 12)).toBe(true);
  });

  it('rejects an 11-char overlap when threshold is 12', () => {
    const source = '他花钱这事特别分裂跟我吃饭从来没让我买过单';
    // 11 chars: '他花钱这事特别分裂跟我'
    expect(hasVerbatimOverlap('他花钱这事特别分裂跟我', [source], 12)).toBe(false);
  });

  it('returns false when sources are empty', () => {
    expect(hasVerbatimOverlap('anything goes here', [], 12)).toBe(false);
  });

  it('returns false for short text', () => {
    expect(hasVerbatimOverlap('短', ['短文本也不行'], 12)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* validateAnchors                                                     */
/* ------------------------------------------------------------------ */

describe('validateAnchors', () => {
  it('validates an anchor when the utterance shares token overlap', () => {
    const anchors = validateAnchors(
      '他花钱从来不含糊,请客买单', // shares '花钱', '买单' etc with q1
      [{ testimonyId: 't-1', qid: 'q1' }],
      'w-a',
      [QUOTABLE_TESTIMONY],
    );
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toEqual({ testimonyId: 't-1', qid: 'q1' });
  });

  it('rejects an anchor for a qid not in the testimony', () => {
    const anchors = validateAnchors(
      '他花钱从来不含糊',
      [{ testimonyId: 't-1', qid: 'q999' }],
      'w-a',
      [QUOTABLE_TESTIMONY],
    );
    expect(anchors).toHaveLength(0);
  });

  it('rejects an anchor for wrong witnessId', () => {
    const anchors = validateAnchors(
      '他花钱从来不含糊',
      [{ testimonyId: 't-1', qid: 'q1' }],
      'w-other',
      [QUOTABLE_TESTIMONY],
    );
    expect(anchors).toHaveLength(0);
  });

  it('rejects an anchor when no token overlap exists', () => {
    const anchors = validateAnchors(
      '今天天气不错,出去走走',
      [{ testimonyId: 't-1', qid: 'q3' }],
      'w-a',
      [QUOTABLE_TESTIMONY],
    );
    // q3 behindText is '答应我的事他基本都做到', shares no meaningful overlap
    // with '今天天气不错,出去走走'
    expect(anchors).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* classifyUtterance                                                   */
/* ------------------------------------------------------------------ */

describe('classifyUtterance', () => {
  it('classifies a stage direction as extrapolate with no anchors', () => {
    const result = classifyUtterance({
      text: '笑了笑,没接话',
      kind: 'stage',
      witnessId: 'w-a',
      consentLevel: 'quotable',
      citedAnchors: [{ testimonyId: 't-1', qid: 'q1' }],
      testimonies: [QUOTABLE_TESTIMONY],
    });
    expect(result.tier).toBe('extrapolate');
    expect(result.anchors).toHaveLength(0);
  });

  it('classifies a quotable witness line with 12+ char overlap as quote', () => {
    // This text contains a 12+ char substring from q1's behindText
    const text = '他跟我吃饭从来没让我买过单,每次都抢着付';
    const result = classifyUtterance({
      text,
      kind: 'speech',
      witnessId: 'w-a',
      consentLevel: 'quotable',
      citedAnchors: [{ testimonyId: 't-1', qid: 'q1' }],
      testimonies: [QUOTABLE_TESTIMONY],
    });
    expect(result.tier).toBe('quote');
    expect(result.anchors.length).toBeGreaterThan(0);
  });

  it('classifies a synthesis_only witness as paraphrase even with verbatim overlap', () => {
    // Even if there is verbatim overlap, synthesis_only never reaches quote
    const text = '他其实特别怕一个人待着,晚上必须开着灯,而且从来不关门';
    const result = classifyUtterance({
      text,
      kind: 'speech',
      witnessId: 'w-syn',
      consentLevel: 'synthesis_only',
      citedAnchors: [{ testimonyId: 't-syn', qid: 'q1' }],
      testimonies: [SYNTHESIS_TESTIMONY],
    });
    expect(result.tier).toBe('paraphrase');
    expect(result.anchors.length).toBeGreaterThan(0);
  });

  it('classifies a line with valid anchors but no verbatim overlap as paraphrase', () => {
    const text = '他请客的时候特别大方,从来不让人掏钱';
    const result = classifyUtterance({
      text,
      kind: 'speech',
      witnessId: 'w-a',
      consentLevel: 'quotable',
      citedAnchors: [{ testimonyId: 't-1', qid: 'q1' }],
      testimonies: [QUOTABLE_TESTIMONY],
    });
    expect(result.tier).toBe('paraphrase');
    expect(result.anchors.length).toBeGreaterThan(0);
  });

  it('classifies a line with no valid anchors as extrapolate', () => {
    const text = '是啊,这天气真热';
    const result = classifyUtterance({
      text,
      kind: 'speech',
      witnessId: 'w-a',
      consentLevel: 'quotable',
      citedAnchors: [],
      testimonies: [QUOTABLE_TESTIMONY],
    });
    expect(result.tier).toBe('extrapolate');
    expect(result.anchors).toHaveLength(0);
  });

  it('demotes when all cited anchors fail validation', () => {
    const text = '天气真好,出去走走吧';
    const result = classifyUtterance({
      text,
      kind: 'speech',
      witnessId: 'w-a',
      consentLevel: 'quotable',
      citedAnchors: [{ testimonyId: 't-1', qid: 'q999' }], // invalid qid
      testimonies: [QUOTABLE_TESTIMONY],
    });
    expect(result.tier).toBe('extrapolate');
    expect(result.anchors).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* tierDistribution                                                    */
/* ------------------------------------------------------------------ */

describe('tierDistribution', () => {
  it('counts the three tiers correctly', () => {
    const dist = tierDistribution([
      { tier: 'quote' },
      { tier: 'quote' },
      { tier: 'paraphrase' },
      { tier: 'extrapolate' },
      { tier: 'extrapolate' },
      { tier: 'extrapolate' },
    ]);
    expect(dist).toEqual({ quote: 2, paraphrase: 1, extrapolate: 3, total: 6 });
  });

  it('treats missing tier as extrapolate', () => {
    const dist = tierDistribution([
      { tier: undefined },
      { tier: 'quote' },
    ]);
    expect(dist.extrapolate).toBe(1);
    expect(dist.quote).toBe(1);
    expect(dist.total).toBe(2);
  });

  it('handles an empty transcript', () => {
    const dist = tierDistribution([]);
    expect(dist).toEqual({ quote: 0, paraphrase: 0, extrapolate: 0, total: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* Old data backward compatibility                                     */
/* ------------------------------------------------------------------ */

describe('backward compatibility', () => {
  it('treats utterances without tier field as extrapolate', () => {
    const dist = tierDistribution([
      {},
      { tier: 'quote' as const },
    ]);
    expect(dist.extrapolate).toBe(1);
    expect(dist.quote).toBe(1);
  });
});
