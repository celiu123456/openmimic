/**
 * Scoped access control: scope definitions and token management.
 *
 * Design: explicit whitelist of known scopes. Wildcards are forbidden.
 * Unknown scopes are rejected at token creation time (fail-closed at the
 * credential boundary). Each route declares the scope it requires; routes
 * without a declaration default to `admin` (fail-closed at the enforcement
 * boundary).
 */
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

/* ------------------------------------------------------------------ */
/* Scope definitions                                                   */
/* ------------------------------------------------------------------ */

/**
 * Every known scope and its human-readable definition.
 *
 * The scope string is the canonical identifier used in token creation,
 * route declarations and enforcement. The description is for documentation
 * and the capabilities endpoint.
 */
export const SCOPE_DEFINITIONS: ReadonlyMap<string, string> = new Map([
  ['persona.chat', 'Converse with a persona via the OpenAI-compatible endpoint.'],
  ['persona.read', 'List personas and read assembly metadata (no testimony text, no system prompt).'],
  ['testimony.read', 'Read raw testimony text. Not granted by default to any token.'],
  ['testimony.write', 'Submit testimony on behalf of a witness (collector integrations).'],
  ['court.run', 'Trigger a court session for a subject.'],
  ['room.run', 'Create and enter rooms for a subject.'],
  ['room.read', 'List and read existing room transcripts for a subject.'],
  ['export', 'Export a persona package (.persona).'],
  ['admin', 'Full administrative access (equivalent to the instance admin token).'],
]);

/** The set of all valid scope strings. */
export const KNOWN_SCOPES: ReadonlySet<string> = new Set(SCOPE_DEFINITIONS.keys());

/** Scopes that grant the same powers as the admin token. */
export function hasAdminScope(scopes: readonly string[]): boolean {
  return scopes.includes('admin');
}

/**
 * Validate a list of requested scopes.
 *
 * - Rejects wildcards (`*`).
 * - Rejects unknown scope strings.
 * - Deduplicates.
 * - Returns sorted array.
 *
 * Throws a descriptive error message on invalid input.
 */
export function validateScopes(requested: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of requested) {
    const scope = raw.trim();
    if (scope === '*') {
      throw new Error('wildcard scope is not allowed');
    }
    if (scope === '') {
      throw new Error('empty scope is not allowed');
    }
    if (!KNOWN_SCOPES.has(scope)) {
      throw new Error(`unknown scope: ${scope}`);
    }
    seen.add(scope);
  }
  return [...seen].sort();
}

/* ------------------------------------------------------------------ */
/* Token format and hashing                                            */
/* ------------------------------------------------------------------ */

/** Prefix for all OpenMimic API tokens, recognizable by secret scanners. */
export const TOKEN_PREFIX = 'omk_';

/** Length of the random portion (bytes, before hex encoding). */
const TOKEN_RANDOM_BYTES = 32;

/**
 * Generate a new plaintext API token.
 *
 * Format: `omk_<64 hex chars>` (256 bits of entropy).
 */
