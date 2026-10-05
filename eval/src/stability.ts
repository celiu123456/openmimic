/**
 * Court stability evaluation.
 *
 * 1. Repeated runs: same data, K times -> measure cross-run claim overlap
 * 2. Witness count curve: for n=2..N, sample subsets -> stability vs n
 *
 * Claim matching uses character bigram Jaccard by default (injectable).
 *
 * Supports incremental checkpointing so a crash/timeout does not lose
 * partial progress.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { LLMClient } from '@openmimic/engine-court';
import type { Store } from '@openmimic/kernel';
import type { Claim } from '@openmimic/shared';
import { adapterRunCourt } from './engine-adapter';
import { getJudgePromptSha, verifyJudgePromptSha } from './judge';
import { requireCalibration, writeRun, type RunRecord } from './ledger';

/* ------------------------------------------------------------------ */
/* Similarity: character bigram Jaccard                                */
/* ------------------------------------------------------------------ */

export type SimilarityFn = (a: string, b: string) => number;

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
/* Claim matching across runs                                          */
/* ------------------------------------------------------------------ */

const MATCH_THRESHOLD = 0.5;

/**
 * Match claims from two runs using greedy best-match.
 * Returns the fraction of claims in run A that have a match in run B.
 */
export function matchClaims(
  claimsA: Claim[],
  claimsB: Claim[],
  similarity: SimilarityFn = bigramJaccard,
): number {
  const survivingA = claimsA.filter((c) => c.status === 'surviving');
  const survivingB = claimsB.filter((c) => c.status === 'surviving');

  if (survivingA.length === 0 && survivingB.length === 0) return 1;
  if (survivingA.length === 0 || survivingB.length === 0) return 0;

  const usedB = new Set<number>();
  let matched = 0;

  for (const claimA of survivingA) {
    let bestSim = 0;
    let bestIdx = -1;
    for (let j = 0; j < survivingB.length; j++) {
      if (usedB.has(j)) continue;
      const sim = similarity(claimA.text, survivingB[j].text);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0 && bestSim >= MATCH_THRESHOLD) {
      matched++;
      usedB.add(bestIdx);
    }
  }

  const rateAinB = survivingA.length > 0 ? matched / survivingA.length : 0;
  return rateAinB;
}

/**
 * Compute all pairwise overlap rates and return mean +/- stddev.
 */
