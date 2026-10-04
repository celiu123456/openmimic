#!/usr/bin/env tsx
/**
 * CLI: npm run eval:calibrate
 *
 * Runs judge calibration against known-answer pairs.
 */

import { loadEnv } from './env';
loadEnv();
import { createEvalLLM } from './eval-llm';
import { runCalibration } from './calibrate';

async function main(): Promise<void> {
  const client = createEvalLLM();

  if (!client.configured) {
    console.error('LLM not configured: set LLM_BASE_URL and LLM_MODEL in .env');
    process.exit(1);
  }

  const modelName = process.env.LLM_MODEL ?? 'unknown';
  console.log(`Running calibration with model: ${modelName}`);

  const result = await runCalibration(client, modelName);

  console.log('\n=== Calibration Results ===');
  console.log(`Total pairs:    ${result.totalPairs}`);
  console.log(`Valid pairs:    ${result.validPairs}`);
  console.log(`Discarded:      ${result.discardedPairs}`);
  console.log(`Correct:        ${result.correctPairs}`);
  console.log(`Accuracy:       ${(result.accuracy * 100).toFixed(1)}%`);
  console.log(`Position bias:  ${(result.positionBias * 100).toFixed(1)}%`);
  console.log(`Passed:         ${result.passed ? 'YES' : 'NO'}`);

  if (!result.passed) {
    console.log('\nFail reasons:');
    for (const reason of result.failReasons) {
      console.log(`  - ${reason}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
