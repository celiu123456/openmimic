/**
 * Tests for the v2 interview modules:
 * - input-intent: intent classification
 * - retreat: sensitive retreat detection
 * - basis: evidence basis classification
 * - privacy: doNotRaiseToSubject and verbatim leak detection
 * - interview-state: quality gate, phase tracking, new shouldAskFollowup
 * - witness-v2: questionnaire variants and strategy selection
 */
import { describe, expect, it } from 'vitest';

import {
  classifyIntent,
  type InputIntent,
} from '@openmimic/engine-witness';

import {
  detectRetreat,
  detectReopen,
} from '@openmimic/engine-witness';

import {
  classifyBasis,
  basisConvictionCeiling,
} from '@openmimic/engine-witness';

import {
  isVisibleToSubject,
  hasVerbatimLeak,
} from '@openmimic/engine-witness';

import {
  isSingleQuestion,
  containsPrematureEnding,
  twoGrams,
  twoGramJaccard,
  isDuplicateFollowup,
  followupPassesGate,
  phaseOf,
  hasClue,
  shouldAskFollowup,
} from '@openmimic/engine-witness';

import {
  WITNESS_V2_FRIEND,
  WITNESS_V2_FAMILY,
  WITNESS_V2_COLLEAGUE,
  WITNESS_V2_QUESTIONNAIRES,
  pickV2Questionnaire,
  strategyFor,
  OBSERVER_DIMENSIONS,
} from '@openmimic/engine-witness';

import { computeConviction } from '@openmimic/engine-court';

/* ================================================================== */
/* Input intent                                                        */
/* ================================================================== */

describe('input-intent: classifyIntent', () => {
  it('classifies normal content', () => {
    const r = classifyIntent('他人挺好的，很随和。');
    expect(r.primary).toBe('CONTENT');
    expect(r.shouldStop).toBe(false);
    expect(r.shouldSkip).toBe(false);
  });

  it('detects safety signals', () => {
    const r = classifyIntent('他家暴了好几年');
    expect(r.hasSafetySignal).toBe(true);
    expect(r.primary).toBe('SAFETY_SIGNAL');
  });

  it('detects stop intent', () => {
    const r = classifyIntent('不想继续聊了');
    expect(r.shouldStop).toBe(true);
    expect(r.primary).toBe('STOP');
  });

  it('detects pause intent', () => {
    const r = classifyIntent('先暂停吧，改天再说');
    expect(r.shouldPause).toBe(true);
  });

  it('detects skip intent', () => {
    const r = classifyIntent('这个话题不想说');
    expect(r.shouldSkip).toBe(true);
    expect(r.primary).toBe('SKIP_TOPIC');
  });

  it('detects interview feedback', () => {
    const r = classifyIntent('你这问题问得太奇怪了');
    expect(r.intents).toContain('INTERVIEW_FEEDBACK');
    expect(r.isFeedbackOnly).toBe(true);
  });

  it('detects correction', () => {
    const r = classifyIntent('你理解错了，我不是这个意思');
    expect(r.hasCorrection).toBe(true);
  });

  it('detects uncertainty but not as retreat', () => {
    const r = classifyIntent('记不清了');
    expect(r.intents).toContain('UNCERTAINTY');
    expect(r.shouldSkip).toBe(false);
  });

  it('detects low willingness', () => {
    const r = classifyIntent('随便吧');
    expect(r.intents).toContain('LOW_WILLINGNESS');
    expect(r.fatigueDelta).toBeGreaterThan(0);
  });

  it('mixes content with control', () => {
    const r = classifyIntent('不想说太多，但其实他对人挺好的');
    expect(r.intents).toContain('LOW_WILLINGNESS');
    expect(r.intents).toContain('CONTENT');
    // Not feedback-only because there is substantive content
    expect(r.isFeedbackOnly).toBe(false);
  });

  it('handles empty input', () => {
    const r = classifyIntent('');
    expect(r.primary).toBe('CONTENT');
  });
});

/* ================================================================== */
/* Retreat detection                                                   */
/* ================================================================== */

