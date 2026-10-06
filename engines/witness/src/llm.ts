/**
 * The LLM contract the interviewer drives.
 *
 * Deliberately separate from the CourtEngine's and RoomEngine's copies so the
 * witness package stays a leaf: any structurally compatible client (including
 * the production OpenAI-compatible one) can be injected, and the tests use
 * {@link FakeLLM}.
 */
export interface LLMCompletionRequest {
  system: string;
  user: string;
  /** Optional max tokens for the response. */
  maxTokens?: number;
  /** Purpose tag for usage tracking. Defaults to 'other' when omitted. */
  purpose?: string;
  /**
   * When set to `'disabled'`, asks the provider to turn off chain-of-thought
   * reasoning so output tokens are not consumed by thinking content.
   * Gated at the wire level by `LLM_THINKING_PARAM` and the base URL.
   */
  thinking?: 'disabled';
}

export interface LLMClient {
  complete(request: LLMCompletionRequest): Promise<string>;
  /**
   * Set by the production client after each `complete` call.
   * Carries the upstream `finish_reason` (e.g. `'stop'`, `'length'`).
   * Undefined when the provider does not surface it or when using FakeLLM.
   */
  lastFinishReason?: string;
}
