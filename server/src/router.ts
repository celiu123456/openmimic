import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthContext } from './scopes';

/** Everything a route handler receives for one request. */
export interface RouteContext {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  /** Raw bytes for routes that stream something other than JSON (audio). */
  rawBody?: Buffer;
  /** Original `content-type` header, paired with {@link rawBody}. */
  contentType?: string;
  /** Resolved auth context for this request. */
  auth?: AuthContext;
}

export interface RouteResult {
  status: number;
  body: unknown;
  /** Extra response headers, merged over the JSON defaults. */
  headers?: Record<string, string>;
}

/**
 * A handler that writes the response itself instead of returning JSON.
 *
 * Used by the OpenAI-compatible proxy: an SSE upstream is piped through byte
 * for byte, so the bytes must never pass through `JSON.stringify`. The runner
 * may not throw — headers are already on the wire — so it owns its own error
 * handling.
 */
export interface RouteStreamResult {
  kind: 'stream';
  run(response: ServerResponse): Promise<void>;
}

export type RouteHandlerResult = RouteResult | RouteStreamResult;

export type RouteHandler = (context: RouteContext) => RouteHandlerResult | Promise<RouteHandlerResult>;

/** Narrow a handler result to the streaming variant. */
export function isStreamResult(result: RouteHandlerResult): result is RouteStreamResult {
  return (result as RouteStreamResult).kind === 'stream';
}

/** Thrown by a route to choose the HTTP status its failure maps to. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const MAX_BODY_BYTES = 256 * 1024;

/** Audio uploads are large; the JSON limit does not apply to them. */
export const MAX_RAW_BODY_BYTES = 25 * 1024 * 1024;

/**
 * Read a binary request body verbatim (used by `POST /api/asr`).
 *
 * The bytes are never parsed here: audio may be raw or multipart, and that
 * decision belongs to the ASR layer.
 */
export async function readRawBody(
  request: IncomingMessage,
  maxBytes: number = MAX_RAW_BODY_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, 'payload_too_large', '音频文件过大');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Read and parse a JSON body, rejecting oversized or malformed input. */
export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', '请求体过大');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'invalid_json', '请求体不是合法 JSON');
  }
}

/**
 * Options for route registration. Plugins may declare required scopes
 * via the `scope` field. Routes without a scope declaration default to
 * 'admin' (fail-closed).
 */
export interface RouteOptions {
  /** The scope required to access this route. Default: 'admin' (fail-closed). */
  scope?: string;
  /** When true, this route is open (no auth required). Overrides scope. */
  open?: boolean;
}

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
  /** The scope required to access this route. */
  scope: string | undefined;
  /** Whether this route is open (unauthenticated). */
  open: boolean;
  /** The original path pattern (e.g. '/api/subjects/:id'). */
  pattern: string;
}

export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
  /** The scope required by the matched route, or undefined (defaults to 'admin'). */
  scope: string | undefined;
  /** Whether the matched route is open (no auth needed). */
  open: boolean;
}

const splitPath = (path: string): string[] => path.split('/').filter((part) => part !== '');

/**
 * Minimal method + path router: exact segments, `:name` captures, nothing
 * else. No middleware, no wildcards, no regex — the API needs none of them.
 *
 * Each route may declare a required scope via {@link RouteOptions}. Routes
 * without a scope declaration default to 'admin' (fail-closed).
 */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler, options?: RouteOptions): this {
    this.routes.push({
      method,
      segments: splitPath(path),
      handler,
      scope: options?.scope,
      open: options?.open ?? false,
      pattern: path,
    });
    return this;
  }

  get(path: string, handler: RouteHandler, options?: RouteOptions): this {
    return this.add('GET', path, handler, options);
  }

  post(path: string, handler: RouteHandler, options?: RouteOptions): this {
    return this.add('POST', path, handler, options);
  }

  match(method: string, pathname: string): RouteMatch | undefined {
    const parts = splitPath(pathname);
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < parts.length; index += 1) {
        const pattern = route.segments[index] ?? '';
        const value = parts[index] ?? '';
        if (pattern.startsWith(':')) params[pattern.slice(1)] = decodeURIComponent(value);
        else if (pattern !== value) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params, scope: route.scope, open: route.open };
    }
    return undefined;
  }

  /**
   * Return all registered routes with their scope declarations.
   *
   * Used by tests to scan for undeclared routes and by the capabilities
   * endpoint to build the capability directory.
   */
  listRoutes(): Array<{ method: string; pattern: string; scope: string | undefined; open: boolean }> {
    return this.routes.map((r) => ({
      method: r.method,
      pattern: r.pattern,
      scope: r.scope,
      open: r.open,
    }));
  }
}
