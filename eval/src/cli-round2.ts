#!/usr/bin/env tsx
/**
 * CLI: npm run eval:round2
 *
 * Runs the complete round-2 evaluation:
 * 1. Calibration (including new adversarial pairs)
 * 2. LOWO with persona composition tracking
 * 3. Ablation arm (full vs baseline, full vs claims-stripped, full vs episodes-stripped)
 * 4. Stability with semantic matching and v2 curve
 *
 * Designed for setsid nohup usage with JSON progress output.
 */

import { loadEnv } from './env';
loadEnv();
import { createEvalLLM } from './eval-llm';
import { OpenAICompatClient } from '@openmimic/engine-court';
import { Store } from '@openmimic/kernel';
import { seedDemo, DEMO_SUBJECT_ID } from '@openmimic/fixtures';
import { runCalibration } from './calibrate';
import { runLowo } from './lowo';
import { runAblation } from './ablation';
import { runStability } from './stability';
import { writeFileSync } from 'node:fs';
import {
  getUsageSummary,
  formatUsageSummary,
  BudgetExceededError,
  InsufficientBalanceError,
} from '@openmimic/shared';

async function main(): Promise<void> {
  const startTime = Date.now();

  const courtClient = new OpenAICompatClient({ timeoutMs: 120_000 });
  const evalClient = createEvalLLM();

  if (!courtClient.configured || !evalClient.configured) {
    console.error('LLM not configured: set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL in .env');
    process.exit(1);
  }

  const modelName = process.env.LLM_MODEL ?? 'unknown';
  console.error(`[Round2] Model: ${modelName}`);
  console.error(`[Round2] Start time: ${new Date().toISOString()}`);

  const results: Record<string, unknown> = {};

  // 1. Calibration
  console.error('\n=== Step 1: Calibration ===');
  const calStart = Date.now();
  const calResult = await runCalibration(evalClient, modelName);
  const calDuration = Date.now() - calStart;
  results.calibration = {
    passed: calResult.passed,
    totalPairs: calResult.totalPairs,
    validPairs: calResult.validPairs,
    accuracy: calResult.accuracy,
    positionBias: calResult.positionBias,
    easy: calResult.easy,
    hard: calResult.hard,
    durationMs: calDuration,
  };
  console.error(`[Round2] Calibration: ${calResult.passed ? 'PASSED' : 'FAILED'} (${calResult.accuracy * 100}%, ${calDuration}ms)`);

  if (!calResult.passed) {
    console.error('[Round2] Calibration failed — aborting.');
    writeFileSync('/tmp/eval-round2-results.json', JSON.stringify(results, null, 2));
    process.exit(1);
  }

  // 2. LOWO with persona composition tracking
  console.error('\n=== Step 2: LOWO ===');
  const store = new Store();
  seedDemo(store);

  const lowoStart = Date.now();
  const lowoResult = await runLowo(DEMO_SUBJECT_ID, store, courtClient, evalClient, Store, {
    modelName,
    maxQuestionsPerWitness: 3,
    progressFile: '/tmp/eval-round2-lowo-progress.json',
  });
  const lowoDuration = Date.now() - lowoStart;
  results.lowo = {
    personaWinRate: lowoResult.personaWinRate,
    wilson95: lowoResult.wilson95,
    totalValidPairs: lowoResult.totalValidPairs,
    totalDiscardedPairs: lowoResult.totalDiscardedPairs,
    durationMs: lowoDuration,
    witnesses: lowoResult.witnessResults.map((wr) => ({
      witnessId: wr.witnessId,
      relation: wr.relation,
      personaWins: wr.personaWins,
      baselineWins: wr.baselineWins,
      discarded: wr.discarded,
      courtStats: wr.courtStats,
      personaComposition: wr.personaComposition,
    })),
  };
  console.error(`[Round2] LOWO: ${(lowoResult.personaWinRate * 100).toFixed(1)}% (${lowoResult.totalValidPairs} valid, ${lowoResult.totalDiscardedPairs} discarded, ${lowoDuration}ms)`);
  store.close();

  // 3. Ablation arm
  console.error('\n=== Step 3: Ablation ===');
  const store2 = new Store();
  seedDemo(store2);

  const ablStart = Date.now();
  const ablResult = await runAblation(DEMO_SUBJECT_ID, store2, courtClient, evalClient, Store, {
    modelName,
    maxQuestionsPerWitness: 3,
    progressFile: '/tmp/eval-round2-ablation-progress.json',
  });
  const ablDuration = Date.now() - ablStart;
  results.ablation = {
    overall: ablResult.overall,
    durationMs: ablDuration,
    witnesses: ablResult.witnessResults.map((wr) => ({
      witnessId: wr.witnessId,
      relation: wr.relation,
      courtStats: wr.courtStats,
      personaComposition: wr.personaComposition,
      vsBaseline: wr.vsBaseline,
      vsClaimsStripped: wr.vsClaimsStripped,
      vsEpisodesStripped: wr.vsEpisodesStripped,
    })),
  };
  console.error(`[Round2] Ablation — vsBaseline: ${(ablResult.overall.vsBaseline.personaWinRate * 100).toFixed(1)}%, vsClaimsStripped: ${(ablResult.overall.vsClaimsStripped.personaWinRate * 100).toFixed(1)}%, vsEpisodesStripped: ${(ablResult.overall.vsEpisodesStripped.personaWinRate * 100).toFixed(1)}% (${ablDuration}ms)`);
  store2.close();

  // 4. Stability with semantic matching and v2 curve
  console.error('\n=== Step 4: Stability ===');
  const store3 = new Store();
  seedDemo(store3);

  const stabStart = Date.now();
  const stabResult = await runStability(DEMO_SUBJECT_ID, store3, courtClient, Store, {
    modelName,
    K: 3,
    maxSubsets: 2,
    matchLlm: evalClient,
    curveV2: true,
    curveV2Subsets: 2,
    progressFile: '/tmp/eval-round2-stability-progress.json',
  });
  const stabDuration = Date.now() - stabStart;
  results.stability = {
    repeat: stabResult.repeat,
    curveV2: stabResult.curveV2,
    durationMs: stabDuration,
  };
  console.error(`[Round2] Stability — bigram: ${(stabResult.repeat.overlap.mean * 100).toFixed(1)}%, LLM: ${stabResult.repeat.overlapLlm ? (stabResult.repeat.overlapLlm.mean * 100).toFixed(1) : 'N/A'}% (${stabDuration}ms)`);
  if (stabResult.curveV2) {
    for (const pt of stabResult.curveV2) {
      console.error(`[Round2]   n=${pt.n}: bigram=${(pt.meanOverlapBigram * 100).toFixed(1)}%${pt.meanOverlapLlm !== undefined ? `, LLM=${(pt.meanOverlapLlm * 100).toFixed(1)}%` : ''}`);
    }
  }
  store3.close();

  // Summary
  const totalDuration = Date.now() - startTime;
  results.totalDurationMs = totalDuration;
  results.endTime = new Date().toISOString();
  results.usage = getUsageSummary();

  console.error(`\n=== Round 2 Complete ===`);
  console.error(`Total duration: ${(totalDuration / 1000 / 60).toFixed(1)} minutes`);
  console.error('\n' + formatUsageSummary());

  // Write results
  writeFileSync('/tmp/eval-round2-results.json', JSON.stringify(results, null, 2));
  console.error('Results written to /tmp/eval-round2-results.json');

  // Print summary to stdout
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error('\n' + formatUsageSummary());
  if (err instanceof BudgetExceededError || err instanceof InsufficientBalanceError) {
    console.error(`Round 2 stopped: ${err.message}`);
    // Save partial results
    writeFileSync('/tmp/eval-round2-results.json', JSON.stringify({
      error: err.message,
      usage: getUsageSummary(),
    }, null, 2));
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});
