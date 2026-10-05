/**
 * The LLM contract the RoomEngine drives.
 *
 * Deliberately separate from the CourtEngine's copy so the room package stays a
 * leaf: any structurally compatible client (including the production
 * OpenAI-compatible one) can be injected, and tests use {@link FakeLLM}.
 */
export interface LLMCompletionRequest {
  system: string;
  user: string;
  /**
   * Purpose tag for usage tracking (e.g. 'room-compose', 'room-verify').
   * Defaults to 'other' when omitted.
   */
  purpose?: string;
}

export interface LLMClient {
  complete(request: LLMCompletionRequest): Promise<string>;
}
