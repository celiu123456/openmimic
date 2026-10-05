/**
 * Access control for OpenMimic.
 *
 * Two layers:
 * 1. **Admin token** (OPENMIMIC_ADMIN_TOKEN): the existing instance-level
 *    management password. Unchanged behavior — it grants full access.
 * 2. **Scoped tokens** (omk_...): created via `POST /api/tokens`. Each
 *    token carries an explicit set of scopes and optional subject bindings.
 *
 * Open routes (invites, interviews, health) require no authentication.
 * Every other route declares the scope it needs; routes without a
 * declaration default to requiring `admin` (fail-closed).
 *
 * When OPENMIMIC_ADMIN_TOKEN is unset the server binds only to 127.0.0.1
 * and prints a warning. Scoped tokens still work in that mode.
 */
import type { IncomingMessage } from 'node:http';
import { HttpError } from './router';
import {
  AUTH_ERROR_CODES,
  ADMIN_AUTH,
  OPEN_AUTH,
  TOKEN_PREFIX,
  hasScope,
  hasSubjectAccess,
  type AuthContext,
} from './scopes';
import type { TokenStore } from './token-store';

/* ------------------------------------------------------------------ */
/* Token extraction                                                    */
/* ------------------------------------------------------------------ */

/**
 * Extract the bearer/cookie/query token from the request.
 *
 * Checks (in order):
 *   1. `Authorization: Bearer <token>` header
 *   2. `_token=<token>` cookie
 *   3. `_token` query parameter (convenience for browser links)
 */
export function extractToken(request: IncomingMessage): string | undefined {
  // Bearer header
  const auth = request.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  // Cookie
  const cookie = request.headers.cookie;
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]!);
  }

  // Query parameter
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const qToken = url.searchParams.get('_token');
    if (qToken) return qToken;
  } catch {
    // ignore
  }

  return undefined;
}

/* ------------------------------------------------------------------ */
/* Auth resolution                                                     */
/* ------------------------------------------------------------------ */

/**
 * Resolve the auth context for a request.
 *
 * Order of precedence:
 *   1. If the route is open, return OPEN_AUTH.
 *   2. If the token matches the admin token, return ADMIN_AUTH.
 *   3. If the token starts with `omk_`, resolve it as a scoped token.
 *   4. Otherwise, throw 401.
 */
export function resolveAuth(
  request: IncomingMessage,
  adminToken: string | undefined,
  isOpen: boolean,
  tokenStore: TokenStore | undefined,
): AuthContext {
  if (isOpen) return OPEN_AUTH;

  const token = extractToken(request);

  // No token provided
  if (!token) {
    // When no admin token is configured, all routes are open (loopback mode)
    if (!adminToken) return ADMIN_AUTH;
    throw new HttpError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Authentication required');
  }

  // Check admin token first
  if (adminToken && token === adminToken) {
    return ADMIN_AUTH;
  }

  // Check scoped token
  if (token.startsWith(TOKEN_PREFIX) && tokenStore) {
    const record = tokenStore.resolve(token);
    if (!record) {
      throw new HttpError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Invalid or expired token');
    }
    return {
      kind: 'scoped_token',
      scopes: record.scopes,
      subjectIds: record.subjectIds,
      tokenId: record.id,
    };
  }

  // Token provided but does not match admin or scoped format
  if (!adminToken) return ADMIN_AUTH;
  throw new HttpError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Invalid token');
}

/* ------------------------------------------------------------------ */
/* Scope enforcement                                                   */
/* ------------------------------------------------------------------ */

/**
 * Enforce a scope requirement against an auth context.
 *
 * Throws HttpError(403) if the auth context does not carry the required scope.
 */
export function requireScope(auth: AuthContext, scope: string): void {
  if (!hasScope(auth, scope)) {
    throw new HttpError(403, AUTH_ERROR_CODES.FORBIDDEN_SCOPE,
      `Token does not have the required scope: ${scope}`);
  }
}

