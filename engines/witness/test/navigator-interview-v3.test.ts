/**
 * v3 feature tests: navigator memo, ASR low-confidence, graceful closing.
 *
 * Tests 1-10:  Navigator memo schema and hard constraints
 * Tests 11-17: Navigator influence on follow-up and question selection
 * Tests 18-19: No-model degradation (existing behaviour unchanged)
 * Tests 20-23: ASR low-confidence detection (heuristic)
 * Tests 24-28: Graceful closing and pacing
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import {
  FakeLLM,
  InterviewSessionStateSchema,
  NavigatorMemoSchema,
  NAVIGATOR_MEMO_INTERVAL,
  MAX_NAVIGATOR_CALLS_PER_SESSION,
  MAX_FOLLOWUPS_PER_SESSION,
  SHORT_ANSWER_THRESHOLD,
  CONSECUTIVE_SHORT_LIMIT,
  OPENING_EXPECTATION,
  answerFollowup,
  answerQuestion,
  buildNavigatorUserPrompt,
  createInvite,
  finishInterview,
  generateNavigatorMemo,
  hasClue,
  memoAvoidsDirection,
  memoSuggestsClosing,
  parseNavigatorMemo,
  shouldPursueLiveThread,
  startInterview,
  type InterviewOptions,
  type InterviewStep,
  type NavigatorMemo,
} from '@openmimic/engine-witness';
import {
  heuristicConfidence,
  DEFAULT_ASR_CONFIDENCE_THRESHOLD,
  readAsrConfidenceThreshold,
} from '../../../server/src/asr';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const BARE = '他人挺好的，挺随和。';
const STORY =
  '前年冬天我搬家，他请了一天假来帮忙，从早上八点搬到下午三点，连口水都没顾上喝，最后还是他开车把最后一箱书送到楼下的。';
const CLUE = '记得有一次他帮了我';
const SHORT = '嗯。';

const FOLLOWUP_LINE = '{"followup":"哪件事让你这么觉得？"}';

/** A valid navigator memo JSON (no question marks anywhere). */
const VALID_MEMO: NavigatorMemo = {
  throughAnswerCount: 3,
  evidenceBacked: ['搬家时他请假帮忙,从早到晚'],
  tentativeInferences: ['他在行动上表达关心,言语较少'],
  liveThreads: ['搬家那次的细节,证人主动提到但未展开'],
  avoid: [],
  interviewFeedback: [],
  respondentPace: '回答较详细,节奏适中',
  foregroundGuidance: {
    focusArea: '具体互动场景',
    focusRationale: '证人已给出一个场景但还有展开空间',
    avoidDirection: '泛泛评价类问题',
    pace: '保持当前节奏即可',
  },
};

const VALID_MEMO_JSON = JSON.stringify(VALID_MEMO);

/** A memo with fatigue signals in respondentPace. */
const FATIGUED_MEMO: NavigatorMemo = {
  ...VALID_MEMO,
  respondentPace: '回答越来越短,参与度下降,可能疲劳',
  foregroundGuidance: {
    ...VALID_MEMO.foregroundGuidance,
    pace: '证人疲倦,建议尽快收尾',
  },
};

function sessionState(store: Store, sessionId: string) {
  const record = store.getInterviewSession(sessionId);
  if (!record) throw new Error('session missing');
  return InterviewSessionStateSchema.parse(record.state);
}

const isQuestion = (
  step: InterviewStep,
): step is Extract<InterviewStep, { question: unknown }> => 'question' in step;

const isDone = (step: InterviewStep): step is { done: true } => 'done' in step;

/* ------------------------------------------------------------------ */
/* Test setup                                                          */
/* ------------------------------------------------------------------ */

let store: Store;
let options: InterviewOptions;
let token: string;
let nowMs: number;
let idCounter: number;

beforeEach(() => {
  store = new Store();
  nowMs = Date.parse('2026-10-05T09:00:00.000Z');
  idCounter = 0;
  const now = () => new Date(nowMs);
  const newId = () => `id-${(idCounter += 1)}`;
  options = { now, newId };
  const invite = createInvite(store, 's1', { now: new Date(nowMs) });
  token = invite.token;
});

afterEach(() => {
  store.close();
});

/* ================================================================== */
/* 1. Navigator memo schema                                            */
/* ================================================================== */