export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_RANDOM_BYTES).toString('hex')}`;
}

/**
 * Extract a display prefix from a token for use in listings and logs.
 * Shows the first 12 characters (the `omk_` prefix plus 8 hex chars).
 */
export function tokenPrefix(token: string): string {
  return token.slice(0, 12);
}

/**
 * Hash a token for storage. Uses SHA-256 with an instance-level salt.
 *
 * The salt prevents rainbow-table attacks if the database is leaked. The
 * salt is derived from `OPENMIMIC_ADMIN_TOKEN` when set, or from a random
 * value generated at process start. The caller must provide the salt.
 */
export function hashToken(token: string, salt: string): string {
  return createHash('sha256')
    .update(salt)
    .update(token)
    .digest('hex');
}

/**
 * Derive the instance-level salt for token hashing.
 *
 * Uses HMAC-SHA256 of a fixed label keyed by the admin token. When no
 * admin token is set, uses a random value (tokens are session-scoped in
 * that case since there is no persistence across restarts).
 */
export function deriveTokenSalt(adminToken?: string): string {
  if (adminToken) {
    return createHmac('sha256', adminToken)
      .update('openmimic:token-salt:v1')
      .digest('hex');
  }
  return randomBytes(32).toString('hex');
}

/* ------------------------------------------------------------------ */
/* Token record (what the store persists)                              */
/* ------------------------------------------------------------------ */

export interface TokenRecord {
  id: string;
  name: string;
  /** First 12 characters of the plaintext token, for display. */
  prefix: string;
  /** SHA-256 hash of the plaintext token (salted). */
  hash: string;
  /** Sorted array of scope strings. */
  scopes: string[];
  /** Optional: restrict to these subject IDs. Empty array = no restriction. */
  subjectIds: string[];
  createdAt: string;
  /** ISO 8601 expiry, or null for no expiry. */
  expiresAt: string | null;
  /** When the token was last used (ISO 8601), or null. */
  lastUsedAt: string | null;
  /** How many times this token has been used. */
  useCount: number;
  /** Whether this token has been revoked. */
  revoked: boolean;
}

/** What the token creation endpoint returns (includes the one-time plaintext). */
export interface TokenCreateResult {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  subjectIds: string[];
  createdAt: string;
  expiresAt: string | null;
  /** The plaintext token. Shown exactly once; never stored or returned again. */
  token: string;
}

/** What the token list endpoint returns (no plaintext, no hash). */
export interface TokenListItem {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  subjectIds: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  revoked: boolean;
}

/* ------------------------------------------------------------------ */
/* Resolved auth context (attached to each request)                    */
/* ------------------------------------------------------------------ */

export type AuthKind = 'admin_token' | 'scoped_token' | 'open';

export interface AuthContext {
  kind: AuthKind;
  /** The scopes this request carries. Empty for open routes. */
  scopes: string[];
  /** Subject IDs this token is bound to, or empty for unrestricted. */
  subjectIds: string[];
  /** The token record ID, if authenticated via a scoped token. */
  tokenId?: string;
}

/** An open (unauthenticated) auth context. */
export const OPEN_AUTH: AuthContext = {
  kind: 'open',
  scopes: [],
  subjectIds: [],
};

/** An admin auth context (full access). */
export const ADMIN_AUTH: AuthContext = {
  kind: 'admin_token',
  scopes: ['admin'],
  subjectIds: [],
};

/**
 * Check whether an auth context satisfies a required scope.
 *
 * Admin auth satisfies everything. A scoped token must explicitly carry
 * the required scope.
 */
export function hasScope(auth: AuthContext, scope: string): boolean {
  if (auth.kind === 'admin_token') return true;
  if (auth.scopes.includes('admin')) return true;
  return auth.scopes.includes(scope);
}

/**
 * Check whether an auth context may access a specific subject.
 *
 * Returns true if the token is not subject-bound, or if the subject is
 * in the bound list. Admin tokens are never subject-bound.
 */
export function hasSubjectAccess(auth: AuthContext, subjectId: string): boolean {
  if (auth.kind === 'admin_token') return true;
  if (auth.subjectIds.length === 0) return true;
  return auth.subjectIds.includes(subjectId);
}

/* ------------------------------------------------------------------ */
/* Stable error codes                                                  */
/* ------------------------------------------------------------------ */

/**
 * Stable error codes for auth and permission errors.
 *
 * These codes are part of the public API contract. They never change even
 * when the human-readable messages are reworded.
 */
export const AUTH_ERROR_CODES = {
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN_SCOPE: 'forbidden_scope',
  FORBIDDEN_SUBJECT: 'forbidden_subject',
  TOKEN_REVOKED: 'token_revoked',
  TOKEN_EXPIRED: 'token_expired',
  RATE_LIMITED: 'rate_limited',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];
