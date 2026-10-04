import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z, ZodError } from 'zod';
import { SubjectSchema } from '@openmimic/shared';
import { UnknownRoomError, type Store } from '@openmimic/kernel';
import { OpenAICompatClient } from '@openmimic/engine-court';
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
import { redactForExternal } from './external';
import {
  HttpError,
  Router,
  readJsonBody,
  readRawBody,
  type RouteContext,
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

export interface StartServerOptions {
  port: number;
  store: Store;
  /** Overrides for the ASR config; unset fields fall back to the environment. */
  asr?: Partial<AsrConfig>;
  /**
   * LLM used by the room routes. When omitted the server builds one from the
   * environment; if that is unconfigured, non-demo rooms answer 501 while the
   * 林默 demo keeps serving its pre-generated transcripts.
   */
  llm?: LLMClient;
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

const errorBody = (code: string, message: string): unknown => ({ error: { code, message } });

function describeZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
}

function sendJson(response: ServerResponse, status: number, body: unknown, store: Store): void {
  // Every outbound payload crosses the W1 authorization gate's `external`
  // scope before serialization (see redactForExternal).
  const payload = JSON.stringify(redactForExternal(store, body));
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
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

function buildRouter(store: Store, asr: AsrConfig, llm: LLMClient | undefined): Router {
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
    return { status: 200, body: room };
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
    const result = await match.handler(context);
    sendJson(response, result.status, result.body, store);
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
 * Build the room LLM from the environment, or `undefined` when unconfigured.
 *
 * Construction performs no I/O; the production client only leaves the process
 * when a room actually asks it to complete.
 */
function createEnvLLM(): LLMClient | undefined {
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
  const llm = options.llm ?? createEnvLLM();

  // An empty database gets the 林默 demo so a key-less install has something to
  // show. `OPENMIMIC_SKIP_DEMO=1` (or `skipDemo`) turns it off.
  const skipDemo = options.skipDemo ?? process.env.OPENMIMIC_SKIP_DEMO === '1';
  if (!skipDemo && store.listSubjects().length === 0) {
    seedDemo(store);
  }

  const router = buildRouter(store, asrConfig, llm);
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
