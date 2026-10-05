/**
 * Minimal access control for public deployments.
 *
 * - OPENMIMIC_ADMIN_TOKEN gates management routes (create subject, view
 *   testimonies, run court, rooms, export, etc.).
 * - Invite/interview routes are open: the invite token itself is the
 *   authorization.
 * - When OPENMIMIC_ADMIN_TOKEN is unset the server binds only to 127.0.0.1
 *   and prints a warning.
 */
import type { IncomingMessage } from 'node:http';
import { HttpError } from './router';

/** Routes that never require authentication. */
const OPEN_PREFIXES = [
  '/api/health',
  '/api/invites/',   // resolve invite, submit testimony, start interview
  '/api/interview/', // interview session (answer, followup, finish)
  '/api/asr',        // speech -- gated by its own config, not auth
];

/**
 * Extract the admin token from the request.
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

/**
 * Returns true if the path is an open (unauthenticated) route.
 */
export function isOpenRoute(pathname: string): boolean {
  return OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Check admin access. Throws HttpError(401) on failure.
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
    throw new HttpError(401, 'unauthorized', '需要管理口令');
  }
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
 * Extract a rate-limit key from the request. Uses the invite token if
 * present in the URL, otherwise falls back to the remote IP.
 */
export function rateLimitKey(request: IncomingMessage, pathname: string): string {
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
