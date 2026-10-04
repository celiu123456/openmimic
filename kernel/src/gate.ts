import {
  WITHHELD_PLACEHOLDER,
  type ConsentLevel,
  type Testimony,
  type ViewerScope,
} from '@openmimic/shared';

/** Resolves the consent level of a witness, or `undefined` if unknown. */
export type ConsentResolver = (witnessId: string) => ConsentLevel | undefined;

/**
 * The authorization gate.
 *
 * `synthesis_only` testimony may participate in synthesis but its raw words
 * must never leave the system. Under `external` scope the answers are replaced
 * with {@link WITHHELD_PLACEHOLDER}; the internal `court` scope sees the full
 * text (a court cannot cross-examine a redaction).
 *
 * The input testimony is never mutated; a redacted copy is returned. Testimony
 * that may be shown (or `court` scope) is returned as the original object so
 * callers can rely on referential equality.
 */
export function redact(
  testimony: Testimony,
  viewerScope: ViewerScope,
  resolveConsent: ConsentResolver,
): Testimony {
  if (viewerScope === 'court') {
    return testimony;
  }

  const consentLevel = resolveConsent(testimony.witnessId);
  if (consentLevel !== 'synthesis_only') {
    return testimony;
  }

  const redacted: Testimony = {
    ...testimony,
    answers: testimony.answers.map((answer) => ({
      qid: answer.qid,
      behindText: WITHHELD_PLACEHOLDER,
      ...(answer.frontText !== undefined ? { frontText: WITHHELD_PLACEHOLDER } : {}),
      ...(answer.followupText !== undefined
        ? { followupText: WITHHELD_PLACEHOLDER }
        : {}),
    })),
  };
  if (testimony.freeText !== undefined) {
    redacted.freeText = WITHHELD_PLACEHOLDER;
  }
  return redacted;
}

/** Convenience wrapper binding a {@link ConsentResolver}. */
export class AuthorizationGate {
  constructor(private readonly resolveConsent: ConsentResolver) {}

  redact(testimony: Testimony, viewerScope: ViewerScope): Testimony {
    return redact(testimony, viewerScope, this.resolveConsent);
  }

  redactAll(testimonies: readonly Testimony[], viewerScope: ViewerScope): Testimony[] {
    return testimonies.map((testimony) => this.redact(testimony, viewerScope));
  }
}
