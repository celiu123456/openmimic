import { z } from 'zod';
import {
  checkBudget,
  recordUsage,
  InsufficientBalanceError,
  type CallUsage,
} from '@openmimic/shared';

/** A single LLM completion request. */
export interface LLMCompletionRequest {
  system: string;
  user: string;
  /** Optional max tokens for the response. */
  maxTokens?: number;
  /**
   * Purpose tag for usage tracking (e.g. 'court-filing', 'room-compose').
   * Defaults to 'other' when omitted.
   */
  purpose?: string;
  /**
   * When set to `'disabled'`, asks the provider to turn off chain-of-thought
   * reasoning so output tokens are not consumed by thinking content.
   * Gated at the wire level by `LLM_THINKING_PARAM` and the base URL.
   */
  thinking?: 'disabled';
}

/** One chat message forwarded verbatim to an OpenAI-compatible upstream. */
export interface ChatMessage {
  role: string;
  content?: unknown;
  [key: string]: unknown;
}

/** Anything the court can drive. Injected so the pipeline stays testable. */
export interface LLMClient {
  complete(request: LLMCompletionRequest): Promise<string>;
}

export interface OpenAICompatClientOptions {
  /** Defaults to `LLM_BASE_URL`; the `/chat/completions` path is appended. */
  baseUrl?: string;
  /** Defaults to `LLM_API_KEY`. Never logged. */
  apiKey?: string;
  /** Defaults to `LLM_MODEL`. */
  model?: string;
  /** Injectable fetch (used by embedders, not by tests). */
  fetchImpl?: typeof fetch;
  /** Optional request timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Whether to send `thinking.type=disabled` in the request body.
   * When true, the DeepSeek thinking/reasoning feature is turned off so
   * that output tokens are not consumed by chain-of-thought content.
   * Default: auto-detected from baseUrl (enabled for deepseek endpoints).
   */
  disableThinking?: boolean;
  /**
   * Injectable sleep function for transport-retry backoff.
   * Defaults to real `setTimeout`-based sleep. Tests inject a no-op.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Per-attempt timeout in milliseconds.  Each transport attempt is bounded
   * by this value via `AbortSignal.timeout` so a single connect hang cannot
   * burn the whole user-facing budget.  Default: 8000 ms.
   */
  perAttemptTimeoutMs?: number;
}

/** Error subclass for transport / provider errors that survived retries. */
export class LLMTransportError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'LLMTransportError';
    this.code = code;
  }
}

const ChatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          reasoning_content: z.string().nullable().optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    prompt_cache_hit_tokens: z.number().optional(),
    cached_tokens: z.number().optional(),
  }).optional(),
});

/**
 * Production client for any OpenAI-compatible `/chat/completions` endpoint.
 *
 * Configuration is read lazily from the environment at construction time only;
 * nothing here performs I/O until {@link OpenAICompatClient.complete} is called,
 * and the W1 test suite never calls it.
 */
/** Transport error cause codes that are retryable (DNS, connect, socket). */
const RETRYABLE_CAUSE_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

/** HTTP status codes from the upstream that warrant a retry. */
const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);

/** Maximum number of transport retries (after the first attempt). */
const MAX_TRANSPORT_RETRIES = 2;

