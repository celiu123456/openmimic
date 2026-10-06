/**
 * Tests for the v4 chat-based interviewer.
 *
 * All tests use FakeLLM — zero real network, zero real model.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import {
  FakeLLM,
  createInvite,
  startChat,
  say,
  finishChat,
  getChatHistory,
  buildSystemPrompt,
  buildMessages,
  validateSystemPrompt,
  sanitiseOutput,
  checkGuards,
  isAcknowledgementPlusQuestion,
  buildRepairInstruction,
  createChatSession,
  addAssistantTurn,
  addUserTurn,
  addCautiousTopic,
  removeCautiousTopic,
  askedQuestions,
  RETREAT_BOUNDARY_INJECTION,
  type PromptContext,
  type ChatInterviewOptions,
  type ChatSessionState,
} from '@openmimic/engine-witness';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function newStore(): Store {
  return new Store();
}

function createSubjectAndInvite(store: Store): { subjectId: string; token: string } {
  const subjectId = 'subject-1';
  store.putSubject({ id: subjectId, displayName: '林小满' });
  const invite = createInvite(store, subjectId);
  return { subjectId, token: invite.token };
}

const VALID_OPENING = '你好，我是访谈员，这段对话用来更完整地理解林小满，随时可以停。你们是怎么认识的？';
const VALID_ACK_QUESTION = '听起来那天挺难的。你后来是怎么跟他说的？';
const VALID_QUESTION_2 = '你觉得他是一个怎样的人？';
const VALID_QUESTION_3 = '他有什么特别的习惯吗？';
const VALID_FOLLOWUP = '你能举个例子吗？';

let idCounter = 0;
function deterministicId(): string {
  return `id-${++idCounter}`;
}

function makeOptions(llm: FakeLLM): ChatInterviewOptions {
  return {
    llm,
    now: () => new Date('2026-10-10T10:00:00Z'),
    newId: deterministicId,
  };
}

beforeEach(() => {
  idCounter = 0;
});

/* ------------------------------------------------------------------ */
/* 1. System prompt rendering                                          */
/* ------------------------------------------------------------------ */

