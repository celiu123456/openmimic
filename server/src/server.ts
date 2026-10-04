import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z, ZodError } from 'zod';
import { SubjectSchema } from '@openmimic/shared';
import {
  UnknownRoomError,
  assemblePersonaContext,
  type Store,
} from '@openmimic/kernel';
import {
  OpenAICompatClient,
  runCourt,
  type ChatMessage,
} from '@openmimic/engine-court';
import {
  RoomRefusedError,
  findCrisisWord,
  openDoor,
  runBehindRoom,
  type LLMClient,
} from '@openmimic/engine-room';
import {
  AnswerFollowupInputSchema,
  AnswerQuestionInputSchema,
  FinishInterviewInputSchema,
  InterviewSessionInvalidError,
  InterviewStateError,
  InviteInvalidError,
  SubmitTestimonyInputSchema,
  createWitnessCollector,
} from '@openmimic/engine-witness';
import { DEMO_SUBJECT_ID, seedDemo } from '../../fixtures/limo';
import { redactForExternal, withholdSynthesisOnly } from './external';
import {
  buildPersonaPackage,
  importPersonaPackage,
  personaContentDisposition,
} from './persona-package';
import {
  HttpError,
  Router,
  isStreamResult,
  readJsonBody,
  readRawBody,
  type RouteContext,
  type RouteHandlerResult,
} from './router';
import {
  isAsrAvailable,
  normalizeAudioInput,
  readAsrConfig,
  transcribeAudio,
  type AsrConfig,
} from './asr';
import { createStaticHandler, type StaticHandler } from './static';

export const SERVER_VERSION = '0.0.1';

/**
 * The raw OpenAI-compatible upstream used by the `persona/<id>` proxy.
 *
 * Deliberately narrower than {@link OpenAICompatClient} so tests can inject a
 * local fake: the server only needs to know whether the upstream is usable and
 * how to send one verbatim `messages` array.
 */
export interface ChatUpstream {
  readonly configured: boolean;
  readonly hasApiKey: boolean;
  chatRaw(
    messages: readonly ChatMessage[],
    options?: { stream?: boolean },
  ): Promise<Response>;
}

export interface StartServerOptions {
  port: number;
  store: Store;
  /** Overrides for the ASR config; unset fields fall back to the environment. */
  asr?: Partial<AsrConfig>;
  /**
   * LLM used by the room, court and witness routes. When omitted the server
   * builds one from the environment; if that is unconfigured, non-demo rooms
   * and courts answer 501 while the 林默 demo keeps serving its pre-generated
   * transcripts.
   */
  llm?: LLMClient;
  /**
   * Upstream used by `/v1/chat/completions`. When omitted the server builds one
   * from the environment; without an API key the proxy answers 501 while
   * `/v1/models` still lists the demo persona.
   */
  chat?: ChatUpstream;
  /** Skip the automatic demo seed (also via `OPENMIMIC_SKIP_DEMO=1`). */
  skipDemo?: boolean;
  /** Built SPA directory served outside `/api/*`; defaults to `web/dist`. */
  webDistDir?: string;
}

export interface RunningServer {
  /** The port the server actually bound (resolves `port: 0`). */
  port: number;
  url: string;
  close(): Promise<void>;
}

/** Body accepted by `POST /api/subjects`; the id is server-generated. */
const CreateSubjectBodySchema = z.object({
  displayName: z.string().min(1),
  selfReport: z.string().min(1).optional(),
});

/** Body accepted by `POST /api/subjects/:id/rooms`; topic is optional. */
const CreateRoomBodySchema = z.object({
  topicSeed: z.string().min(1).optional(),
});

/**
 * One forwarded chat message. Loose on purpose: whatever the client sent is
 * relayed to the upstream unchanged, including fields this layer does not know.
 */
const ChatMessageSchema = z
  .object({
    role: z.string().min(1),
    content: z.unknown().optional(),
  })
  .passthrough();

