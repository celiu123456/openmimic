/**
 * Typed client for the W2a collection API and the W2b speech endpoint.
 *
 * Every call goes through `request`, which turns the server's uniform
 * `{ error: { code, message } }` shape into an {@link ApiError} carrying the
 * HTTP status. That is how the interview room distinguishes "this link is
 * gone" (410) from "speech is not configured" (501) without parsing strings.
 */

export type ConsentLevel = 'quotable' | 'synthesis_only';

export interface WitnessQuestion {
  qid: string;
  prompt: string;
  followupHint: string;
}

export interface Questionnaire {
  id: string;
  title: string;
  frontPrompt: string;
  questions: WitnessQuestion[];
}

export interface InvitePayload {
  subjectDisplayName: string;
  questionnaire: Questionnaire;
}

export interface SubjectPayload {
  id: string;
  displayName: string;
  selfReport?: string;
}

export interface CreatedInvitePayload {
  token: string;
  url: string;
  expiresAt: string;
}

export interface ProgressPayload {
  testimonyCount: number;
  witnessCount: number;
}

/** `speech` is a spoken turn; `stage` is a stage direction (a silence, a look). */
export type RoomUtteranceKind = 'speech' | 'stage';

/** Expression tier: how close an utterance is to a witness's own words. */
export type UtteranceTier = 'quote' | 'paraphrase' | 'extrapolate';

export interface UtteranceAnchor {
  testimonyId: string;
  qid: string;
}

export interface RoomUtterance {
  witnessId: string;
  displayLabel: string;
  text: string;
  kind: RoomUtteranceKind;
  at: string;
  /** Expression tier; absent on old data, treated as 'extrapolate'. */
  tier?: UtteranceTier;
  /** Testimony anchors this utterance draws from. */
  anchors?: UtteranceAnchor[];
}

export type RoomStatus = 'behind_only' | 'door_opened';

/**
 * One generated room. The room is a generated artifact, never evidence: the
 * page shows what was said, never the testimony it was generated from.
 */
export interface RoomPayload {
  id: string;
  subjectId: string;
  topicSeed: string;
  status: RoomStatus;
  behindTranscript: RoomUtterance[];
  frontTranscript?: RoomUtterance[];
  createdAt: string;
}

export interface SubmitPayload {
  relation: string;
  consentLevel: ConsentLevel;
  answers: Array<{
    qid: string;
    behindText: string;
    frontText?: string;
    /** What the interviewer's follow-up drew out, kept apart from behindText. */
    followupText?: string;
    /** When true, this answer must not appear in any subject-visible view. */
    doNotRaiseToSubject?: boolean;
  }>;
  freeText?: string;
  /** Question ids the witness explicitly skipped (silence signal). */
  avoidedQids?: string[];
}

export interface SubmitResult {
  witnessId: string;
  testimonyId: string;
  count: number;
}

/** What opening an interview session hands back. */
export interface StartedInterviewPayload {
  sessionId: string;
  question: WitnessQuestion;
  total: number;
}

/**
 * One step of the question tree: a follow-up to ask, the next question, or
 * the end of the interview. No model configured means `followup` never comes.
 */
export type InterviewStepPayload =
  | { followup: string }
  | { question: WitnessQuestion; index: number }
  | { done: true };

