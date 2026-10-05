import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, type InvitePayload } from '../src/api';

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

const invite: InvitePayload = {
  subjectDisplayName: '林小满',
  questionnaire: {
    id: 'friend-v1',
    title: '朋友版问卷 v1',
    frontPrompt: '如果他就坐在你对面,这话你会怎么对他说？',
    questions: [{ qid: 'q1', prompt: '问题', followupHint: '提示' }],
  },
};

describe('api client', () => {
  it('fetches an invite relative to the configured base url', async () => {
    const { api, calls } = makeClient(() => jsonResponse(invite));
    await expect(api.fetchInvite('tok en')).resolves.toEqual(invite);
    expect(calls[0]?.url).toBe('http://api.test/api/invites/tok%20en');
  });

  it('posts a testimony payload and returns the running count', async () => {
    const { api, calls } = makeClient(() =>
      jsonResponse({ witnessId: 'w1', testimonyId: 't1', count: 3 }, 201),
    );
    const result = await api.submitTestimony('tok', {
      relation: '朋友',
      consentLevel: 'synthesis_only',
      answers: [{ qid: 'q1', behindText: 'words' }],
    });
    expect(result.count).toBe(3);

    const init = calls[0]?.init;
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      consentLevel: 'synthesis_only',
      answers: [{ qid: 'q1', behindText: 'words' }],
    });
  });

  it('turns an HTTP error into an ApiError with status and code', async () => {
    const { api } = makeClient(() =>
      jsonResponse({ error: { code: 'invite_invalid', message: '邀请链接已过期' } }, 410),
    );
    await expect(api.fetchInvite('gone')).rejects.toMatchObject({
      name: 'ApiError',
      status: 410,
      code: 'invite_invalid',
    });
  });

  it('reports asr availability and surfaces a 501 as asr_unavailable', async () => {
    const available = makeClient(() => jsonResponse({ available: true }));
    await expect(available.api.checkAsrAvailable()).resolves.toBe(true);

    const missing = makeClient(() => jsonResponse({ available: false }));
    await expect(missing.api.checkAsrAvailable()).resolves.toBe(false);

    const unavailable = makeClient(() =>
      jsonResponse({ error: { code: 'asr_unavailable', message: '未配置语音转写' } }, 501),
    );
    const caught = await unavailable.api
      .transcribe(new Blob(['audio'], { type: 'audio/webm' }))
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(501);
    expect((caught as ApiError).code).toBe('asr_unavailable');
  });

  it('uploads audio with the blob content type and returns the transcript', async () => {
    const { api, calls } = makeClient(() => jsonResponse({ text: '她总是提前买单。' }));
    const result = await api.transcribe(new Blob(['bytes'], { type: 'audio/webm' }));
    expect(result.text).toBe('她总是提前买单。');
    expect(result.lowConfidence).toBe(false);
    expect(result.confidence).toBe(1);
    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.['content-type']).toBe('audio/webm');
  });

  it('reports a network failure as a zero-status ApiError', async () => {
    const { api } = makeClient(() => {
      throw new TypeError('fetch failed');
    });
    await expect(api.getProgress('s1')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  it('drives the interview session endpoints', async () => {
    const { api, calls } = makeClient((call) => {
      if (call.url.endsWith('/interview')) {
        return jsonResponse(
          {
            sessionId: 'sess-1',
            question: { qid: 'q1', prompt: '问题一', followupHint: '提示' },
            total: 10,
          },
          201,
        );
      }
      if (call.url.endsWith('/answer')) return jsonResponse({ followup: '哪件事？' });
      if (call.url.endsWith('/followup')) {
        return jsonResponse({ question: { qid: 'q2', prompt: '问题二', followupHint: '' }, index: 1 });
      }
      return jsonResponse({ witnessId: 'w1', testimonyId: 't1', count: 1 }, 201);
    });

    const started = await api.startInterview('tok en');
    expect(started.sessionId).toBe('sess-1');
    expect(started.total).toBe(10);

    const step = await api.answerInterview('sess-1', { qid: 'q1', text: '他人挺好的。' });
    expect(step).toEqual({ followup: '哪件事？' });

    const next = await api.answerInterviewFollowup('sess-1', {
      text: '上个月他帮我搬家。',
    });
    expect(next).toMatchObject({ index: 1 });

    const result = await api.finishInterview('sess-1', {
      relation: '朋友',
      consentLevel: 'quotable',
      answers: [{ qid: 'q1', behindText: '他人挺好的。', followupText: '上个月他帮我搬家。' }],
      avoidedQids: ['q2'],
    });
    expect(result.count).toBe(1);

    expect(calls.map((call) => [call.init?.method, call.url])).toEqual([
      ['POST', 'http://api.test/api/invites/tok%20en/interview'],
      ['POST', 'http://api.test/api/interview/sess-1/answer'],
      ['POST', 'http://api.test/api/interview/sess-1/followup'],
      ['POST', 'http://api.test/api/interview/sess-1/finish'],
    ]);
  });
});
