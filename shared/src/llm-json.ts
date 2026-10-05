/**
 * Unified JSON extraction and structured repair from LLM responses.
 *
 * Tolerates markdown fences, surrounding prose, and common LLM formatting
 * quirks. This is the single canonical implementation — all engines import
 * from here instead of maintaining local copies.
 *
 * The repair loop (generateStructuredJson) feeds the model's original output
 * and the validation error back to the model for a second attempt. This is
 * used by court, room, witness, eval, and any plugin that needs JSON output.
 */

import type { ProviderErrorClass } from './provider-error';
import { normalizeProviderError } from './provider-error';

/**
 * Extract a JSON value from a possibly chatty LLM response.
 *
 * Strategy (in order):
 * 1. Direct JSON.parse of the trimmed response
 * 2. Extract from markdown code fence (```json ... ```)
 * 3. Find the outermost JSON structure ([...] or {...})
 *
 * Throws if no parseable JSON is found.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // 1. Direct parse
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    /* fall through */
  }

  // 2. Fenced code block
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim()) as unknown;
    } catch {
      /* fall through */
    }
  }

  // 3. Find outermost JSON structure
  const start = trimmed.search(/[[{]/);
  if (start >= 0) {
    const candidate = trimmed.slice(start);
    for (const closing of [']', '}'] as const) {
      const end = candidate.lastIndexOf(closing);
      if (end > 0) {
        try {
          return JSON.parse(candidate.slice(0, end + 1)) as unknown;
        } catch {
          /* try the other bracket */
        }
      }
    }
  }

  throw new Error('LLM response did not contain parseable JSON');
}

/**
 * Try to extract JSON without throwing. Returns undefined on failure.
 */
export function tryExtractJson(text: string): unknown {
  try {
    return extractJson(text);
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Non-retryable error classes — repair loop must not retry these       */
/* ------------------------------------------------------------------ */

const NON_RETRYABLE_CLASSES: ReadonlySet<ProviderErrorClass> = new Set([
  'AUTH_FAILED',
  'QUOTA_EXHAUSTED',
  'PERMANENT_BAD_REQUEST',
]);

/**
 * Check whether an error is non-retryable (budget, auth, quota).
 * These must propagate immediately — never feed back for repair.
 */
function isNonRetryable(error: unknown): boolean {
  const normalized = normalizeProviderError('llm', error);
  return NON_RETRYABLE_CLASSES.has(normalized.errorClass) || !normalized.retryable;
}

/* ------------------------------------------------------------------ */
/* Structured JSON repair loop                                         */
/* ------------------------------------------------------------------ */

/**
 * Minimal chat message interface for the repair loop.
 * Matches the subset needed by both court and room LLM clients.
 */
export interface RepairChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * A model that can complete a chat message array.
 * The caller adapts their LLMClient to this interface.
 */
export interface RepairModel {
  chat(messages: RepairChatMessage[]): Promise<string>;
}

export interface StructuredJsonOptions<T> {
  /** The model to call (adapter around the caller's LLMClient). */
  model: RepairModel;
  /** Initial messages (system + user). */
  messages: RepairChatMessage[];
  /**
   * Validate and parse the extracted JSON value. Throw on validation failure
   * (the error message is fed back to the model).
   */
  validate: (value: unknown) => T;
  /**
   * Maximum attempts (initial + repairs). Default 2.
   * The first attempt uses the original messages; subsequent attempts append
   * the model's output and the validation error for repair.
   */
  maxAttempts?: number;
}

/**
 * Structured JSON generation with a repair loop.
 *
 * 1. Call the model with the initial messages.
 * 2. Extract JSON from the response.
 * 3. Validate with the caller's `validate` function.
 * 4. On parse or validation failure: append the model's raw output and a
 *    repair prompt describing the error, then call again.
 * 5. Non-retryable errors (402 quota, 401 auth, budget exceeded) propagate
 *    immediately — never wasted on a second call.
 *
 * Migrated from personality_structure_server/structured-json.ts, adapted
 * for OpenMimic's pure-function architecture.
 */
export async function generateStructuredJson<T>(
  options: StructuredJsonOptions<T>,
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const messages = [...options.messages];
  let lastError: Error = new Error('no attempt was made');

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response: string;
    try {
      response = await options.model.chat(messages);
    } catch (err) {
      // Non-retryable provider errors propagate immediately
      if (isNonRetryable(err)) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }

    try {
      const raw = extractJson(response);
      return options.validate(raw);
    } catch (validationError) {
      lastError = validationError instanceof Error
        ? validationError
        : new Error(String(validationError));
      // Append the model's output and the error for repair
      messages.push({ role: 'assistant', content: response });
      messages.push({
        role: 'user',
        content: buildRepairPrompt(lastError),
      });
    }
  }

  throw new Error(
    `structured_json_validation_failed: ${lastError.message}`,
  );
}

/**
 * Build a repair prompt from a validation error.
 * Keeps it concise: the model already has context from the conversation.
 */
function buildRepairPrompt(error: Error): string {
  return [
    '你的输出 JSON 校验失败,请修复后重新输出。',
    `错误信息: ${error.message}`,
    '只输出修正后的 JSON,不要解释。',
  ].join('\n');
}
