/** Base class for all OpenMimic kernel errors. */
export class OpenMimicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Raised when a claim is proposed without a usable evidence anchor: an empty
 * evidence list, or an id that does not exist in the testimony ledger.
 *
 * No anchor => no claim. This is the kernel-level enforcement of the
 * "every conclusion answers 'who said it'" invariant.
 */
export class NoEvidenceError extends OpenMimicError {}

/** Raised when code tries to reference a testimony that is not in the ledger. */
export class UnknownTestimonyError extends OpenMimicError {}

/** Raised when a plugin is registered twice or with an invalid manifest. */
export class PluginRegistrationError extends OpenMimicError {}

/** Raised when a plugin's inject list names a service that is not yet provided. */
export class MissingServiceError extends OpenMimicError {}

/** Raised when loadAll detects a cyclic dependency among plugins. */
export class CyclicDependencyError extends OpenMimicError {}

/** Raised when code references a room that does not exist. */
export class UnknownRoomError extends OpenMimicError {}

/**
 * Raised when an episode's text is not a verbatim substring of its
 * source testimony answer, or when the `elicited` flag does not match.
 */
export class NoAnchorError extends OpenMimicError {}