/** Body accepted by `POST /v1/chat/completions`. */
const ChatCompletionBodySchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(ChatMessageSchema).min(1),
    stream: z.boolean().optional(),
  })
  .passthrough();

/** The OpenAI model-id prefix that maps to a persona. */
const PERSONA_MODEL_PREFIX = 'persona/';

const errorBody = (code: string, message: string): unknown => ({ error: { code, message } });

/** An OpenAI-shaped error, used on the `/v1` surface. */
const openAiError = (
  code: string,
  message: string,
  type: 'invalid_request_error' | 'server_error' = 'invalid_request_error',
): unknown => ({ error: { message, type, code } });

/** Claims produced by one court session, oldest first. */
function claimsForSession(store: Store, subjectId: string, sessionId: string) {
  return store
    .listClaimsBySubject(subjectId)
    .filter((claim) => claim.courtSessionId === sessionId);
}

function describeZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  store: Store,
  headers: Record<string, string> = {},
): void {
  // Every outbound payload crosses the W1 authorization gate's `external`
  // scope before serialization (see redactForExternal).
  const payload = JSON.stringify(redactForExternal(store, body));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(payload);
}

function sendAsset(
  response: ServerResponse,
  asset: { status: number; contentType: string; body: Buffer },
): void {
  response.writeHead(asset.status, {
    'content-type': asset.contentType,
    'content-length': asset.body.length,
    // The HTML shell must be revalidated so a redeploy is picked up.
    'cache-control': 'no-cache',
  });
  response.end(asset.body);
}

