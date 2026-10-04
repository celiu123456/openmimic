import { describe, expect, it } from 'vitest';
import { emptyDraft, type InterviewDraft } from '../src/answers';
import type { Questionnaire } from '../src/api';
import {
  allResolved,
  answerFor,
  buildSubmission,
  canContinue,
  canStart,
  isBehindFilled,
  isFrontRevealed,
  questionAt,
  skipFront,
  skipQuestion,
  updateBehind,
  updateFollowup,
  updateFront,
} from '../src/interview';

const questionnaire: Questionnaire = {
  id: 'friend-v1',
  title: '朋友版问卷 v1',
  frontPrompt: '这话你会当他面说吗？会怎么说？',
  questions: [
    { qid: 'q1', prompt: '第一个问题', followupHint: '提示一' },
    { qid: 'q2', prompt: '第二个问题', followupHint: '提示二' },
  ],
};

const answer = (draft: InterviewDraft, qid: string) => answerFor(draft, qid);

describe('interview state logic', () => {
  it('cannot start until a relation is chosen; 其他 needs free text', () => {
    const start = emptyDraft();
    expect(canStart(start)).toBe(false);
    expect(canStart({ ...start, relationChoice: '朋友' })).toBe(true);
    expect(canStart({ ...start, relationChoice: '其他', relationOther: '  ' })).toBe(false);
    expect(canStart({ ...start, relationChoice: '其他', relationOther: '房东' })).toBe(true);
  });

  it('reveals the front question only after the raw answer has words', () => {
    let draft = emptyDraft();
    expect(isFrontRevealed(answer(draft, 'q1'))).toBe(false);
    draft = updateBehind(draft, 'q1', '   ');
    expect(isFrontRevealed(answer(draft, 'q1'))).toBe(false);
    draft = updateBehind(draft, 'q1', '她总是提前买单。');
    expect(isFrontRevealed(answer(draft, 'q1'))).toBe(true);
  });

  it('does not advance on a blank front: text or an explicit skip is required', () => {
    let draft = updateBehind(emptyDraft(), 'q1', '她总是提前买单。');
    expect(canContinue(answer(draft, 'q1'))).toBe(false);

    draft = updateFront(draft, 'q1', '我会当面谢她。');
    expect(canContinue(answer(draft, 'q1'))).toBe(true);

    const skipped = skipFront(updateBehind(emptyDraft(), 'q1', '她总是提前买单。'), 'q1');
    expect(answer(skipped, 'q1').frontSkipped).toBe(true);
    expect(canContinue(answer(skipped, 'q1'))).toBe(true);
  });

  it('records the skip explicitly and lets typing undo it', () => {
    let draft = skipFront(updateBehind(emptyDraft(), 'q1', 'words'), 'q1');
    expect(answer(draft, 'q1').frontSkipped).toBe(true);
    expect(answer(draft, 'q1').frontText).toBe('');

    draft = updateFront(draft, 'q1', '当面我会说：谢谢你。');
    expect(answer(draft, 'q1').frontSkipped).toBe(false);
    expect(answer(draft, 'q1').frontText).toBe('当面我会说：谢谢你。');

    draft = updateFront(draft, 'q1', '');
    expect(answer(draft, 'q1').frontSkipped).toBe(false);
    expect(canContinue(answer(draft, 'q1'))).toBe(false);
  });

  it('builds a payload that omits a skipped front and drops empty answers', () => {
    let draft = updateBehind(emptyDraft(), 'q1', '  她总是提前买单。 ');
    draft = skipFront(draft, 'q1');
    draft = updateBehind(draft, 'q2', '生气就不说话。');
    draft = updateFront(draft, 'q2', ' 我会直接问她。 ');
    draft = { ...draft, relationChoice: '其他', relationOther: ' 大学同学 ' };

    const payload = buildSubmission(draft, questionnaire);
    expect(payload.relation).toBe('大学同学');
    expect(payload.consentLevel).toBe('synthesis_only');
    expect(payload.answers).toEqual([
      { qid: 'q1', behindText: '她总是提前买单。' },
      { qid: 'q2', behindText: '生气就不说话。', frontText: '我会直接问她。' },
    ]);
  });

  it('needs every question resolved before the whole interview is submittable', () => {
    let draft = updateBehind(emptyDraft(), 'q1', 'one');
    expect(allResolved(draft, questionnaire)).toBe(false);
    draft = skipFront(draft, 'q1');
    expect(allResolved(draft, questionnaire)).toBe(false);
    draft = updateBehind(draft, 'q2', 'two');
    expect(allResolved(draft, questionnaire)).toBe(false);
    draft = skipFront(draft, 'q2');
    expect(allResolved(draft, questionnaire)).toBe(true);
  });

  it('clamps the current index to the questionnaire bounds', () => {
    expect(questionAt({ ...emptyDraft(), currentIndex: 9 }, questionnaire)).toBe(1);
    expect(questionAt({ ...emptyDraft(), currentIndex: -3 }, questionnaire)).toBe(0);
  });

  it('treats an explicitly skipped question as resolved', () => {
    let draft = skipFront(updateBehind(emptyDraft(), 'q1', 'words'), 'q1');
    expect(allResolved(draft, questionnaire)).toBe(false);

    draft = skipQuestion(draft, 'q2');
    expect(allResolved(draft, questionnaire)).toBe(true);
    expect(draft.avoidedQids).toEqual(['q2']);
  });

  it('drops any words on the question when it is skipped', () => {
    const draft = skipQuestion(updateBehind(emptyDraft(), 'q1', 'words'), 'q1');
    expect(draft.answers.q1).toBeUndefined();
    expect(isBehindFilled(answerFor(draft, 'q1'))).toBe(false);
  });

  it('keeps the follow-up answer apart and lists skips in the payload', () => {
    let draft = updateBehind(emptyDraft(), 'q1', 'words');
    draft = updateFollowup(draft, 'q1', '  上个月他帮我搬了家。 ');
    draft = skipQuestion(draft, 'q2');

    const payload = buildSubmission(draft, questionnaire);
    expect(payload.answers).toEqual([
      { qid: 'q1', behindText: 'words', followupText: '上个月他帮我搬了家。' },
    ]);
    expect(payload.avoidedQids).toEqual(['q2']);
  });
});
