#!/usr/bin/env tsx
/**
 * CLI: npm run eval:stability -- --subject <id>
 *
 * Runs court stability evaluation for a subject.
 * Supports incremental checkpointing via --progress <file>.
 */

import { loadEnv } from './env';
loadEnv();
import { createEvalLLM } from './eval-llm';
import { Store } from '@openmimic/kernel';
import { seedDemo, DEMO_SUBJECT_ID } from '@openmimic/fixtures';
import { runStability } from './stability';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subjectIdx = args.indexOf('--subject');
  const subjectId = subjectIdx >= 0 && args[subjectIdx + 1] ? args[subjectIdx + 1] : DEMO_SUBJECT_ID;

  const kIdx = args.indexOf('--K');
  const K = kIdx >= 0 && args[kIdx + 1] ? parseInt(args[kIdx + 1], 10) : 3;

  const subsetsIdx = args.indexOf('--max-subsets');
  const maxSubsets = subsetsIdx >= 0 && args[subsetsIdx + 1] ? parseInt(args[subsetsIdx + 1], 10) : 2;

  const progressIdx = args.indexOf('--progress');
  const progressFile = progressIdx >= 0 && args[progressIdx + 1] ? args[progressIdx + 1] : undefined;

  const client = createEvalLLM();

  if (!client.configured) {
    console.error('LLM not configured: set LLM_BASE_URL and LLM_MODEL in .env');
    process.exit(1);
  }

  const modelName = process.env.LLM_MODEL ?? 'unknown';
  console.log(`Running stability for subject: ${subjectId}, model: ${modelName}, K=${K}, maxSubsets=${maxSubsets}`);
  if (progressFile) console.log(`Checkpoint file: ${progressFile}`);

  // Load demo data
  const store = new Store();
  if (subjectId === DEMO_SUBJECT_ID) {
    seedDemo(store);
  }

  try {
    const result = await runStability(subjectId, store, client, Store, {
      modelName,
      K,
      maxSubsets,
      progressFile,
    });

    console.log('\n=== Stability Results ===');
    console.log(`Repeat runs (K=${result.repeat.K}):`);
    console.log(`  Claim counts: ${result.repeat.claimCounts.join(', ')}`);
    console.log(`  Overlap mean: ${(result.repeat.overlap.mean * 100).toFixed(1)}%`);
    console.log(`  Overlap std:  ${(result.repeat.overlap.stddev * 100).toFixed(1)}%`);

    console.log('\nWitness count curve:');
    for (const point of result.curve) {
      console.log(
        `  n=${point.n}: ${point.subsets} subsets, ` +
          `overlap=${(point.overlap.mean * 100).toFixed(1)}% +/- ${(point.overlap.stddev * 100).toFixed(1)}%`,
      );
    }
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
