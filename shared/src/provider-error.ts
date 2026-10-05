/**
 * Provider error classification for LLM calls.
 *
 * Nine error classes with automatic retry-after parsing and retryability.
 * Migrated from personality_structure_server/provider-error.ts, stripped
 * of framework dependencies.
 */

/* ------------------------------------------------------------------ */
/* Error classes                                                        */
/* ------------------------------------------------------------------ */

export type ProviderErrorClass =
  | 'RATE_LIMIT'
  | 'AUTH_FAILED'
  | 'QUOTA_EXHAUSTED'
  | 'TIMEOUT'
  | 'TEMPORARY_UPSTREAM_ERROR'
  | 'PERMANENT_BAD_REQUEST'
  | 'BAD_RESPONSE'
  | 'CONTENT_FILTERED'
  | 'UNKNOWN';

const RETRYABLE_CLASSES: ReadonlySet<ProviderErrorClass> = new Set([
  'RATE_LIMIT',
  'TIMEOUT',
  'TEMPORARY_UPSTREAM_ERROR',
  'UNKNOWN',
]);

/* ------------------------------------------------------------------ */
/* ProviderError                                                       */
/* ------------------------------------------------------------------ */

export class ProviderError extends Error {
  readonly provider: string;
  readonly errorClass: ProviderErrorClass;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;

  constructor(options: {
    provider: string;
    message: string;
    errorClass: ProviderErrorClass;
    statusCode?: number;
    retryAfterMs?: number;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'ProviderError';
    this.provider = options.provider;
    this.errorClass = options.errorClass;
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable ?? isRetryable(options.errorClass);
  }
}

/* ------------------------------------------------------------------ */
/* Classification helpers                                              */
/* ------------------------------------------------------------------ */

export function isRetryable(errorClass: ProviderErrorClass): boolean {
  return RETRYABLE_CLASSES.has(errorClass);
}

function isRateLimitError(error: unknown): boolean {
  const e = error as Record<string, unknown> | undefined;
  if (!e) return false;
  return (
    e.errorClass === 'RATE_LIMIT' ||
    e.statusCode === 429 ||
    e.status === 429 ||
    (e.response as Record<string, unknown> | undefined)?.status === 429 ||
    String(e.message ?? '').includes('429') ||
    String(e.message ?? '').toLowerCase().includes('rate limit')
  );
}

function isQuotaExhaustedError(error: unknown): boolean {
  const e = error as Record<string, unknown> | undefined;
  if (!e) return false;
  const statusCode =
    (e.statusCode as number | undefined) ??
    (e.status as number | undefined) ??
    ((e.response as Record<string, unknown> | undefined)?.status as number | undefined);
  if (statusCode === 402 || e.errorClass === 'QUOTA_EXHAUSTED') return true;

  const message = [
    e.message,
    (e.response as Record<string, unknown> | undefined)?.data,
  ]
    .filter(Boolean)
    .map(String)
    .join(' ')
    .toLowerCase();

  return /insufficient (balance|quota|credit)|quota exhausted|billing hard limit/.test(message);
}

/* ------------------------------------------------------------------ */
/* parseRetryAfter                                                     */
/* ------------------------------------------------------------------ */

/**
 * Parse the Retry-After header from a response. Accepts both numeric
 * seconds and HTTP-date formats.
 */
export function parseRetryAfter(headers: unknown): number | undefined {
  if (!headers) return undefined;
  const h = headers as Record<string, unknown>;
  const raw =
    typeof (h as { get?: unknown }).get === 'function'
      ? (h as { get: (k: string) => string | null }).get('retry-after')
      : (h['retry-after'] as string | undefined) ?? (h['Retry-After'] as string | undefined);
  if (!raw) return undefined;
  const seconds = parseInt(raw, 10);
  return seconds > 0 ? seconds * 1000 : undefined;
}

/* ------------------------------------------------------------------ */
/* normalizeProviderError                                              */
/* ------------------------------------------------------------------ */

/**
 * Classify any thrown error into a ProviderError with the appropriate class.
 * Already-classified ProviderErrors pass through unchanged.
 */
export function normalizeProviderError(
  provider: string,
  error: unknown,
  fallbackMessage?: string,
): ProviderError {
  if (error instanceof ProviderError) return error;

  const e = error as Record<string, unknown> | undefined;
  const statusCode =
    (e?.statusCode as number | undefined) ??
    (e?.status as number | undefined) ??
    ((e?.response as Record<string, unknown> | undefined)?.status as number | undefined);
  const retryAfterMs =
    (e?.retryAfterMs as number | undefined) ??
    parseRetryAfter((e?.response as Record<string, unknown> | undefined)?.headers);
  const message = String(e?.message ?? fallbackMessage ?? `${provider} provider call failed`);

  if (statusCode === 429 || isRateLimitError(error)) {
    return new ProviderError({
      provider,
      message,
      errorClass: 'RATE_LIMIT',
      statusCode: 429,
      retryAfterMs: retryAfterMs,
      cause: error,
    });
  }

  if (isQuotaExhaustedError(error)) {
    return new ProviderError({
      provider,
      message,
      errorClass: 'QUOTA_EXHAUSTED',
      statusCode,
      retryable: false,
      cause: error,
    });
  }

  if (statusCode === 401 || statusCode === 403) {
    return new ProviderError({
      provider,
      message,
      errorClass: 'AUTH_FAILED',
      statusCode,
      retryable: false,
      cause: error,
    });
  }

  if (statusCode === 400 || statusCode === 404) {
    return new ProviderError({
      provider,
      message,
      errorClass: 'PERMANENT_BAD_REQUEST',
      statusCode,
      retryable: false,
      cause: error,
    });
  }

  if (statusCode === 408 || (e as { name?: string })?.name === 'AbortError') {
    return new ProviderError({
      provider,
      message,
      errorClass: 'TIMEOUT',
      statusCode,
      cause: error,
    });
  }

  if (statusCode !== undefined && statusCode >= 500) {
    return new ProviderError({
      provider,
      message,
      errorClass: 'TEMPORARY_UPSTREAM_ERROR',
      statusCode,
      cause: error,
    });
  }

  return new ProviderError({
    provider,
    message,
    errorClass: 'UNKNOWN',
    statusCode,
    cause: error,
  });
}
