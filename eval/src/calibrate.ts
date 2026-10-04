/**
 * Judge calibration gate.
 *
 * Runs the judge against a set of known-answer pairs. Three thresholds
 * apply to the overall set AND to the hard subset independently:
 *   - Accuracy > 80%
 *   - Valid pairs >= 20
 *   - Position bias (discard rate) <= 30%
 *
 * Hard-subset thresholds are identical except min valid >= 20 applies
 * to the hard pairs alone. If the hard subset has fewer than 20 valid
 * pairs the hard gate fails.
 *
 * Calibration result is written to eval/runs/ and subsequent evaluations
 * verify that the model name + prompt SHA match.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { LLMClient } from '@openmimic/engine-court';
import { judgePair, getJudgePromptSha } from './judge';
import { writeRun, type RunRecord } from './ledger';

/* ------------------------------------------------------------------ */
/* Calibration pairs schema                                            */
/* ------------------------------------------------------------------ */

const CalibrationPairSchema = z.object({
  id: z.string(),
  real: z.string(),
  close: z.string(),
  far: z.string(),
  expectedWinner: z.enum(['close', 'far']),
  difficulty: z.enum(['easy', 'hard']).optional().default('easy'),
});

export type CalibrationPair = z.infer<typeof CalibrationPairSchema>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAIRS_FILE = join(__dirname, '..', 'calibration', 'pairs.zh.json');

export function loadCalibrationPairs(): CalibrationPair[] {
  const raw = readFileSync(PAIRS_FILE, 'utf-8');
  return z.array(CalibrationPairSchema).parse(JSON.parse(raw));
}

/* ------------------------------------------------------------------ */
/* Thresholds                                                          */
/* ------------------------------------------------------------------ */

export const CALIBRATION_ACCURACY_THRESHOLD = 0.8;
export const CALIBRATION_MIN_VALID_PAIRS = 20;
export const CALIBRATION_MAX_BIAS = 0.3;

/* ------------------------------------------------------------------ */
/* Result type                                                         */
/* ------------------------------------------------------------------ */

export interface CalibrationDetail {
  pairId: string;
  difficulty: 'easy' | 'hard';
  status: 'correct' | 'incorrect' | 'discarded';
  reason?: string;
}

export interface SubsetStats {
  totalPairs: number;
  validPairs: number;
  discardedPairs: number;
  correctPairs: number;
  accuracy: number;
  positionBias: number;
}

export interface CalibrationResult {
  modelName: string;
  promptSha: string;
  totalPairs: number;
  validPairs: number;
  discardedPairs: number;
  correctPairs: number;
  accuracy: number;
  positionBias: number;
  passed: boolean;
  details: CalibrationDetail[];
  failReasons: string[];
  /** Per-difficulty subset breakdown */
  easy: SubsetStats;
  hard: SubsetStats;
}

/* ------------------------------------------------------------------ */
/* Helper: compute stats for a subset of details                       */
/* ------------------------------------------------------------------ */

