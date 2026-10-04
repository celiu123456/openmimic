#!/usr/bin/env tsx
/**
 * CLI: npm run eval:lowo -- --subject <id>
 *
 * Runs Leave-One-Witness-Out evaluation for a subject.
 */

import { loadEnv } from './env';
loadEnv();
import { createEvalLLM } from './eval-llm';
import { Store } from '@openmimic/kernel';
import { seedDemo, DEMO_SUBJECT_ID } from '@openmimic/fixtures';
import { runLowo } from './lowo';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subjectIdx = args.indexOf('--subject');
  const subjectId = subjectIdx >= 0 && args[subjectIdx + 1] ? args[subjectIdx + 1] : DEMO_SUBJECT_ID;

  const maxQIdx = args.indexOf('--max-questions');
  const maxQuestionsPerWitness = maxQIdx >= 0 && args[maxQIdx + 1] ? parseInt(args[maxQIdx + 1], 10) : 3;

  const client = createEvalLLM();

  if (!client.configured) {
    console.error('LLM not configured: set LLM_BASE_URL and LLM_MODEL in .env');
    process.exit(1);
  }

  const modelName = process.env.LLM_MODEL ?? 'unknown';
  console.log(`Running LOWO for subject: ${subjectId}, model: ${modelName}, maxQ=${maxQuestionsPerWitness}`);

  // Load demo data
  const store = new Store();
  if (subjectId === DEMO_SUBJECT_ID) {
    seedDemo(store);
  }

  try {
    const result = await runLowo(subjectId, store, client, Store, {
      modelName,
      maxQuestionsPerWitness,
    });

    console.log('\n=== LOWO Results ===');
    console.log(`Subject:            ${result.subjectId}`);
    console.log(`Valid pairs:        ${result.totalValidPairs}`);
    console.log(`Discarded pairs:    ${result.totalDiscardedPairs}`);
    console.log(`Persona win rate:   ${(result.personaWinRate * 100).toFixed(1)}%`);
    console.log(`Wilson 95% CI:      [${(result.wilson95.lower * 100).toFixed(1)}%, ${(result.wilson95.upper * 100).toFixed(1)}%]`);

    console.log('\nBy witness:');
    for (const wr of result.witnessResults) {
      console.log(`  ${wr.relation} (${wr.witnessId}): ${wr.personaWins}W ${wr.baselineWins}L ${wr.discarded}D`);
    }

    console.log('\nBy relation:');
    for (const [rel, data] of Object.entries(result.byRelation)) {
      console.log(`  ${rel}: ${data.wins}/${data.total} = ${(data.rate * 100).toFixed(1)}%`);
    }
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