/** Default backoff schedule in milliseconds (one entry per retry). */
const BACKOFF_MS = [300, 1200];

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class OpenAICompatClient implements LLMClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly disableThinking: boolean;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly perAttemptTimeoutMs: number;

  /**
   * The `finish_reason` from the most recent `complete()` call.
   * Undefined before the first call or when the provider does not surface it.
   */
  lastFinishReason?: string;

  constructor(options: OpenAICompatClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.LLM_BASE_URL ?? '').replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? process.env.LLM_API_KEY ?? '';
    this.model = options.model ?? process.env.LLM_MODEL ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    // Auto-detect DeepSeek endpoints to disable thinking by default
    this.disableThinking = options.disableThinking ??
      (/deepseek/i.test(this.baseUrl) || /deepseek/i.test(this.model));
    this.sleep = options.sleep ?? defaultSleep;
    this.perAttemptTimeoutMs = options.perAttemptTimeoutMs ?? 8_000;
  }

  /**
   * Whether the `thinking` wire field should be sent for a given request.
   *
   * Gating rule (env `LLM_THINKING_PARAM`):
   *   - `off`  → never send, regardless of provider
   *   - `on`   → always send when thinking is requested
   *   - absent → send only when the base URL host contains `deepseek`
   */
  private shouldSendThinking(wantDisable: boolean): boolean {
    if (!wantDisable) return false;
    const env = process.env.LLM_THINKING_PARAM ?? '';
    if (env.toLowerCase() === 'off') return false;
    if (env.toLowerCase() === 'on') return true;
    return /deepseek/i.test(this.baseUrl);
  }

  /** Whether both a base URL and a model name are configured. */
  get configured(): boolean {
    return this.baseUrl.length > 0 && this.model.length > 0;
  }

  /** Whether an API key is present. The persona proxy refuses to run without one. */
  get hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Forward a full `messages` array to the upstream `/chat/completions` and
   * return the raw {@link Response}.
   *
   * Unlike {@link complete}, this does not build a system/user pair, does not
   * parse the body and does not impose a request timeout — the caller streams
   * the response body and owns its lifetime. The configured model replaces
   * whatever the client asked for, because `persona/<id>` is not a model the
   * upstream would recognise.
   */
  async chatRaw(
    messages: readonly ChatMessage[],
    options: { stream?: boolean } = {},
  ): Promise<Response> {
    if (!this.baseUrl) throw new Error('LLM_BASE_URL is not configured');
    if (!this.model) throw new Error('LLM_MODEL is not configured');

    return this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: options.stream === true,
      }),
    });
  }

  async complete({ system, user, maxTokens, purpose, thinking }: LLMCompletionRequest): Promise<string> {
    if (!this.baseUrl) throw new Error('LLM_BASE_URL is not configured');
    if (!this.model) throw new Error('LLM_MODEL is not configured');

    checkBudget();

    const body: Record<string, unknown> = {
      model: this.model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    if (maxTokens !== undefined) {
      body.max_tokens = maxTokens;
    }
    // Disable thinking/reasoning when requested per-call or per-client,
    // gated by LLM_THINKING_PARAM and provider detection.
    const wantDisable = thinking === 'disabled' || this.disableThinking;
    if (this.shouldSendThinking(wantDisable)) {
      body.thinking = { type: 'disabled' };
    }

    const response = await this.fetchWithRetry(body);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 402) {
        throw new InsufficientBalanceError(402, detail.slice(0, 500));
      }
      // Non-retryable HTTP error (4xx other than 402, or unexpected codes)
      throw new Error(
        `LLM request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 500)}` : ''}`,
      );
    }

    const parsed = ChatCompletionResponseSchema.parse(await response.json());
    const content = parsed.choices[0]?.message.content ?? '';
    const reasoningContent = parsed.choices[0]?.message.reasoning_content ?? '';
    const finishReason = parsed.choices[0]?.finish_reason ?? undefined;

    // Surface finish_reason for callers that need it
    this.lastFinishReason = finishReason ?? undefined;

    // Record usage (failed transport attempts consumed no tokens)
    const tag = purpose ?? 'other';
    const usage: CallUsage = {
      promptTokens: parsed.usage?.prompt_tokens ?? 0,
      completionTokens: parsed.usage?.completion_tokens ?? 0,
      cachedTokens: parsed.usage?.prompt_cache_hit_tokens
        ?? parsed.usage?.cached_tokens
        ?? 0,
    };
    recordUsage(tag, usage);

    if (content) return content;

    // Thinking model fallback: content is empty but reasoning_content is non-empty.
    // Disable thinking and raise max_tokens, then retry once (counts toward budget).
    if (reasoningContent && this.disableThinking) {
      // Already disabled — nothing more to try
      throw new Error('LLM response contained no message content (reasoning_content present but thinking already disabled)');
    }
    if (reasoningContent) {
      return this.retryWithThinkingDisabled({ system, user, maxTokens, purpose });
    }

    throw new Error('LLM response contained no message content');
  }

  /**
   * Execute a fetch with transport-level retry.
   *
   * Retries on:
   *   - fetch rejecting with TypeError (DNS/connect failures)
   *   - HTTP 502, 503, 504
   *
   * Does NOT retry:
   *   - 4xx responses (401, 402, 429 etc.)
   *   - AbortError from the caller's own timeout
   *
   * Each attempt is bounded by `perAttemptTimeoutMs` via AbortSignal.timeout
   * so a single connect hang cannot burn the whole caller's budget.
   */
  private async fetchWithRetry(body: Record<string, unknown>): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt++) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.perAttemptTimeoutMs),
        });

        // Non-retryable HTTP — return immediately for caller to handle
        if (response.ok || !RETRYABLE_HTTP_STATUSES.has(response.status)) {
          return response;
        }

        // Retryable HTTP status (502/503/504)
        lastError = new Error(
          `LLM upstream error: ${response.status} ${response.statusText}`,
        );
      } catch (err: unknown) {
        // AbortError from AbortSignal.timeout = per-attempt timeout, retryable
        // but TypeError "fetch failed" with cause codes is the primary case
        if (isRetryableTransportError(err)) {
          lastError = err;
        } else {
          // Non-retryable (e.g. AbortError from caller's controller, or unknown)
          throw err;
        }
      }

      // Backoff before next attempt (skip if this was the last attempt)
      if (attempt < MAX_TRANSPORT_RETRIES) {
        await this.sleep(BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!);
      }
    }

    // All attempts exhausted — throw a transport error
    const code = extractErrorCode(lastError);
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new LLMTransportError(
      `LLM transport failed after ${MAX_TRANSPORT_RETRIES + 1} attempts: ${message}`,
      code,
    );
  }

  /**
   * Retry a request with thinking explicitly disabled and a raised max_tokens.
   * Used when the first response had reasoning_content but empty content.
   */
  private async retryWithThinkingDisabled(
    { system, user, maxTokens, purpose }: LLMCompletionRequest,
  ): Promise<string> {
    checkBudget();

    const body: Record<string, unknown> = {
      model: this.model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: Math.max(maxTokens ?? 4096, 4096),
    };
    if (this.shouldSendThinking(true)) {
      body.thinking = { type: 'disabled' };
    }

    const response = await this.fetchWithRetry(body);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 402) {
        throw new InsufficientBalanceError(402, detail.slice(0, 500));
      }
      throw new Error(
        `LLM request failed (thinking retry): ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 500)}` : ''}`,
      );
    }

    const parsed = ChatCompletionResponseSchema.parse(await response.json());
    const content = parsed.choices[0]?.message.content ?? '';
    if (!content) {
      throw new Error('LLM response contained no message content even after disabling thinking');
    }

    const tag = purpose ?? 'other';
    const usage: CallUsage = {
      promptTokens: parsed.usage?.prompt_tokens ?? 0,
      completionTokens: parsed.usage?.completion_tokens ?? 0,
      cachedTokens: parsed.usage?.prompt_cache_hit_tokens
        ?? parsed.usage?.cached_tokens
        ?? 0,
    };
    recordUsage(tag, usage);

    return content;
  }
}

/* ------------------------------------------------------------------ */
/* Transport error classification                                      */
/* ------------------------------------------------------------------ */

/**
 * Check whether an error thrown by `fetch` is retryable at the transport
 * level (DNS failure, connect timeout, socket reset, per-attempt timeout).
 */
function isRetryableTransportError(err: unknown): boolean {
  // AbortError from AbortSignal.timeout = per-attempt timeout, retryable
  if (err instanceof DOMException && err.name === 'TimeoutError') return true;

  // Node TypeError "fetch failed" with cause
  if (err instanceof TypeError) {
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause && typeof cause.code === 'string') {
      return RETRYABLE_CAUSE_CODES.has(cause.code);
    }
    // Generic "fetch failed" without a structured cause — still transport
    if (/fetch failed/i.test(err.message)) return true;
  }

  return false;
}

/**
 * Extract a short error code from a transport error for logging.
 */
function extractErrorCode(err: unknown): string {
  if (err instanceof TypeError) {
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause && typeof cause.code === 'string') return cause.code;
  }
  if (err instanceof Error) return err.name;
  return 'UNKNOWN';
}