/** One answer turn; `skip` records an explicit silence. */
export interface InterviewAnswerRequest {
  qid?: string;
  text?: string;
  frontText?: string;
  frontSkipped?: boolean;
  skip?: true;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  /** Empty means same origin; the Vite dev proxy forwards `/api` to 7860. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface CourtSessionPayload {
  session: { id: string; subjectId: string };
  claims: unknown[];
}

export interface ApiClient {
  fetchInvite(token: string): Promise<InvitePayload>;
  checkAsrAvailable(): Promise<boolean>;
  transcribe(blob: Blob): Promise<string>;
  createSubject(displayName: string): Promise<SubjectPayload>;
  createInvite(subjectId: string): Promise<CreatedInvitePayload>;
  getProgress(subjectId: string): Promise<ProgressPayload>;
  /** Rooms for one subject, oldest first (the API's own order). */
  getSubjectRooms(subjectId: string): Promise<RoomPayload[]>;
  getRoom(roomId: string): Promise<RoomPayload>;
  createRoom(subjectId: string, topicSeed?: string): Promise<RoomPayload>;
  /** Opens the door; idempotent server-side, so a repeat never re-generates. */
  openDoor(roomId: string): Promise<RoomPayload>;
  submitTestimony(token: string, payload: SubmitPayload): Promise<SubmitResult>;
  /** Open an interview session and get its first question. */
  startInterview(token: string): Promise<StartedInterviewPayload>;
  /** Answer (or skip) the current question; may return a follow-up. */
  answerInterview(
    sessionId: string,
    request: InterviewAnswerRequest,
  ): Promise<InterviewStepPayload>;
  /** Answer (or skip) the waiting follow-up. */
  answerInterviewFollowup(
    sessionId: string,
    request: { text: string } | { skip: true },
  ): Promise<InterviewStepPayload>;
  /** Close the session and append the assembled testimony. */
  finishInterview(sessionId: string, payload: SubmitPayload): Promise<SubmitResult>;
  /** Trigger the court (requires LLM). */
  runCourt(subjectId: string): Promise<CourtSessionPayload>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(
    path: string,
    init: RequestInit = {},
    accept = 'application/json',
  ): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, init);
    } catch (cause) {
      throw new ApiError(0, 'network_error', cause instanceof Error ? cause.message : '网络错误');
    }

    if (accept !== 'application/json') {
      if (!response.ok) throw new ApiError(response.status, 'request_failed', '请求失败');
      return (await response.text()) as unknown as T;
    }

    const text = await response.text();
    let parsed: unknown = {};
    if (text.trim() !== '') {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = {};
      }
    }

    if (!response.ok) {
      const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : {};
      const code = typeof error.code === 'string' ? error.code : 'request_failed';
      const message = typeof error.message === 'string' ? error.message : '请求失败';
      throw new ApiError(response.status, code, message);
    }

    return parsed as T;
  }

  const jsonInit = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    fetchInvite: (token) => request<InvitePayload>(`/api/invites/${encodeURIComponent(token)}`),

    async checkAsrAvailable() {
      const result = await request<{ available?: unknown }>('/api/asr/available');
      return result.available === true;
    },

    async transcribe(blob) {
      const result = await request<{ text?: unknown }>('/api/asr', {
        method: 'POST',
        headers: { 'content-type': blob.type || 'audio/webm' },
        body: blob,
      });
      return typeof result.text === 'string' ? result.text : '';
    },

    createSubject: (displayName) =>
      request<SubjectPayload>('/api/subjects', jsonInit('POST', { displayName })),

    createInvite: (subjectId) =>
      request<CreatedInvitePayload>(
        `/api/subjects/${encodeURIComponent(subjectId)}/invites`,
        { method: 'POST' },
      ),

    getProgress: (subjectId) =>
      request<ProgressPayload>(`/api/subjects/${encodeURIComponent(subjectId)}/progress`),

    async getSubjectRooms(subjectId) {
      const result = await request<{ rooms?: RoomPayload[] }>(
        `/api/subjects/${encodeURIComponent(subjectId)}/rooms`,
      );
      return Array.isArray(result.rooms) ? result.rooms : [];
    },

    getRoom: (roomId) => request<RoomPayload>(`/api/rooms/${encodeURIComponent(roomId)}`),

    createRoom: (subjectId, topicSeed) =>
      request<RoomPayload>(
        `/api/subjects/${encodeURIComponent(subjectId)}/rooms`,
        jsonInit('POST', topicSeed === undefined ? {} : { topicSeed }),
      ),

    openDoor: (roomId) =>
      request<RoomPayload>(`/api/rooms/${encodeURIComponent(roomId)}/door`, { method: 'POST' }),

    submitTestimony: (token, payload) =>
      request<SubmitResult>(
        `/api/invites/${encodeURIComponent(token)}/testimony`,
        jsonInit('POST', payload),
      ),

    startInterview: (token) =>
      request<StartedInterviewPayload>(
        `/api/invites/${encodeURIComponent(token)}/interview`,
        { method: 'POST' },
      ),

    answerInterview: (sessionId, payload) =>
      request<InterviewStepPayload>(
        `/api/interview/${encodeURIComponent(sessionId)}/answer`,
        jsonInit('POST', payload),
      ),

    answerInterviewFollowup: (sessionId, payload) =>
      request<InterviewStepPayload>(
        `/api/interview/${encodeURIComponent(sessionId)}/followup`,
        jsonInit('POST', payload),
      ),

    finishInterview: (sessionId, payload) =>
      request<SubmitResult>(
        `/api/interview/${encodeURIComponent(sessionId)}/finish`,
        jsonInit('POST', payload),
      ),

    runCourt: (subjectId) =>
      request<CourtSessionPayload>(
        `/api/subjects/${encodeURIComponent(subjectId)}/court`,
        { method: 'POST' },
      ),
  };
}

/** Shared client for the browser, relative to the current origin. */
export const api = createApiClient();