function computeSubsetStats(details: CalibrationDetail[]): SubsetStats {
  const total = details.length;
  const valid = details.filter((d) => d.status !== 'discarded').length;
  const discarded = details.filter((d) => d.status === 'discarded').length;
  const correct = details.filter((d) => d.status === 'correct').length;
  return {
    totalPairs: total,
    validPairs: valid,
    discardedPairs: discarded,
    correctPairs: correct,
    accuracy: valid > 0 ? correct / valid : 0,
    positionBias: total > 0 ? discarded / total : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Run calibration                                                     */
/* ------------------------------------------------------------------ */

export async function runCalibration(
  llm: LLMClient,
  modelName: string,
): Promise<CalibrationResult> {
  const pairs = loadCalibrationPairs();
  const promptSha = getJudgePromptSha();
  const details: CalibrationDetail[] = [];

  for (const pair of pairs) {
    const difficulty = pair.difficulty ?? 'easy';
    // close is candidate 1, far is candidate 2
    const result = await judgePair(llm, pair.real, pair.close, pair.far);

    if (result.status === 'discarded') {
      details.push({ pairId: pair.id, difficulty, status: 'discarded', reason: result.reason });
    } else {
      // result.winner is 'first' or 'second'; first = close, second = far
      const judgedWinner = result.winner === 'first' ? 'close' : 'far';
      if (judgedWinner === pair.expectedWinner) {
        details.push({ pairId: pair.id, difficulty, status: 'correct' });
      } else {
        details.push({ pairId: pair.id, difficulty, status: 'incorrect', reason: `expected ${pair.expectedWinner}, got ${judgedWinner}` });
      }
    }
  }

  // Overall stats
  const validPairs = details.filter((d) => d.status !== 'discarded').length;
  const discardedPairs = details.filter((d) => d.status === 'discarded').length;
  const correctPairs = details.filter((d) => d.status === 'correct').length;
  const accuracy = validPairs > 0 ? correctPairs / validPairs : 0;
  const positionBias = pairs.length > 0 ? discardedPairs / pairs.length : 0;

  // Per-difficulty stats
  const easyDetails = details.filter((d) => d.difficulty === 'easy');
  const hardDetails = details.filter((d) => d.difficulty === 'hard');
  const easy = computeSubsetStats(easyDetails);
  const hard = computeSubsetStats(hardDetails);

  // Gate checks: overall AND hard subset must each pass
  const failReasons: string[] = [];

  // Overall gates
  if (accuracy <= CALIBRATION_ACCURACY_THRESHOLD) {
    failReasons.push(`overall accuracy ${(accuracy * 100).toFixed(1)}% <= ${CALIBRATION_ACCURACY_THRESHOLD * 100}% threshold`);
  }
  if (validPairs < CALIBRATION_MIN_VALID_PAIRS) {
    failReasons.push(`overall valid pairs ${validPairs} < ${CALIBRATION_MIN_VALID_PAIRS} minimum`);
  }
  if (positionBias > CALIBRATION_MAX_BIAS) {
    failReasons.push(`overall position bias ${(positionBias * 100).toFixed(1)}% > ${CALIBRATION_MAX_BIAS * 100}% maximum`);
  }

  // Hard-subset gates (only if hard pairs exist)
  if (hard.totalPairs > 0) {
    if (hard.accuracy <= CALIBRATION_ACCURACY_THRESHOLD) {
      failReasons.push(`hard accuracy ${(hard.accuracy * 100).toFixed(1)}% <= ${CALIBRATION_ACCURACY_THRESHOLD * 100}% threshold`);
    }
    if (hard.validPairs < CALIBRATION_MIN_VALID_PAIRS) {
      failReasons.push(`hard valid pairs ${hard.validPairs} < ${CALIBRATION_MIN_VALID_PAIRS} minimum`);
    }
    if (hard.positionBias > CALIBRATION_MAX_BIAS) {
      failReasons.push(`hard position bias ${(hard.positionBias * 100).toFixed(1)}% > ${CALIBRATION_MAX_BIAS * 100}% maximum`);
    }
  }

  const passed = failReasons.length === 0;

  const result: CalibrationResult = {
    modelName,
    promptSha,
    totalPairs: pairs.length,
    validPairs,
    discardedPairs,
    correctPairs,
    accuracy,
    positionBias,
    passed,
    details,
    failReasons,
    easy,
    hard,
  };

  // Write run log
  const run: RunRecord = {
    kind: 'calibration',
    modelName,
    promptSha,
    commitSha: 'unknown', // filled by CLI
    params: {
      totalPairs: pairs.length,
      easyPairs: easy.totalPairs,
      hardPairs: hard.totalPairs,
      accuracyThreshold: CALIBRATION_ACCURACY_THRESHOLD,
      minValidPairs: CALIBRATION_MIN_VALID_PAIRS,
      maxBias: CALIBRATION_MAX_BIAS,
    },
    results: {
      passed,
      accuracy,
      validPairs,
      discardedPairs,
      correctPairs,
      positionBias,
      failReasons,
      easy,
      hard,
    },
    details,
  };
  writeRun(run);

  return result;
}
