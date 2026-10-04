import { OpenMimicError } from '@openmimic/kernel';

/**
 * Raised when an invite token is unknown or past its expiry.
 *
 * Deliberately one error for both cases: a caller must not be able to probe
 * the invite table by telling "never existed" apart from "expired".
 */
export class InviteInvalidError extends OpenMimicError {}
