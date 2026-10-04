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

/* ------------------------------------------------------------------ */
/* Crisis word gate                                                    */
/* ------------------------------------------------------------------ */

/**
 * W3a mental-health crisis word list.
 *
 * If someone opens a room with a topic seed that contains one of these words
 * the room refuses to start. This list is a cheap floor, not a medical
 * screening instrument.
 */
export const CRISIS_WORDS: readonly string[] = [
  '自杀', '自残', '自伤', '割腕', '跳楼', '跳桥', '想死', '不想活',
  '活不下去', '死了算了', '轻生', '结束生命', '遗书', '烧炭', '安眠药',
  '服药过量', '上吊', '一了百了', '不想醒来', '永远睡过去', '从楼上跳',
  '失踪算了', '没脸活了', '活着没意思',
];

/** First crisis word that appears in `text`, if any. */
export function findCrisisWord(text: string): string | undefined {
  for (const word of CRISIS_WORDS) {
    if (word.length > 0 && text.includes(word)) return word;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Authorization gate                                                  */
/* ------------------------------------------------------------------ */

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
