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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LLMClient, LLMCompletionRequest } from '@openmimic/engine-court';
import type { Store } from '@openmimic/kernel';
import type { Claim } from '@openmimic/shared';
import { adapterRunCourt } from './engine-adapter';
import { getJudgePromptSha, verifyJudgePromptSha } from './judge';
import { requireCalibration, writeRun, type RunRecord } from './ledger';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
/* LLM-based claim matching (same-facet judge)                         */
/* ------------------------------------------------------------------ */

export const CLAIM_MATCH_PROMPT_FILE = join(__dirname, 'claim-match-prompt.txt');

export function loadClaimMatchPrompt(): string {
  return readFileSync(CLAIM_MATCH_PROMPT_FILE, 'utf-8');
}

export function getClaimMatchPromptSha(): string {
  return createHash('sha256').update(loadClaimMatchPrompt(), 'utf-8').digest('hex');
}

const ClaimMatchResponseSchema = z.object({
  verdict: z.enum(['same', 'different']),
  reason: z.string(),
});

/**
 * Ask an LLM whether two claims describe the same facet.
 * Position-swapped: run twice with A/B then B/A; inconsistent = different.
 */
export async function llmClaimMatch(
  llm: LLMClient,
  claimA: string,
  claimB: string,
): Promise<boolean> {
  const prompt = loadClaimMatchPrompt();

  async function call(textA: string, textB: string): Promise<'same' | 'different' | null> {
    const user = `## 论断 A\n${textA}\n\n## 论断 B\n${textB}`;
    const request: LLMCompletionRequest = { system: prompt, user, purpose: 'eval-judge' };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await llm.complete(request);
        const trimmed = raw.trim();
        let parsed: unknown;
        try { parsed = JSON.parse(trimmed); } catch {
          const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
          if (fenced?.[1]) parsed = JSON.parse(fenced[1].trim());
          else {
            const start = trimmed.search(/[{[]/);
            if (start >= 0) {
              const sub = trimmed.slice(start);
              const end = sub.lastIndexOf('}');
              if (end > 0) parsed = JSON.parse(sub.slice(0, end + 1));
            }
          }
        }
        if (!parsed) continue;
        const result = ClaimMatchResponseSchema.parse(parsed);
        return result.verdict;
      } catch {
        // retry once
      }
    }
    return null; // parse failure => treat as different
  }

  const run1 = await call(claimA, claimB);
  if (run1 !== 'same') return false; // different or parse failure => not matched

  const run2 = await call(claimB, claimA);
  if (run2 !== 'same') return false; // position swap disagrees => not matched

  return true; // both directions agree: same facet
}

/** How many bigram-nearest candidates to check via LLM per claim. */
const LLM_MATCH_TOP_K = 3;

/**
 * Match claims from two runs using LLM judge with bigram pre-filter.
 *
 * For each claim in A, the top-K nearest claims in B (by bigram Jaccard)
 * are tested via LLM judge (position-swapped). This reduces LLM calls
 * from O(n*m) to O(n*K) while retaining semantic matching power.
 */
export async function matchClaimsLlm(
  claimsA: Claim[],
  claimsB: Claim[],
  llm: LLMClient,
): Promise<number> {
  const survivingA = claimsA.filter((c) => c.status === 'surviving');
  const survivingB = claimsB.filter((c) => c.status === 'surviving');

  if (survivingA.length === 0 && survivingB.length === 0) return 1;
  if (survivingA.length === 0 || survivingB.length === 0) return 0;

  const usedB = new Set<number>();
  let matched = 0;

  for (const claimA of survivingA) {
    // Rank B claims by bigram similarity, take top-K not already used
    const candidates: Array<{ idx: number; sim: number }> = [];
    for (let j = 0; j < survivingB.length; j++) {
      if (usedB.has(j)) continue;
      candidates.push({ idx: j, sim: bigramJaccard(claimA.text, survivingB[j].text) });
    }
    candidates.sort((a, b) => b.sim - a.sim);
    const topK = candidates.slice(0, LLM_MATCH_TOP_K);

    for (const { idx } of topK) {
      const isSame = await llmClaimMatch(llm, claimA.text, survivingB[idx].text);
      if (isSame) {
        matched++;
        usedB.add(idx);
        break;
      }
    }
  }

  return survivingA.length > 0 ? matched / survivingA.length : 0;
}

/**
 * Compute all pairwise overlap rates using LLM judge and return mean +/- stddev.
 */
export async function pairwiseOverlapLlm(
  claimSets: Claim[][],
  llm: LLMClient,
): Promise<{ mean: number; stddev: number; pairs: number }> {
  const rates: number[] = [];
  for (let i = 0; i < claimSets.length; i++) {
    for (let j = i + 1; j < claimSets.length; j++) {
      const rateAB = await matchClaimsLlm(claimSets[i], claimSets[j], llm);
      const rateBA = await matchClaimsLlm(claimSets[j], claimSets[i], llm);
      rates.push((rateAB + rateBA) / 2);
    }
  }
  if (rates.length === 0) return { mean: 0, stddev: 0, pairs: 0 };

  const mean = rates.reduce((s, r) => s + r, 0) / rates.length;
  const variance = rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length;
  return { mean, stddev: Math.sqrt(variance), pairs: rates.length };
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
  /** LLM judge overlap (same-facet matching). Only present if matchLlm was provided. */
  overlapLlm?: { mean: number; stddev: number; pairs: number };
  courtStats: Array<{ claimCount: number; durationMs: number }>;
}

export interface StabilityCurvePoint {
  n: number;
  subsets: number;
  overlap: { mean: number; stddev: number; pairs: number };
  /** Witness IDs for each subset (enables post-hoc decomposition). */
  witnessIdSets: string[][];
}

