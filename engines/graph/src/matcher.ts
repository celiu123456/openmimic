/**
 * Claim matching for incremental recompute.
 *
 * When court runs are non-deterministic (~47% overlap), a recompute may
 * produce claims that say the same thing in different words. This module
 * matches old claims to new ones using:
 *
 * 1. Exact text match (fast path)
 * 2. Character bigram Jaccard (from eval/stability)
 * 3. Optional LLM semantic match (from eval/stability, position-swapped)
 *
 * The result classifies each claim as retained, merged, new, or retired.
 */
import type { Claim } from '@openmimic/shared';

/* ------------------------------------------------------------------ */
/* Bigram Jaccard (same as eval/src/stability.ts)                      */
/* ------------------------------------------------------------------ */

function charBigrams(text: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    bigrams.add(text.slice(i, i + 2));
  }
  return bigrams;
}

export function bigramJaccard(a: string, b: string): number {
  const setA = charBigrams(a);
  const setB = charBigrams(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const bigram of setA) {
    if (setB.has(bigram)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/* ------------------------------------------------------------------ */
/* Match result types                                                  */
/* ------------------------------------------------------------------ */

export type ClaimFate = 'retained' | 'merged' | 'new' | 'retired';

export interface ClaimMatchResult {
  /** Old claim id → new claim id (retained or merged). */
  retained: Array<{ oldId: string; newId: string; similarity: number }>;
  /** New claims with no match in the old set. */
  added: string[];
  /** Old claims with no match in the new set (retired). */
  retired: string[];
  /** Counts. */
  counts: {
    retained: number;
    merged: number;
    added: number;
    retired: number;
  };
}

export interface SemanticMatcher {
  /**
   * Check whether two claim texts refer to the same facet.
   * Position-swapped: returns true only if both directions agree.
   */
  isSameFacet(textA: string, textB: string): Promise<boolean>;
}

/* ------------------------------------------------------------------ */
/* Match pipeline                                                      */
/* ------------------------------------------------------------------ */

const BIGRAM_THRESHOLD = 0.5;

/**
 * Match old claims against new claims.
 *
 * 1. Exact text match
 * 2. Bigram Jaccard >= threshold
 * 3. If semanticMatcher is provided, LLM match on top-3 candidates
 *
 * Uses greedy bipartite matching (not optimal, but good enough and O(n*m)).
 */
export async function matchClaims(
  oldClaims: Claim[],
  newClaims: Claim[],
  semanticMatcher?: SemanticMatcher,
): Promise<ClaimMatchResult> {
  const oldSurviving = oldClaims.filter((c) => c.status === 'surviving');
  const newSurviving = newClaims.filter((c) => c.status === 'surviving');

  const usedNew = new Set<number>();
  const retained: ClaimMatchResult['retained'] = [];

  // Pass 1: exact text match
  for (const old of oldSurviving) {
    for (let j = 0; j < newSurviving.length; j++) {
      if (usedNew.has(j)) continue;
      if (old.text === newSurviving[j]!.text) {
        retained.push({ oldId: old.id, newId: newSurviving[j]!.id, similarity: 1.0 });
        usedNew.add(j);
        break;
      }
    }
  }

  const matchedOld = new Set(retained.map((r) => r.oldId));

  // Pass 2: bigram Jaccard for unmatched
  for (const old of oldSurviving) {
    if (matchedOld.has(old.id)) continue;
    let bestIdx = -1;
    let bestSim = 0;
    for (let j = 0; j < newSurviving.length; j++) {
      if (usedNew.has(j)) continue;
      const sim = bigramJaccard(old.text, newSurviving[j]!.text);
      if (sim >= BIGRAM_THRESHOLD && sim > bestSim) {
        bestSim = sim;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0) {
      retained.push({ oldId: old.id, newId: newSurviving[bestIdx]!.id, similarity: bestSim });
      usedNew.add(bestIdx);
      matchedOld.add(old.id);
    }
  }

  // Pass 3: LLM semantic match for remaining unmatched (if available)
  if (semanticMatcher) {
    for (const old of oldSurviving) {
      if (matchedOld.has(old.id)) continue;

      // Top-3 candidates by bigram
      const candidates: Array<{ idx: number; sim: number }> = [];
      for (let j = 0; j < newSurviving.length; j++) {
        if (usedNew.has(j)) continue;
        candidates.push({ idx: j, sim: bigramJaccard(old.text, newSurviving[j]!.text) });
      }
      candidates.sort((a, b) => b.sim - a.sim);
      const topK = candidates.slice(0, 3);

      for (const { idx, sim } of topK) {
        const isSame = await semanticMatcher.isSameFacet(old.text, newSurviving[idx]!.text);
        if (isSame) {
          retained.push({ oldId: old.id, newId: newSurviving[idx]!.id, similarity: sim });
          usedNew.add(idx);
          matchedOld.add(old.id);
          break;
        }
      }
    }
  }

  // Compute results
  const addedIds = newSurviving
    .filter((_, i) => !usedNew.has(i))
    .map((c) => c.id);
  const retiredIds = oldSurviving
    .filter((c) => !matchedOld.has(c.id))
    .map((c) => c.id);

  // Classify retained as "retained" (exact) or "merged" (fuzzy)
  const exactMatches = retained.filter((r) => r.similarity === 1.0);
  const mergedMatches = retained.filter((r) => r.similarity < 1.0);

  return {
    retained,
    added: addedIds,
    retired: retiredIds,
    counts: {
      retained: exactMatches.length,
      merged: mergedMatches.length,
      added: addedIds.length,
      retired: retiredIds.length,
    },
  };
}
