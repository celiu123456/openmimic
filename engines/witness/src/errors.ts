import { OpenMimicError } from '@openmimic/kernel';

/**
 * Raised when an invite token is unknown or past its expiry.
 *
 * Deliberately one error for both cases: a caller must not be able to probe
 * the invite table by telling "never existed" apart from "expired".
 */
export class InviteInvalidError extends OpenMimicError {}

/**
 * Raised when an interview session is unknown, already purged, or older than
 * its TTL.
 *
 * One error for all three, for the same reason invites share one: a caller
 * must not be able to probe session ids by telling "never existed" apart from
 * "expired". The engine purges an expired session lazily the moment it is
 * touched, so the error is also the cleanup signal.
 */
export class InterviewSessionInvalidError extends OpenMimicError {}

/**
 * Raised when a step does not fit the session's current state — answering a
 * follow-up that was never asked, or answering after the last question.
 *
 * This is a client sequencing bug, not a data problem: the session is left
 * untouched so the witness can recover by re-reading the current question.
 */
export class InterviewStateError extends OpenMimicError {}
