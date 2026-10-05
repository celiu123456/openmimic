/**
 * Liveness calibration gate.
 *
 * Before any liveness evaluation can produce readings, the judge model
 * must prove it can distinguish human-written text from AI-generated
 * text on a set of **manually curated** sample pairs.
 *
 * Three thresholds must ALL be met:
 *   - Accuracy > 80%
 *   - Valid pairs >= 20
 *   - Position bias (discard rate) <= 30%
 *
 * If calibration fails, subsequent liveness evaluations refuse to run.
 *
 * CRITICAL: This file does NOT provide any real human samples. The
 * project owner must supply them manually. See samples.example.json
 * for the expected format.
 *
 * Ported from personality_structure_server/eval/reply-liveness/calibrate.ts,
 * with the database loading path (lines 119-222, containing hardcoded
 * credentials) deliberately NOT ported.
 */

import { readFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { z } from 'zod';
import type { LLMClient } from '@openmimic/engine-court';
import {
  judgeLivenessPairs,
  LIVENESS_JUDGE_PROMPT_SHA,
  type LivenessPairInput,
  type LivenessPairVerdict,
  type ConversationTurn,
} from './liveness-judge';
import { checkSampleHygiene } from './sample-hygiene';
import { writeRun, findCalibrationRun, type RunRecord } from './ledger';

/* ------------------------------------------------------------------ */
/* Thresholds (hardcoded — changing them is an explicit code change)   */
/* ------------------------------------------------------------------ */

export const LIVENESS_CALIBRATION_PASS_THRESHOLD = 0.8;
export const LIVENESS_CALIBRATION_MIN_PAIRS = 20;
export const LIVENESS_CALIBRATION_MAX_BIAS = 0.3;

/* ------------------------------------------------------------------ */
/* Sample schema                                                       */
/* ------------------------------------------------------------------ */

export interface LivenessSample {
  id: string;
  origin: 'human' | 'ai';
  text: string;
  trigger?: string;
  context?: ConversationTurn[];
}

const SampleFileSchema = z.object({
  human: z.array(
    z.union([
      z.string(),
      z.object({
        id: z.string().optional(),
        text: z.string(),
        trigger: z.string().optional(),
        context: z
          .array(
            z.object({
              role: z.enum(['user', 'assistant']),
              content: z.string(),
            }),
          )
          .optional(),
      }),
    ]),
  ),
  ai: z.array(
    z.union([
      z.string(),
      z.object({
        id: z.string().optional(),
        text: z.string(),
        trigger: z.string().optional(),
        context: z
          .array(
            z.object({
              role: z.enum(['user', 'assistant']),
              content: z.string(),
            }),
          )
          .optional(),
      }),
    ]),
  ),
});

/**
 * Load samples from a JSON file. Both human and AI arrays may contain
 * plain strings or objects with { text, trigger?, context? }.
 */
export function loadLivenessSamples(filePath: string): {
  human: LivenessSample[];
  ai: LivenessSample[];
} {
  const abs = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  const parsed = SampleFileSchema.parse(JSON.parse(readFileSync(abs, 'utf-8')));

  const normalize = (
    raw: string | { id?: string; text: string; trigger?: string; context?: ConversationTurn[] },
    origin: 'human' | 'ai',
    idx: number,
  ): LivenessSample => {
    if (typeof raw === 'string') {
      return { id: `${origin}_${idx}`, origin, text: raw.trim() };
    }
    return {
      id: raw.id ?? `${origin}_${idx}`,
      origin,
      text: raw.text.trim(),
      trigger: raw.trigger,
      context: raw.context,
    };
  };

  return {
    human: parsed.human
      .map((r, i) => normalize(r, 'human', i))
      .filter((s) => s.text.length > 0),
    ai: parsed.ai
      .map((r, i) => normalize(r, 'ai', i))
      .filter((s) => s.text.length > 0),
  };
}

/* ------------------------------------------------------------------ */
/* Pairing (hygiene-checked)                                           */
/* ------------------------------------------------------------------ */

export interface LivenessCalibrationPair {
  pairId: string;
  human: LivenessSample;
  ai: LivenessSample;
  humanSide: 'A' | 'B';
  trigger: string;
  context: ConversationTurn[];
}

/**
 * Build calibration pairs from human and AI samples.
 * Samples that fail hygiene checks are silently excluded.
 * humanSide alternates by index for determinism.
 */
export function buildLivenessCalibrationPairs(
  human: LivenessSample[],
  ai: LivenessSample[],
  maxPairs: number = 100,
): { pairs: LivenessCalibrationPair[]; hygieneExcluded: number } {
  let hygieneExcluded = 0;

  const cleanHuman = human.filter((s) => {
    const h = checkSampleHygiene(s.text);
    if (!h.clean) hygieneExcluded++;
    return h.clean;
  });
  const cleanAi = ai.filter((s) => {
    const h = checkSampleHygiene(s.text);
    if (!h.clean) hygieneExcluded++;
    return h.clean;
  });

  const pairs: LivenessCalibrationPair[] = [];
  const usedAi = new Set<string>();

  for (const humanSample of cleanHuman) {
    if (pairs.length >= maxPairs) break;
    const aiSample = cleanAi.find((s) => !usedAi.has(s.id));
    if (!aiSample) break;
    usedAi.add(aiSample.id);

    const idx = pairs.length;
    pairs.push({
      pairId: `liveness_calib_${idx}`,
      human: humanSample,
      ai: aiSample,
      humanSide: idx % 2 === 0 ? 'A' : 'B',
      trigger: humanSample.trigger ?? aiSample.trigger ?? '(无触发消息)',
      context: humanSample.context ?? aiSample.context ?? [],
    });
  }

  return { pairs, hygieneExcluded };
}

function toPairInputs(pairs: LivenessCalibrationPair[]): LivenessPairInput[] {
  return pairs.map((pair) => {
    const humanSide = { label: `human:${pair.human.id}`, text: pair.human.text };
    const aiSide = { label: `ai:${pair.ai.id}`, text: pair.ai.text };
    return {
      pairId: pair.pairId,
      context: pair.context,
      trigger: pair.trigger,
      a: pair.humanSide === 'A' ? humanSide : aiSide,
      b: pair.humanSide === 'A' ? aiSide : humanSide,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export interface LivenessCalibrationResult {
  promptSha: string;
  modelName: string;
  totalPairs: number;
  validPairs: number;
  discardedPairs: number;
  correctPairs: number;
  accuracy: number;
  positionBias: number;
  passed: boolean;
  failReasons: string[];
  hygieneExcluded: number;
}

function scoreCalibration(
  pairs: LivenessCalibrationPair[],
  verdicts: LivenessPairVerdict[],
  modelName: string,
  hygieneExcluded: number,
): LivenessCalibrationResult {
  const byId = new Map(verdicts.map((v) => [v.pairId, v]));
  let correct = 0;
  let wrong = 0;
  let undecided = 0;
  let positionBiased = 0;

  for (const pair of pairs) {
    const verdict = byId.get(pair.pairId);
    if (!verdict || (!verdict.runs.length && verdict.errors.length)) continue;
    if (verdict.positionBias) {
      positionBiased++;
      continue;
    }
    if (verdict.winner === 'tie') {
      undecided++;
      continue;
    }
    if (verdict.winner === pair.humanSide) {
      correct++;
    } else {
      wrong++;
    }
  }

  const decided = correct + wrong;
  const accuracy = decided > 0 ? correct / decided : 0;
  const totalForBias = pairs.length;
  const positionBiasRate =
    totalForBias > 0 ? positionBiased / totalForBias : 0;

  const failReasons: string[] = [];
  if (decided < LIVENESS_CALIBRATION_MIN_PAIRS) {
    failReasons.push(
      `valid pairs ${decided} < ${LIVENESS_CALIBRATION_MIN_PAIRS} minimum`,
    );
  }
  if (accuracy <= LIVENESS_CALIBRATION_PASS_THRESHOLD) {
    failReasons.push(
      `accuracy ${(accuracy * 100).toFixed(1)}% <= ${LIVENESS_CALIBRATION_PASS_THRESHOLD * 100}% threshold`,
    );
  }
  if (positionBiasRate > LIVENESS_CALIBRATION_MAX_BIAS) {
    failReasons.push(
      `position bias ${(positionBiasRate * 100).toFixed(1)}% > ${LIVENESS_CALIBRATION_MAX_BIAS * 100}% maximum`,
    );
  }

  return {
    promptSha: LIVENESS_JUDGE_PROMPT_SHA,
    modelName,
    totalPairs: pairs.length,
    validPairs: decided,
    discardedPairs: positionBiased + undecided,
    correctPairs: correct,
    accuracy,
    positionBias: positionBiasRate,
    passed: failReasons.length === 0,
    failReasons,
    hygieneExcluded,
  };
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

export async function runLivenessCalibration(
  llm: LLMClient,
  modelName: string,
  samples: { human: LivenessSample[]; ai: LivenessSample[] },
  maxPairs: number = 100,
): Promise<LivenessCalibrationResult> {
  const { pairs, hygieneExcluded } = buildLivenessCalibrationPairs(
    samples.human,
    samples.ai,
    maxPairs,
  );
  const inputs = toPairInputs(pairs);
  const verdicts = await judgeLivenessPairs(llm, inputs);
  const result = scoreCalibration(pairs, verdicts, modelName, hygieneExcluded);

  // Write run log
  const run: RunRecord = {
    kind: 'liveness-calibration',
    modelName,
    promptSha: LIVENESS_JUDGE_PROMPT_SHA,
    commitSha: 'unknown',
    params: {
      totalPairs: pairs.length,
      hygieneExcluded,
      accuracyThreshold: LIVENESS_CALIBRATION_PASS_THRESHOLD,
      minValidPairs: LIVENESS_CALIBRATION_MIN_PAIRS,
      maxBias: LIVENESS_CALIBRATION_MAX_BIAS,
    },
    results: {
      passed: result.passed,
      accuracy: result.accuracy,
      validPairs: result.validPairs,
      positionBias: result.positionBias,
      failReasons: result.failReasons,
    },
    details: [],
  };
  writeRun(run);

  return result;
}

/**
 * Verify that a passing liveness calibration exists for the given
 * model + prompt SHA. Throws if not.
 */
export function requireLivenessCalibration(modelName: string): void {
  const cal = findCalibrationRun(modelName, LIVENESS_JUDGE_PROMPT_SHA);
  if (!cal) {
    throw new Error(
      `No liveness calibration found for model="${modelName}" ` +
        `promptSha="${LIVENESS_JUDGE_PROMPT_SHA}". ` +
        'Run liveness calibration first with manually curated human samples.',
    );
  }
  // Check if the kind matches liveness
  if (cal.kind !== 'liveness-calibration') {
    // Fall back: any calibration that passed for this model+sha is acceptable
    if (!cal.results.passed) {
      throw new Error(
        `Calibration for model="${modelName}" did not pass. ` +
          'Cannot run liveness evaluation with failed calibration.',
      );
    }
    return;
  }
  if (!cal.results.passed) {
    throw new Error(
      `Liveness calibration for model="${modelName}" did not pass. ` +
        'Cannot run liveness evaluation with failed calibration.',
    );
  }
}
