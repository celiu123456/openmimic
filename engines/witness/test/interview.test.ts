import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import {
  FakeLLM,
  INTERVIEW_SESSION_TTL_MS,
  InterviewSessionInvalidError,
  InterviewSessionStateSchema,
  InterviewStateError,
  MAX_FOLLOWUPS_PER_SESSION,
  answerFollowup,
  answerQuestion,
  createInvite,
  finishInterview,
  hasConcreteDetail,
  parseFollowup,
  startInterview,
  type InterviewOptions,
  type InterviewStep,
} from '@openmimic/engine-witness';

/** An answer with no number, quote or time marker and under 40 characters. */
const BARE = '他人挺好的，挺随和。';
/** An unambiguous concrete incident (well over the 40-character threshold). */
const STORY =
  '前年冬天我搬家，他请了一天假来帮忙，从早上八点搬到下午三点，连口水都没顾上喝，最后还是他开车把最后一箱书送到楼下的。';

const FOLLOWUP_LINE = '{"followup":"哪件事让你这么觉得？"}';

function sessionState(store: Store, sessionId: string) {
  const record = store.getInterviewSession(sessionId);
  if (!record) throw new Error('session missing');
  return InterviewSessionStateSchema.parse(record.state);
}

const isQuestion = (
  step: InterviewStep,
): step is Extract<InterviewStep, { question: unknown }> => 'question' in step;

describe('follow-up heuristic', () => {
  it('treats a long answer, a number, a quote or a time marker as concrete', () => {
    expect(hasConcreteDetail('a'.repeat(40))).toBe(true);
    expect(hasConcreteDetail('a'.repeat(39))).toBe(false);
    expect(hasConcreteDetail('他借了我200块')).toBe(true);
    expect(hasConcreteDetail('他说“你少来这套”')).toBe(true);
    expect(hasConcreteDetail('有一回他把单买了')).toBe(true);
    expect(hasConcreteDetail('那天他先走了')).toBe(true);
    expect(hasConcreteDetail(BARE)).toBe(false);
  });

  it('parses a bare, fenced or prose-wrapped follow-up object', () => {
    expect(parseFollowup(FOLLOWUP_LINE)).toBe('哪件事让你这么觉得？');
    expect(parseFollowup('```json\n{"followup":"举个例？"}\n```')).toBe('举个例？');
    expect(parseFollowup('好的：{"followup":"当时是什么情况？"}')).toBe('当时是什么情况？');
    expect(() => parseFollowup('没有 JSON')).toThrow();
  });
});

