/**
 * Sanitization utilities for privacy protection.
 *
 * - PII anonymization (phone, email, ID card, bank card, secrets)
 * - Sensitive field masking for log/export contexts
 * - Stable JSON serialization with short hash
 *
 * Migrated from personality_structure_server/memory-anonymizer.ts,
 * stripped of Midway framework dependencies.
 */
import { createHash } from 'node:crypto';

/* ------------------------------------------------------------------ */
/* PII anonymization                                                   */
/* ------------------------------------------------------------------ */

/** Chinese mobile number: 1[3-9]XXXXXXXXX */
const PHONE_REGEX = /1[3-9]\d{9}/g;

/** Email address */
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Chinese ID card: 15 or 18 digits (last may be X) */
const ID_CARD_REGEX = /\b\d{15}(?:\d{2}[0-9Xx])?\b/g;

/** Bank card / long numeric account: 12-19 digits */
const BANK_CARD_REGEX = /\b\d{12,19}\b/g;

/** Credential leak: password/token/secret followed by a value */
const SECRET_REGEX =
  /(密码|口令|验证码|token|accessToken|secret|password|api[_-]?key)[：: ]*[^\s，。；;]+/gi;

export interface AnonymizeOptions {
  /** Named entities to replace (people's names, etc.). */
  names?: string[];
  /** Replacement text for named entities. */
  nameReplacement?: string;
  /** Whether to anonymize phone numbers. Default true. */
  phone?: boolean;
  /** Whether to anonymize emails. Default true. */
  email?: boolean;
  /** Whether to anonymize ID cards. Default true. */
  idCard?: boolean;
  /** Whether to anonymize bank cards / long numbers. Default true. */
  bankCard?: boolean;
  /** Whether to redact credential leaks. Default true. */
  secrets?: boolean;
}

/**
 * Replace PII patterns in text with generic placeholders.
 * Does not modify the original string.
 */
export function anonymize(text: string, options: AnonymizeOptions = {}): string {
  let result = String(text || '');

  // Named entity replacement
  if (options.names?.length) {
    const replacement = options.nameReplacement ?? '[PERSON]';
    for (const name of options.names) {
      if (!name || name.length < 2) continue;
      result = result.replace(new RegExp(escapeRegExp(name), 'g'), replacement);
    }
  }

  // Order matters: longer patterns first to prevent partial matches.
  // ID cards (18 digits) before bank cards (12-19) before phones (11).
  if (options.idCard !== false) {
    result = result.replace(ID_CARD_REGEX, '[ID_CARD]');
  }
  if (options.bankCard !== false) {
    result = result.replace(BANK_CARD_REGEX, '[CARD]');
  }
  if (options.phone !== false) {
    result = result.replace(PHONE_REGEX, '[PHONE]');
  }
  if (options.email !== false) {
    result = result.replace(EMAIL_REGEX, '[EMAIL]');
  }
  if (options.secrets !== false) {
    result = result.replace(SECRET_REGEX, '$1[REDACTED]');
  }

  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ */
/* Sensitive field masking                                              */
/* ------------------------------------------------------------------ */

/** Fields that should be masked in logs and exports. */
const SENSITIVE_FIELDS = new Set([
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'authorization',
  'cookie',
  'sessionId',
  'session_id',
]);

/**
 * Deep-clone an object, replacing sensitive field values with '******'.
 * Only masks own enumerable string-keyed properties. Arrays are traversed.
 */
export function maskSensitiveFields<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(maskSensitiveFields) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.has(key)) {
      result[key] = '******';
    } else if (val !== null && typeof val === 'object') {
      result[key] = maskSensitiveFields(val);
    } else {
      result[key] = val;
    }
  }
  return result as T;
}

/* ------------------------------------------------------------------ */
/* Stable serialization                                                */
/* ------------------------------------------------------------------ */

/**
 * Deterministic JSON.stringify with sorted keys.
 * Produces the same output for the same logical value regardless of
 * property insertion order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Short hash: first 8 hex characters of the SHA-256 of the stable
 * JSON representation. Useful as a quick equality check or cache key.
 */
export function shortHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 8);
}
