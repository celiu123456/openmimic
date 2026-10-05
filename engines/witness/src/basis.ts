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

const WITNESSED_PATTERN =
  /我亲眼|我看到|我看见|当时他|当时她|当时TA|他当时|她当时|TA当时|我当时在|亲眼见|亲眼看/;

/**
 * First-person event narratives: the witness recounts a personal
 * experience, which implies they were present. These should be
 * classified as 'witnessed' even without explicit "I saw" markers.
 *
 * Examples:
 *   "记得有一次我搬家"   → witnessed (first-person event)
 *   "我上次去他家的时候"  → witnessed (first-person event)
 *   "那天我们一起吃饭"   → witnessed (first-person event)
 *   "有一次我跟他出去"   → witnessed (first-person event)
 */
const FIRST_PERSON_EVENT_PATTERN =
  /(?:记得|我记得)?有一[次回]我|我(?:上次|那次|有一次)|我(?:们|跟(?:他|她|TA))(?:一起|一块)|我去(?:他|她|TA)(?:家|那)|那天我|那时候我|当年我|后来我/;

const HEARD_PATTERN =
  /听说|别人说|(?:他|她|TA)跟我说|(?:他|她|TA)告诉我|有人说|听(?:他|她|TA)提过|转述/;

/**
 * Inferred pattern, with a critical fix: "大概/差不多" before numbers
 * is numeric approximation (roughly N), not epistemic hedging.
 *
 * "大概花了两千多"  → NOT inferred (numeric approximation)
 * "大概5000元"      → NOT inferred (numeric approximation)
 * "大概是这样的吧"  → inferred (epistemic hedging)
 * "我觉得可能"      → inferred
 *
 * The negative lookahead checks whether a number appears within 4
 * characters after "大概/差不多" (allowing verb/particle between the
 * approximation word and the number it governs).
 */
const INFERRED_PATTERN =
  /可能|也许|我猜|(?:大概|差不多)(?!.{0,4}[\d零一二三四五六七八九十百千万亿两])|估计|应该是|感觉是|我觉得(?:大概|可能|应该)/;

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
  if (FIRST_PERSON_EVENT_PATTERN.test(value)) return 'witnessed';
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
 * - unknown: 0.85 — absence of explicit markers does not lower
 *   conviction; many factual statements simply don't use "I saw"
 *   phrasing. The previous ceiling of 0.6 penalized first-person
 *   narratives that didn't happen to use witnessed-pattern words.
 */
export function basisConvictionCeiling(basis: EvidenceBasis): number {
  switch (basis) {
    case 'witnessed': return 1.0;
    case 'heard': return 0.7;
    case 'inferred': return 0.5;
    case 'unknown': return 0.85;
  }
}