describe('navigator memo schema', () => {
  it('1: accepts a well-formed memo without question marks', () => {
    const result = NavigatorMemoSchema.safeParse(VALID_MEMO);
    expect(result.success).toBe(true);
  });

  it('2: rejects a memo with a question mark in evidenceBacked', () => {
    const bad = { ...VALID_MEMO, evidenceBacked: ['他是不是经常帮忙?'] };
    const result = NavigatorMemoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('3: rejects a memo with a full-width question mark in liveThreads', () => {
    const bad = { ...VALID_MEMO, liveThreads: ['搬家的事具体怎样？'] };
    const result = NavigatorMemoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('4: rejects a memo with a question mark in foregroundGuidance.focusArea', () => {
    const bad = {
      ...VALID_MEMO,
      foregroundGuidance: {
        ...VALID_MEMO.foregroundGuidance,
        focusArea: '具体互动场景?',
      },
    };
    const result = NavigatorMemoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('5: rejects a memo with a question mark in respondentPace', () => {
    const bad = { ...VALID_MEMO, respondentPace: '是否在走神?' };
    const result = NavigatorMemoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('6: rejects extra fields (strict mode)', () => {
    const bad = { ...VALID_MEMO, candidateQuestion: '下一个问...' };
    const result = NavigatorMemoSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('7: parseNavigatorMemo round-trips valid JSON', () => {
    const memo = parseNavigatorMemo(VALID_MEMO_JSON);
    expect(memo.throughAnswerCount).toBe(3);
    expect(memo.foregroundGuidance.focusArea).toBe('具体互动场景');
  });

  it('8: parseNavigatorMemo handles fenced JSON', () => {
    const fenced = '```json\n' + VALID_MEMO_JSON + '\n```';
    const memo = parseNavigatorMemo(fenced);
    expect(memo.throughAnswerCount).toBe(3);
  });

  it('9: parseNavigatorMemo throws on invalid structure', () => {
    expect(() => parseNavigatorMemo('{"not":"a memo"}')).toThrow();
  });

  it('10: parseNavigatorMemo throws when memo contains questions', () => {
    const bad = { ...VALID_MEMO, evidenceBacked: ['他帮忙了吗?'] };
    expect(() => parseNavigatorMemo(JSON.stringify(bad))).toThrow();
  });
});

/* ================================================================== */
/* 2. Memo influence helpers                                           */
/* ================================================================== */

describe('navigator memo influence helpers', () => {
  it('11: shouldPursueLiveThread returns true when threads exist', () => {
    expect(shouldPursueLiveThread(VALID_MEMO)).toBe(true);
  });

  it('12: shouldPursueLiveThread returns false when no threads', () => {
    const empty = { ...VALID_MEMO, liveThreads: [] };
    expect(shouldPursueLiveThread(empty)).toBe(false);
  });

  it('13: memoSuggestsClosing detects fatigue signals', () => {
    expect(memoSuggestsClosing(FATIGUED_MEMO)).toBe(true);
  });

  it('14: memoSuggestsClosing returns false for normal pace', () => {
    expect(memoSuggestsClosing(VALID_MEMO)).toBe(false);
  });

  it('15: memoAvoidsDirection matches against avoid list', () => {
    const memo: NavigatorMemo = {
      ...VALID_MEMO,
      avoid: ['家庭关系方面的问题已引发反感'],
    };
    expect(memoAvoidsDirection(memo, '家庭关系')).toBe(true);
    expect(memoAvoidsDirection(memo, '工作')).toBe(false);
  });

  it('16: memoAvoidsDirection matches against foregroundGuidance.avoidDirection', () => {
    const memo: NavigatorMemo = {
      ...VALID_MEMO,
      foregroundGuidance: {
        ...VALID_MEMO.foregroundGuidance,
        avoidDirection: '经济话题已触发防御',
      },
    };
    expect(memoAvoidsDirection(memo, '经济')).toBe(true);
  });
});

/* ================================================================== */
/* 3. Navigator memo generation via FakeLLM                            */
/* ================================================================== */

describe('navigator memo generation', () => {
  it('17: generateNavigatorMemo returns parsed memo on valid LLM output', async () => {
    const llm = new FakeLLM([VALID_MEMO_JSON]);
    const memo = await generateNavigatorMemo(
      llm,
      [{ qid: 'q1', behindText: STORY }],
      [{ qid: 'q1', prompt: '你怎么看他?', followupHint: '' }],
      [],
      1,
      null,
    );
    expect(memo).toBeDefined();
    expect(memo!.throughAnswerCount).toBe(3);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.system).toContain('导航员');
  });

  it('18: generateNavigatorMemo returns undefined on garbage output', async () => {
    const llm = new FakeLLM(['not json', 'still not json']);
    const memo = await generateNavigatorMemo(
      llm,
      [{ qid: 'q1', behindText: STORY }],
      [{ qid: 'q1', prompt: '你怎么看他?', followupHint: '' }],
      [],
      1,
      null,
    );
    expect(memo).toBeUndefined();
    // Initial attempt + repair attempt = 2 calls
    expect(llm.calls).toHaveLength(2);
  });

  it('19: generateNavigatorMemo repairs a memo with question marks', async () => {
    const badMemo = { ...VALID_MEMO, evidenceBacked: ['他帮忙了吗?'] };
    const llm = new FakeLLM([
      JSON.stringify(badMemo),
      VALID_MEMO_JSON, // repair succeeds
    ]);
    const memo = await generateNavigatorMemo(
      llm,
      [{ qid: 'q1', behindText: STORY }],
      [{ qid: 'q1', prompt: '你怎么看他?', followupHint: '' }],
      [],
      1,
      null,
    );
    expect(memo).toBeDefined();
    expect(memo!.evidenceBacked).not.toContain('他帮忙了吗?');
    expect(llm.calls).toHaveLength(2);
  });

  it('20: buildNavigatorUserPrompt wraps answers as untrusted', () => {
    const prompt = buildNavigatorUserPrompt(
      [{ qid: 'q1', behindText: '他借了我200块' }],
      [{ qid: 'q1', prompt: '你怎么看他?', followupHint: '' }],
      [],
      1,
      null,
    );
    expect(prompt).toContain('EXTERNAL_CONTENT_BEGIN');
    expect(prompt).toContain('他借了我200块');
    expect(prompt).toContain('截至第 1 题');
  });
});

/* ================================================================== */
/* 4. Navigator integration with interview state machine               */
/* ================================================================== */

describe('navigator interview integration', () => {
  it('21: navigator memo fires every N answers and is stored in state', async () => {
    // Script: 3 followup responses + 1 navigator memo (at answer 3)
    const llm = new FakeLLM([
      FOLLOWUP_LINE,                    // followup for answer 1 (BARE)
      FOLLOWUP_LINE,                    // followup for answer 2 (CLUE)
      VALID_MEMO_JSON,                  // navigator at answer 3
      FOLLOWUP_LINE,                    // followup for answer 3 (CLUE)
    ]);
    const navOpts = { ...options, llm, navigatorInterval: 3 };
    const { sessionId } = startInterview(store, token, options);

    // Answer 1: bare, gets followup
    await answerQuestion(store, sessionId, { text: BARE }, navOpts);
    answerFollowup(store, sessionId, { skip: true }, options);

    // Answer 2: clue, gets followup
    await answerQuestion(store, sessionId, { text: CLUE }, navOpts);
    answerFollowup(store, sessionId, { skip: true }, options);

    // Before answer 3, no memo yet
    expect(sessionState(store, sessionId).navigatorMemo).toBeUndefined();
    expect(sessionState(store, sessionId).navigatorCallCount).toBeUndefined();

    // Answer 3: triggers navigator (3 % 3 == 0)
    await answerQuestion(store, sessionId, { text: CLUE }, navOpts);
    answerFollowup(store, sessionId, { skip: true }, options);

    const state = sessionState(store, sessionId);
    expect(state.navigatorMemo).toBeDefined();
    expect(state.navigatorCallCount).toBe(1);
  });

  it('22: navigator does not fire when navigatorInterval is 0', async () => {
    const llm = new FakeLLM(Array.from({ length: 10 }, () => FOLLOWUP_LINE));
    const navOpts = { ...options, llm, navigatorInterval: 0 };
    const { sessionId } = startInterview(store, token, options);

    // Answer 3 questions
    for (let i = 0; i < 3; i++) {
      await answerQuestion(store, sessionId, { text: CLUE }, navOpts);
      answerFollowup(store, sessionId, { skip: true }, options);
    }

    // No navigator calls were made — only followup calls
    const navCalls = llm.calls.filter((c) => c.purpose === 'navigator');
    expect(navCalls).toHaveLength(0);
    expect(sessionState(store, sessionId).navigatorCallCount).toBeUndefined();
  });

  it('23: navigator budget is capped at MAX_NAVIGATOR_CALLS_PER_SESSION', async () => {
    // With interval=1, every answer triggers a navigator. Budget is 4.
    const totalAnswers = MAX_NAVIGATOR_CALLS_PER_SESSION + 2; // 6
    const script: string[] = [];
    for (let i = 0; i < totalAnswers; i++) {
      script.push(VALID_MEMO_JSON); // navigator
      // No followup for STORY (has concrete detail, skips followup)
    }
    const llm = new FakeLLM(script);
    const navOpts = { ...options, llm, navigatorInterval: 1 };
    const { sessionId } = startInterview(store, token, options);

    for (let i = 0; i < totalAnswers; i++) {
      await answerQuestion(store, sessionId, { text: STORY }, navOpts);
    }

    const state = sessionState(store, sessionId);
    // Budget capped: only MAX_NAVIGATOR_CALLS_PER_SESSION calls made
    expect(state.navigatorCallCount).toBe(MAX_NAVIGATOR_CALLS_PER_SESSION);
    // Consumed entries = 4 (navigator) + 0 (no followup for STORY)
    const navCalls = llm.calls.filter((c) => c.purpose === 'navigator');
    expect(navCalls).toHaveLength(MAX_NAVIGATOR_CALLS_PER_SESSION);
  });

  it('24: memo fatigue signal suppresses follow-up', async () => {
    // First: answer 3 questions with normal memo. On the 4th answer,
    // the memo says closing. Follow-up should be suppressed.
    const script: string[] = [
      FOLLOWUP_LINE,                               // followup for answer 1
      FOLLOWUP_LINE,                               // followup for answer 2
      JSON.stringify(FATIGUED_MEMO),               // navigator at answer 3 (fatigue)
      // No followup expected for answer 3 due to fatigue memo
    ];
    const llm = new FakeLLM(script);
    const navOpts = { ...options, llm, navigatorInterval: 3 };
    const { sessionId } = startInterview(store, token, options);

    // Answer 1 (BARE -> followup)
    await answerQuestion(store, sessionId, { text: BARE }, navOpts);
    answerFollowup(store, sessionId, { skip: true }, options);

    // Answer 2 (CLUE -> followup)
    await answerQuestion(store, sessionId, { text: CLUE }, navOpts);
    answerFollowup(store, sessionId, { skip: true }, options);

    // Answer 3: triggers navigator with fatigue memo.
    // Even though CLUE normally gets a followup, the fatigued memo
    // should suppress it (memoSuggestsClosing returns true).
    const step3 = await answerQuestion(store, sessionId, { text: CLUE }, navOpts);
    // Because the memo suggests closing, followup is suppressed -> advance to next question
    expect(isQuestion(step3)).toBe(true);
    expect('followup' in step3).toBe(false);
  });
});

/* ================================================================== */
/* 5. No-model degradation                                             */
/* ================================================================== */

describe('no-model degradation', () => {
  it('25: without llm, answers advance linearly with no followup or memo', async () => {
    const { sessionId } = startInterview(store, token, options);

    const step1 = await answerQuestion(store, sessionId, { text: BARE }, options);
    expect(isQuestion(step1)).toBe(true);
    if (isQuestion(step1)) expect(step1.index).toBe(1);

    const state = sessionState(store, sessionId);
    expect(state.navigatorMemo).toBeUndefined();
    expect(state.navigatorCallCount).toBeUndefined();
    expect(state.followupCount).toBe(0);
  });

  it('26: without llm, closing suggestion still works via short answers', async () => {
    const { sessionId } = startInterview(store, token, options);

    // First short answer
    await answerQuestion(store, sessionId, { text: SHORT }, options);
    // Second short answer: should suggest closing
    const step2 = await answerQuestion(store, sessionId, { text: SHORT }, options);
    expect(isQuestion(step2)).toBe(true);
    if (isQuestion(step2)) {
      expect(step2.closingSuggested).toBe(true);
    }
  });
});

/* ================================================================== */
/* 6. ASR low-confidence detection (heuristic)                         */
/* ================================================================== */

describe('ASR heuristic confidence', () => {
  it('27: empty text returns confidence 0', () => {
    expect(heuristicConfidence('')).toBe(0);
    expect(heuristicConfidence('  ')).toBe(0);
  });

  it('28: single character returns low confidence (0.3)', () => {
    expect(heuristicConfidence('啊')).toBe(0.3);
  });

  it('29: mostly non-CJK garbled text returns low confidence', () => {
    const garbled = 'asdfghjkl';
    expect(heuristicConfidence(garbled)).toBeLessThan(DEFAULT_ASR_CONFIDENCE_THRESHOLD);
  });

  it('30: normal Chinese sentence returns high confidence', () => {
    expect(heuristicConfidence('他人挺好的，挺随和。')).toBe(0.9);
  });

  it('31: readAsrConfidenceThreshold defaults to 0.72', () => {
    const threshold = readAsrConfidenceThreshold({} as NodeJS.ProcessEnv);
    expect(threshold).toBe(0.72);
  });

  it('32: readAsrConfidenceThreshold reads from env', () => {
    const threshold = readAsrConfidenceThreshold({
      ASR_CONFIDENCE_THRESHOLD: '0.5',
    } as unknown as NodeJS.ProcessEnv);
    expect(threshold).toBe(0.5);
  });

  it('33: readAsrConfidenceThreshold clamps to [0, 1]', () => {
    const high = readAsrConfidenceThreshold({
      ASR_CONFIDENCE_THRESHOLD: '2.0',
    } as unknown as NodeJS.ProcessEnv);
    expect(high).toBe(1);
    const low = readAsrConfidenceThreshold({
      ASR_CONFIDENCE_THRESHOLD: '-0.5',
    } as unknown as NodeJS.ProcessEnv);
    expect(low).toBe(0);
  });
});

/* ================================================================== */
/* 7. Graceful closing and pacing                                      */
/* ================================================================== */

describe('graceful closing', () => {
  it('34: opening expectation is returned at session start', () => {
    const { opening } = startInterview(store, token, options);
    expect(opening).toBe(OPENING_EXPECTATION);
    expect(opening).toContain('跳过');
    expect(opening).toContain('结束');
  });

  it('35: consecutive short answers trigger closingSuggested', async () => {
    const llm = new FakeLLM(Array.from({ length: 10 }, () => FOLLOWUP_LINE));
    const navOpts = { ...options, llm, navigatorInterval: 0 };
    const { sessionId } = startInterview(store, token, options);

    // First answer: short bare answer gets a followup (bare cap = 1)
    const step1 = await answerQuestion(store, sessionId, { text: SHORT }, navOpts);
    expect('followup' in step1).toBe(true);
    answerFollowup(store, sessionId, { skip: true }, options);

    // Second short answer: bare cap already spent, so no followup.
    // closingSuggested fires because 2 consecutive short answers.
    const step2 = await answerQuestion(store, sessionId, { text: SHORT }, navOpts);
    expect(isQuestion(step2)).toBe(true);
    if (isQuestion(step2)) {
      expect(step2.closingSuggested).toBe(true);
    }
  });

  it('36: a substantive answer resets the short-answer counter', async () => {
    // No LLM: no followups, pure state machine. Focus on short-answer tracking.
    const { sessionId } = startInterview(store, token, options);

    // One short answer (consecutiveShort = 1)
    await answerQuestion(store, sessionId, { text: SHORT }, options);
    expect(sessionState(store, sessionId).consecutiveShortAnswers).toBe(1);

    // Substantive answer resets (consecutiveShort = 0)
    await answerQuestion(store, sessionId, { text: STORY }, options);
    expect(sessionState(store, sessionId).consecutiveShortAnswers).toBe(0);

    // One more short answer (consecutiveShort = 1, NOT 2)
    const step3 = await answerQuestion(store, sessionId, { text: SHORT }, options);
    expect(sessionState(store, sessionId).consecutiveShortAnswers).toBe(1);
    if (isQuestion(step3)) {
      // Only 1 consecutive short, not enough for closing suggestion
      expect(step3.closingSuggested).toBeFalsy();
    }
  });

  it('37: SHORT_ANSWER_THRESHOLD correctly classifies answers', () => {
    // SHORT ('嗯。') is 2 characters, well under threshold
    expect(Array.from(SHORT).length).toBeLessThan(SHORT_ANSWER_THRESHOLD);
    // BARE ('他人挺好的，挺随和。') is 9 characters, still under 15
    expect(Array.from(BARE).length).toBeLessThan(SHORT_ANSWER_THRESHOLD);
    // STORY is well above
    expect(Array.from(STORY).length).toBeGreaterThan(SHORT_ANSWER_THRESHOLD);
  });

  it('38: consecutiveShortAnswers is persisted in session state', async () => {
    const { sessionId } = startInterview(store, token, options);

    await answerQuestion(store, sessionId, { text: SHORT }, options);
    expect(sessionState(store, sessionId).consecutiveShortAnswers).toBe(1);

    await answerQuestion(store, sessionId, { text: SHORT }, options);
    expect(sessionState(store, sessionId).consecutiveShortAnswers).toBe(2);

    // Substantive answer resets
    await answerQuestion(store, sessionId, { text: STORY }, options);
    expect(sessionState(store, sessionId).consecutiveShortAnswers).toBe(0);
  });

  it('39: closingSuggested from fatigued memo triggers even with long answers', async () => {
    // All answers are long (STORY), but navigator memo says fatigue.
    // closingSuggested should be true from memo, not from short answers.
    const script: string[] = [];
    for (let i = 0; i < 3; i++) {
      // STORY has concrete detail -> no followup generated
      // Navigator fires at answer 3
    }
    script.push(JSON.stringify(FATIGUED_MEMO)); // navigator at answer 3
    const llm = new FakeLLM(script);
    const navOpts = { ...options, llm, navigatorInterval: 3 };
    const { sessionId } = startInterview(store, token, options);

    await answerQuestion(store, sessionId, { text: STORY }, navOpts);
    await answerQuestion(store, sessionId, { text: STORY }, navOpts);
    // Answer 3 triggers navigator
    const step3 = await answerQuestion(store, sessionId, { text: STORY }, navOpts);
    expect(isQuestion(step3)).toBe(true);
    if (isQuestion(step3)) {
      expect(step3.closingSuggested).toBe(true);
    }
  });

  it('40: early submission still records already-answered parts', async () => {
    const { sessionId } = startInterview(store, token, options);

    // Answer 2 questions, then finish early
    await answerQuestion(store, sessionId, { text: STORY }, options);
    await answerQuestion(store, sessionId, { text: BARE }, options);

    const result = finishInterview(
      store,
      sessionId,
      { relation: '朋友', consentLevel: 'quotable' },
      options,
    );

    const testimony = store.getTestimony(result.testimonyId);
    expect(testimony).toBeDefined();
    expect(testimony?.answers).toHaveLength(2);
    expect(testimony?.answers[0]?.behindText).toBe(STORY);
    expect(testimony?.answers[1]?.behindText).toBe(BARE);
    // No avoidedQids since we just stopped early without explicitly skipping
    expect(testimony?.avoidedQids ?? []).toEqual([]);
  });
});

/* ================================================================== */
/* 8. Constants and configuration                                      */
/* ================================================================== */

describe('v3 constants', () => {
  it('41: NAVIGATOR_MEMO_INTERVAL defaults to 3', () => {
    expect(NAVIGATOR_MEMO_INTERVAL).toBe(3);
  });

  it('42: MAX_NAVIGATOR_CALLS_PER_SESSION defaults to 4', () => {
    expect(MAX_NAVIGATOR_CALLS_PER_SESSION).toBe(4);
  });

  it('43: SHORT_ANSWER_THRESHOLD is 15', () => {
    expect(SHORT_ANSWER_THRESHOLD).toBe(15);
  });

  it('44: CONSECUTIVE_SHORT_LIMIT is 2', () => {
    expect(CONSECUTIVE_SHORT_LIMIT).toBe(2);
  });

  it('45: DEFAULT_ASR_CONFIDENCE_THRESHOLD is 0.72', () => {
    expect(DEFAULT_ASR_CONFIDENCE_THRESHOLD).toBe(0.72);
  });
});
