import { z } from 'zod';

/** A single LLM completion request. */
export interface LLMCompletionRequest {
  system: string;
  user: string;
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
}

const ChatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
      }),
    )
    .min(1),
});

/**
 * Production client for any OpenAI-compatible `/chat/completions` endpoint.
 *
 * Configuration is read lazily from the environment at construction time only;
 * nothing here performs I/O until {@link OpenAICompatClient.complete} is called,
 * and the W1 test suite never calls it.
 */
export class OpenAICompatClient implements LLMClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenAICompatClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.LLM_BASE_URL ?? '').replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? process.env.LLM_API_KEY ?? '';
    this.model = options.model ?? process.env.LLM_MODEL ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Whether both a base URL and a model name are configured. */
  get configured(): boolean {
    return this.baseUrl.length > 0 && this.model.length > 0;
  }

  async complete({ system, user }: LLMCompletionRequest): Promise<string> {
    if (!this.baseUrl) throw new Error('LLM_BASE_URL is not configured');
    if (!this.model) throw new Error('LLM_MODEL is not configured');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          `LLM request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 500)}` : ''}`,
        );
      }

      const parsed = ChatCompletionResponseSchema.parse(await response.json());
      const content = parsed.choices[0]?.message.content ?? '';
      if (!content) throw new Error('LLM response contained no message content');
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}
