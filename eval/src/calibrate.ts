/**
 * Judge calibration gate.
 *
 * Runs the judge against a set of known-answer pairs. Three thresholds:
 *   - Accuracy > 80%
 *   - Valid pairs >= 20
 *   - Position bias (discard rate) <= 30%
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
  status: 'correct' | 'incorrect' | 'discarded';
  reason?: string;
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
    // close is candidate 1, far is candidate 2
    const result = await judgePair(llm, pair.real, pair.close, pair.far);

    if (result.status === 'discarded') {
      details.push({ pairId: pair.id, status: 'discarded', reason: result.reason });
    } else {
      // result.winner is 'first' or 'second'; first = close, second = far
      const judgedWinner = result.winner === 'first' ? 'close' : 'far';
      if (judgedWinner === pair.expectedWinner) {
        details.push({ pairId: pair.id, status: 'correct' });
      } else {
        details.push({ pairId: pair.id, status: 'incorrect', reason: `expected ${pair.expectedWinner}, got ${judgedWinner}` });
      }
    }
  }

  const validPairs = details.filter((d) => d.status !== 'discarded').length;
  const discardedPairs = details.filter((d) => d.status === 'discarded').length;
  const correctPairs = details.filter((d) => d.status === 'correct').length;
  const accuracy = validPairs > 0 ? correctPairs / validPairs : 0;
  const positionBias = pairs.length > 0 ? discardedPairs / pairs.length : 0;

  const failReasons: string[] = [];
  if (accuracy <= CALIBRATION_ACCURACY_THRESHOLD) {
    failReasons.push(`accuracy ${(accuracy * 100).toFixed(1)}% <= ${CALIBRATION_ACCURACY_THRESHOLD * 100}% threshold`);
  }
  if (validPairs < CALIBRATION_MIN_VALID_PAIRS) {
    failReasons.push(`valid pairs ${validPairs} < ${CALIBRATION_MIN_VALID_PAIRS} minimum`);
  }
  if (positionBias > CALIBRATION_MAX_BIAS) {
    failReasons.push(`position bias ${(positionBias * 100).toFixed(1)}% > ${CALIBRATION_MAX_BIAS * 100}% maximum`);
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
  };

  // Write run log
  const run: RunRecord = {
    kind: 'calibration',
    modelName,
    promptSha,
    commitSha: 'unknown', // filled by CLI
    params: {
      totalPairs: pairs.length,
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
    },
    details,
  };
  writeRun(run);

  return result;
}
