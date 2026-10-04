import type { LLMClient, LLMCompletionRequest } from './llm';

/** A scripted reply: either a literal string or a function of the request. */
export type FakeLLMResponse =
  | string
  | ((request: LLMCompletionRequest) => string | Promise<string>);

/**
 * Deterministic {@link LLMClient} for tests.
 *
 * Replies are returned in script order, one per `complete` call. Every request
 * is recorded on {@link FakeLLM.calls}, which is how the room tests prove what
 * each persona was (and was not) allowed to see.
 */
export class FakeLLM implements LLMClient {
  readonly calls: LLMCompletionRequest[] = [];

  private readonly script: FakeLLMResponse[];

  constructor(script: readonly FakeLLMResponse[] = []) {
    this.script = [...script];
  }

  async complete(request: LLMCompletionRequest): Promise<string> {
    this.calls.push(request);
    const next = this.script.shift();
    if (next === undefined) {
      throw new Error(`FakeLLM script exhausted after ${this.calls.length} call(s)`);
    }
    return typeof next === 'function' ? await next(request) : next;
  }

  /** Number of scripted replies that have not been consumed yet. */
  get remaining(): number {
    return this.script.length;
  }

  /** Append a reply to the end of the script. */
  push(response: FakeLLMResponse): void {
    this.script.push(response);
  }
}