export function pairwiseOverlap(
  claimSets: Claim[][],
  similarity: SimilarityFn = bigramJaccard,
): { mean: number; stddev: number; pairs: number } {
  const rates: number[] = [];
  for (let i = 0; i < claimSets.length; i++) {
    for (let j = i + 1; j < claimSets.length; j++) {
      const rateAB = matchClaims(claimSets[i], claimSets[j], similarity);
      const rateBA = matchClaims(claimSets[j], claimSets[i], similarity);
      rates.push((rateAB + rateBA) / 2);
    }
  }
  if (rates.length === 0) return { mean: 0, stddev: 0, pairs: 0 };

  const mean = rates.reduce((s, r) => s + r, 0) / rates.length;
  const variance = rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length;
  return { mean, stddev: Math.sqrt(variance), pairs: rates.length };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getCommitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/* ------------------------------------------------------------------ */
/* Stability types                                                     */
/* ------------------------------------------------------------------ */

export interface StabilityRepeatResult {
  K: number;
  claimCounts: number[];
  overlap: { mean: number; stddev: number; pairs: number };
  courtStats: Array<{ claimCount: number; durationMs: number }>;
}

export interface StabilityCurvePoint {
  n: number;
  subsets: number;
  overlap: { mean: number; stddev: number; pairs: number };
}

export interface StabilityResult {
  subjectId: string;
  modelName: string;
  promptSha: string;
  repeat: StabilityRepeatResult;
  curve: StabilityCurvePoint[];
}

export interface StabilityOptions {
  modelName: string;
  /** Number of repeat runs (default 5) */
  K?: number;
  /** Max subsets per n value (default 5) */
  maxSubsets?: number;
  /** Skip calibration check (for testing) */
  skipCalibrationCheck?: boolean;
  /** Similarity function override */
  similarity?: SimilarityFn;
  /** Path to checkpoint file for incremental save/resume */
  progressFile?: string;
}

/* ------------------------------------------------------------------ */
/* Checkpoint                                                          */
/* ------------------------------------------------------------------ */

interface StabilityCheckpoint {
  /** Serialized claim sets for completed repeat runs */
  repeatClaimTexts: string[][];
  /** Completed curve points */
  curve: StabilityCurvePoint[];
  /** Subset claim texts for in-progress curve point n */
  currentN?: number;
  currentSubsetClaimTexts?: string[][];
  /** Per-run court stats from repeat phase */
  repeatCourtStats?: Array<{ claimCount: number; durationMs: number }>;
}

function loadStabilityCheckpoint(file: string): StabilityCheckpoint | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function saveStabilityCheckpoint(file: string, cp: StabilityCheckpoint): void {
  writeFileSync(file, JSON.stringify(cp, null, 2), 'utf-8');
}

/** Serialize claim sets as text arrays (claims are re-created from text for matching). */
function claimsToTexts(claims: Claim[]): string[] {
  return claims.filter((c) => c.status === 'surviving').map((c) => c.text);
}

function textsToMinimalClaims(texts: string[]): Claim[] {
  return texts.map((text, i) => ({
    id: `restored-${i}`,
    subjectId: 'restored',
    text,
    conviction: 0.5,
    evidence: [],
    status: 'surviving' as const,
    courtSessionId: 'restored',
  }));
}

/* ------------------------------------------------------------------ */
/* Subset generation                                                   */
/* ------------------------------------------------------------------ */

/** Generate random subsets of size k from an array of n items. */
function randomSubsets<T>(items: T[], k: number, maxCount: number): T[][] {
  if (k >= items.length) return [items];
  if (k <= 0) return [];

  // For small combinations, generate all and pick randomly
  const all = combinations(items, k);
  if (all.length <= maxCount) return all;

  // Shuffle and take first maxCount
  const shuffled = [...all];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, maxCount);
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k === items.length) return [items];
  const result: T[][] = [];
  function pick(start: number, chosen: T[]): void {
    if (chosen.length === k) {
      result.push([...chosen]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      chosen.push(items[i]);
      pick(i + 1, chosen);
      chosen.pop();
    }
  }
  pick(0, []);
  return result;
}

/* ------------------------------------------------------------------ */
/* Main stability runner                                               */
/* ------------------------------------------------------------------ */

