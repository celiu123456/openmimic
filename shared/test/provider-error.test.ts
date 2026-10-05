import { describe, expect, it } from 'vitest';
import {
  ProviderError,
  normalizeProviderError,
  isRetryable,
  parseRetryAfter,
  type ProviderErrorClass,
} from '../src/provider-error';

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

describe('normalizeProviderError', () => {
  it('classifies 429 as RATE_LIMIT', () => {
    const err = normalizeProviderError('openai', { status: 429, message: 'Too Many Requests' });
    expect(err.errorClass).toBe('RATE_LIMIT');
    expect(err.retryable).toBe(true);
  });

  it('classifies 402 as QUOTA_EXHAUSTED', () => {
    const err = normalizeProviderError('openai', { status: 402, message: 'insufficient balance' });
    expect(err.errorClass).toBe('QUOTA_EXHAUSTED');
    expect(err.retryable).toBe(false);
  });

  it('classifies 401 as AUTH_FAILED', () => {
    const err = normalizeProviderError('openai', { status: 401, message: 'Unauthorized' });
    expect(err.errorClass).toBe('AUTH_FAILED');
    expect(err.retryable).toBe(false);
  });

  it('classifies 403 as AUTH_FAILED', () => {
    const err = normalizeProviderError('openai', { status: 403, message: 'Forbidden' });
    expect(err.errorClass).toBe('AUTH_FAILED');
    expect(err.retryable).toBe(false);
  });

  it('classifies 400 as PERMANENT_BAD_REQUEST', () => {
    const err = normalizeProviderError('openai', { status: 400, message: 'Bad Request' });
    expect(err.errorClass).toBe('PERMANENT_BAD_REQUEST');
    expect(err.retryable).toBe(false);
  });

  it('classifies 408 as TIMEOUT', () => {
    const err = normalizeProviderError('openai', { status: 408, message: 'Timeout' });
    expect(err.errorClass).toBe('TIMEOUT');
    expect(err.retryable).toBe(true);
  });

  it('classifies AbortError as TIMEOUT', () => {
    const err = normalizeProviderError('openai', { name: 'AbortError', message: 'The operation was aborted' });
    expect(err.errorClass).toBe('TIMEOUT');
  });

  it('classifies 500+ as TEMPORARY_UPSTREAM_ERROR', () => {
    const err = normalizeProviderError('openai', { status: 500, message: 'Internal Server Error' });
    expect(err.errorClass).toBe('TEMPORARY_UPSTREAM_ERROR');
    expect(err.retryable).toBe(true);
  });

  it('classifies unknown errors as UNKNOWN', () => {
    const err = normalizeProviderError('openai', new Error('Something weird'));
    expect(err.errorClass).toBe('UNKNOWN');
    expect(err.retryable).toBe(true);
  });

  it('passes through ProviderError unchanged', () => {
    const original = new ProviderError({
      provider: 'test',
      message: 'test error',
      errorClass: 'CONTENT_FILTERED',
    });
    expect(normalizeProviderError('test', original)).toBe(original);
  });

  it('detects rate limit from message text', () => {
    const err = normalizeProviderError('openai', { message: 'rate limit exceeded' });
    expect(err.errorClass).toBe('RATE_LIMIT');
  });

  it('detects quota from "insufficient balance" message', () => {
    const err = normalizeProviderError('openai', { message: 'insufficient balance on account' });
    expect(err.errorClass).toBe('QUOTA_EXHAUSTED');
    expect(err.retryable).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* isRetryable                                                         */
/* ------------------------------------------------------------------ */

describe('isRetryable', () => {
  const retryableClasses: ProviderErrorClass[] = [
    'RATE_LIMIT',
    'TIMEOUT',
    'TEMPORARY_UPSTREAM_ERROR',
    'UNKNOWN',
  ];
  const nonRetryableClasses: ProviderErrorClass[] = [
    'AUTH_FAILED',
    'QUOTA_EXHAUSTED',
    'PERMANENT_BAD_REQUEST',
    'BAD_RESPONSE',
    'CONTENT_FILTERED',
  ];

  for (const cls of retryableClasses) {
    it(`${cls} is retryable`, () => expect(isRetryable(cls)).toBe(true));
  }

  for (const cls of nonRetryableClasses) {
    it(`${cls} is not retryable`, () => expect(isRetryable(cls)).toBe(false));
  }
});

/* ------------------------------------------------------------------ */
/* parseRetryAfter                                                     */
/* ------------------------------------------------------------------ */

describe('parseRetryAfter', () => {
  it('parses numeric seconds', () => {
    expect(parseRetryAfter({ 'retry-after': '5' })).toBe(5000);
  });

  it('handles Map-like headers with get()', () => {
    const headers = {
      get: (key: string) => key === 'retry-after' ? '10' : null,
    };
    expect(parseRetryAfter(headers)).toBe(10000);
  });

  it('returns undefined for missing header', () => {
    expect(parseRetryAfter({})).toBeUndefined();
  });

  it('returns undefined for null headers', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('returns undefined for zero or negative seconds', () => {
    expect(parseRetryAfter({ 'retry-after': '0' })).toBeUndefined();
    expect(parseRetryAfter({ 'retry-after': '-1' })).toBeUndefined();
  });
});
