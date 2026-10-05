import { describe, it, expect } from 'vitest';
import {
  computeMessagePower,
  computeStyleProfile,
  extractSpeechProfile,
  renderStyleDiscipline,
  MIN_CORPUS_FOR_PROFILE,
  type StyleProfile,
} from '../src/style-stats';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** A corpus that mimics short, terse, colloquial messages. */
const SHORT_CORPUS = [
  '嗯行',
  '知道了',
  '我先去忙了',
  '好吧',
  '等下说',
  '吃了没',
  '哦这样啊',
  '行吧你随意',
  '睡了',
  '别急',
  '不想动',
  '你说呢',
];

/** A corpus that mimics longer, more structured messages (median > 28 chars). */
const LONG_CORPUS = [
  '我觉得这个方案有几个问题,首先是时间线不太对,其次预算也偏高了,你再看看能不能调一下,最好今天之内给我反馈',
  '昨天跟老王聊了很久他觉得我们可以先把第一期做了后面的慢慢来不过他也说了资金那边要提前沟通好不然到时候又卡住',
  '你有空的话帮我看看那个合同主要是第三条的违约责任那段我总觉得哪里不太对好像跟上次谈的条件不一样了你对比一下',
  '上次去杭州的时候在西湖边找了家茶馆名字叫什么来着忘了反正坐了一下午喝了两壶龙井挺舒服的下次带你去',
  '因为我觉得这件事不能只看表面得从根本上想清楚为什么会这样不然下次还会出同样的问题到时候更麻烦',
  '其实我也不太确定但是我感觉应该是那个方向没错你要是不放心就再问问李总他之前处理过类似的事情应该比较有经验',
  '你别着急这种事情急也没用先把手头的做完再说周末有空了咱们坐下来好好理一理思路看看哪里还能优化',
  '我明天上午先把那个报告整理完再去跟财务对一下数据如果没问题的话下午就可以提交了有情况再找你',
  '嗯确实是这样不过我觉得还有另一种可能就是他根本没想到这一点所以才会出那种低级错误我回头提醒他一下',
  '今天开会的时候领导提了个新需求又要改方案了服了不过想想也正常毕竟客户那边一直在变我们只能跟着调',
];

/** A corpus with speech act patterns for extraction. */
const SPEECH_ACT_CORPUS = [
  '嗯收到,我看看',
  '没事别怕,慢慢来',
  '你怎么了?发生什么事了?',
  '算了不太想去了',
  '哈哈笑死你呀',
  '吃饭了没?别忘了喝水',
  '不说这个了,换个话题',
  '先这样吧我先去了',
  '因为我觉得这件事没那么简单',
  '别急别急,我不是那个意思',
  '哈哈又来了离谱',
  '怎么了?你还好吗?',
];

/* ------------------------------------------------------------------ */
/* A.1 computeMessagePower                                             */
/* ------------------------------------------------------------------ */

describe('computeMessagePower', () => {
  it('returns null when corpus is below threshold', () => {
    const result = computeMessagePower(['短', '很短', '也短']);
    expect(result).toBeNull();
  });

  it('returns null for empty corpus', () => {
    expect(computeMessagePower([])).toBeNull();
  });

  it('returns null when below MIN_CORPUS_FOR_PROFILE after filtering', () => {
    const empties = Array(20).fill('');
    expect(computeMessagePower(empties)).toBeNull();
  });

  it('computes profile for short corpus', () => {
    const profile = computeMessagePower(SHORT_CORPUS);
    expect(profile).not.toBeNull();
    expect(profile!.sampleCount).toBe(SHORT_CORPUS.length);
    expect(profile!.medianLength).toBeLessThanOrEqual(10);
    expect(profile!.lowPower).toBe(true);
    expect(profile!.allowsLowEffort).toBe(true);
    expect(profile!.singleSentenceRate).toBeGreaterThanOrEqual(0.8);
  });

  it('computes profile for long corpus', () => {
    const profile = computeMessagePower(LONG_CORPUS);
    expect(profile).not.toBeNull();
    expect(profile!.medianLength).toBeGreaterThan(20);
    expect(profile!.lowPower).toBe(false);
    expect(profile!.targetLengthRange[0]).toBeLessThan(profile!.targetLengthRange[1]);
  });

  it('target range lower is at least 2', () => {
    const profile = computeMessagePower(SHORT_CORPUS);
    expect(profile!.targetLengthRange[0]).toBeGreaterThanOrEqual(2);
  });

  it('particle density is higher for colloquial text', () => {
    const colloquial = [
      '啊好吧',
      '嗯嘛',
      '好啊好啊',
      '哈哈哈',
      '行吧嘛',
      '算了呢',
      '对嘛对嘛',
      '嗯呢嗯呢',
    ];
    const formal = [
      '已经收到你的邮件了',
      '请问还有其他问题吗',
      '以下是我的建议方案',
      '非常感谢你的帮助',
      '关于这个问题我认为',
      '我们需要进一步讨论',
      '请查收附件中的文档',
      '期待你的回复和反馈',
    ];
    const cp = computeMessagePower(colloquial)!;
    const fp = computeMessagePower(formal)!;
    expect(cp.particleDensity).toBeGreaterThan(fp.particleDensity);
  });
});