function buildRouter(
  store: Store,
  asr: AsrConfig,
  llm: LLMClient | undefined,
  chat: ChatUpstream | undefined,
): Router {
  const collector = createWitnessCollector(store, llm ? { llm } : {});
  const router = new Router();

  router.get('/api/health', () => ({
    status: 200,
    body: { ok: true, version: SERVER_VERSION },
  }));

  router.post('/api/subjects', (context) => {
    const body = CreateSubjectBodySchema.parse(context.body);
    const subject = SubjectSchema.parse({
      id: randomUUID(),
      displayName: body.displayName,
      ...(body.selfReport !== undefined ? { selfReport: body.selfReport } : {}),
    });
    store.putSubject(subject);
    return { status: 201, body: subject };
  });

  router.post('/api/subjects/:id/invites', (context) => {
    const subject = store.getSubject(context.params.id ?? '');
    if (!subject) throw new HttpError(404, 'subject_not_found', '当事人不存在');
    const invite = collector.createInvite(subject.id);
    return {
      status: 201,
      body: { token: invite.token, url: `/i/${invite.token}`, expiresAt: invite.expiresAt },
    };
  });

  router.get('/api/invites/:token', (context) => {
    // resolveInvite throws InviteInvalidError for unknown/expired tokens.
    const resolved = collector.resolveInvite(context.params.token ?? '');
    const subject = store.getSubject(resolved.subjectId);
    if (!subject) throw new HttpError(404, 'subject_not_found', '当事人不存在');
    // Display name + questionnaire only: never selfReport, never testimony.
    return {
      status: 200,
      body: { subjectDisplayName: subject.displayName, questionnaire: resolved.questionnaire },
    };
  });

  router.post('/api/invites/:token/testimony', (context) => {
    const input = SubmitTestimonyInputSchema.parse(context.body);
    const result = collector.submitTestimony(context.params.token ?? '', input);
    return { status: 201, body: result };
  });

  /* ---------------------------------------------------------------- */
  /* Interview sessions: the question tree plus conditional follow-ups */
  /* ---------------------------------------------------------------- */

  router.post('/api/invites/:token/interview', (context) => {
    const started = collector.startInterview(context.params.token ?? '');
    return {
      status: 201,
      body: {
        sessionId: started.sessionId,
        question: started.question,
        total: collector.questionnaire.questions.length,
      },
    };
  });

  router.post('/api/interview/:sid/answer', async (context) => {
    const input = AnswerQuestionInputSchema.parse(context.body);
    const step = await collector.answerQuestion(context.params.sid ?? '', input);
    return { status: 200, body: step };
  });

  router.post('/api/interview/:sid/followup', (context) => {
    const input = AnswerFollowupInputSchema.parse(context.body);
    const step = collector.answerFollowup(context.params.sid ?? '', input);
    return { status: 200, body: step };
  });

  router.post('/api/interview/:sid/finish', (context) => {
    const input = FinishInterviewInputSchema.parse(context.body);
    const result = collector.finishInterview(context.params.sid ?? '', input);
    return { status: 201, body: result };
  });

  router.get('/api/subjects/:id/progress', (context) => {
    const subjectId = context.params.id ?? '';
    if (!store.getSubject(subjectId)) {
      throw new HttpError(404, 'subject_not_found', '当事人不存在');
    }
    return {
      status: 200,
      body: {
        testimonyCount: store.listBySubject(subjectId).length,
        witnessCount: store.listWitnessesBySubject(subjectId).length,
      },
    };
  });

  router.get('/api/subjects/:id/rooms', (context) => {
    const subjectId = context.params.id ?? '';
    if (!store.getSubject(subjectId)) {
      throw new HttpError(404, 'subject_not_found', '当事人不存在');
    }
    return { status: 200, body: { rooms: store.listRoomsBySubject(subjectId) } };
  });

  router.post('/api/subjects/:id/rooms', async (context) => {
    const subjectId = context.params.id ?? '';
    if (!store.getSubject(subjectId)) {
      throw new HttpError(404, 'subject_not_found', '当事人不存在');
    }
    const body = CreateRoomBodySchema.parse(context.body ?? {});
    // A crisis topic is refused before any model call, demo data or not.
    const crisisWord = body.topicSeed ? findCrisisWord(body.topicSeed) : undefined;
    if (crisisWord) {
      throw new HttpError(
        422,
        'room_refused',
        `话题种子包含危机词面「${crisisWord}」,拒绝开房`,
      );
    }

    if (llm) {
      const room = await runBehindRoom(
        subjectId,
        store,
        llm,
        body.topicSeed !== undefined ? { topicSeed: body.topicSeed } : {},
      );
      return { status: 201, body: room };
    }

    // No model configured. The demo subject still works: it serves the
    // transcripts that were generated when the demo was seeded.
    if (subjectId === DEMO_SUBJECT_ID) {
      const rooms = store.listRoomsBySubject(subjectId);
      const room = rooms[rooms.length - 1];
      if (!room) throw new HttpError(500, 'demo_missing', '演示数据未初始化');
      return { status: 201, body: room };
    }
    throw new HttpError(501, 'llm_unavailable', '服务器未配置语言模型');
  });

  router.post('/api/rooms/:id/door', async (context) => {
    const roomId = context.params.id ?? '';
    const room = store.getRoom(roomId);
    if (!room) throw new HttpError(404, 'room_not_found', '房间不存在');

    if (llm) {
      // openDoor is idempotent: an already-open room is returned untouched.
      const opened = await openDoor(roomId, store, llm);
      return { status: 200, body: opened };
    }
    if (room.subjectId === DEMO_SUBJECT_ID) {
      return { status: 200, body: room };
    }
    throw new HttpError(501, 'llm_unavailable', '服务器未配置语言模型');
  });

  router.get('/api/rooms/:id', (context) => {
    const room = store.getRoom(context.params.id ?? '');
    if (!room) throw new HttpError(404, 'room_not_found', '房间不存在');
    // The page should not have to carry the subject's name in the URL; the
    // room payload names its own subject.
    const subject = store.getSubject(room.subjectId);
    return { status: 200, body: { ...room, subjectDisplayName: subject?.displayName ?? '' } };
  });

  /* ---------------------------------------------------------------- */
  /* Court: run a trial, read the baseline, read one session            */
  /* ---------------------------------------------------------------- */

  router.post('/api/subjects/:id/court', async (context) => {
    const subjectId = context.params.id ?? '';
    if (!store.getSubject(subjectId)) {
      throw new HttpError(404, 'subject_not_found', '当事人不存在');
    }

    if (llm) {
      const session = await runCourt(subjectId, store, llm);
      // Re-running is a *full* retrial: every claim from an earlier session is
      // retired so the new session is the single source of truth. Incremental
      // re-examination (keeping untouched claims alive) is deliberately future
      // work, not something this batch pretends to do.
      for (const claim of store.listClaimsBySubject(subjectId)) {
        if (claim.courtSessionId !== session.id && claim.status !== 'retired') {
          store.putClaim({ ...claim, status: 'retired' });
        }
      }
      return {
        status: 200,
        body: { session, claims: claimsForSession(store, subjectId, session.id) },
      };
    }

    // No model configured. The demo subject still works: it serves the session
    // that was generated when the demo was seeded.
    if (subjectId === DEMO_SUBJECT_ID) {
      const sessions = store.listCourtSessionsBySubject(subjectId);
      const session = sessions[sessions.length - 1];
      if (!session) throw new HttpError(500, 'demo_missing', '演示数据未初始化');
      return {
        status: 200,
        body: { session, claims: claimsForSession(store, subjectId, session.id) },
      };
    }
    throw new HttpError(501, 'llm_unavailable', '服务器未配置语言模型');
  });

  router.get('/api/subjects/:id/claims', (context) => {
    const subjectId = context.params.id ?? '';
    if (!store.getSubject(subjectId)) {
      throw new HttpError(404, 'subject_not_found', '当事人不存在');
    }
    // "surviving + qualified": a qualified claim is a surviving claim carrying
    // at least one qualifier, so both are status `surviving`. Only claim text
    // and evidence *ids* leave this route — never the testimony originals.
    const claims = store
      .listClaimsBySubject(subjectId)
      .filter((claim) => claim.status === 'surviving');
    return { status: 200, body: { claims } };
  });

  /* ---------------------------------------------------------------- */
  /* .persona packages: portable, consent-filtered persona export      */
  /* ---------------------------------------------------------------- */

  router.get('/api/subjects/:id/export', (context) => {
    const subjectId = context.params.id ?? '';
    const subject = store.getSubject(subjectId);
    if (!subject) throw new HttpError(404, 'subject_not_found', '当事人不存在');
    const pkg = buildPersonaPackage(subjectId, store);
    if (!pkg) throw new HttpError(404, 'subject_not_found', '当事人不存在');
    // Defense in depth: the package is built from synthesized claims and
    // `quotable` samples only, and the general scrubber runs on top so a
    // future field cannot leak a `synthesis_only` run.
    const body = withholdSynthesisOnly(store, subjectId, pkg);
    return {
      status: 200,
      body,
      headers: {
        'content-disposition': personaContentDisposition(subject.displayName, subjectId),
      },
    };
  });

  router.post('/api/import', (context) => {
    const result = importPersonaPackage(store, context.body);
    return { status: 201, body: result };
  });

  router.get('/api/court/:sessionId', (context) => {
    const session = store.getCourtSession(context.params.sessionId ?? '');
    if (!session) throw new HttpError(404, 'session_not_found', '法庭会话不存在');
    // The transcript crosses the external scope in `sendJson`: challenge lines
    // may quote a `synthesis_only` testimony, and those runs are withheld.
    return { status: 200, body: session };
  });

  router.get('/api/asr/available', () => ({
    status: 200,
    body: { available: isAsrAvailable(asr) },
  }));

  router.post('/api/asr', async (context) => {
    if (!isAsrAvailable(asr)) {
      // No key: the UI hides the microphone entirely; this path is the
      // truthful answer for anything else that still calls it.
      throw new HttpError(501, 'asr_unavailable', '服务器未配置语音转写');
    }
    const raw = context.rawBody;
    if (!raw || raw.length === 0) {
      throw new HttpError(400, 'asr_no_audio', '没有收到音频数据');
    }
    const input = await normalizeAudioInput(raw, context.contentType ?? '');
    const text = await transcribeAudio(input, asr);
    return { status: 200, body: { text } };
  });

  /* ---------------------------------------------------------------- */
  /* OpenAI-compatible surface: the persona *is* the model             */
  /* ---------------------------------------------------------------- */

  router.get('/v1/models', () => {
    // Only subjects with at least one surviving claim are servable personas;
    // a subject with an empty baseline has nothing to be a model of.
    const data: unknown[] = [];
    for (const subject of store.listSubjects()) {
      const served = store
        .listClaimsBySubject(subject.id)
        .some((claim) => claim.status === 'surviving');
      if (!served) continue;
      data.push({
        id: `${PERSONA_MODEL_PREFIX}${subject.id}`,
        object: 'model',
        created: 0,
        owned_by: 'openmimic',
      });
    }
    return { status: 200, body: { object: 'list', data } };
  });

  router.post('/v1/chat/completions', async (context) => {
    const body = ChatCompletionBodySchema.parse(context.body);
    if (!body.model.startsWith(PERSONA_MODEL_PREFIX)) {
      return {
        status: 404,
        body: openAiError('model_not_found', `未知模型:${body.model}`),
      };
    }
    const subjectId = body.model.slice(PERSONA_MODEL_PREFIX.length);
    if (subjectId === '' || !store.getSubject(subjectId)) {
      return {
        status: 404,
        body: openAiError('model_not_found', `未知模型:${body.model}`),
      };
    }
    // No key: say so rather than attempting a real call. `/v1/models`
    // deliberately keeps listing the demo so a key-less install is inspectable.
    if (!chat || !chat.configured || !chat.hasApiKey) {
      return {
        status: 501,
        body: openAiError('llm_unavailable', '服务器未配置语言模型', 'server_error'),
      };
    }

    const { systemPrompt } = assemblePersonaContext(subjectId, store);
    // The persona prompt is prepended; a client-supplied system message is kept
    // verbatim right after it, so the persona stays the higher authority.
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...body.messages,
    ];
    const stream = body.stream === true;

    let upstream: Response;
    try {
      upstream = await chat.chatRaw(messages, { stream });
    } catch {
      // Nothing has been written yet, so a plain JSON error is safe.
      return {
        status: 502,
        body: openAiError('upstream_error', '上游模型服务不可用', 'server_error'),
      };
    }
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return {
        status: 502,
        body: openAiError(
          'upstream_error',
          `上游模型返回 ${upstream.status}${detail ? `:${detail.slice(0, 200)}` : ''}`,
          'server_error',
        ),
      };
    }

    if (!stream) {
      // Usage and every other field pass through untouched. Conversation
      // content is deliberately never persisted here: chat is private, and an
      // audit switch belongs to the W5 official site, not this layer.
      let payload: unknown;
      try {
        payload = await upstream.json();
      } catch {
        return {
          status: 502,
          body: openAiError('upstream_error', '上游返回了无法解析的响应', 'server_error'),
        };
      }
      return { status: 200, body: payload };
    }

    // SSE: pipe the raw bytes through without parsing or reassembling them.
    return {
      kind: 'stream' as const,
      run: async (response: ServerResponse) => {
        response.writeHead(200, {
          'content-type':
            upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
        });
        try {
          const streamBody = upstream.body;
          if (streamBody) {
            const reader = streamBody.getReader();
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) response.write(Buffer.from(value));
              }
            } finally {
              reader.releaseLock();
            }
          }
        } catch {
          // Upstream broke mid-stream: close with an OpenAI error object so a
          // streaming client still sees a structured failure.
          response.write(
            `data: ${JSON.stringify(openAiError('upstream_error', '上游流中断', 'server_error'))}\n\n`,
          );
        }
        response.end();
      },
    };
  });

  return router;
}