/** v2 curve point: each subset run twice, report intra-subset stability. */
export interface StabilityCurvePointV2 {
  n: number;
  subsets: Array<{
    witnessIds: string[];
    claimCounts: [number, number];
    durationMs: [number, number];
    overlapBigram: number;
    overlapLlm?: number;
  }>;
  /** Mean intra-subset overlap across all subsets at this n. */
  meanOverlapBigram: number;
  meanOverlapLlm?: number;
}

export interface StabilityResult {
  subjectId: string;
  modelName: string;
  promptSha: string;
  repeat: StabilityRepeatResult;
  curve: StabilityCurvePoint[];
  /** v2 curve: each subset run twice, measuring intra-subset stability. */
  curveV2?: StabilityCurvePointV2[];
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
  /** LLM client for LLM-judge claim matching (optional; if set, both methods are reported). */
  matchLlm?: LLMClient;
  /** Enable v2 curve: each subset run twice to measure intra-subset stability. */
  curveV2?: boolean;
  /** Number of subsets per n for v2 curve (default 2). */
  curveV2Subsets?: number;
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

  const overlapBigram = pairwiseOverlap(repeatClaimSets, similarity);
  const overlapLlm = options.matchLlm
    ? await pairwiseOverlapLlm(repeatClaimSets, options.matchLlm)
    : undefined;

  const repeat: StabilityRepeatResult = {
    K,
    claimCounts: repeatClaimSets.map((c) => c.filter((cl) => cl.status === 'surviving').length),
    overlap: overlapBigram,
    ...(overlapLlm ? { overlapLlm } : {}),
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
      witnessIdSets: subsets.map((s) => s.map((w) => w.id)),
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

  /* ---- Witness count curve v2: intra-subset stability ---- */
  const curveV2: StabilityCurvePointV2[] = [];

  if (options.curveV2) {
    const curveV2Subsets = options.curveV2Subsets ?? 2;
    console.error(`[Stability] Running v2 curve (${curveV2Subsets} subsets, each run 2x)...`);

    for (let n = 2; n <= witnesses.length; n++) {
      console.error(`[Stability] CurveV2 n=${n}...`);
      const subsetsList = randomSubsets(witnesses, n, curveV2Subsets);
      const subsetResults: StabilityCurvePointV2['subsets'] = [];

      for (let si = 0; si < subsetsList.length; si++) {
        const subset = subsetsList[si];
        const subsetIds = new Set(subset.map((w) => w.id));
        const witnessIds = subset.map((w) => w.id);
        console.error(`[Stability]   Subset ${si + 1}/${subsetsList.length} (n=${n}): ${witnessIds.join(',')}`);

        const runClaims: Claim[][] = [];
        const runClaimCounts: [number, number] = [0, 0];
        const runDurations: [number, number] = [0, 0];

        for (let run = 0; run < 2; run++) {
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
            console.error(`[Stability]     Run ${run + 1}/2: ${survivingCount} surviving in ${(courtDurationMs / 1000).toFixed(1)}s`);

            if (survivingCount === 0) {
              throw new Error(`CurveV2 n=${n} subset ${si + 1} run ${run + 1} produced 0 surviving claims. Aborting.`);
            }

            runClaims.push(claims);
            runClaimCounts[run] = survivingCount;
            runDurations[run] = courtDurationMs;
          } finally {
            tempStore.close();
          }
        }

        // Compute intra-subset overlap (2 runs of the same subset)
        const bigramAB = matchClaims(runClaims[0], runClaims[1], similarity);
        const bigramBA = matchClaims(runClaims[1], runClaims[0], similarity);
        const overlapBigram = (bigramAB + bigramBA) / 2;

        let overlapLlm: number | undefined;
        if (options.matchLlm) {
          const llmAB = await matchClaimsLlm(runClaims[0], runClaims[1], options.matchLlm);
          const llmBA = await matchClaimsLlm(runClaims[1], runClaims[0], options.matchLlm);
          overlapLlm = (llmAB + llmBA) / 2;
        }

        subsetResults.push({
          witnessIds,
          claimCounts: runClaimCounts,
          durationMs: runDurations,
          overlapBigram,
          ...(overlapLlm !== undefined ? { overlapLlm } : {}),
        });
      }

      const meanOverlapBigram = subsetResults.reduce((s, sr) => s + sr.overlapBigram, 0) / subsetResults.length;
      const meanOverlapLlm = subsetResults.every((sr) => sr.overlapLlm !== undefined)
        ? subsetResults.reduce((s, sr) => s + (sr.overlapLlm ?? 0), 0) / subsetResults.length
        : undefined;

      curveV2.push({
        n,
        subsets: subsetResults,
        meanOverlapBigram,
        ...(meanOverlapLlm !== undefined ? { meanOverlapLlm } : {}),
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
  }

  const result: StabilityResult = {
    subjectId,
    modelName: options.modelName,
    promptSha,
    repeat,
    curve,
    ...(curveV2.length > 0 ? { curveV2 } : {}),
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
        ...(repeat.overlapLlm ? {
          overlapLlmMean: repeat.overlapLlm.mean,
          overlapLlmStddev: repeat.overlapLlm.stddev,
        } : {}),
        courtStats: repeat.courtStats,
      },
      curve: curve.map((p) => ({
        n: p.n,
        subsets: p.subsets,
        overlapMean: p.overlap.mean,
        overlapStddev: p.overlap.stddev,
        witnessIdSets: p.witnessIdSets,
      })),
      ...(curveV2.length > 0 ? { curveV2 } : {}),
    },
    details: [],
  };
  writeRun(runRecord);

  return result;
}
