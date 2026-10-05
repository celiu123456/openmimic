/**
 * Regression tests for basis classification defects.
 *
 * Two bugs fixed:
 * 1. "大概/差不多" before numbers wrongly triggered 'inferred'
 * 2. First-person event narratives wrongly classified as 'unknown'
 * 3. Unknown conviction ceiling too low (0.6 → 0.85)
 */
import { describe, expect, it } from 'vitest';
import { classifyBasis, basisConvictionCeiling } from '../src/basis';

/* ------------------------------------------------------------------ */
/* Bug 1: "大概" before numbers is approximation, not hedging          */
/* ------------------------------------------------------------------ */

describe('大概/差不多 before numbers = approximation, not inferred', () => {
  const numericApproximations = [
    '大概花了两千多',
    '差不多三百块',
    '大概二十分钟',
    '大概5000元',
    '差不多100斤',
    '大概十几个人',
    '差不多八九点钟',
    '大概一百多万',
  ];

  for (const text of numericApproximations) {
    it(`"${text}" is NOT inferred`, () => {
      expect(classifyBasis(text)).not.toBe('inferred');
    });
  }

  // "大概" without numbers IS epistemic hedging
  const epistemicHedges = [
    '大概是这样的吧',
    '差不多是那个意思',
    '大概就是那种感觉',
  ];

  for (const text of epistemicHedges) {
    it(`"${text}" IS inferred`, () => {
      expect(classifyBasis(text)).toBe('inferred');
    });
  }
});

/* ------------------------------------------------------------------ */
/* Bug 2: first-person event narratives → witnessed, not unknown       */
/* ------------------------------------------------------------------ */

describe('first-person event narratives are witnessed', () => {
  const firstPersonEvents = [
    '记得有一次我搬家',
    '我上次去他家的时候',
    '我有一次跟他出去吃饭',
    '那天我去找他',
    '我们一起去过一次',
    '当年我在公司见过他',
    '后来我就搬走了',
    '我跟他一起做过那个项目',
    '那时候我还在上学',
  ];

  for (const text of firstPersonEvents) {
    it(`"${text}" is witnessed`, () => {
      expect(classifyBasis(text)).toBe('witnessed');
    });
  }
});

/* ------------------------------------------------------------------ */
/* Bug 3: unknown conviction ceiling                                   */
/* ------------------------------------------------------------------ */

describe('unknown conviction ceiling is not punitive', () => {
  it('unknown ceiling is 0.85, not the old 0.6', () => {
    expect(basisConvictionCeiling('unknown')).toBe(0.85);
  });

  it('witnessed has the highest ceiling (1.0)', () => {
    expect(basisConvictionCeiling('witnessed')).toBe(1.0);
  });

  it('unknown ceiling > heard ceiling', () => {
    expect(basisConvictionCeiling('unknown')).toBeGreaterThan(
      basisConvictionCeiling('heard'),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Existing classifications still correct                               */
/* ------------------------------------------------------------------ */

describe('existing classifications preserved', () => {
  it('explicit witnessing still works', () => {
    expect(classifyBasis('我亲眼看到他帮了那个人')).toBe('witnessed');
    expect(classifyBasis('我看见他拿走了东西')).toBe('witnessed');
    expect(classifyBasis('当时他就站在我旁边')).toBe('witnessed');
  });

  it('hearsay still works', () => {
    expect(classifyBasis('听说他以前做过')).toBe('heard');
    expect(classifyBasis('别人说他脾气不好')).toBe('heard');
    expect(classifyBasis('他告诉我他要去北京')).toBe('heard');
  });

  it('hedging still works (non-numeric)', () => {
    expect(classifyBasis('也许他是那种人')).toBe('inferred');
    expect(classifyBasis('我猜他可能不喜欢')).toBe('inferred');
    expect(classifyBasis('估计他不会来了')).toBe('inferred');
    expect(classifyBasis('应该是那样')).toBe('inferred');
  });

  it('bare evaluations remain unknown', () => {
    expect(classifyBasis('他人挺好的')).toBe('unknown');
    expect(classifyBasis('她很聪明')).toBe('unknown');
  });
});
