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

export interface SubmitPayload {
  relation: string;
  consentLevel: ConsentLevel;
  answers: Array<{ qid: string; behindText: string; frontText?: string }>;
  freeText?: string;
}

export interface SubmitResult {
  witnessId: string;
  testimonyId: string;
  count: number;
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

export interface ApiClient {
  fetchInvite(token: string): Promise<InvitePayload>;
  checkAsrAvailable(): Promise<boolean>;
  transcribe(blob: Blob): Promise<string>;
  createSubject(displayName: string): Promise<SubjectPayload>;
  createInvite(subjectId: string): Promise<CreatedInvitePayload>;
  getProgress(subjectId: string): Promise<ProgressPayload>;
  submitTestimony(token: string, payload: SubmitPayload): Promise<SubmitResult>;
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

    submitTestimony: (token, payload) =>
      request<SubmitResult>(
        `/api/invites/${encodeURIComponent(token)}/testimony`,
        jsonInit('POST', payload),
      ),
  };
}

/** Shared client for the browser, relative to the current origin. */
export const api = createApiClient();
