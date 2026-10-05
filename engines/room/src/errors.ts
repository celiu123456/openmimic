import { OpenMimicError } from '@openmimic/kernel';

/**
 * Raised when a room is asked to open on a topic the engine must not role-play.
 *
 * The W3a trigger is a crisis word in the topic seed: generating witness
 * chatter about self-harm would be worse than refusing outright, so the room
 * never starts and the caller is told why.
 */
export class RoomRefusedError extends OpenMimicError {}

/**
 * Raised when a room's front transcript cannot be generated because too few
 * witnesses have provided `frontText` (what they would say to the subject's
 * face). A room full of stage directions is meaningless, so the engine
 * refuses and tells the caller why.
 */
export class FrontUnavailableError extends OpenMimicError {
  /** Human-readable reason suitable for display. */
  readonly reason: string;

  constructor(reason: string) {
    super(`front_unavailable: ${reason}`);
    this.reason = reason;
  }
}