describe('system prompt rendering', () => {
  it('renders informant prompt with correct variables', () => {
    const ctx: PromptContext = {
      mode: 'informant',
      respondentName: '你',
      relatedName: '林小满',
      relation: '朋友',
      uncoveredAspects: ['关系起点与共同经历', '亲眼见过的具体行为'],
      isOpening: false,
    };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('林小满');
    expect(prompt).toContain('朋友');
    expect(prompt).toContain('理解受访者眼中的 林小满');
    expect(prompt).toContain('关系起点与共同经历');
    expect(prompt).not.toContain('同一个人');
  });

  it('renders self prompt with "同一个人" sentence', () => {
    const ctx: PromptContext = {
      mode: 'self',
      respondentName: '林小满',
      relatedName: '林小满',
      relation: '自己',
      uncoveredAspects: [],
      isOpening: false,
    };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('同一个人');
    expect(prompt).toContain('帮助受访者用自己的语言讲述');
    expect(prompt).not.toContain('参考');
  });

  it('omits reference section when no uncovered aspects', () => {
    const ctx: PromptContext = {
      mode: 'informant',
      respondentName: '你',
      relatedName: '林小满',
      relation: '同事',
      uncoveredAspects: [],
      isOpening: false,
    };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).not.toContain('参考');
    expect(prompt).not.toContain('还没聊到');
  });

  it('renders relationship direction as "如何理解" not raw relation label', () => {
    const ctx: PromptContext = {
      mode: 'informant',
      respondentName: '张三',
      relatedName: '李四',
      relation: '朋友',
      uncoveredAspects: [],
      isOpening: false,
    };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('张三如何理解李四');
    expect(prompt).toContain('（李四的朋友）');
    expect(prompt).not.toContain('关系方向始终是 朋友');
  });

  it('renders self relationship direction as "如何理解自己"', () => {
    const ctx: PromptContext = {
      mode: 'self',
      respondentName: '林小满',
      relatedName: '林小满',
      relation: '自己',
      uncoveredAspects: [],
      isOpening: false,
    };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('林小满如何理解自己');
  });

  it('throws on unresolved {Anchor} placeholders', () => {
    // This tests the validation function
    expect(() => validateSystemPrompt('hello {UnknownAnchor} world')).toThrow(
      'unresolved placeholder',
    );
    expect(() => validateSystemPrompt('hello world？')).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* 2. Message history                                                  */
/* ------------------------------------------------------------------ */

describe('message history', () => {
  const now = new Date('2026-10-10T10:00:00Z');

  it('includes all effective turns, excludes rejected ones', () => {
    let state = createChatSession({
      sessionId: 's1',
      inviteToken: 't1',
      mode: 'informant',
      respondentName: '你',
      relatedName: '林小满',
      relation: '朋友',
      now,
    });
    state = addAssistantTurn(state, 'a1', '你好，你们是怎么认识的？', now);
    state = addUserTurn(state, 'u1', '大学认识的', now);
    // A rejected assistant turn
    state = addAssistantTurn(state, 'a2-bad', '不合格的输出', now, true);
    state = addAssistantTurn(state, 'a2', '大学时代有什么印象深的事吗？', now);

    const messages = buildMessages(state, 'system prompt', '他挺好的');
    // System + a1 + u1 + a2 + current user = 5 (rejected a2-bad excluded)
    const nonSystem = messages.filter((m) => m.role !== 'system');
    expect(nonSystem).toHaveLength(4); // a1, u1, a2, current user
    expect(nonSystem.map((m) => m.content)).not.toContain('不合格的输出');
  });

  it('trims oldest assistant question when history exceeds char limit, keeps user answer', () => {
    let state = createChatSession({
      sessionId: 's1',
      inviteToken: 't1',
      mode: 'informant',
      respondentName: '你',
      relatedName: '林小满',
      relation: '朋友',
      now,
    });
    // Create long history that exceeds a small limit
    const longText = 'A'.repeat(500);
    state = addAssistantTurn(state, 'a1', `第一问：${longText}？`, now);
    state = addUserTurn(state, 'u1', `第一答：${longText}`, now);
    state = addAssistantTurn(state, 'a2', `第二问？`, now);
    state = addUserTurn(state, 'u2', `第二答`, now);

    // With a small limit, the first assistant question should be trimmed
    const messages = buildMessages(state, 'sys', '新回答', 100);
    const contents = messages.filter((m) => m.role !== 'system').map((m) => m.content);
    // First user answer should be kept
    expect(contents.some((c) => c.includes('第一答'))).toBe(true);
    // First assistant question should be trimmed
    expect(contents.some((c) => c.includes('第一问'))).toBe(false);
  });

  it('does not generate summaries during trimming', () => {
    let state = createChatSession({
      sessionId: 's1',
      inviteToken: 't1',
      mode: 'informant',
      respondentName: '你',
      relatedName: '林小满',
      relation: '朋友',
      now,
    });
    state = addAssistantTurn(state, 'a1', '长问题'.repeat(200) + '？', now);
    state = addUserTurn(state, 'u1', '回答', now);

    const messages = buildMessages(state, 'sys', '新', 10);
    // No message should contain summary-like content
    const allContent = messages.map((m) => m.content).join(' ');
    expect(allContent).not.toContain('摘要');
    expect(allContent).not.toContain('summary');
  });
});

/* ------------------------------------------------------------------ */
/* 3. Guards                                                           */
/* ------------------------------------------------------------------ */

describe('guards', () => {
  it('rejects double question marks', () => {
    const result = checkGuards('你喜欢吃什么？你呢？', []);
    expect(result).toBe('not_single_question');
  });

  it('rejects output with no question mark', () => {
    const result = checkGuards('你喜欢吃什么。', []);
    expect(result).toBe('not_single_question');
  });

  it('rejects closing language: 最后再问一个', () => {
    expect(checkGuards('最后再问一个，你觉得呢？', [])).toBe('premature_ending');
  });

  it('rejects closing language: 今天就先聊到这', () => {
    expect(checkGuards('今天就先聊到这，你还想说什么吗？', [])).toBe('premature_ending');
  });

  it('rejects closing language: 收尾一下', () => {
    expect(checkGuards('收尾一下，你想怎么形容他？', [])).toBe('premature_ending');
  });

  it('rejects closing language: 谢谢你的分享', () => {
    expect(checkGuards('谢谢你的分享，还有想说的吗？', [])).toBe('premature_ending');
  });

  it('rejects duplicate with recent 12 questions', () => {
    const prev = Array.from({ length: 12 }, (_, i) => `第${i}个不相关的问题？`);
    prev[5] = '你们是怎么认识的呢？';
    // A near-duplicate of prev[5]
    const result = checkGuards('你们是怎么认识的？', prev);
    expect(result).toBe('duplicate');
  });

  it('rejects output starting with 抱歉', () => {
    const result = checkGuards('抱歉，我换个问题问你，你觉得呢？', []);
    expect(result).toBe('not_single_question');
  });

  it('isAcknowledgementPlusQuestion accepts valid acknowledgement + question', () => {
    expect(isAcknowledgementPlusQuestion('听起来那天挺难的。你后来是怎么跟他说的？')).toBe('你后来是怎么跟他说的？');
    expect(isAcknowledgementPlusQuestion('你觉得他是一个怎样的人？')).toBe('你觉得他是一个怎样的人？');
  });

  it('isAcknowledgementPlusQuestion rejects question mark in acknowledgement', () => {
    expect(isAcknowledgementPlusQuestion('他挺好的？那具体呢？')).toBeUndefined();
  });

  it('isAcknowledgementPlusQuestion rejects two acknowledgement sentences', () => {
    expect(isAcknowledgementPlusQuestion('原来如此。真有意思。你后来呢？')).toBeUndefined();
  });

  it('isAcknowledgementPlusQuestion rejects newline', () => {
    expect(isAcknowledgementPlusQuestion('嗯嗯。\n你后来呢？')).toBeUndefined();
  });

  it('passes a valid single question', () => {
    expect(checkGuards(VALID_QUESTION_2, [])).toBeUndefined();
  });

  it('passes acknowledgement + question: 听起来那天挺难的。你后来是怎么跟他说的？', () => {
    expect(checkGuards('听起来那天挺难的。你后来是怎么跟他说的？', [])).toBeUndefined();
  });

  it('passes opening: 你好，我是访谈员…你们是怎么认识的？', () => {
    expect(checkGuards(VALID_OPENING, [])).toBeUndefined();
  });

  it('rejects chained questions: 他挺好的？那具体呢？', () => {
    expect(checkGuards('他挺好的？那具体呢？', [])).toBe('not_single_question');
  });

  it('rejects two acknowledgement sentences: A。B。C？', () => {
    expect(checkGuards('原来是这样。真有意思。你后来怎么办的？', [])).toBe('not_single_question');
  });

  it('rejects newline in output', () => {
    expect(checkGuards('听起来挺好的。\n你后来呢？', [])).toBe('not_single_question');
  });
});

/* ------------------------------------------------------------------ */
/* 4. Repair chain                                                     */
/* ------------------------------------------------------------------ */

describe('repair and retreat text', () => {
  it('buildRepairInstruction includes rejected output wrapped as untrusted', () => {
    const instruction = buildRepairInstruction('坏输出没有问号');
    expect(instruction).toContain('【仅修复本次错误输出】');
    expect(instruction).toContain('坏输出没有问号');
    expect(instruction).toContain('只输出一个口语化、容易回答并以问句结束的下一问');
  });

  it('RETREAT_BOUNDARY_INJECTION contains old-platform boundary signal text', () => {
    expect(RETREAT_BOUNDARY_INJECTION).toContain('受访者边界信号');
    expect(RETREAT_BOUNDARY_INJECTION).toContain('温和地承认对方的感受');
    expect(RETREAT_BOUNDARY_INJECTION).toContain('转向更轻松且由受访者主导方向的问题');
  });
});

describe('repair chain', () => {
  it('first violation triggers repair, second pass succeeds with exactly 2 calls', async () => {
    const store = newStore();
    const { token } = createSubjectAndInvite(store);
    const llm = new FakeLLM([
      VALID_OPENING, // opening
    ]);
    const options = makeOptions(llm);
    await startChat(store, token, options);

    // Now test say: first call returns bad output, repair returns good
    llm.push('坏输出没有问号'); // first attempt fails guard
    llm.push(VALID_QUESTION_2); // repair succeeds

    const result = await say(store, 'id-1', { text: '他人挺好的' }, options);
    expect(result.message?.text).toBe(VALID_QUESTION_2);
    // Opening used 1 call; say used 2 calls = 3 total
    expect(llm.calls).toHaveLength(3);
  });

  it('two consecutive guard failures throw interview_generation_failed, history unchanged', async () => {
    const store = newStore();
    const { token } = createSubjectAndInvite(store);
    const llm = new FakeLLM([
      VALID_OPENING, // opening
    ]);
    const options = makeOptions(llm);
    const started = await startChat(store, token, options);

    // Both attempts fail
    llm.push('没有问号的废话'); // first attempt
    llm.push('还是没有问号'); // repair attempt

    await expect(
      say(store, started.sessionId, { text: '他人挺好的' }, options),
    ).rejects.toThrow('interview_generation_failed');

    // History should have the user turn + 2 rejected turns, but effective history unchanged
    const history = getChatHistory(store, started.sessionId, options);
    // Effective turns: opening assistant + user (rejected ones filtered out)
    const effectiveAssistant = history.turns.filter((t) => t.role === 'assistant');
    expect(effectiveAssistant).toHaveLength(1); // only the opening
  });
});

/* ------------------------------------------------------------------ */
/* 5. Retreat detection                                                */
/* ------------------------------------------------------------------ */

describe('retreat and reopen', () => {
  it('retreat injects boundary text and adds cautious topic', async () => {
    const store = newStore();
    const { token } = createSubjectAndInvite(store);
    const llm = new FakeLLM([
      VALID_OPENING, // opening
    ]);
    const options = makeOptions(llm);
    await startChat(store, token, options);

    // Answer with a retreat signal
    llm.push(VALID_QUESTION_2);
    await say(store, 'id-1', { text: '这个不想说' }, options);

    // Check that the system prompt for the next call contained retreat injection
    const lastCall = llm.calls[llm.calls.length - 1]!;
    expect(lastCall.system).toContain('受访者边界信号');
    expect(lastCall.system).toContain('不想在当前这个敏感方向上继续深入');
  });

  it('reopen removes cautious topic and does not inject boundary', async () => {
    const store = newStore();
    const { token } = createSubjectAndInvite(store);
    const llm = new FakeLLM([
      VALID_OPENING, // opening
    ]);
    const options = makeOptions(llm);
    await startChat(store, token, options);

    // Retreat
    llm.push(VALID_QUESTION_2);
    await say(store, 'id-1', { text: '不想说这个' }, options);

    // Reopen
    llm.push(VALID_QUESTION_3);
    await say(store, 'id-1', { text: '其实我想说一下那件事' }, options);

    // The last call should NOT contain retreat injection
    const lastCall = llm.calls[llm.calls.length - 1]!;
    expect(lastCall.system).not.toContain('受访者边界信号');
  });
});

/* ------------------------------------------------------------------ */
/* 6. Call count                                                       */
/* ------------------------------------------------------------------ */

describe('call count', () => {
  it('each normal turn uses exactly 1 LLM call', async () => {
    const store = newStore();
    const { token } = createSubjectAndInvite(store);
    const llm = new FakeLLM([
      VALID_OPENING, // opening
    ]);
    const options = makeOptions(llm);
    await startChat(store, token, options);
    expect(llm.calls).toHaveLength(1);

    llm.push(VALID_QUESTION_2);
    await say(store, 'id-1', { text: '他人挺好的' }, options);
    expect(llm.calls).toHaveLength(2);
  });

  it('empty content with finish_reason=length triggers exactly 1 retry (2 calls total for that turn)', async () => {
    const store = newStore();
    const { token } = createSubjectAndInvite(store);
    const llm = new FakeLLM([VALID_OPENING]);
    const options = makeOptions(llm);
    await startChat(store, token, options);
    expect(llm.calls).toHaveLength(1);

    // First call returns empty string with finish_reason=length;
    // retry returns a valid question.
    llm.pushWithFinishReason('', 'length');
    llm.push(VALID_QUESTION_2);

    const result = await say(store, 'id-1', { text: '他人挺好的' }, options);
    expect(result.message?.text).toBe(VALID_QUESTION_2);
    // Opening = 1 call, say first attempt = 1, retry = 1 → 3 total
    expect(llm.calls).toHaveLength(3);
    // The retry request should have a larger maxTokens
    const retryCall = llm.calls[2]!;
    expect(retryCall.maxTokens).toBe(1200);
  });

  it('v4 calls pass thinking=disabled and maxTokens', async () => {
    const store = newStore();
    const { token } = createSubjectAndInvite(store);
    const llm = new FakeLLM([VALID_OPENING]);
    const options = makeOptions(llm);
    await startChat(store, token, options);

    const openingCall = llm.calls[0]!;
    expect(openingCall.thinking).toBe('disabled');
    expect(openingCall.maxTokens).toBe(260);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Opening                                                          */
/* ------------------------------------------------------------------ */

describe('opening', () => {
  it('system prompt contains opening instruction when history is empty', async () => {
    const store = newStore();
    const { token } = createSubjectAndInvite(store);
    const llm = new FakeLLM([VALID_OPENING]);
    const options = makeOptions(llm);
    await startChat(store, token, options);

    expect(llm.calls[0]!.system).toContain('这是开场');
    expect(llm.calls[0]!.system).toContain('林小满');
  });
});

/* ------------------------------------------------------------------ */
/* 8. Finish: turns → answers                                          */
/* ------------------------------------------------------------------ */

describe('finish', () => {
  it('maps turns to answers with unique v4: qids and goes through submitTestimony', async () => {
    const store = newStore();
    const { subjectId, token } = createSubjectAndInvite(store);
    const llm = new FakeLLM([VALID_OPENING]);
    const options = makeOptions(llm);
    const started = await startChat(store, token, options);

    llm.push(VALID_QUESTION_2);
    await say(store, started.sessionId, { text: '大学认识的' }, options);

    llm.push(VALID_QUESTION_3);
    await say(store, started.sessionId, { text: '他很随和' }, options);

    const result = finishChat(
      store,
      started.sessionId,
      { consentLevel: 'quotable', relation: '大学同学' },
      options,
    );

    expect(result.count).toBe(1);
    expect(result.witnessId).toBeTruthy();
    expect(result.testimonyId).toBeTruthy();

    // Check testimony
    const testimony = store.getTestimony(result.testimonyId);
    expect(testimony).toBeDefined();
    expect(testimony!.answers).toHaveLength(2); // 2 Q&A pairs (opening has no user response paired)
    // All qids should start with v4:
    for (const answer of testimony!.answers) {
      expect(answer.qid).toMatch(/^v4:/);
    }
    // Qids should be unique
    const qids = testimony!.answers.map((a) => a.qid);
    expect(new Set(qids).size).toBe(qids.length);

    // Session should be purged
    expect(store.getInterviewSession(started.sessionId)).toBeUndefined();

    // Subject should have 1 testimony
    expect(store.listBySubject(subjectId)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* 9. Low-confidence speech                                            */
/* ------------------------------------------------------------------ */

describe('low-confidence speech', () => {
  it('returns confirm for low-confidence speech, does not enter history', async () => {
    const store = newStore();
    const { token } = createSubjectAndInvite(store);
    const llm = new FakeLLM([VALID_OPENING]);
    const options = makeOptions(llm);
    const started = await startChat(store, token, options);

    const result = await say(
      store,
      started.sessionId,
      { text: '他人挺好的', source: 'speech', asrConfidence: 0.5 },
      options,
    );
    expect(result.confirm).toBeDefined();
    expect(result.confirm!.text).toBe('他人挺好的');
    expect(result.message).toBeUndefined();

    // History should only have the opening, not the low-conf input
    const history = getChatHistory(store, started.sessionId, options);
    expect(history.turns).toHaveLength(1); // only opening
    // LLM should not have been called again
    expect(llm.calls).toHaveLength(1); // only opening
  });

  it('high-confidence speech enters history normally', async () => {
    const store = newStore();
    const { token } = createSubjectAndInvite(store);
    const llm = new FakeLLM([VALID_OPENING, VALID_QUESTION_2]);
    const options = makeOptions(llm);
    const started = await startChat(store, token, options);

    const result = await say(
      store,
      started.sessionId,
      { text: '大学认识的', source: 'speech', asrConfidence: 0.85 },
      options,
    );
    expect(result.message).toBeDefined();
    expect(result.confirm).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 10. Output sanitisation                                             */
/* ------------------------------------------------------------------ */

describe('output sanitisation', () => {
  it('strips code fences', () => {
    expect(sanitiseOutput('```\n你好吗？\n```')).toBe('你好吗？');
  });

  it('extracts question from JSON with question field', () => {
    expect(sanitiseOutput('{"question":"你好吗？"}')).toBe('你好吗？');
  });

  it('passes through plain text', () => {
    expect(sanitiseOutput('你好吗？')).toBe('你好吗？');
  });
});

/* ------------------------------------------------------------------ */
/* 11. Session state helpers                                           */
/* ------------------------------------------------------------------ */

describe('session state', () => {
  const now = new Date('2026-10-10T10:00:00Z');

  it('askedQuestions returns only non-rejected assistant texts', () => {
    let state = createChatSession({
      sessionId: 's1',
      inviteToken: 't1',
      mode: 'informant',
      respondentName: '你',
      relatedName: '林小满',
      relation: '朋友',
      now,
    });
    state = addAssistantTurn(state, 'a1', '问题一？', now);
    state = addAssistantTurn(state, 'a2', '被拒的问题？', now, true);
    state = addAssistantTurn(state, 'a3', '问题二？', now);

    const questions = askedQuestions(state);
    expect(questions).toEqual(['问题一？', '问题二？']);
  });

  it('addCautiousTopic is idempotent', () => {
    let state = createChatSession({
      sessionId: 's1',
      inviteToken: 't1',
      mode: 'informant',
      respondentName: '你',
      relatedName: '林小满',
      relation: '朋友',
      now,
    });
    state = addCautiousTopic(state, 'topic1');
    state = addCautiousTopic(state, 'topic1');
    expect(state.cautiousTopics).toEqual(['topic1']);
  });

  it('removeCautiousTopic removes the specified topic', () => {
    let state = createChatSession({
      sessionId: 's1',
      inviteToken: 't1',
      mode: 'informant',
      respondentName: '你',
      relatedName: '林小满',
      relation: '朋友',
      now,
    });
    state = addCautiousTopic(state, 'topic1');
    state = addCautiousTopic(state, 'topic2');
    state = removeCautiousTopic(state, 'topic1');
    expect(state.cautiousTopics).toEqual(['topic2']);
  });
});

/* ------------------------------------------------------------------ */
/* Self-interview mode                                                 */
/* ------------------------------------------------------------------ */

describe('self-interview mode', () => {
  let store: Store;

  beforeEach(() => {
    store = newStore();
    idCounter = 0;
  });
  afterEach(() => store.close());

  function createSelfInvite(s: Store): { subjectId: string; token: string } {
    const subjectId = 'subject-self';
    s.putSubject({ id: subjectId, displayName: '张三' });
    const invite = createInvite(s, subjectId, { mode: 'self' });
    return { subjectId, token: invite.token };
  }

  it('invite schema defaults missing mode to informant', () => {
    const subjectId = 'subject-default';
    store.putSubject({ id: subjectId, displayName: '李四' });
    const invite = createInvite(store, subjectId);
    const resolved = store.getInvite(invite.token);
    // mode is absent or undefined for informant
    expect(resolved?.mode ?? 'informant').toBe('informant');
  });

  it('invite persists self mode and resolves it', () => {
    const { token } = createSelfInvite(store);
    const invite = store.getInvite(token);
    expect(invite?.mode).toBe('self');
  });

  it('startChat picks invite mode when no explicit mode given', async () => {
    const { token } = createSelfInvite(store);
    const llm = new FakeLLM(['你好，这段对话用来更完整地理解你自己，随时可以停。最近过得怎么样？']);
    const options = makeOptions(llm);
    const result = await startChat(store, token, options);
    expect(result.mode).toBe('self');
  });

  it('self system prompt uses "如何理解自己" and opening says "你自己"', () => {
    const ctx: PromptContext = {
      mode: 'self',
      respondentName: '张三',
      relatedName: '张三',
      relation: '自己',
      uncoveredAspects: [],
      isOpening: true,
    };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('张三如何理解自己');
    expect(prompt).toContain('理解你自己');
    expect(prompt).not.toContain('理解张三');
  });

  it('old invites without mode column still produce informant chat', async () => {
    const subjectId = 'subject-old';
    store.putSubject({ id: subjectId, displayName: '老王' });
    // createInvite with no mode option — simulates old invite
    const invite = createInvite(store, subjectId);
    const llm = new FakeLLM([VALID_OPENING.replace('林小满', '老王')]);
    const options = makeOptions(llm);
    const result = await startChat(store, invite.token, options);
    expect(result.mode).toBe('informant');
  });
});

/* ------------------------------------------------------------------ */
/* 12. Observability logging                                           */
/* ------------------------------------------------------------------ */

describe('generation failure logging', () => {
  it('emits a log line with route and reason but without user text', async () => {
    const store = newStore();
    const { token } = createSubjectAndInvite(store);
    const llm = new FakeLLM([VALID_OPENING]);
    const options = makeOptions(llm);
    const started = await startChat(store, token, options);

    // Both attempts fail
    llm.push('没有问号的废话');
    llm.push('还是没有问号');

    const logged: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    };

    try {
      await expect(
        say(store, started.sessionId, { text: '这是用户的私密文字不应出现在日志' }, options),
      ).rejects.toThrow('interview_generation_failed');
    } finally {
      console.error = origError;
    }

    // At least one log line was emitted
    expect(logged.length).toBeGreaterThan(0);
    const logLine = logged.find((l) => l.includes('[interview-v4]'));
    expect(logLine).toBeDefined();
    // Contains the failure reason
    expect(logLine).toContain('reason=not_single_question');
    // Contains route and session info
    expect(logLine).toContain('route=say');
    expect(logLine).toContain('session=');
    // Does NOT contain user text
    expect(logLine).not.toContain('这是用户的私密文字不应出现在日志');
    // Contains at most first 40 chars of rejected output
    expect(logLine).toContain('output_head=');
  });

  it('emits log on start failure too', async () => {
    const store = newStore();
    const { token } = createSubjectAndInvite(store);
    // Both opening attempts fail
    const llm = new FakeLLM(['没有问号的废话', '还是没有问号']);
    const options = makeOptions(llm);

    const logged: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    };

    try {
      await expect(startChat(store, token, options)).rejects.toThrow(
        'interview_generation_failed',
      );
    } finally {
      console.error = origError;
    }

    const logLine = logged.find((l) => l.includes('[interview-v4]'));
    expect(logLine).toBeDefined();
    expect(logLine).toContain('route=start');
  });
});
