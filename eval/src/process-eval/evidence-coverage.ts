/**
 * Evidence Coverage: three-element version (Twig §6.2 ①).
 *
 * For each surviving claim, checks:
 * 1. Has supporting evidence: >= 1 episode anchored to this claim
 * 2. Has counter-evidence: divergent material from another witness
 *    (a divergence record, a qualifier, or testimony from a different
 *    witness that the court paired with this claim)
 * 3. Has situational context: period, audience, or situation qualifiers
 *
 * Pure function. Does not judge whether the claim is "correct" — only
 * whether its evidence structure is complete.
 */
import type { Store } from '@openmimic/kernel';
import type { Claim } from '@openmimic/shared';
import type { ClaimCoverageResult, EvidenceCoverageReport } from './types';

/**
 * Check whether a claim has counter-evidence: material from a different
 * witness that challenges or qualifies this claim. We look for:
 * - Divergence records where one position comes from a different witness
 * - Claims from different witnesses paired in court (via divergence map)
 * - Explicit qualifiers on the claim
 */
function hasCounterEvidence(
  claim: Claim,
  store: Store,
): boolean {
  // 1. Explicit qualifiers on the claim
  if (claim.qualifiers && claim.qualifiers.length > 0) {
    return true;
  }

  // 2. Divergence records involving this claim's evidence
  const divergences = store.listDivergencesBySubject(claim.subjectId);
  for (const div of divergences) {
    // Check if this divergence involves testimony from our claim's witnesses
    // AND testimony from a different witness
    const claimWitnessIds = new Set(claim.witnessIds ?? []);
    const positionWitnessIds = div.positions.map((p) => p.witnessId).filter(Boolean);
    const hasOurWitness = positionWitnessIds.some((id) => id && claimWitnessIds.has(id));
    const hasOtherWitness = positionWitnessIds.some((id) => id && !claimWitnessIds.has(id));
    if (hasOurWitness && hasOtherWitness) {
      return true;
    }
  }

  // 3. Check if there are other claims from different witnesses on the same topic
  // (a rough proxy: claims in the same court session from different witnesses)
  const sessionClaims = store.listClaimsBySubject(claim.subjectId)
    .filter((c) => c.courtSessionId === claim.courtSessionId && c.id !== claim.id);
  const ourWitnesses = new Set(claim.witnessIds ?? []);
  for (const other of sessionClaims) {
    const otherWitnesses = other.witnessIds ?? [];
    if (otherWitnesses.some((wid) => !ourWitnesses.has(wid))) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether a claim has situational context (period/audience/situation).
 */
function hasContext(claim: Claim): boolean {
  if (!claim.context) return false;
  const { period, audience, situation } = claim.context;
  return !!(period || audience || situation);
}

/**
 * Compute three-element evidence coverage for all surviving claims of a subject.
 */
export function computeEvidenceCoverage(
  subjectId: string,
  store: Store,
): EvidenceCoverageReport {
  const claims = store.listClaimsBySubject(subjectId)
    .filter((c) => c.status === 'surviving');

  const details: ClaimCoverageResult[] = [];

  for (const claim of claims) {
    const hasSupport = (claim.episodeIds ?? []).length > 0;
    const hasCounter = hasCounterEvidence(claim, store);
    const hasSituationalContext = hasContext(claim);
    const score = (hasSupport ? 1 : 0) + (hasCounter ? 1 : 0) + (hasSituationalContext ? 1 : 0);

    details.push({
      claimId: claim.id,
      claimText: claim.text,
      hasSupport,
      hasCounterEvidence: hasCounter,
      hasContext: hasSituationalContext,
      score,
    });
  }

  const totalClaims = details.length;
  const fullCoverage = details.filter((d) => d.score === 3).length;
  const withSupport = details.filter((d) => d.hasSupport).length;
  const withCounterEvidence = details.filter((d) => d.hasCounterEvidence).length;
  const withContext = details.filter((d) => d.hasContext).length;
  const averageScore = totalClaims > 0
    ? details.reduce((sum, d) => sum + d.score, 0) / totalClaims
    : 0;

  return {
    totalClaims,
    fullCoverage,
    withSupport,
    withCounterEvidence,
    withContext,
    averageScore,
    details,
  };
}
