import { emptyAnswer, emptyDraft, type AnswerDraft, type InterviewDraft } from './answers';
import type { Questionnaire, SubmitPayload } from './api';

/**
 * The interview's state rules, kept as plain functions.
 *
 * The important rule is the front question: once the raw answer is written,
 * the witness must either say something to the subject's face *or* press
 * "当面我不会说". Leaving it blank is not an option — an unanswered front is
 * a deliberate act, so the state remembers the press rather than guessing
 * from an empty string.
 */

export function relationValue(draft: InterviewDraft): string {
  if (draft.relationChoice === '其他') return draft.relationOther.trim();
  return draft.relationChoice.trim();
}

export function canStart(draft: InterviewDraft): boolean {
  return relationValue(draft).length > 0;
}

export function answerFor(draft: InterviewDraft, qid: string): AnswerDraft {
  return draft.answers[qid] ?? emptyAnswer();
}

export function isBehindFilled(answer: AnswerDraft): boolean {
  return answer.behindText.trim().length > 0;
}

/** The front question only appears once there is a raw answer to react to. */
export function isFrontRevealed(answer: AnswerDraft): boolean {
  return isBehindFilled(answer);
}

export function isFrontResolved(answer: AnswerDraft): boolean {
  return answer.frontSkipped || answer.frontText.trim().length > 0;
}

/**
 * A question counts as done only when the raw answer exists and the front
 * question was either answered or explicitly skipped.
 */
export function canContinue(answer: AnswerDraft): boolean {
  return isBehindFilled(answer) && isFrontResolved(answer);
}

function withAnswer(
  draft: InterviewDraft,
  qid: string,
  update: (answer: AnswerDraft) => AnswerDraft,
): InterviewDraft {
  const current = answerFor(draft, qid);
  return { ...draft, answers: { ...draft.answers, [qid]: update(current) } };
}

export function updateBehind(draft: InterviewDraft, qid: string, text: string): InterviewDraft {
  return withAnswer(draft, qid, (answer) => ({ ...answer, behindText: text }));
}

export function updateFront(draft: InterviewDraft, qid: string, text: string): InterviewDraft {
  // Typing clears a previous explicit skip: the witness changed their mind.
  return withAnswer(draft, qid, (answer) => ({
    ...answer,
    frontText: text,
    frontSkipped: text.trim().length > 0 ? false : answer.frontSkipped,
  }));
}

/** The "当面我不会说" button: records intent, not an empty field. */
export function skipFront(draft: InterviewDraft, qid: string): InterviewDraft {
  return withAnswer(draft, qid, (answer) => ({
    ...answer,
    frontText: '',
    frontSkipped: true,
  }));
}

export function toggleDoNotRaise(draft: InterviewDraft, qid: string): InterviewDraft {
  return withAnswer(draft, qid, (answer) => ({
    ...answer,
    doNotRaiseToSubject: !answer.doNotRaiseToSubject,
  }));
}

export function questionAt(draft: InterviewDraft, questionnaire: Questionnaire): number {
  const count = questionnaire.questions.length;
  if (count === 0) return 0;
  return Math.min(Math.max(draft.currentIndex, 0), count - 1);
}

export function isLastQuestion(draft: InterviewDraft, questionnaire: Questionnaire): boolean {
  return questionAt(draft, questionnaire) >= questionnaire.questions.length - 1;
}

export function answeredCount(draft: InterviewDraft, questionnaire: Questionnaire): number {
  return questionnaire.questions.filter((question) => isBehindFilled(answerFor(draft, question.qid)))
    .length;
}

/** A question is done when it has an answer, or was explicitly skipped. */
export function isQuestionResolved(draft: InterviewDraft, qid: string): boolean {
  if (draft.avoidedQids.includes(qid)) return true;
  return canContinue(answerFor(draft, qid));
}

export function allResolved(draft: InterviewDraft, questionnaire: Questionnaire): boolean {
  return questionnaire.questions.every((question) => isQuestionResolved(draft, question.qid));
}

/** The explicit "这题跳过": records silence and drops any words on the question. */
export function skipQuestion(draft: InterviewDraft, qid: string): InterviewDraft {
  const answers = { ...draft.answers };
  delete answers[qid];
  const followups = { ...draft.followups };
  delete followups[qid];
  return {
    ...draft,
    answers,
    followups,
    avoidedQids: draft.avoidedQids.includes(qid)
      ? draft.avoidedQids
      : [...draft.avoidedQids, qid],
  };
}

/** Store (or clear) the answer to the interviewer's follow-up. */
export function updateFollowup(
  draft: InterviewDraft,
  qid: string,
  text: string,
): InterviewDraft {
  return { ...draft, followups: { ...draft.followups, [qid]: text } };
}

/**
 * Build the wire payload. Only questions with words are submitted, and a
 * skipped front question is *omitted* rather than sent as an empty string.
 * A follow-up answer rides in its own field, never appended to `behindText`,
 * and explicit skips are listed so the silence survives.
 */
export function buildSubmission(
  draft: InterviewDraft,
  questionnaire: Questionnaire,
): SubmitPayload {
  const answers = questionnaire.questions
    .map((question) => ({ question, answer: answerFor(draft, question.qid) }))
    .filter(({ answer }) => isBehindFilled(answer))
    .map(({ question, answer }) => {
      const entry: SubmitPayload['answers'][number] = {
        qid: question.qid,
        behindText: answer.behindText.trim(),
      };
      if (!answer.frontSkipped && answer.frontText.trim().length > 0) {
        entry.frontText = answer.frontText.trim();
      }
      const followup = draft.followups[question.qid]?.trim();
      if (followup !== undefined && followup.length > 0) {
        entry.followupText = followup;
      }
      if (answer.doNotRaiseToSubject) {
        entry.doNotRaiseToSubject = true;
      }
      return entry;
    });

  return {
    relation: relationValue(draft),
    consentLevel: draft.consentLevel,
    answers,
    ...(draft.avoidedQids.length > 0 ? { avoidedQids: [...draft.avoidedQids] } : {}),
  };
}

export { emptyDraft };
