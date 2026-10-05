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
import { RoomRefusedError, type LLMClient } from '@openmimic/engine-room';
import {
  InterviewSessionInvalidError,
  InterviewStateError,
  InviteInvalidError,
} from '@openmimic/engine-witness';
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
import { resolvePlugin } from './plugin-resolver';
import {
  resolveAuth,
  requireScope,
  requireSubjectAccess,
  isOpenRoute,
  RateLimiter,
  rateLimitKey,
  requireAdmin,
} from './auth';
import {
  AUTH_ERROR_CODES,
  type AuthContext,
} from './scopes';
import { TokenStore } from './token-store';
import { buildCapabilityDirectory, type CapabilityDeclaration } from './capabilities';
import type { MountRestConfig } from './mount-rest';
import type { MountOpenAIConfig } from './mount-openai';
import type { MountMcpConfig } from './mount-mcp';

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
  /**
   * Admin token for management routes. When omitted the server reads
   * `OPENMIMIC_ADMIN_TOKEN` from the environment; when that is also unset
   * the server binds only to 127.0.0.1 (loopback) and all routes are open.
   */
  adminToken?: string;
  /**
   * Per-token rate limit for the OpenAI-compatible endpoint.
   * Defaults to 60 requests per minute.
   */
  tokenRateLimit?: { maxRequests: number; windowMs: number };
}

export interface RunningServer {
  /** The port the server actually bound (resolves `port: 0`). */
  port: number;
  url: string;
  close(): Promise<void>;
  /** Exposed for test introspection only — lists registered routes and their scope declarations. */
  _router?: Router;
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
  adminToken: string | undefined,
  submitLimiter: RateLimiter,
  tokenLimiter: RateLimiter,
  tokenStore: TokenStore | undefined,
): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const method = request.method ?? 'GET';

    // Match the route first so we know its scope declaration
    const match = router.match(method, url.pathname);

    // Determine if this is an open route (either by route declaration or prefix)
    const routeIsOpen = match?.open ?? false;
    const pathIsOpen = isOpenRoute(url.pathname);
    const isOpen = routeIsOpen || pathIsOpen ||
      (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/v1/'));

    // Resolve auth context
    const auth = resolveAuth(request, adminToken, isOpen, tokenStore);

    // Scope enforcement for matched routes
    if (match && !isOpen) {
      // Use the route's declared scope, or default to 'admin' (fail-closed)
      const requiredScope = match.scope ?? 'admin';
      requireScope(auth, requiredScope);
    }

    // Rate limiting
    if (auth.kind === 'scoped_token') {
      // Per-token rate limit for scoped tokens
      const key = rateLimitKey(request, url.pathname, auth);
      if (!tokenLimiter.check(key)) {
        sendJson(response, 429, errorBody(AUTH_ERROR_CODES.RATE_LIMITED,
          'Token rate limit exceeded'), store);
        return;
      }
    } else if (method === 'POST' && pathIsOpen) {
      // Legacy rate limiting for open submission routes
      const key = rateLimitKey(request, url.pathname);
      if (!submitLimiter.check(key)) {
        sendJson(response, 429, errorBody(AUTH_ERROR_CODES.RATE_LIMITED,
          'Rate limit exceeded'), store);
        return;
      }
    }

    if (!match) {
      if (!url.pathname.startsWith('/api/') && staticHandler) {
        const asset = await staticHandler(url.pathname);
        if (asset) {
          sendAsset(response, asset);
          return;
        }
      }
      sendJson(response, 404, errorBody('not_found', 'Endpoint not found'), store);
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
      auth,
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
      sendJson(response, 500, errorBody('internal_error', 'Internal server error'), store);
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
 * Internally assembles the plugin system: preset services -> engine plugins ->
 * mount plugins. The caller owns the {@link Store}; closing the server does
 * not close it.
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { store } = options;
  const envClient = createEnvLLM();
  const envReady = envClient && envClient.hasApiKey ? envClient : undefined;
  const llm = options.llm ?? envReady;
  const chat = options.chat ?? envReady;

  // Access control
  const adminToken = options.adminToken ?? process.env.OPENMIMIC_ADMIN_TOKEN;
  const bindLoopbackOnly = !adminToken;

  // Token store for scoped access tokens (salt is instance-level, persisted in DB)
  const tokenStore = new TokenStore(store);

  // Rate limiters
  const submitLimiter = new RateLimiter({ maxRequests: 30, windowMs: 60_000 });
  const tokenRateCfg = options.tokenRateLimit ?? { maxRequests: 60, windowMs: 60_000 };
  const tokenLimiter = new RateLimiter(tokenRateCfg);

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

  // Load plugins via resolver (the single location that maps use names
  // to concrete Plugin objects). Engine plugins that need llm are only
  // loaded when an LLM is available.
  const pluginConfigs: Record<string, unknown> = {
    'mount-rest': { asr: options.asr, tokenStore } satisfies MountRestConfig & { tokenStore: TokenStore },
    'mount-openai': { chat } satisfies MountOpenAIConfig,
    'mount-mcp': { chat } satisfies MountMcpConfig,
  };

  const useNames = [
    '@openmimic/engine-witness',
    ...(llm ? ['@openmimic/engine-court', '@openmimic/engine-room'] : []),
    '@openmimic/engine-gate',
    '@openmimic/meta-perception',
    '@openmimic/silence-signal',
    '@openmimic/mount-rest',
    '@openmimic/mount-openai',
    '@openmimic/mount-mcp',
  ];

  for (const use of useNames) {
    const plugin = resolvePlugin(use);
    if (!plugin) throw new Error(`plugin not found: ${use}`);
    const config = pluginConfigs[plugin.name];
    await host.load(plugin, config);
  }

  // Static hosting
  const distDir = options.webDistDir ?? 'web/dist';
  const staticHandler = distDir === '' ? undefined : createStaticHandler(distDir);

  const server = createServer((request, response) => {
    void handleRequest(
      request, response, router, store, staticHandler,
      adminToken, submitLimiter, tokenLimiter, tokenStore,
    );
  });

  const bindHost = bindLoopbackOnly ? '127.0.0.1' : '0.0.0.0';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, bindHost, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    _router: router,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await host.disposeAll();
    },
  };
}
