import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import {
  EventBus,
  PluginHost,
  UnknownRoomError,
  type Store,
} from '@openmimic/kernel';
import {
  OpenAICompatClient,
  type ChatMessage,
} from '@openmimic/engine-court';
import {
  RoomRefusedError,
  type LLMClient,
} from '@openmimic/engine-room';
import {
  InterviewSessionInvalidError,
  InterviewStateError,
  InviteInvalidError,
  witnessPlugin,
} from '@openmimic/engine-witness';
import { courtPlugin } from '@openmimic/engine-court';
import { roomPlugin } from '@openmimic/engine-room';
import { DEMO_SUBJECT_ID, seedDemo } from '../../fixtures/limo';
import { redactForExternal } from './external';
import {
  HttpError,
  Router,
  isStreamResult,
  readJsonBody,
  readRawBody,
  type RouteContext,
  type RouteHandlerResult,
} from './router';
import { readAsrConfig, type AsrConfig } from './asr';
import { createStaticHandler, type StaticHandler } from './static';
import { mountRestPlugin, type MountRestConfig } from './mount-rest';
import { mountOpenaiPlugin, type MountOpenAIConfig } from './mount-openai';
import { mountMcpPlugin, type MountMcpConfig } from './mount-mcp';

export { SERVER_VERSION } from './mount-rest';

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

const errorBody = (code: string, message: string): unknown => ({ error: { code, message } });

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  store: Store,
  headers: Record<string, string> = {},
): void {
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
    'cache-control': 'no-cache',
  });
  response.end(asset.body);
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
      await result.run(response);
      return;
    }
    sendJson(response, result.status, result.body, store, result.headers);
  } catch (caught) {
    if (caught instanceof ZodError) {
      const desc = caught.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      sendJson(response, 400, errorBody('validation_error', desc), store);
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
 */
function createEnvLLM(): OpenAICompatClient | undefined {
  const client = new OpenAICompatClient();
  return client.configured ? client : undefined;
}

/**
 * Start the collection API and resolve once it is listening.
 *
 * Internally assembles the plugin system: preset services → engine plugins →
 * mount plugins. The caller owns the {@link Store}; closing the server does
 * not close it.
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { store } = options;
  const envClient = createEnvLLM();
  const envReady = envClient && envClient.hasApiKey ? envClient : undefined;
  const llm = options.llm ?? envReady;
  const chat = options.chat ?? envReady;

  // Demo seed
  const skipDemo = options.skipDemo ?? process.env.OPENMIMIC_SKIP_DEMO === '1';
  if (!skipDemo && store.listSubjects().length === 0) {
    seedDemo(store);
  }

  // Assemble the plugin system
  const events = new EventBus();
  const host = new PluginHost(events);
  const router = new Router();

  // Kernel preset services
  host.providePreset('store', store);
  host.providePreset('events', events);
  host.providePreset('router', router);
  if (llm) host.providePreset('llm', llm);

  // Load engine plugins
  await host.load(witnessPlugin);
  if (llm) {
    await host.load(courtPlugin);
    await host.load(roomPlugin);
  }

  // Load mount plugins
  const restConfig: MountRestConfig = { asr: options.asr };
  await host.load(mountRestPlugin, restConfig);

  const openaiConfig: MountOpenAIConfig = { chat };
  await host.load(mountOpenaiPlugin, openaiConfig);

  const mcpConfig: MountMcpConfig = { chat };
  await host.load(mountMcpPlugin, mcpConfig);

  // Static hosting
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
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await host.disposeAll();
    },
  };
}
