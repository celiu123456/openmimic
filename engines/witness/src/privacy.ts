/**
 * Privacy helpers for witness testimony.
 *
 * Ported from the author's earlier platform (family-book-pointer.util.ts).
 * Pure functions — no framework dependencies.
 *
 * The key feature: `doNotRaiseToSubject` — a per-answer flag that says
 * "this answer participates in persona synthesis but must not appear in
 * any view the subject person can see (rooms, reports, meta-perception)."
 */

import type { ConsentLevel } from '@openmimic/shared';

/**
 * Whether a specific answer should be visible to the subject.
 *
 * An answer is hidden from the subject when:
 * 1. The witness flagged it as `doNotRaiseToSubject`, OR
 * 2. The witness's consent level is `synthesis_only` (the gate handles this
 *    globally, but this function is a belt-and-suspenders check).
 *
 * Both conditions allow the answer to participate in synthesis (court, persona)
 * — they only control visibility in subject-facing views.
 */
export function isVisibleToSubject(
  opts: {
    doNotRaiseToSubject?: boolean;
    consentLevel: ConsentLevel;
  },
): boolean {
  if (opts.doNotRaiseToSubject) return false;
  if (opts.consentLevel === 'synthesis_only') return false;
  return true;
}

/**
 * Check whether a text contains a verbatim leak: >= `threshold` consecutive
 * characters from the source appear in the target.
 *
 * This is the same check the old platform used (family-book-pointer.util.ts):
 * if the target contains 8+ characters of continuous source text, it is
 * considered a potential leak and should be reviewed before showing to the
 * subject.
 */
export function hasVerbatimLeak(
  source: string,
  target: string,
  threshold = 8,
): boolean {
  const src = source.trim();
  const tgt = target.trim();
  if (src.length < threshold || tgt.length < threshold) return false;

  // Sliding window over source text
  for (let i = 0; i <= src.length - threshold; i++) {
    const window = src.slice(i, i + threshold);
    if (tgt.includes(window)) return true;
  }
  return false;
}
