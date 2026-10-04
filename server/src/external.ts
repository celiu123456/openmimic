import { CONSENT_OVERLAP_LENGTH, withholdOverlaps } from '@openmimic/shared';
import type { Store } from '@openmimic/kernel';
import type { Testimony } from '@openmimic/shared';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Duck-typed check for a kernel testimony, independent of its exact class. */
function looksLikeTestimony(value: Record<string, unknown>): boolean {
  return (
    typeof value.witnessId === 'string' &&
    typeof value.subjectId === 'string' &&
    Array.isArray(value.answers)
  );
}

/**
 * Duck-typed check for a court session.
 *
 * A transcript is prose, not testimony, so the structural redactor below would
 * otherwise pass it through untouched. Detecting the session shape lets the
 * `external` scope scrub quoted raw words out of challenge and defense lines.
 */
function looksLikeCourtSession(value: Record<string, unknown>): boolean {
  return (
    typeof value.subjectId === 'string' &&
    Array.isArray(value.transcript) &&
    value.transcript.length > 0 &&
    value.transcript.every(
      (event) => isRecord(event) && typeof event.text === 'string',
    )
  );
}

/**
 * Every raw string a `synthesis_only` witness ever wrote about this subject.
 *
 * These are the only strings the external scope must withhold; a `quotable`
 * witness's words are allowed to travel. Strings shorter than the overlap
 * window can never match and are dropped up front.
 */
export function collectSynthesisOnlySources(store: Store, subjectId: string): string[] {
  const sources: string[] = [];
  for (const testimony of store.listBySubject(subjectId)) {
    if (store.getConsentLevel(testimony.witnessId) !== 'synthesis_only') continue;
    for (const answer of testimony.answers) {
      sources.push(answer.behindText);
      if (answer.frontText !== undefined) sources.push(answer.frontText);
      if (answer.followupText !== undefined) sources.push(answer.followupText);
    }
    if (testimony.freeText !== undefined) sources.push(testimony.freeText);
  }
  return sources.filter((source) => source.length >= CONSENT_OVERLAP_LENGTH);
}

/**
 * Recursively project a payload through the W1 authorization gate's
 * `external` scope.
 *
 * The collection API returns counts, display names and the questionnaire —
 * never raw testimony. Routing every outbound body through this function means
 * a future route cannot accidentally serialize a `synthesis_only` answer: the
 * gate replaces it with the withheld placeholder before `JSON.stringify` ever
 * sees it.
 *
 * Court transcripts get the same treatment even though they are not testimony:
 * a challenge line may quote a witness verbatim, so any run of
 * {@link CONSENT_OVERLAP_LENGTH} characters copied from a `synthesis_only`
 * testimony is replaced with `[withheld]`.
 */
export function redactForExternal(store: Store, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactForExternal(store, entry));
  if (!isRecord(value)) return value;
  if (looksLikeTestimony(value)) {
    return store.redact(value as unknown as Testimony, 'external');
  }
  if (looksLikeCourtSession(value)) {
    const sources = collectSynthesisOnlySources(store, value.subjectId as string);
    const projected: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'transcript') {
        projected[key] = (entry as unknown[]).map((event) =>
          isRecord(event) && typeof event.text === 'string'
            ? {
                ...event,
                text:
                  sources.length === 0
                    ? event.text
                    : withholdOverlaps(event.text, sources),
              }
            : event,
        );
      } else {
        projected[key] = redactForExternal(store, entry);
      }
    }
    return projected;
  }
  const projected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    projected[key] = redactForExternal(store, entry);
  }
  return projected;
}

/**
 * Withhold `synthesis_only` runs from *any* string in a payload.
 *
 * {@link redactForExternal} only knows two shapes (a testimony and a court
 * session). Tool results and `.persona` packages are plain JSON, so a raw
 * answer copied into a free-form string would slip past it. This walk applies
 * {@link withholdOverlaps} to every string, which is the `external` scope in
 * its most general form: anything an outbound body says is checked against the
 * subject's withheld sources.
 */
export function withholdSynthesisOnly(
  store: Store,
  subjectIds: string | readonly string[],
  value: unknown,
): unknown {
  const ids = typeof subjectIds === 'string' ? [subjectIds] : subjectIds;
  const sources: string[] = [];
  for (const id of ids) sources.push(...collectSynthesisOnlySources(store, id));
  if (sources.length === 0) return value;

  const walk = (entry: unknown): unknown => {
    if (typeof entry === 'string') return withholdOverlaps(entry, sources);
    if (Array.isArray(entry)) return entry.map(walk);
    if (isRecord(entry)) {
      const projected: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(entry)) projected[key] = walk(nested);
      return projected;
    }
    return entry;
  };
  return walk(value);
}