/**
 * Enforce subject access against an auth context.
 *
 * Throws HttpError(403) if the token is subject-bound and the subject is
 * not in its allowed list.
 */
export function requireSubjectAccess(auth: AuthContext, subjectId: string): void {
  if (!hasSubjectAccess(auth, subjectId)) {
    throw new HttpError(403, AUTH_ERROR_CODES.FORBIDDEN_SUBJECT,
      'Token is not authorized for this subject');
  }
}

/* ------------------------------------------------------------------ */
/* Legacy compat: isOpenRoute                                          */
/* ------------------------------------------------------------------ */

/** Routes that never require authentication (used by open route declarations). */
const OPEN_PREFIXES = [
  '/api/health',
  '/api/invites/',   // resolve invite, submit testimony, start interview
  '/api/interview/', // interview session (answer, followup, finish)
  '/api/asr',        // speech -- gated by its own config, not auth
  '/api/capabilities', // public capability directory
];

/**
 * Returns true if the path is an open (unauthenticated) route.
 *
 * Note: this is now a fallback. Routes should declare `{ open: true }` in
 * their registration. This function catches routes that use the old prefix
 * convention.
 */
export function isOpenRoute(pathname: string): boolean {
  return OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/* ------------------------------------------------------------------ */
/* In-memory rate limiter (zero dependencies)                          */
/* ------------------------------------------------------------------ */

interface RateBucket {
  count: number;
  windowStart: number;
}

/**
 * Simple fixed-window in-memory rate limiter.
 *
 * Each key (IP or token) gets `maxRequests` per `windowMs`. No external
 * dependencies. Stale entries are lazily pruned on access.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private lastPrune = Date.now();

  constructor(options: { maxRequests: number; windowMs: number }) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
  }

  /**
   * Returns true if the request is allowed, false if rate-limited.
   */
  check(key: string): boolean {
    const now = Date.now();

    // Lazy prune every 60s
    if (now - this.lastPrune > 60_000) {
      this.prune(now);
      this.lastPrune = now;
    }

    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }

    bucket.count += 1;
    return bucket.count <= this.maxRequests;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Extract a rate-limit key from the request. Uses the auth token ID if
 * available, the invite token if present in the URL, otherwise falls back
 * to the remote IP.
 */
export function rateLimitKey(
  request: IncomingMessage,
  pathname: string,
  auth?: AuthContext,
): string {
  // For scoped tokens, key by token ID
  if (auth?.tokenId) return `token:${auth.tokenId}`;

  // For invite/interview routes, key by the token in the URL
  const inviteMatch = pathname.match(/^\/api\/invites\/([^/]+)/);
  if (inviteMatch) return `invite:${inviteMatch[1]}`;

  const interviewMatch = pathname.match(/^\/api\/interview\/([^/]+)/);
  if (interviewMatch) return `session:${interviewMatch[1]}`;

  // Fall back to IP
  const forwarded = request.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string'
    ? forwarded.split(',')[0]!.trim()
    : request.socket.remoteAddress ?? 'unknown';
  return `ip:${ip}`;
}

/* ------------------------------------------------------------------ */
/* Legacy compat: requireAdmin (kept for backward compatibility)       */
/* ------------------------------------------------------------------ */

/**
 * @deprecated Use resolveAuth + requireScope instead.
 *
 * Kept so that the existing test suite continues to pass during migration.
 * Internally delegates to the new auth system.
 */
export function requireAdmin(
  request: IncomingMessage,
  adminToken: string,
  pathname: string,
): void {
  // Static assets and open API routes skip auth
  if (!pathname.startsWith('/api/') && !pathname.startsWith('/v1/')) return;

  // Open routes
  if (isOpenRoute(pathname)) return;

  const token = extractToken(request);
  if (!token || token !== adminToken) {
    throw new HttpError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Authentication required');
  }
}
