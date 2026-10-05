import { describe, expect, it } from 'vitest';
import {
  canonicalText,
  normalizeClaim,
  extractClaims,
  minhash,
  minhashSimilarity,
  computeFingerprint,
  screenReflux,
  MINHASH_SIZE,
  REFLUX_THRESHOLD,
  type AiFingerprint,
} from '../src/reflux';

/* ------------------------------------------------------------------ */
/* canonicalText                                                        */
/* ------------------------------------------------------------------ */

describe('canonicalText', () => {
  it('normalizes whitespace and case', () => {
    expect(canonicalText('  Hello   World  ')).toBe('hello world');
  });

  it('normalizes CJK punctuation', () => {
    expect(canonicalText('他说，"你好。"')).toBe('他说,"你好."');
  });

  it('normalizes smart quotes', () => {
    expect(canonicalText('“Hello”')).toBe('"hello"');
  });
});

/* ------------------------------------------------------------------ */
/* normalizeClaim                                                      */
/* ------------------------------------------------------------------ */

describe('normalizeClaim', () => {
  it('replaces dates with <date>', () => {
    expect(normalizeClaim('她在2024年3月搬家了')).toContain('<date>');
    expect(normalizeClaim('她在2024年3月搬家了')).not.toContain('2024');
  });

  it('replaces numbers with <number>', () => {
    expect(normalizeClaim('他花了500元')).toContain('<number>');
    expect(normalizeClaim('他花了500元')).not.toContain('500');
  });
});

/* ------------------------------------------------------------------ */
/* extractClaims                                                       */
/* ------------------------------------------------------------------ */

describe('extractClaims', () => {
  it('splits on sentence boundaries', () => {
    const claims = extractClaims('他很慷慨。她也很善良！这是真的吗？');
    expect(claims.length).toBe(3);
  });

  it('filters short fragments', () => {
    const claims = extractClaims('好。这是一个很长的句子，足够作为一个论断');
    expect(claims.length).toBe(1);
    expect(claims[0]).toContain('这是');
  });
});

/* ------------------------------------------------------------------ */
/* minhash                                                             */
/* ------------------------------------------------------------------ */

describe('minhash', () => {
  it('returns correct dimension', () => {
    const sig = minhash('这是一段测试文本');
    expect(sig).toHaveLength(MINHASH_SIZE);
  });

  it('produces identical signatures for identical text', () => {
    const sig1 = minhash('完全相同的文本');
    const sig2 = minhash('完全相同的文本');
    expect(sig1).toEqual(sig2);
  });

  it('produces high similarity for near-identical text', () => {
    // Use longer text for more stable MinHash estimates
    const sig1 = minhash('他经常帮助邻居做家务,每天早上六点起床去菜市场买菜做饭');
    const sig2 = minhash('他经常帮助邻居做家务,每天早上六点起床去菜市场买菜做饭给家人');
    expect(minhashSimilarity(sig1, sig2)).toBeGreaterThan(0.4);
  });

  it('produces low similarity for unrelated text', () => {
    const sig1 = minhash('他经常帮助邻居做家务');
    const sig2 = minhash('天气预报说明天会下雨');
    expect(minhashSimilarity(sig1, sig2)).toBeLessThan(0.3);
  });

  it('handles very short text', () => {
    const sig = minhash('ab');
    expect(sig).toHaveLength(MINHASH_SIZE);
  });
});

/* ------------------------------------------------------------------ */
/* minhashSimilarity                                                   */
/* ------------------------------------------------------------------ */

describe('minhashSimilarity', () => {
  it('returns 1 for identical signatures', () => {
    const sig = minhash('test');
    expect(minhashSimilarity(sig, sig)).toBe(1);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(minhashSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 for empty arrays', () => {
    expect(minhashSimilarity([], [])).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* computeFingerprint                                                  */
/* ------------------------------------------------------------------ */

describe('computeFingerprint', () => {
  it('computes a complete fingerprint', () => {
    const fp = computeFingerprint('room:abc', 'subj1', '他是一个很慷慨的人。经常帮助别人做事情！');
    expect(fp.artifactId).toBe('room:abc');
    expect(fp.subjectId).toBe('subj1');
    expect(fp.minhashSig).toHaveLength(MINHASH_SIZE);
    expect(fp.syntheticClaimHashes.length).toBeGreaterThan(0);
    expect(fp.textDigest).toHaveLength(64); // SHA-256 hex
  });

  it('uses provided claims if given', () => {
    const fp = computeFingerprint('court:claim:1', 'subj1', '他花了很多钱', ['他花了很多钱']);
    expect(fp.syntheticClaimHashes).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* screenReflux                                                        */
/* ------------------------------------------------------------------ */

describe('screenReflux', () => {
  it('returns none when no candidates', () => {
    const result = screenReflux('some text', []);
    expect(result.suspicion).toBe('none');
  });

  it('returns none for unrelated text', () => {
    const fp = computeFingerprint('room:1', 's1', '她喜欢在周末去爬山,每次都带很多零食');
    const result = screenReflux('天气预报说明天会有大雨', [fp]);
    expect(result.suspicion).toBe('none');
  });

  it('detects high suspicion when synthetic claim is copied verbatim', () => {
    const aiText = '他是一个非常慷慨的人。他经常帮助邻居修理东西！';
    const fp = computeFingerprint('room:1', 's1', aiText);

    // Witness copies an AI sentence verbatim
    const witnessText = '他经常帮助邻居修理东西';
    const result = screenReflux(witnessText, [fp]);
    expect(result.suspicion).toBe('high');
    expect(result.signal).toBe('synthetic_claim');
    expect(result.matchedArtifactId).toBe('room:1');
  });

  it('detects low suspicion when text structurally resembles AI output', () => {
    const aiText = '他每天早上六点起床,先跑步半小时,然后去菜市场买菜,回来做早饭给全家人吃';
    const fp = computeFingerprint('room:1', 's1', aiText);

    // Witness slightly paraphrases the same narrative
    const witnessText = '他每天早上六点起床,先跑步半小时,然后去菜市场买菜,回来做早饭给家人吃';
    const result = screenReflux(witnessText, [fp]);
    // Should detect at least low similarity
    expect(['low', 'high']).toContain(result.suspicion);
  });

  it('returns none for empty text', () => {
    const fp = computeFingerprint('room:1', 's1', 'some ai text');
    expect(screenReflux('', [fp]).suspicion).toBe('none');
  });
});

/* ------------------------------------------------------------------ */
/* Invariant: threshold is 0.5                                         */
/* ------------------------------------------------------------------ */

describe('reflux constants', () => {
  it('minhash size is 128', () => {
    expect(MINHASH_SIZE).toBe(128);
  });

  it('reflux threshold is 0.5', () => {
    expect(REFLUX_THRESHOLD).toBe(0.5);
  });
});
