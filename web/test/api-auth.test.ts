/**
 * Tests for admin-token auth header attachment and open-route detection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createApiClient,
  getAdminToken,
  setAdminToken,
  isOpenRoute,
  consumeAdminQueryParam,
} from '../src/api';

/* ------------------------------------------------------------------ */
/* localStorage stub                                                   */
/* ------------------------------------------------------------------ */

const store = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
});

afterEach(() => store.clear());

/* ------------------------------------------------------------------ */
/* Helper: capture fetch calls                                         */
/* ------------------------------------------------------------------ */

interface Call {
  url: string;
  init?: RequestInit;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { api: createApiClient({ baseUrl: 'http://api.test', fetchImpl }), calls };
}

function authHeader(call: Call): string | undefined {
  const headers = call.init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get('authorization') ?? undefined;
  if (Array.isArray(headers)) {
    const entry = headers.find(([k]) => k.toLowerCase() === 'authorization');
    return entry ? entry[1] : undefined;
  }
  return (headers as Record<string, string>).authorization;
}

/* ------------------------------------------------------------------ */
/* isOpenRoute                                                         */
/* ------------------------------------------------------------------ */

describe('isOpenRoute', () => {
  it('marks invite paths as open', () => {
    expect(isOpenRoute('/api/invites/abc-123')).toBe(true);
    expect(isOpenRoute('/api/invites/tok/testimony')).toBe(true);
    expect(isOpenRoute('/api/invites/tok/chat')).toBe(true);
    expect(isOpenRoute('/api/invites/tok/interview')).toBe(true);
  });

  it('marks interview session paths as open', () => {
    expect(isOpenRoute('/api/interview/sess-1/answer')).toBe(true);
    expect(isOpenRoute('/api/interview/sess-1/followup')).toBe(true);
    expect(isOpenRoute('/api/interview/sess-1/finish')).toBe(true);
  });

  it('marks chat paths as open', () => {
    expect(isOpenRoute('/api/chat/sess-1/say')).toBe(true);
    expect(isOpenRoute('/api/chat/sess-1/finish')).toBe(true);
    expect(isOpenRoute('/api/chat/sess-1')).toBe(true);
  });

  it('marks health and asr as open', () => {
    expect(isOpenRoute('/api/health')).toBe(true);
    expect(isOpenRoute('/api/asr')).toBe(true);
    expect(isOpenRoute('/api/asr/available')).toBe(true);
  });

  it('marks capabilities as open', () => {
    expect(isOpenRoute('/api/capabilities')).toBe(true);
  });

  it('marks short-code resolution as open', () => {
    expect(isOpenRoute('/api/i/AB12CD')).toBe(true);
  });

  it('marks management routes as NOT open', () => {
    expect(isOpenRoute('/api/subjects')).toBe(false);
    expect(isOpenRoute('/api/subjects/abc/progress')).toBe(false);
    expect(isOpenRoute('/api/subjects/abc/rooms')).toBe(false);
    expect(isOpenRoute('/api/subjects/abc/court')).toBe(false);
    expect(isOpenRoute('/api/rooms/abc')).toBe(false);
    expect(isOpenRoute('/api/rooms/abc/door')).toBe(false);
    expect(isOpenRoute('/api/tokens')).toBe(false);
    expect(isOpenRoute('/api/import')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Admin token storage                                                 */
/* ------------------------------------------------------------------ */

describe('admin token storage', () => {
  it('stores and retrieves the admin token', () => {
    expect(getAdminToken()).toBe('');
    setAdminToken('my-secret');
    expect(getAdminToken()).toBe('my-secret');
  });

  it('clears the admin token with an empty string', () => {
    setAdminToken('my-secret');
    setAdminToken('');
    expect(getAdminToken()).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* Auth header attachment                                              */
/* ------------------------------------------------------------------ */

describe('request auth header', () => {
  it('attaches Authorization header on management routes when token is stored', async () => {
    setAdminToken('test-token');
    // createSubject hits /api/subjects (management)
    const { api, calls } = makeClient(() =>
      jsonResponse({ id: 's1', displayName: 'test' }, 201),
    );
    await api.createSubject('test');
    expect(authHeader(calls[0]!)).toBe('Bearer test-token');
  });

  it('does NOT attach header on open routes (fetchInvite)', async () => {
    setAdminToken('test-token');
    const { api, calls } = makeClient(() =>
      jsonResponse({
        subjectDisplayName: 'X',
        questionnaire: { id: 'q', title: 'Q', frontPrompt: 'P', questions: [] },
      }),
    );
    await api.fetchInvite('tok');
    expect(authHeader(calls[0]!)).toBeUndefined();
  });

  it('does NOT attach header on open routes (startInterview)', async () => {
    setAdminToken('test-token');
    const { api, calls } = makeClient(() =>
      jsonResponse({ sessionId: 's', question: { qid: 'q1', prompt: 'P', followupHint: '' }, total: 1 }, 201),
    );
    await api.startInterview('tok');
    expect(authHeader(calls[0]!)).toBeUndefined();
  });

  it('does NOT attach header on open routes (sayChat)', async () => {
    setAdminToken('test-token');
    const { api, calls } = makeClient(() => jsonResponse({}));
    await api.sayChat('sess-1', 'hi');
    expect(authHeader(calls[0]!)).toBeUndefined();
  });

  it('does NOT attach header on open routes (transcribe / asr)', async () => {
    setAdminToken('test-token');
    const { api, calls } = makeClient(() => jsonResponse({ text: 'hi' }));
    await api.transcribe(new Blob(['audio'], { type: 'audio/webm' }));
    expect(authHeader(calls[0]!)).toBeUndefined();
  });

  it('does NOT attach header when no token is stored', async () => {
    // token is empty by default (afterEach clears store)
    const { api, calls } = makeClient(() =>
      jsonResponse({ id: 's1', displayName: 'test' }, 201),
    );
    await api.createSubject('test');
    expect(authHeader(calls[0]!)).toBeUndefined();
  });

  it('attaches header on getProgress (management route)', async () => {
    setAdminToken('tok-admin');
    const { api, calls } = makeClient(() =>
      jsonResponse({ testimonyCount: 5, witnessCount: 2 }),
    );
    await api.getProgress('s1');
    expect(authHeader(calls[0]!)).toBe('Bearer tok-admin');
  });

  it('attaches header on createRoom (management route)', async () => {
    setAdminToken('tok-admin');
    const { api, calls } = makeClient(() =>
      jsonResponse({ id: 'r1', subjectId: 's1', topicSeed: '', status: 'behind_only', behindTranscript: [], createdAt: '' }, 201),
    );
    await api.createRoom('s1');
    expect(authHeader(calls[0]!)).toBe('Bearer tok-admin');
  });

  it('attaches header on runCourt (management route)', async () => {
    setAdminToken('tok-admin');
    const { api, calls } = makeClient(() =>
      jsonResponse({ session: { id: 'cs1', subjectId: 's1' }, claims: [] }),
    );
    await api.runCourt('s1');
    expect(authHeader(calls[0]!)).toBe('Bearer tok-admin');
  });

  it('preserves existing headers (e.g. content-type) alongside Authorization', async () => {
    setAdminToken('tok-admin');
    const { api, calls } = makeClient(() =>
      jsonResponse({ id: 's1', displayName: 'test' }, 201),
    );
    await api.createSubject('test');
    const h = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(h?.['content-type']).toBe('application/json');
    expect(h?.['authorization']).toBe('Bearer tok-admin');
  });
});

/* ------------------------------------------------------------------ */
/* consumeAdminQueryParam                                              */
/* ------------------------------------------------------------------ */

describe('consumeAdminQueryParam', () => {
  let savedLocation: PropertyDescriptor | undefined;
  let savedHistory: PropertyDescriptor | undefined;

  function stubWindow(href: string): Array<{ url: string }> {
    const replacedStates: Array<{ url: string }> = [];
    savedLocation = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const fakeWindow = {
      location: { href } as unknown as Location,
      history: {
        replaceState(_data: unknown, _title: string, url?: string | URL | null) {
          replacedStates.push({ url: String(url) });
        },
      } as unknown as History,
    };
    Object.defineProperty(globalThis, 'window', {
      value: fakeWindow,
      writable: true,
      configurable: true,
    });
    return replacedStates;
  }

  afterEach(() => {
    if (savedLocation) {
      Object.defineProperty(globalThis, 'window', savedLocation);
    } else {
      delete (globalThis as Record<string, unknown>).window;
    }
  });

  it('stores the token from ?admin= and returns it', () => {
    const replacedStates = stubWindow('http://localhost/?admin=secret123');

    const result = consumeAdminQueryParam();
    expect(result).toBe('secret123');
    expect(getAdminToken()).toBe('secret123');
    // URL should have admin param removed
    expect(replacedStates[0]?.url).not.toContain('admin=');
  });

  it('returns empty string when no ?admin= is present', () => {
    stubWindow('http://localhost/');
    const result = consumeAdminQueryParam();
    expect(result).toBe('');
  });
});
