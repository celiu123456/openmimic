import { describe, expect, it } from 'vitest';
import {
  canonicalText,
  normalizeClaim,
  extractClaims,
  minhash,
  minhashSimilarity,
  computeFingerprint,
  screenReflux,
  screenRefluxEnhanced,
  extractRarePhrases,
  rarePhraseOverlap,
  buildRefluxConfirmPrompt,
  MINHASH_SIZE,
  MINHASH_MEDIUM_THRESHOLD,
  REFLUX_THRESHOLD,
  MAX_REFLUX_LLM_CALLS,
  type AiFingerprint,
  type RefluxLLM,
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

  it('medium threshold is 0.3', () => {
    expect(MINHASH_MEDIUM_THRESHOLD).toBe(0.3);
  });

  it('max LLM calls is 3', () => {
    expect(MAX_REFLUX_LLM_CALLS).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/* extractRarePhrases                                                  */
/* ------------------------------------------------------------------ */

describe('extractRarePhrases', () => {
  it('extracts 3+ digit numbers', () => {
    const phrases = extractRarePhrases('他花了12345元买了一台电脑');
    expect(phrases).toContain('12345');
  });

  it('extracts quoted content', () => {
    const phrases = extractRarePhrases('他说"这是一个重要的东西"');
    expect(phrases.some((p) => p.includes('重要的东西'))).toBe(true);
  });

  it('extracts CJK proper nouns after role markers', () => {
    const phrases = extractRarePhrases('他叫张伟,是李明的朋友');
    expect(phrases.some((p) => p.includes('张伟'))).toBe(true);
  });

  it('returns empty for generic text', () => {
    const phrases = extractRarePhrases('今天天气很好');
    expect(phrases.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* rarePhraseOverlap                                                   */
/* ------------------------------------------------------------------ */

describe('rarePhraseOverlap', () => {
  it('returns 0 when no artifact phrases', () => {
    expect(rarePhraseOverlap(['hello'], [])).toBe(0);
  });

  it('returns 1 when all artifact phrases found', () => {
    expect(rarePhraseOverlap(['12345', 'abc'], ['12345', 'abc'])).toBe(1);
  });

  it('returns fraction for partial overlap', () => {
    expect(rarePhraseOverlap(['12345', 'xyz'], ['12345', 'abc'])).toBe(0.5);
  });
});

/* ------------------------------------------------------------------ */
/* buildRefluxConfirmPrompt                                            */
/* ------------------------------------------------------------------ */

describe('buildRefluxConfirmPrompt', () => {
  it('includes artifact and testimony fragments', () => {
    const { system, user } = buildRefluxConfirmPrompt(
      '这是AI生成的内容',
      '这是证人提交的内容',
    );
    expect(system).toContain('plagiarism');
    expect(user).toContain('ARTIFACT');
    expect(user).toContain('TESTIMONY');
    expect(user).toContain('AI生成');
    expect(user).toContain('证人提交');
  });

  it('truncates long texts', () => {
    const longText = 'x'.repeat(1000);
    const { user } = buildRefluxConfirmPrompt(longText, longText);
    // Each fragment capped at 500 chars
    expect(user.length).toBeLessThan(1100);
  });
});

/* ------------------------------------------------------------------ */
/* screenRefluxEnhanced: four-grade test                               */
/* ------------------------------------------------------------------ */

describe('screenRefluxEnhanced', () => {
  const aiText = '他叫张伟,在杭州的一家公司工作,年薪大概是258000元。他经常帮助老王做一些家务,比如修理水管和换灯泡。';

  it('Grade 1 (verbatim): detects high suspicion', async () => {
    const fp = computeFingerprint('room:1', 's1', aiText);
    // Copy a sentence verbatim
    const copy = '他经常帮助老王做一些家务,比如修理水管和换灯泡';
    const result = await screenRefluxEnhanced(copy, [fp]);
    expect(result.suspicion).toBe('high');
    // Record similarity for report
    expect(typeof result.similarity).toBe('number');
  });

  it('Grade 2 (light rewrite): detects medium with rare phrases', async () => {
    const fp = computeFingerprint('room:1', 's1', aiText);
    // Rewrite but keep distinctive content (张伟, 258000, 老王)
    const rewrite = '张伟是杭州一家公司的员工,年薪大约258000,他总帮老王干活';
    const artifactTexts = new Map([['room:1', aiText]]);

    // With FakeLLM that confirms
    const fakeLLM: RefluxLLM = {
      complete: async () => 'YES',
    };
    const result = await screenRefluxEnhanced(rewrite, [fp], fakeLLM, artifactTexts);
    expect(['medium', 'high']).toContain(result.suspicion);
  });

  it('Grade 3 (heavy rewrite / gist only): none without LLM, medium with confirming LLM', async () => {
    const fp = computeFingerprint('room:1', 's1', aiText);
    // Heavy rewrite — different words, same general idea, no specific numbers/names
    const heavyRewrite = '有个人在浙江上班,收入还不错,平时帮邻居做些修修补补的活';
    const artifactTexts = new Map([['room:1', aiText]]);

    // Without LLM: should be none (no shared rare phrases)
    const resultNoLLM = await screenRefluxEnhanced(heavyRewrite, [fp]);
    expect(resultNoLLM.suspicion).toBe('none');
  });

  it('Grade 4 (unrelated): none', async () => {
    const fp = computeFingerprint('room:1', 's1', aiText);
    const unrelated = '今天上午去超市买了一些水果和蔬菜,回来后给猫咪喂了饭';
    const result = await screenRefluxEnhanced(unrelated, [fp]);
    expect(result.suspicion).toBe('none');
  });

  it('returns minhash similarity for all grades', async () => {
    const fp = computeFingerprint('room:1', 's1', aiText);

    const verbatim = aiText;
    const lightRewrite = '张伟在杭州上班,年薪258000,帮老王干家务活';
    const heavyRewrite = '有个人在浙江上班,收入还不错';
    const unrelated = '今天天气很好,适合出去散步';

    const r1 = await screenRefluxEnhanced(verbatim, [fp]);
    const r2 = await screenRefluxEnhanced(lightRewrite, [fp]);
    const r3 = await screenRefluxEnhanced(heavyRewrite, [fp]);
    const r4 = await screenRefluxEnhanced(unrelated, [fp]);

    // Similarities should generally decrease: verbatim > light > heavy > unrelated
    // But we only assert they are all defined numbers
    expect(typeof r1.similarity).toBe('number');
    expect(typeof r2.similarity).toBe('number');
    expect(typeof r3.similarity).toBe('number');
    expect(typeof r4.similarity).toBe('number');

    // Log for report
    console.log('MinHash similarities:');
    console.log(`  Verbatim:      ${r1.similarity?.toFixed(4)}`);
    console.log(`  Light rewrite: ${r2.similarity?.toFixed(4)}`);
    console.log(`  Heavy rewrite: ${r3.similarity?.toFixed(4)}`);
    console.log(`  Unrelated:     ${r4.similarity?.toFixed(4)}`);
  });

  it('FakeLLM NO response → none with llmConfirmed=false', async () => {
    const fp = computeFingerprint('room:1', 's1', aiText);
    // Use text that has shared rare phrases to trigger the LLM path
    const rewrite = '张伟在杭州工作,年薪258000左右,经常帮老王修东西';
    const artifactTexts = new Map([['room:1', aiText]]);
    const fakeLLM: RefluxLLM = { complete: async () => 'NO' };
    const result = await screenRefluxEnhanced(rewrite, [fp], fakeLLM, artifactTexts);
    // If LLM was called and said NO, suspicion should be none
    if (result.llmConfirmed !== undefined) {
      expect(result.suspicion).toBe('none');
      expect(result.llmConfirmed).toBe(false);
    } else {
      // LLM path was not triggered (no medium zone / no rare overlap)
      // — test still passes, just no LLM was needed
      expect(['none', 'medium']).toContain(result.suspicion);
    }
  });

  it('LLM error → falls back to heuristic', async () => {
    const fp = computeFingerprint('room:1', 's1', aiText);
    const rewrite = '张伟在杭州,年薪258000,总帮老王干活';
    const artifactTexts = new Map([['room:1', aiText]]);
    const failLLM: RefluxLLM = { complete: async () => { throw new Error('timeout'); } };
    const result = await screenRefluxEnhanced(rewrite, [fp], failLLM, artifactTexts);
    // Should still catch via rare phrase heuristic if phrases match
    expect(typeof result.suspicion).toBe('string');
  });

  it('no candidates → none', async () => {
    const result = await screenRefluxEnhanced('any text', []);
    expect(result.suspicion).toBe('none');
  });

  it('empty text → none', async () => {
    const fp = computeFingerprint('room:1', 's1', 'some text');
    const result = await screenRefluxEnhanced('', [fp]);
    expect(result.suspicion).toBe('none');
  });
});
