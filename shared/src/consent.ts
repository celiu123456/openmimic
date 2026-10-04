import { WITHHELD_PLACEHOLDER } from './schemas';

/**
 * Consent-overlap guard shared by every surface that may quote a witness.
 *
 * A `synthesis_only` witness allows their words to be *summarised* but never
 * quoted verbatim. Two functions enforce that floor from opposite directions:
 *
 * - {@link containsConsentOverlap} answers "did the model copy a run of raw
 *   words?", used by the room engine to rewrite a generated line.
 * - {@link withholdOverlaps} answers "which runs of raw words leaked into a
 *   piece of already-written text?", used by the HTTP layer to mask a court
 *   transcript that quotes a `synthesis_only` testimony.
 *
 * Both live here, in `shared`, so the room and the server use one definition
 * of what "an 8-character quote" means.
 */

/** A verbatim overlap of this many characters counts as quoting. */
export const CONSENT_OVERLAP_LENGTH = 8;

/**
 * True when `text` contains a contiguous run of at least `length` characters
 * copied from any `source`.
 *
 * This is how a `synthesis_only` witness is allowed to *participate* in a room
 * while their raw words stay unquoted: paraphrases pass, verbatim strings do
 * not. Sources shorter than the window can never match, which is correct — a
 * five-character answer has no eight-character quote inside it.
 */
export function containsConsentOverlap(
  text: string,
  sources: readonly string[],
  length: number = CONSENT_OVERLAP_LENGTH,
): boolean {
  if (text.length < length) return false;
  for (const source of sources) {
    if (source.length < length) continue;
    for (let start = 0; start + length <= source.length; start += 1) {
      if (text.includes(source.slice(start, start + length))) return true;
    }
  }
  return false;
}

/**
 * Replace every run of `text` that is copied (≥ `length` characters) from any
 * `source` with `placeholder`.
 *
 * Scans left to right and extends each hit to its longest match inside the
 * source, so a whole quoted sentence becomes one `[withheld]` rather than a
 * string of overlapping fragments. Text with no long-enough overlap is
 * returned unchanged (referentially irrelevant: callers compare strings).
 */
export function withholdOverlaps(
  text: string,
  sources: readonly string[],
  length: number = CONSENT_OVERLAP_LENGTH,
  placeholder: string = WITHHELD_PLACEHOLDER,
): string {
  if (text.length < length) return text;
  const usable = sources.filter((source) => source.length >= length);
  if (usable.length === 0) return text;

  const intervals: Array<[number, number]> = [];
  for (let start = 0; start + length <= text.length; start += 1) {
    let matchedEnd = start; // exclusive end of the longest hit from `start`
    for (const source of usable) {
      if (!source.includes(text.slice(start, start + length))) continue;
      let candidate = start + length + 1;
      while (candidate <= text.length && source.includes(text.slice(start, candidate))) {
        candidate += 1;
      }
      if (candidate - 1 > matchedEnd) matchedEnd = candidate - 1;
    }
    if (matchedEnd > start) {
      intervals.push([start, matchedEnd]);
      start = matchedEnd - 1; // the for-loop increment moves past the hit
    }
  }
  if (intervals.length === 0) return text;

  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of intervals) {
    parts.push(text.slice(cursor, start));
    parts.push(placeholder);
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}
