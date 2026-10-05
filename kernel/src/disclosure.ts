/**
 * Four-level disclosure policy.
 *
 * Migrated from the old platform's `deriveDisclosure` in
 * `memory-access-policy.ts`. Pure functions, no framework dependency.
 *
 * Disclosure levels (ordered from most to least permissive):
 *
 *   speakable       — persona may say it aloud freely
 *   reference_only  — persona may hint at it but not reproduce verbatim
 *   presence_only   — persona only uses it for tone/mood, never content
 *   excluded        — never enters any prompt or context window
 *
 * `holdUntilRaised`: orthogonal to the disclosure level. When true, the
 * persona must not raise the topic proactively; it may only respond when
 * the interlocutor brings it up first. This preserves the old platform's
 * "知道≠可提" principle.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type DisclosureLevel =
  | 'speakable'
  | 'reference_only'
  | 'presence_only'
  | 'excluded';

/**
 * Why a particular disclosure level was chosen. Codes map to the
 * old platform's `disclosureReason` values but are kept as literal
 * strings for transparency.
 */
export type DisclosureReasonCode =
  | 'access_denied'
  | 'non_persona_context'
  | 'owner_self'
  | 'deny_runtime'
  | 'trusted_secret'
  | 'restricted_context'
  | 'third_party_sensitive'
  | 'unacknowledged_observation'
  | 'near_visibility_ceiling'
  | 'default_speakable';

export interface DisclosureResult {
  disclosure: DisclosureLevel;
  reason: DisclosureReasonCode;
  /** When true, persona must not proactively mention the content. */
  holdUntilRaised?: boolean;
}

/* ------------------------------------------------------------------ */
/* Content subject classification                                      */
/* ------------------------------------------------------------------ */

/**
 * Who the content is *about* — used to decide third-party protection.
 *
 * - `self`:         about the persona's own subject
 * - `peer_facing`:  about the current interlocutor
 * - `third_party`:  about someone else entirely
 */
export type ContentSubject = 'self' | 'peer_facing' | 'third_party';

export interface ContentSubjectInput {
  /** Witness IDs that sourced this claim's evidence. */
  sourceWitnessIds: string[];
  /** The interlocutor's witness ID, if they are also a witness. */
  interlocutorWitnessId?: string;
  /** Whether the claim contains third-party evaluative language. */
  hasThirdPartyEvaluation?: boolean;
}

/**
 * Classify who a piece of content is about.
 *
 * Simplified from the old platform's `classifyContentSubject` which
 * operated on personality IDs and memory scopes. In OpenMimic, claims
 * are always *about* the subject, but some contain evaluations of
 * third parties or are directly relevant to the interlocutor.
 */
export function classifyContentSubject(input: ContentSubjectInput): ContentSubject {
  if (input.hasThirdPartyEvaluation) return 'third_party';

  // If the interlocutor is the sole or primary source witness, the
  // content is about them <-> the subject relationship.
  if (
    input.interlocutorWitnessId &&
    input.sourceWitnessIds.includes(input.interlocutorWitnessId)
  ) {
    return 'peer_facing';
  }

  return 'self';
}

/* ------------------------------------------------------------------ */
/* Disclosure derivation                                               */
/* ------------------------------------------------------------------ */

export interface DisclosureInput {
  /** Whether the claim is admissible (passed gate, not retired). */
  admissible: boolean;
  /** Purpose of access: 'persona' for prompt assembly, 'api' for external. */
  purpose: 'persona' | 'api';
  /** Whether the viewer is the subject's owner / self. */
  isOwner?: boolean;
  /** Content subject classification. */
  contentSubject?: ContentSubject;
  /** Whether the witness marked this as sensitive. */
  sensitive?: boolean;
  /** Whether the subject has denied runtime mention. */
  denyRuntime?: boolean;
  /** Whether the claim has restricted AI context level. */
  restricted?: boolean;
  /**
   * Bond level gap: effectiveVisibility - viewerBondLevel.
   * Positive means the viewer is below the visibility threshold.
   */
  visibilityGap?: number;
}

/** Soft band for near-ceiling downgrade to reference_only. */
const DISCLOSURE_SOFT_BAND = 2;

/**
 * Derive the disclosure level for a claim in a given context.
 *
 * Deterministic pure function. The rule chain mirrors the old platform's
 * `deriveDisclosure` without framework dependencies.
 *
 * Invariant: when no new fields are supplied, the result equals
 * `admissible ? 'speakable' : 'excluded'` — backward-compatible.
 */
export function deriveDisclosure(input: DisclosureInput): DisclosureResult {
  // Inadmissible claims are always excluded.
  if (!input.admissible) {
    return { disclosure: 'excluded', reason: 'access_denied' };
  }

  // Non-persona contexts (API listing, admin) → always speakable.
  if (input.purpose !== 'persona') {
    return { disclosure: 'speakable', reason: 'non_persona_context' };
  }

  // Owner / self always sees everything.
  if (input.isOwner) {
    return { disclosure: 'speakable', reason: 'owner_self' };
  }

  const subject = input.contentSubject ?? 'self';

  // holdUntilRaised: peer-facing + (sensitive | denyRuntime) → hold.
  const holdUntilRaised =
    subject === 'peer_facing' && (input.sensitive === true || input.denyRuntime === true);
  const holdField: { holdUntilRaised?: boolean } = holdUntilRaised
    ? { holdUntilRaised: true }
    : {};

  // --- presence_only gates ---
  if (input.denyRuntime && subject !== 'peer_facing') {
    return { disclosure: 'presence_only', reason: 'deny_runtime', ...holdField };
  }

  // --- reference_only gates ---
  if (input.restricted) {
    return { disclosure: 'reference_only', reason: 'restricted_context', ...holdField };
  }
  // Third-party content is never verbatim in peer replies.
  if (subject === 'third_party') {
    return { disclosure: 'reference_only', reason: 'third_party_sensitive', ...holdField };
  }
  // Near the visibility ceiling + sensitive → reference_only.
  if (
    input.visibilityGap !== undefined &&
    input.visibilityGap > -DISCLOSURE_SOFT_BAND &&
    input.sensitive
  ) {
    return { disclosure: 'reference_only', reason: 'near_visibility_ceiling', ...holdField };
  }

  // --- default speakable ---
  return { disclosure: 'speakable', reason: 'default_speakable', ...holdField };
}
