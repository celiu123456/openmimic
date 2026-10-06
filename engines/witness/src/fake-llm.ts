import type { LLMClient, LLMCompletionRequest } from './llm';

/** A scripted reply: either a literal string or a function of the request. */
export type FakeLLMResponse =
  | string
  | ((request: LLMCompletionRequest) => string | Promise<string>);

/**
 * Deterministic {@link LLMClient} for tests.
 *
 * Replies are returned in script order, one per `complete` call. Every request
 * is recorded on {@link FakeLLM.calls}, which is how the interview tests prove
 * a follow-up was (or was not) generated and that its prompt kept the rules.
 */
export class FakeLLM implements LLMClient {
  readonly calls: LLMCompletionRequest[] = [];

  /**
   * When set, `complete()` copies this value before returning so callers
   * can inspect it.  Set it between script entries to simulate provider
   * finish reasons (e.g. `'length'`).
   */
  lastFinishReason?: string;

  /**
   * Queue of finish reasons, consumed in lockstep with the script.
   * When an entry is present it overrides {@link lastFinishReason} for
   * that call; when absent the current value of `lastFinishReason` is kept.
   */
  private readonly finishReasons: Array<string | undefined> = [];

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
    const fr = this.finishReasons.shift();
    if (fr !== undefined) this.lastFinishReason = fr;
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

  /**
   * Append a reply together with a finish reason.
   * The finish reason is set on `lastFinishReason` when this reply is consumed.
   */
  pushWithFinishReason(response: FakeLLMResponse, finishReason: string): void {
    this.script.push(response);
    // Pad finishReasons to stay aligned with the script
    while (this.finishReasons.length < this.script.length - 1) {
      this.finishReasons.push(undefined);
    }
    this.finishReasons[this.script.length - 1] = finishReason;
  }
}