describe('retreat: detectRetreat', () => {
  it('detects volitional refusal', () => {
    expect(detectRetreat('这个不想说')).toEqual({ kind: 'volitional_refusal' });
    expect(detectRetreat('别问了')).toEqual({ kind: 'volitional_refusal' });
    expect(detectRetreat('换个话题吧')).toEqual({ kind: 'volitional_refusal' });
    expect(detectRetreat('关于他这个不想说')).toEqual({ kind: 'volitional_refusal' });
  });

  it('detects distress withdrawal', () => {
    expect(detectRetreat('太痛苦了说不下去')).toEqual({ kind: 'distress_withdrawal' });
  });

  it('does NOT treat memory inability as retreat', () => {
    expect(detectRetreat('记不清了')).toBeUndefined();
    expect(detectRetreat('想不起来了')).toBeUndefined();
  });

  it('returns undefined for normal content', () => {
    expect(detectRetreat('他挺好的')).toBeUndefined();
  });
});

describe('retreat: detectReopen', () => {
  it('detects reopening', () => {
    expect(detectReopen('其实我想说说那件事')).toBe(true);
  });

  it('rejects questions', () => {
    expect(detectReopen('其实我想说说那件事？')).toBe(false);
  });

  it('rejects short text', () => {
    expect(detectReopen('嗯')).toBe(false);
  });
});

/* ================================================================== */
/* Evidence basis                                                      */
/* ================================================================== */

describe('basis: classifyBasis', () => {
  it('classifies witnessed', () => {
    expect(classifyBasis('我亲眼看到他帮了那个人')).toBe('witnessed');
    expect(classifyBasis('当时他就站在那里')).toBe('witnessed');
  });

  it('classifies heard', () => {
    expect(classifyBasis('听说他以前做过这事')).toBe('heard');
    expect(classifyBasis('他跟我说过他不喜欢那个')).toBe('heard');
  });

  it('classifies inferred', () => {
    expect(classifyBasis('我猜他可能是那样的人')).toBe('inferred');
    expect(classifyBasis('也许他不太喜欢社交')).toBe('inferred');
  });

  it('returns unknown for bare evaluations', () => {
    expect(classifyBasis('他人挺好的')).toBe('unknown');
  });
});

describe('basis: basisConvictionCeiling', () => {
  it('witnessed has no ceiling', () => {
    expect(basisConvictionCeiling('witnessed')).toBe(1.0);
  });

  it('heard caps at 0.7', () => {
    expect(basisConvictionCeiling('heard')).toBe(0.7);
  });

  it('inferred caps at 0.5', () => {
    expect(basisConvictionCeiling('inferred')).toBe(0.5);
  });
});

/* ================================================================== */
/* Privacy                                                             */
/* ================================================================== */

describe('privacy: isVisibleToSubject', () => {
  it('visible when quotable and not flagged', () => {
    expect(isVisibleToSubject({ consentLevel: 'quotable' })).toBe(true);
  });

  it('hidden when doNotRaiseToSubject is true', () => {
    expect(isVisibleToSubject({ doNotRaiseToSubject: true, consentLevel: 'quotable' })).toBe(false);
  });

  it('hidden when synthesis_only', () => {
    expect(isVisibleToSubject({ consentLevel: 'synthesis_only' })).toBe(false);
  });
});

describe('privacy: hasVerbatimLeak', () => {
  it('detects 8+ char overlap', () => {
    const source = '去年冬天他请了一天假来帮我搬家';
    const target = '他请了一天假来帮忙搬家';
    expect(hasVerbatimLeak(source, target, 8)).toBe(true);
  });

  it('passes when no long overlap', () => {
    const source = '去年冬天他帮我搬家';
    const target = '他是个好人';
    expect(hasVerbatimLeak(source, target, 8)).toBe(false);
  });

  it('handles short texts', () => {
    expect(hasVerbatimLeak('短', '短文', 8)).toBe(false);
  });
});

/* ================================================================== */
/* Quality gate                                                        */
/* ================================================================== */

describe('quality gate: isSingleQuestion', () => {
  it('accepts a single question', () => {
    expect(isSingleQuestion('你们平时多久见一次面？')).toBe(true);
  });

  it('rejects no question mark', () => {
    expect(isSingleQuestion('你们平时多久见一次面。')).toBe(false);
  });

  it('rejects multiple question marks', () => {
    expect(isSingleQuestion('你们多久见一次？平时聊什么？')).toBe(false);
  });

  it('rejects refusal patterns', () => {
    expect(isSingleQuestion('抱歉我不能回答这个问题？')).toBe(false);
  });
});