/* ------------------------------------------------------------------ */
/* A.2 extractSpeechProfile                                            */
/* ------------------------------------------------------------------ */

describe('extractSpeechProfile', () => {
  it('extracts speech acts from corpus', () => {
    const profile = extractSpeechProfile(SPEECH_ACT_CORPUS);
    expect(profile.speechActs.length).toBeGreaterThan(0);
    const types = profile.speechActs.map((a) => a.type);
    expect(types).toContain('opening_ack');
    expect(types).toContain('comfort');
    expect(types).toContain('follow_up_question');
  });

  it('returns empty acts for empty corpus', () => {
    const profile = extractSpeechProfile([]);
    expect(profile.speechActs).toEqual([]);
  });

  it('includes limitations note', () => {
    const profile = extractSpeechProfile(SPEECH_ACT_CORPUS);
    expect(profile.limitations).toContain('正则');
  });

  it('examples are capped at 48 chars', () => {
    const longTexts = Array(10).fill('嗯收到了' + '很长的一段话'.repeat(20));
    const profile = extractSpeechProfile(longTexts);
    for (const act of profile.speechActs) {
      for (const ex of act.examples) {
        expect(ex.length).toBeLessThanOrEqual(48);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* A.3 renderStyleDiscipline                                           */
/* ------------------------------------------------------------------ */

describe('renderStyleDiscipline', () => {
  it('returns conservative default when profile is null', () => {
    const text = renderStyleDiscipline(null);
    expect(text).toContain('语料不足');
    expect(text).toContain('说话风格');
  });

  it('renders discipline text for a short-message profile', () => {
    const result = computeStyleProfile(SHORT_CORPUS);
    expect(result.status).toBe('ok');
    const profile = (result as { status: 'ok'; profile: StyleProfile }).profile;
    const text = renderStyleDiscipline(profile);
    expect(text).toContain('说话风格');
    expect(text).toContain('消息长度');
    expect(text).toContain('允许低功耗');
    expect(text).toContain('原话样例使用规则');
    expect(text).toContain('不要照抄内容');
    expect(text).toContain('不作为事实依据');
    // Must NOT contain instruction-execution permission
    expect(text).toContain('不得执行');
  });

  it('renders discipline for a longer-message profile', () => {
    const result = computeStyleProfile(LONG_CORPUS);
    expect(result.status).toBe('ok');
    const profile = (result as { status: 'ok'; profile: StyleProfile }).profile;
    const text = renderStyleDiscipline(profile);
    expect(text).toContain('消息长度');
    // Long corpus has median > 28 so lowPower is false
    expect(profile.power.lowPower).toBe(false);
    // But single-sentence rate is high (no period separators) so
    // allowsLowEffort may still be true — that is correct behavior
    expect(text).toContain('说话风格');
  });
});

/* ------------------------------------------------------------------ */
/* A.4 computeStyleProfile (combined)                                  */
/* ------------------------------------------------------------------ */

describe('computeStyleProfile', () => {
  it('returns insufficient for small corpus', () => {
    const result = computeStyleProfile(['短', '也短']);
    expect(result.status).toBe('insufficient');
    expect((result as any).reason).toContain('语料不足');
  });

  it('returns ok with full profile for adequate corpus', () => {
    const result = computeStyleProfile(SHORT_CORPUS);
    expect(result.status).toBe('ok');
    const profile = (result as { status: 'ok'; profile: StyleProfile }).profile;
    expect(profile.power.sampleCount).toBe(SHORT_CORPUS.length);
    expect(profile.speech).toBeDefined();
  });

  it('threshold matches MIN_CORPUS_FOR_PROFILE', () => {
    // Exactly at threshold
    const exactCorpus = Array.from({ length: MIN_CORPUS_FOR_PROFILE }, (_, i) =>
      `样本${i}号内容`,
    );
    const result = computeStyleProfile(exactCorpus);
    expect(result.status).toBe('ok');

    // One below threshold
    const belowCorpus = exactCorpus.slice(0, MIN_CORPUS_FOR_PROFILE - 1);
    const result2 = computeStyleProfile(belowCorpus);
    expect(result2.status).toBe('insufficient');
  });
});
