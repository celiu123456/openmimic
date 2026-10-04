import { readJson, removeKey, writeJson, type KeyValueStore } from './storage';

/**
 * Local draft of one interview, kept in `sessionStorage` under the invite
 * token. Refreshing mid-answer must not lose words, so every answer is saved
 * as it is typed and cleared only after the testimony is accepted.
 */
export const DRAFT_STORAGE_PREFIX = 'openmimic.interview.draft.';

export type ConsentLevel = 'quotable' | 'synthesis_only';

export interface AnswerDraft {
  /** What the witness says behind the subject's back. */
  behindText: string;
  /** Optional "to their face" variant. */
  frontText: string;
  /** True only after an explicit "当面我不会说" press — never inferred. */
  frontSkipped: boolean;
}

export interface InterviewDraft {
  /** One of the relation chips, or the literal `其他`. */
  relationChoice: string;
  /** Free text used when `relationChoice === '其他'`. */
  relationOther: string;
  currentIndex: number;
  answers: Record<string, AnswerDraft>;
  consentLevel: ConsentLevel;
}

export function emptyAnswer(): AnswerDraft {
  return { behindText: '', frontText: '', frontSkipped: false };
}

export function emptyDraft(): InterviewDraft {
  return {
    relationChoice: '',
    relationOther: '',
    currentIndex: 0,
    answers: {},
    // The private option is the default: silence is not consent to publish.
    consentLevel: 'synthesis_only',
  };
}

export function answersStorageKey(token: string): string {
  return `${DRAFT_STORAGE_PREFIX}${token}`;
}

/** Coerce whatever sat in storage back into a usable, current-shape draft. */
function normalizeDraft(value: unknown): InterviewDraft {
  const base = emptyDraft();
  if (typeof value !== 'object' || value === null) return base;
  const raw = value as Record<string, unknown>;

  const answers: InterviewDraft['answers'] = {};
  if (typeof raw.answers === 'object' && raw.answers !== null) {
    for (const [qid, entry] of Object.entries(raw.answers as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const answer = entry as Record<string, unknown>;
      answers[qid] = {
        behindText: typeof answer.behindText === 'string' ? answer.behindText : '',
        frontText: typeof answer.frontText === 'string' ? answer.frontText : '',
        frontSkipped: answer.frontSkipped === true,
      };
    }
  }

  return {
    relationChoice: typeof raw.relationChoice === 'string' ? raw.relationChoice : '',
    relationOther: typeof raw.relationOther === 'string' ? raw.relationOther : '',
    currentIndex:
      typeof raw.currentIndex === 'number' && Number.isInteger(raw.currentIndex)
        ? Math.max(0, raw.currentIndex)
        : 0,
    answers,
    consentLevel: raw.consentLevel === 'quotable' ? 'quotable' : 'synthesis_only',
  };
}

export function loadDraft(store: KeyValueStore, token: string): InterviewDraft | undefined {
  const stored = readJson<unknown>(store, answersStorageKey(token));
  return stored === undefined ? undefined : normalizeDraft(stored);
}

export function saveDraft(store: KeyValueStore, token: string, draft: InterviewDraft): void {
  writeJson(store, answersStorageKey(token), draft);
}

export function clearDraft(store: KeyValueStore, token: string): void {
  removeKey(store, answersStorageKey(token));
}