/** Routes that read a binary body verbatim instead of parsing JSON. */
const RAW_BODY_ROUTES = new Set(['/api/asr']);

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  router: Router,
  store: Store,
  staticHandler: StaticHandler | undefined,
): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const method = request.method ?? 'GET';
    const match = router.match(method, url.pathname);
    if (!match) {
      // Everything under `/api` stays JSON; anything else may be the SPA.
      if (!url.pathname.startsWith('/api/') && staticHandler) {
        const asset = await staticHandler(url.pathname);
        if (asset) {
          sendAsset(response, asset);
          return;
        }
      }
      sendJson(response, 404, errorBody('not_found', '接口不存在'), store);
      return;
    }
    let body: unknown;
    let rawBody: Buffer | undefined;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      if (RAW_BODY_ROUTES.has(url.pathname)) rawBody = await readRawBody(request);
      else body = await readJsonBody(request);
    }
    const context: RouteContext = {
      params: match.params,
      query: url.searchParams,
      body,
      ...(rawBody !== undefined ? { rawBody } : {}),
      contentType: request.headers['content-type'] ?? '',
    };
    const result: RouteHandlerResult = await match.handler(context);
    if (isStreamResult(result)) {
      // The handler already owns the socket (SSE passthrough). It must not
      // throw; if it did, the catch below would try to write JSON over an
      // already-sent response.
      await result.run(response);
      return;
    }
    sendJson(response, result.status, result.body, store, result.headers);
  } catch (caught) {
    if (caught instanceof ZodError) {
      sendJson(response, 400, errorBody('validation_error', describeZodError(caught)), store);
    } else if (caught instanceof InviteInvalidError) {
      sendJson(response, 410, errorBody('invite_invalid', caught.message), store);
    } else if (caught instanceof InterviewSessionInvalidError) {
      sendJson(response, 410, errorBody('session_invalid', caught.message), store);
    } else if (caught instanceof InterviewStateError) {
      sendJson(response, 409, errorBody('interview_state', caught.message), store);
    } else if (caught instanceof RoomRefusedError) {
      sendJson(response, 422, errorBody('room_refused', caught.message), store);
    } else if (caught instanceof UnknownRoomError) {
      sendJson(response, 404, errorBody('room_not_found', caught.message), store);
    } else if (caught instanceof HttpError) {
      sendJson(response, caught.status, errorBody(caught.code, caught.message), store);
    } else {
      sendJson(response, 500, errorBody('internal_error', '服务器内部错误'), store);
    }
  }
}

