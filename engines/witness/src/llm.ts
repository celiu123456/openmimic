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
  /** Purpose tag for usage tracking. Defaults to 'other' when omitted. */
  purpose?: string;
}

export interface LLMClient {
  complete(request: LLMCompletionRequest): Promise<string>;
}
