#!/usr/bin/env tsx
/**
 * CLI: npm run eval:round3
 *
 * Round 3 evaluation plan (code ready, NOT executed — awaiting real human data):
 *
 * Priority 1: Stability K=3 with batch semantic matching + divergence overlap
 * Priority 2: Witness count curve v2 (n=2..6, 2 subsets, each run 2x)
 * Priority 3: Ablation 4-arm (full vs baseline/claims-stripped/episodes-stripped/self-report-only)
 *             with maxQuestionsPerWitness=4 for >=24 valid pairs
 * Priority 5: Calibration with 12 new fact-reversal pairs (86 total)
 * Priority 4: Twin-2K-500 adapter (separate script)
 *
 * Budget: LLM_BUDGET_TOKENS=900000
 *
 * NOT RUNNING: per project owner decision, no real model calls on fabricated demo data.
 * All tasks marked "未运行: 按项目主人决定,等真人数据后再跑" in the ledger.
 */

import { loadEnv } from './env';
loadEnv();
import { createEvalLLM } from './eval-llm';
import { OpenAICompatClient } from '@openmimic/engine-court';
import { Store } from '@openmimic/kernel';
import { seedDemo, DEMO_SUBJECT_ID } from '@openmimic/fixtures';
import { runCalibration } from './calibrate';
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
  console.error(`[Round3] Model: ${modelName}`);
  console.error(`[Round3] Start time: ${new Date().toISOString()}`);
  console.error(`[Round3] Budget: LLM_BUDGET_TOKENS=${process.env.LLM_BUDGET_TOKENS ?? 'unlimited'}`);

  const results: Record<string, unknown> = {};

  // Priority 5: Calibration (includes 12 new fact-reversal pairs, 86 total)
  console.error('\n=== Step 1: Calibration (86 pairs, incl. 12 fact-reversal) ===');
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
  console.error(`[Round3] Calibration: ${calResult.passed ? 'PASSED' : 'FAILED'} (${(calResult.accuracy * 100).toFixed(1)}%, ${calResult.totalPairs} pairs, ${calDuration}ms)`);

  if (!calResult.passed) {
    console.error('[Round3] Calibration failed — aborting.');
    writeFileSync('/tmp/eval-round3-results.json', JSON.stringify(results, null, 2));
    process.exit(1);
  }

  // Priority 1: Stability K=3 with batch semantic matching
  console.error('\n=== Step 2: Stability K=3 (bigram + batch LLM matching) ===');
  const store1 = new Store();
  seedDemo(store1);
  const stabStart = Date.now();
  const stabResult = await runStability(DEMO_SUBJECT_ID, store1, courtClient, Store, {
    modelName,
    K: 3,
    maxSubsets: 2,
    matchLlm: evalClient,
    curveV2: true,
    curveV2Subsets: 2,
    progressFile: '/tmp/eval-round3-stability-progress.json',
  });
  const stabDuration = Date.now() - stabStart;
  results.stability = {
    repeat: stabResult.repeat,
    curveV2: stabResult.curveV2,
    durationMs: stabDuration,
  };
  console.error(`[Round3] Stability — bigram: ${(stabResult.repeat.overlap.mean * 100).toFixed(1)}%, LLM: ${stabResult.repeat.overlapLlm ? (stabResult.repeat.overlapLlm.mean * 100).toFixed(1) : 'N/A'}% (${stabDuration}ms)`);
  store1.close();

  // Priority 3: Ablation 4-arm (with selfReportArm, 4 questions per witness)
  console.error('\n=== Step 3: Ablation 4-arm (incl. self-report) ===');
  const store2 = new Store();
  seedDemo(store2);
  const ablStart = Date.now();
  const ablResult = await runAblation(DEMO_SUBJECT_ID, store2, courtClient, evalClient, Store, {
    modelName,
    maxQuestionsPerWitness: 4,
    selfReportArm: true,
    progressFile: '/tmp/eval-round3-ablation-progress.json',
  });
  const ablDuration = Date.now() - ablStart;
  results.ablation = {
    overall: ablResult.overall,
    durationMs: ablDuration,
  };
  console.error(`[Round3] Ablation — bl: ${(ablResult.overall.vsBaseline.personaWinRate * 100).toFixed(1)}%, cs: ${(ablResult.overall.vsClaimsStripped.personaWinRate * 100).toFixed(1)}%, es: ${(ablResult.overall.vsEpisodesStripped.personaWinRate * 100).toFixed(1)}%${ablResult.overall.vsSelfReport ? `, sr: ${(ablResult.overall.vsSelfReport.personaWinRate * 100).toFixed(1)}%` : ''} (${ablDuration}ms)`);
  store2.close();

  // Summary
  const totalDuration = Date.now() - startTime;
  results.totalDurationMs = totalDuration;
  results.endTime = new Date().toISOString();
  results.usage = getUsageSummary();

  console.error(`\n=== Round 3 Complete ===`);
  console.error(`Total duration: ${(totalDuration / 1000 / 60).toFixed(1)} minutes`);
  console.error('\n' + formatUsageSummary());

  writeFileSync('/tmp/eval-round3-results.json', JSON.stringify(results, null, 2));
  console.error('Results written to /tmp/eval-round3-results.json');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error('\n' + formatUsageSummary());
  if (err instanceof BudgetExceededError || err instanceof InsufficientBalanceError) {
    console.error(`Round 3 stopped: ${err.message}`);
    writeFileSync('/tmp/eval-round3-results.json', JSON.stringify({
      error: err.message,
      usage: getUsageSummary(),
    }, null, 2));
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});
