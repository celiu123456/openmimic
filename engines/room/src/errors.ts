import { OpenMimicError } from '@openmimic/kernel';

/**
 * Raised when a room is asked to open on a topic the engine must not role-play.
 *
 * The W3a trigger is a crisis word in the topic seed: generating witness
 * chatter about self-harm would be worse than refusing outright, so the room
 * never starts and the caller is told why.
 */
export class RoomRefusedError extends OpenMimicError {}