/**
 * Build the model client from the environment, or `undefined` when unconfigured.
 *
 * Construction performs no I/O; the production client only leaves the process
 * when a route asks it to complete.
 */
function createEnvLLM(): OpenAICompatClient | undefined {
  const client = new OpenAICompatClient();
  return client.configured ? client : undefined;
}

/**
 * Start the collection API and resolve once it is listening.
 *
 * The caller owns the {@link Store}; closing the server does not close it.
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { store } = options;
  const asrConfig: AsrConfig = { ...readAsrConfig(), ...options.asr };
  // An env client without a key is not usable: the whole project's contract is
  // "no key => 501", never a silent key-less call to a remote endpoint.
  const envClient = createEnvLLM();
  const envReady = envClient && envClient.hasApiKey ? envClient : undefined;
  const llm = options.llm ?? envReady;
  const chat = options.chat ?? envReady;

  // An empty database gets the 林默 demo so a key-less install has something to
  // show. `OPENMIMIC_SKIP_DEMO=1` (or `skipDemo`) turns it off.
  const skipDemo = options.skipDemo ?? process.env.OPENMIMIC_SKIP_DEMO === '1';
  if (!skipDemo && store.listSubjects().length === 0) {
    seedDemo(store);
  }

  const router = buildRouter(store, asrConfig, llm, chat);
  // An empty path disables static hosting (the whole API still works).
  const distDir = options.webDistDir ?? 'web/dist';
  const staticHandler = distDir === '' ? undefined : createStaticHandler(distDir);

  const server = createServer((request, response) => {
    void handleRequest(request, response, router, store, staticHandler);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