describe('quality gate: containsPrematureEnding', () => {
  it('detects premature endings', () => {
    expect(containsPrematureEnding('最后再问一个问题')).toBe(true);
    expect(containsPrematureEnding('今天就先聊到这里吧')).toBe(true);
    expect(containsPrematureEnding('谢谢你的分享')).toBe(true);
  });

  it('passes normal questions', () => {
    expect(containsPrematureEnding('你们多久见一次面？')).toBe(false);
  });
});

describe('quality gate: deduplication', () => {
  it('detects duplicates by Jaccard similarity', () => {
    expect(isDuplicateFollowup(
      '你们平时多久见一次面？',
      ['你们平时多久见一次面？'],
    )).toBe(true);
  });

  it('detects near-duplicates by containment', () => {
    expect(isDuplicateFollowup(
      '请问你们平时多久见一次面？',
      ['你们平时多久见一次面？'],
    )).toBe(true);
  });

  it('passes genuinely different questions', () => {
    expect(isDuplicateFollowup(
      '遇到压力的时候TA会怎么办？',
      ['你们平时多久见一次面？'],
    )).toBe(false);
  });
});

describe('quality gate: followupPassesGate', () => {
  it('passes a good single question', () => {
    expect(followupPassesGate('有没有哪件事让你印象特别深？', [])).toBe(true);
  });

  it('rejects a premature ending', () => {
    expect(followupPassesGate('最后再问一个，你觉得TA怎么样？', [])).toBe(false);
  });

  it('rejects a duplicate', () => {
    expect(followupPassesGate(
      '你们平时多久见一次面？',
      ['你们平时多久见一次面？'],
    )).toBe(false);
  });
});

/* ================================================================== */
/* Phase tracking                                                      */
/* ================================================================== */

describe('phaseOf', () => {
  it('returns icebreaker for 0-3', () => {
    expect(phaseOf(0)).toBe('icebreaker');
    expect(phaseOf(3)).toBe('icebreaker');
  });

  it('returns concrete_events for 4-6', () => {
    expect(phaseOf(4)).toBe('concrete_events');
    expect(phaseOf(6)).toBe('concrete_events');
  });

  it('returns feeling_meaning for 7-8', () => {
    expect(phaseOf(7)).toBe('feeling_meaning');
  });

  it('returns pattern_contrast for 9+', () => {
    expect(phaseOf(9)).toBe('pattern_contrast');
    expect(phaseOf(20)).toBe('pattern_contrast');
  });
});

/* ================================================================== */
/* Follow-up trigger (v2 anti-mechanical policy)                       */
/* ================================================================== */

describe('shouldAskFollowup v2', () => {
  it('never follows up on a long answer', () => {
    expect(shouldAskFollowup('a'.repeat(40), 0)).toBe(false);
  });

  it('follows up on a bare evaluation (first time only)', () => {
    expect(shouldAskFollowup('他人挺好的', 0)).toBe(true);
    expect(shouldAskFollowup('他人挺好的', 1)).toBe(false);
  });

  it('follows up on a clue-bearing answer within budget', () => {
    expect(shouldAskFollowup('记得有一次他帮了我', 0)).toBe(true);
    expect(shouldAskFollowup('记得有一次他帮了我', 3)).toBe(true);
    expect(shouldAskFollowup('记得有一次他帮了我', 4)).toBe(true);
  });

  it('does not follow up on clues beyond budget', () => {
    expect(shouldAskFollowup('记得有一次他帮了我', 5)).toBe(false);
  });

  it('hasClue detects clue markers', () => {
    expect(hasClue('记得有一次他帮了我')).toBe(true);
    expect(hasClue('比如说上次那件事')).toBe(true);
    expect(hasClue('他人挺好的')).toBe(false);
  });
});

/* ================================================================== */
/* Witness v2 questionnaires                                           */
/* ================================================================== */

