/**
 * Eval-specific LLM client wrapper.
 *
 * DeepSeek reasoning models (e.g. deepseek-flash / V4.1) emit
 * reasoning_content before the actual content. With default max_tokens,
 * short outputs get starved. This wrapper either disables thinking
 * or sets sufficient max_tokens.
 *
 * We cannot modify the existing engine's OpenAICompatClient, so we
 * wrap it here for eval-only use.
 */

import { z } from 'zod';
import type { LLMClient, LLMCompletionRequest } from '@openmimic/engine-court';
import {
  checkBudget,
  recordUsage,
  InsufficientBalanceError,
  type CallUsage,
} from '@openmimic/shared';

const ChatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
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

export interface EvalLLMOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Timeout in ms (default 120s for slow reasoning models) */
  timeoutMs?: number;
  /** Max tokens for generation (default 4096) */
  maxTokens?: number;
}

/**
 * LLM client for eval runs. Disables thinking for reasoning models
 * and sets generous max_tokens.
 */
export class EvalLLMClient implements LLMClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;

  constructor(options: EvalLLMOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxTokens = options.maxTokens ?? 4096;
  }

  get configured(): boolean {
    return this.baseUrl.length > 0 && this.model.length > 0;
  }

  async complete({ system, user, purpose }: LLMCompletionRequest): Promise<string> {
    if (!this.baseUrl) throw new Error('LLM_BASE_URL is not configured');
    if (!this.model) throw new Error('LLM_MODEL is not configured');

    checkBudget();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: this.maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        if (response.status === 402) {
          throw new InsufficientBalanceError(402, detail.slice(0, 500));
        }
        throw new Error(
          `LLM request failed: ${response.status} ${response.statusText}${detail ? ` -- ${detail.slice(0, 500)}` : ''}`,
        );
      }

      const parsed = ChatCompletionResponseSchema.parse(await response.json());
      const content = parsed.choices[0]?.message.content ?? '';
      if (!content) throw new Error('LLM response contained no message content');

      // Record usage
      const tag = purpose ?? 'other';
      const callUsage: CallUsage = {
        promptTokens: parsed.usage?.prompt_tokens ?? 0,
        completionTokens: parsed.usage?.completion_tokens ?? 0,
        cachedTokens: parsed.usage?.prompt_cache_hit_tokens
          ?? parsed.usage?.cached_tokens
          ?? 0,
      };
      recordUsage(tag, callUsage);

      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Create an EvalLLMClient from environment variables. */
export function createEvalLLM(): EvalLLMClient {
  return new EvalLLMClient({
    baseUrl: process.env.LLM_BASE_URL ?? '',
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? '',
  });
}