export async function runStability(
  subjectId: string,
  store: Store,
  courtLlm: LLMClient,
  StoreClass: new () => Store,
  options: StabilityOptions,
): Promise<StabilityResult> {
  const promptSha = getJudgePromptSha();
  const K = options.K ?? 5;
  const maxSubsets = options.maxSubsets ?? 5;
  const similarity = options.similarity ?? bigramJaccard;

  if (!options.skipCalibrationCheck) {
    requireCalibration(options.modelName, promptSha);
    verifyJudgePromptSha(promptSha);
  }

  const witnesses = store.listWitnessesBySubject(subjectId);
  const allTestimonies = store.listBySubject(subjectId);

  // Load checkpoint
  const checkpoint = options.progressFile ? loadStabilityCheckpoint(options.progressFile) : null;

  /* ---- Repeat runs (full data, K times) ---- */
  const repeatClaimSets: Claim[][] = checkpoint
    ? checkpoint.repeatClaimTexts.map(textsToMinimalClaims)
    : [];
  const courtStatsArr: Array<{ claimCount: number; durationMs: number }> =
    checkpoint?.repeatCourtStats ?? [];

  for (let run = repeatClaimSets.length; run < K; run++) {
    console.error(`[Stability] Repeat run ${run + 1}/${K}...`);
    const tempStore = new StoreClass();
    const subject = store.getSubject(subjectId);
    if (subject) tempStore.putSubject(subject);
    for (const w of witnesses) tempStore.putWitness(w);
    for (const t of allTestimonies) tempStore.addTestimony(t);

    try {
      const courtStart = Date.now();
      await adapterRunCourt(subjectId, tempStore, courtLlm);
      const courtDurationMs = Date.now() - courtStart;

      const claims = tempStore.listClaimsBySubject(subjectId);
      const survivingCount = claims.filter((c) => c.status === 'surviving').length;
      console.error(`[Stability]   Run ${run + 1}: ${survivingCount} surviving claims (${claims.length} total) in ${(courtDurationMs / 1000).toFixed(1)}s`);

      if (survivingCount === 0) {
        throw new Error(
          `Stability repeat run ${run + 1}/${K} produced 0 surviving claims. ` +
          `Overlap measurements with 0 claims are degenerate. Aborting. ` +
          `Check that the court LLM client correctly disables thinking for DeepSeek models.`,
        );
      }

      repeatClaimSets.push(claims);
      courtStatsArr.push({ claimCount: survivingCount, durationMs: courtDurationMs });

      // Checkpoint
      if (options.progressFile) {
        saveStabilityCheckpoint(options.progressFile, {
          repeatClaimTexts: repeatClaimSets.map(claimsToTexts),
          curve: checkpoint?.curve ?? [],
          repeatCourtStats: courtStatsArr,
        });
      }
    } finally {
      tempStore.close();
    }
  }

  const repeat: StabilityRepeatResult = {
    K,
    claimCounts: repeatClaimSets.map((c) => c.filter((cl) => cl.status === 'surviving').length),
    overlap: pairwiseOverlap(repeatClaimSets, similarity),
    courtStats: courtStatsArr,
  };

  /* ---- Witness count curve ---- */
  const curve: StabilityCurvePoint[] = checkpoint?.curve ?? [];
  const completedNs = new Set(curve.map((p) => p.n));

  for (let n = 2; n <= witnesses.length; n++) {
    if (completedNs.has(n)) {
      console.error(`[Stability] Curve n=${n}: already done, skipping`);
      continue;
    }

    console.error(`[Stability] Curve n=${n}...`);
    const subsets = randomSubsets(witnesses, n, maxSubsets);
    const subsetClaimSets: Claim[][] = [];

    for (let si = 0; si < subsets.length; si++) {
      const subset = subsets[si];
      console.error(`[Stability]   Subset ${si + 1}/${subsets.length} (n=${n})...`);
      const subsetIds = new Set(subset.map((w) => w.id));
      const tempStore = new StoreClass();
      const subject = store.getSubject(subjectId);
      if (subject) tempStore.putSubject(subject);
      for (const w of subset) tempStore.putWitness(w);
      for (const t of allTestimonies) {
        if (subsetIds.has(t.witnessId)) tempStore.addTestimony(t);
      }

      try {
        const courtStart = Date.now();
        await adapterRunCourt(subjectId, tempStore, courtLlm);
        const courtDurationMs = Date.now() - courtStart;

        const claims = tempStore.listClaimsBySubject(subjectId);
        const survivingCount = claims.filter((c) => c.status === 'surviving').length;
        console.error(`[Stability]     ${survivingCount} surviving claims in ${(courtDurationMs / 1000).toFixed(1)}s`);

        if (survivingCount === 0) {
          throw new Error(
            `Stability curve n=${n} subset ${si + 1}/${subsets.length} produced 0 surviving claims. ` +
            `Aborting. Check that the court LLM client correctly disables thinking for DeepSeek models.`,
          );
        }

        subsetClaimSets.push(claims);
      } finally {
        tempStore.close();
      }
    }

    curve.push({
      n,
      subsets: subsets.length,
      overlap: pairwiseOverlap(subsetClaimSets, similarity),
    });

    // Checkpoint
    if (options.progressFile) {
      saveStabilityCheckpoint(options.progressFile, {
        repeatClaimTexts: repeatClaimSets.map(claimsToTexts),
        curve,
        repeatCourtStats: courtStatsArr,
      });
    }
  }

  const result: StabilityResult = {
    subjectId,
    modelName: options.modelName,
    promptSha,
    repeat,
    curve,
  };

  // Write run log
  const runRecord: RunRecord = {
    kind: 'stability',
    modelName: options.modelName,
    promptSha,
    commitSha: getCommitSha(),
    params: { subjectId, K, maxSubsets },
    results: {
      repeat: {
        K: repeat.K,
        claimCounts: repeat.claimCounts,
        overlapMean: repeat.overlap.mean,
        overlapStddev: repeat.overlap.stddev,
        courtStats: repeat.courtStats,
      },
      curve: curve.map((p) => ({
        n: p.n,
        subsets: p.subsets,
        overlapMean: p.overlap.mean,
        overlapStddev: p.overlap.stddev,
      })),
    },
    details: [],
  };
  writeRun(runRecord);

  return result;
}