describe('witness-v2 questionnaires', () => {
  it('friend variant has 10 questions', () => {
    expect(WITNESS_V2_FRIEND.questions).toHaveLength(10);
    expect(WITNESS_V2_FRIEND.id).toBe('witness-v2-friend');
  });

  it('family variant has 9 questions', () => {
    expect(WITNESS_V2_FAMILY.questions).toHaveLength(9);
    expect(WITNESS_V2_FAMILY.id).toBe('witness-v2-family');
  });

  it('colleague variant has 8 questions', () => {
    expect(WITNESS_V2_COLLEAGUE.questions).toHaveLength(8);
    expect(WITNESS_V2_COLLEAGUE.id).toBe('witness-v2-colleague');
  });

  it('all variants are registered in WITNESS_V2_QUESTIONNAIRES', () => {
    expect(Object.keys(WITNESS_V2_QUESTIONNAIRES)).toHaveLength(3);
    expect(WITNESS_V2_QUESTIONNAIRES['witness-v2-friend']).toBeDefined();
    expect(WITNESS_V2_QUESTIONNAIRES['witness-v2-family']).toBeDefined();
    expect(WITNESS_V2_QUESTIONNAIRES['witness-v2-colleague']).toBeDefined();
  });

  it('all questions have dimensionId and sensitivity', () => {
    for (const q of WITNESS_V2_FRIEND.questions) {
      const v2q = q as unknown as { dimensionId: string; sensitivity: string };
      expect(v2q.dimensionId).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(v2q.sensitivity);
    }
  });

  it('high-sensitivity questions are in the back half', () => {
    const qs = WITNESS_V2_FRIEND.questions as unknown as Array<{ sensitivity: string }>;
    const highIndices = qs
      .map((q, i) => (q.sensitivity === 'high' ? i : -1))
      .filter((i) => i >= 0);
    const midpoint = Math.floor(qs.length / 2);
    for (const idx of highIndices) {
      expect(idx).toBeGreaterThanOrEqual(midpoint);
    }
  });

  it('OBSERVER_DIMENSIONS has 10 entries', () => {
    expect(OBSERVER_DIMENSIONS).toHaveLength(10);
  });
});

describe('questionnaire selection', () => {
  it('picks family for family relations', () => {
    expect(pickV2Questionnaire('父亲').id).toBe('witness-v2-family');
    expect(pickV2Questionnaire('妈妈').id).toBe('witness-v2-family');
    expect(pickV2Questionnaire('亲戚').id).toBe('witness-v2-family');
  });

  it('picks colleague for work relations', () => {
    expect(pickV2Questionnaire('同事').id).toBe('witness-v2-colleague');
    expect(pickV2Questionnaire('领导').id).toBe('witness-v2-colleague');
  });

  it('defaults to friend', () => {
    expect(pickV2Questionnaire('朋友').id).toBe('witness-v2-friend');
    expect(pickV2Questionnaire('同学').id).toBe('witness-v2-friend');
    expect(pickV2Questionnaire(undefined).id).toBe('witness-v2-friend');
  });
});

describe('relation strategies', () => {
  it('returns friend strategy by default', () => {
    expect(strategyFor('friend').key).toBe('friend');
    expect(strategyFor('unknown').key).toBe('friend');
  });

  it('returns family strategy', () => {
    expect(strategyFor('family').key).toBe('family');
    expect(strategyFor('family').taboo).toContain('缺点');
  });

  it('returns colleague strategy', () => {
    expect(strategyFor('colleague').key).toBe('colleague');
  });
});

/* ================================================================== */
/* Court conviction with basis                                         */
/* ================================================================== */

describe('computeConviction with basis ceiling', () => {
  const base = {
    witnessCount: 2,
    hasEpisode: true,
    allEpisodesElicited: false,
    wasPaired: true,
    isContested: false,
  };

  it('witnessed does not lower the score', () => {
    const withBasis = computeConviction({ ...base, weakestBasis: 'witnessed' });
    const withoutBasis = computeConviction(base);
    expect(withBasis).toBe(withoutBasis);
  });

  it('heard caps at 0.7', () => {
    const score = computeConviction({ ...base, weakestBasis: 'heard' });
    expect(score).toBeLessThanOrEqual(0.7);
  });

  it('inferred caps at 0.5', () => {
    const score = computeConviction({ ...base, weakestBasis: 'inferred' });
    expect(score).toBeLessThanOrEqual(0.5);
  });

  it('omitting basis does not change existing behavior', () => {
    const score = computeConviction(base);
    expect(score).toBeGreaterThan(0);
  });
});
