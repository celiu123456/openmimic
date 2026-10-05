/**
 * Evidence basis classification.
 *
 * Ported from the author's earlier platform (evidence-extractor.ts).
 * Pure function — no framework, no LLM.
 *
 * Classifies an answer's epistemic basis: was the witness there (witnessed),
 * did they hear about it (heard), are they guessing (inferred), or unknown?
 */

/** The epistemic basis of a testimony answer. */
export type EvidenceBasis = 'witnessed' | 'heard' | 'inferred' | 'unknown';

/* ------------------------------------------------------------------ */
/* Patterns                                                            */
/* ------------------------------------------------------------------ */

const WITNESSED_PATTERN = /我亲眼|我看到|我看见|当时他|当时她|当时TA|他当时|她当时|TA当时|我当时在|亲眼见|亲眼看/;
const HEARD_PATTERN = /听说|别人说|(?:他|她|TA)跟我说|(?:他|她|TA)告诉我|有人说|听(?:他|她|TA)提过|转述/;
const INFERRED_PATTERN = /可能|也许|我猜|大概|估计|应该是|感觉是|我觉得(?:大概|可能|应该)/;

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Classify the epistemic basis of a witness answer using rule-based heuristics.
 *
 * Priority: witnessed > heard > inferred > unknown.
 * When the rules can't determine the basis (e.g. a short evaluative statement),
 * returns 'unknown'. An LLM can refine 'unknown' during court filing.
 */
export function classifyBasis(text: string): EvidenceBasis {
  const value = String(text || '').trim();
  if (!value) return 'unknown';

  if (WITNESSED_PATTERN.test(value)) return 'witnessed';
  if (HEARD_PATTERN.test(value)) return 'heard';
  if (INFERRED_PATTERN.test(value)) return 'inferred';

  return 'unknown';
}

/**
 * Conviction ceiling for a given basis.
 *
 * - witnessed: no ceiling (1.0)
 * - heard: 0.7 — second-hand information can't be fully trusted
 * - inferred: 0.5 — the witness is guessing
 * - unknown: 0.6 — default ceiling (same as CONVICTION_UNCHALLENGED_CAP)
 */
export function basisConvictionCeiling(basis: EvidenceBasis): number {
  switch (basis) {
    case 'witnessed': return 1.0;
    case 'heard': return 0.7;
    case 'inferred': return 0.5;
    case 'unknown': return 0.6;
  }
}