describe('interview session state machine', () => {
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

  it('asks for a follow-up only when the answer carries no concrete detail', async () => {
    const llm = new FakeLLM([FOLLOWUP_LINE]);
    const { sessionId } = startInterview(store, token, options);

    const step = await answerQuestion(
      store,
      sessionId,
      { text: BARE },
      { ...options, llm, navigatorInterval: 0 },
    );

    expect(step).toEqual({ followup: '哪件事让你这么觉得？' });
    expect(llm.calls).toHaveLength(1);
    // The v2 system prompt: casual style, no chaining, no grading, no labels.
    expect(llm.calls[0]?.system).toContain('不要连环问');
    expect(llm.calls[0]?.system).toContain('不贴标签');
    expect(llm.calls[0]?.user).toContain(BARE);

    // The follow-up reply moves to the next question.
    const next = answerFollowup(
      store,
      sessionId,
      { text: '就上个礼拜，他帮我搬了两箱书，然后自己走了。' },
      options,
    );
    expect(isQuestion(next) && next.index === 1).toBe(true);
  });

  it('never calls the model when the answer already contains an incident', async () => {
    const llm = new FakeLLM([]);
    const { sessionId } = startInterview(store, token, options);

    const step = await answerQuestion(
      store,
      sessionId,
      { text: STORY },
      { ...options, llm },
    );

    expect(isQuestion(step) && step.index === 1).toBe(true);
    expect(llm.calls).toHaveLength(0);
  });

  it('never calls the model for a short answer that names a time', async () => {
    const llm = new FakeLLM([]);
    const { sessionId } = startInterview(store, token, options);

    const step = await answerQuestion(
      store,
      sessionId,
      { text: '有一回他先走了。' },
      { ...options, llm },
    );

    expect(isQuestion(step) && step.index === 1).toBe(true);
    expect(llm.calls).toHaveLength(0);
  });

  it('limits bare-evaluation follow-ups to one, and stops after the budget', async () => {
    const llm = new FakeLLM(Array.from({ length: 20 }, () => FOLLOWUP_LINE));
    const llmOpts = { ...options, llm, navigatorInterval: 0 };
    const { sessionId } = startInterview(store, token, options);

    // v2 policy: a bare evaluation (no clue) gets at most 1 follow-up across
    // the entire interview. The first bare answer triggers a follow-up...
    const step1 = await answerQuestion(store, sessionId, { text: BARE }, llmOpts);
    expect('followup' in step1).toBe(true);
    answerFollowup(store, sessionId, { skip: true }, options);
    expect(llm.calls).toHaveLength(1);

    // ...but the second bare answer does NOT get a follow-up (bare-eval cap).
    const step2 = await answerQuestion(store, sessionId, { text: BARE }, llmOpts);
    expect(isQuestion(step2)).toBe(true);
    expect('followup' in step2).toBe(false);
    expect(llm.calls).toHaveLength(1);

    // An answer with a clue still gets a follow-up (budget not yet exhausted).
    const CLUE = '记得有一次他帮了我';
    const step3 = await answerQuestion(store, sessionId, { text: CLUE }, llmOpts);
    expect('followup' in step3).toBe(true);
    answerFollowup(store, sessionId, { skip: true }, options);

    // After MAX_FOLLOWUPS_PER_SESSION calls, the budget is exhausted.
    let calls = llm.calls.length;
    for (let i = calls; i < MAX_FOLLOWUPS_PER_SESSION; i++) {
      await answerQuestion(store, sessionId, { text: CLUE }, llmOpts);
      answerFollowup(store, sessionId, { skip: true }, options);
    }
    expect(llm.calls).toHaveLength(MAX_FOLLOWUPS_PER_SESSION);

    // Beyond the budget, even a clue-bearing answer gets no follow-up.
    const beyond = await answerQuestion(store, sessionId, { text: CLUE }, llmOpts);
    expect(isQuestion(beyond)).toBe(true);
    expect('followup' in beyond).toBe(false);
    expect(llm.calls).toHaveLength(MAX_FOLLOWUPS_PER_SESSION);
  });

  it('gives up the follow-up when the model output is unusable', async () => {
    const llm = new FakeLLM(['这不是 JSON']);
    const { sessionId } = startInterview(store, token, options);

    const step = await answerQuestion(store, sessionId, { text: BARE }, { ...options, llm, navigatorInterval: 0 });

    expect(isQuestion(step) && step.index === 1).toBe(true);
    expect(llm.calls).toHaveLength(1);
    expect(sessionState(store, sessionId).followupCount).toBe(1);
  });

  it('records a skipped question as avoided and never asks its follow-up', async () => {
    const llm = new FakeLLM([FOLLOWUP_LINE]);
    const { sessionId } = startInterview(store, token, options);

    const step = await answerQuestion(store, sessionId, { skip: true }, { ...options, llm });

    expect(isQuestion(step) && step.index === 1).toBe(true);
    expect(sessionState(store, sessionId).avoidedQids).toEqual(['q1']);
    expect(llm.calls).toHaveLength(0);
  });

  it('records a skipped follow-up as a silence, not an empty followupText', async () => {
    const llm = new FakeLLM([FOLLOWUP_LINE]);
    const { sessionId } = startInterview(store, token, options);

    await answerQuestion(store, sessionId, { text: BARE }, { ...options, llm, navigatorInterval: 0 });
    answerFollowup(store, sessionId, { skip: true }, options);

    const answers = sessionState(store, sessionId).answers;
    expect(answers[0]).toMatchObject({ qid: 'q1', behindText: BARE });
    expect(answers[0]?.followupText).toBeUndefined();
  });

  it('refuses a follow-up answer when no follow-up is waiting', () => {
    const { sessionId } = startInterview(store, token, options);

    expect(() => answerFollowup(store, sessionId, { text: '嗯' }, options)).toThrow(
      InterviewStateError,
    );
  });

  it('lets a client correct an earlier answer without spending a follow-up', async () => {
    const llm = new FakeLLM([FOLLOWUP_LINE]);
    const llmOpts = { ...options, llm, navigatorInterval: 0 };
    const { sessionId } = startInterview(store, token, options);

    await answerQuestion(store, sessionId, { text: BARE }, llmOpts);
    answerFollowup(store, sessionId, { skip: true }, options);

    const step = await answerQuestion(
      store,
      sessionId,
      { qid: 'q1', text: '他其实挺护着人的，去年替同事背过锅。', frontText: '我会当面谢他。' },
      llmOpts,
    );
    expect(isQuestion(step) && step.index === 1).toBe(true);
    expect(llm.calls).toHaveLength(1);

    const answer = sessionState(store, sessionId).answers.find((entry) => entry.qid === 'q1');
    expect(answer?.behindText).toContain('背过锅');
    expect(answer?.frontText).toBe('我会当面谢他。');
  });

  it('never follows up when no model is configured', async () => {
    const { sessionId } = startInterview(store, token, options);

    const step = await answerQuestion(store, sessionId, { text: BARE }, options);
    expect(isQuestion(step) && step.index === 1).toBe(true);
  });

  it('purges an expired session the next time it is touched', async () => {
    const { sessionId } = startInterview(store, token, options);

    // One millisecond short of the TTL: still alive.
    nowMs += INTERVIEW_SESSION_TTL_MS - 1;
    await expect(
      answerQuestion(store, sessionId, { text: BARE }, options),
    ).resolves.toMatchObject({ index: 1 });
    expect(store.getInterviewSession(sessionId)).toBeDefined();

    // At the TTL the session is purged lazily and the caller is told.
    nowMs += 1;
    await expect(
      answerQuestion(store, sessionId, { text: BARE }, options),
    ).rejects.toThrow(InterviewSessionInvalidError);
    expect(store.getInterviewSession(sessionId)).toBeUndefined();
  });
});

describe('interview finish', () => {
  let store: Store;
  let options: InterviewOptions;
  let token: string;
  let nowMs: number;
  let idCounter: number;

  beforeEach(() => {
    store = new Store();
    nowMs = Date.parse('2026-10-05T09:00:00.000Z');
    idCounter = 0;
    options = {
      now: () => new Date(nowMs),
      newId: () => `id-${(idCounter += 1)}`,
    };
    token = createInvite(store, 's1', { now: new Date(nowMs) }).token;
  });

  afterEach(() => {
    store.close();
  });

  it('assembles a testimony with followupText kept apart and avoidedQids kept', async () => {
    const llm = new FakeLLM([FOLLOWUP_LINE]);
    const llmOpts = { ...options, llm, navigatorInterval: 0 };
    const { sessionId } = startInterview(store, token, options);

    // q1: concrete long answer with a front answer, no follow-up.
    await answerQuestion(
      store,
      sessionId,
      { text: STORY, frontText: '这事我会当面提。' },
      llmOpts,
    );
    // q2: bare answer, follow-up, answered.
    await answerQuestion(store, sessionId, { text: BARE }, llmOpts);
    await answerFollowup(
      store,
      sessionId,
      { text: '上个月团建他悄悄把单买了，还让大家别声张。' },
      options,
    );
    // q3: explicitly skipped.
    await answerQuestion(store, sessionId, { skip: true }, options);

    const result = finishInterview(
      store,
      sessionId,
      { relation: '大学同学', consentLevel: 'quotable' },
      options,
    );

    const testimony = store.getTestimony(result.testimonyId);
    expect(testimony).toBeDefined();
    expect(testimony?.answers).toHaveLength(2);
    expect(testimony?.avoidedQids).toEqual(['q3']);

    const q1 = testimony?.answers.find((answer) => answer.qid === 'q1');
    expect(q1?.behindText).toBe(STORY);
    expect(q1?.frontText).toBe('这事我会当面提。');
    expect(q1?.followupText).toBeUndefined();

    const q2 = testimony?.answers.find((answer) => answer.qid === 'q2');
    expect(q2?.behindText).toBe(BARE);
    expect(q2?.followupText).toBe('上个月团建他悄悄把单买了，还让大家别声张。');
    // The follow-up is stored beside the raw answer, never concatenated into it.
    expect(q2?.behindText).not.toContain('团建');

    // The draft is gone; the ledger entry is the only thing that survives.
    expect(store.getInterviewSession(sessionId)).toBeUndefined();
    expect(store.listBySubject('s1')).toHaveLength(1);
  });

  it('round-trips avoidedQids and followupText through the ledger', async () => {
    const llm = new FakeLLM([FOLLOWUP_LINE]);
    const llmOpts = { ...options, llm, navigatorInterval: 0 };
    const { sessionId } = startInterview(store, token, options);
    await answerQuestion(store, sessionId, { text: BARE }, llmOpts);
    await answerFollowup(store, sessionId, { text: '他去年悄悄帮我垫了房租。' }, options);
    await answerQuestion(store, sessionId, { skip: true }, options);

    const result = finishInterview(
      store,
      sessionId,
      { relation: '朋友', consentLevel: 'synthesis_only' },
      options,
    );

    const reread = store.getTestimony(result.testimonyId);
    expect(reread?.answers[0]?.followupText).toBe('他去年悄悄帮我垫了房租。');
    expect(reread?.avoidedQids).toEqual(['q2']);
  });

  it('accepts a client-held draft and can jump straight to a later question', async () => {
    const llm = new FakeLLM([FOLLOWUP_LINE]);
    const llmOpts = { ...options, llm, navigatorInterval: 0 };
    const { sessionId } = startInterview(store, token, options);

    // A refreshed client resumes at q4 without replaying q1..q3.
    const step = await answerQuestion(
      store,
      sessionId,
      { qid: 'q4', text: BARE },
      llmOpts,
    );
    expect('followup' in step).toBe(true);
    await answerFollowup(store, sessionId, { skip: true }, options);

    const result = finishInterview(
      store,
      sessionId,
      {
        relation: '朋友',
        consentLevel: 'quotable',
        answers: [
          { qid: 'q1', behindText: '第一题的答案。' },
          { qid: 'q4', behindText: BARE, followupText: '上个月他悄悄把单买了。' },
        ],
        avoidedQids: ['q2', 'q3'],
      },
      options,
    );

    const testimony = store.getTestimony(result.testimonyId);
    expect(testimony?.answers.map((answer) => answer.qid)).toEqual(['q1', 'q4']);
    expect(testimony?.answers[1]?.followupText).toBe('上个月他悄悄把单买了。');
    expect(testimony?.avoidedQids).toEqual(['q2', 'q3']);
  });
});
