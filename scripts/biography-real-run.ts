#!/usr/bin/env npx tsx
/**
 * Real-model biography generation: run court + biography against a real LLM.
 *
 * Usage: LLM_BUDGET_CALLS=40 npx tsx scripts/biography-real-run.ts
 *
 * Writes results to docs/biography-run.md.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '@openmimic/kernel';
import { EventBus, PluginHost } from '@openmimic/kernel';
import { Router } from '@openmimic/server';
import { OpenAICompatClient, runCourt } from '@openmimic/engine-court';
import { silenceSignalPlugin } from '@openmimic/silence-signal';
import { outputBiographyPlugin, generateBiography, type GenerationResult } from '@openmimic/output-biography';
import {
  DEMO_WITNESSES,
  demoSubject,
  demoTestimonies,
  demoWitnesses,
} from '@openmimic/fixtures';
import {
  getUsageSummary,
  formatUsageSummary,
  BudgetExceededError,
  InsufficientBalanceError,
} from '@openmimic/shared';

// Load .env manually (no dotenv dependency)
try {
  const envPath = resolve(import.meta.dirname ?? '.', '..', '.env');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // .env not found, rely on existing env vars
}

// Set budget
if (!process.env.LLM_BUDGET_CALLS) {
  process.env.LLM_BUDGET_CALLS = '40';
}

const OUTPUT_FILE = resolve(import.meta.dirname ?? '.', '..', 'docs', 'biography-run.md');

async function main() {
  const llm = new OpenAICompatClient();
  if (!llm.configured) {
    console.error('LLM not configured. Set LLM_BASE_URL and LLM_MODEL in .env');
    process.exit(1);
  }

  console.log('Setting up store with demo data...');
  const dbPath = '/tmp/openmimic-biography-run.db';
  const store = new Store({ path: dbPath });

  // Seed demo data
  const subject = demoSubject();
  store.putSubject(subject);
  for (const w of demoWitnesses()) {
    store.putWitness(w);
  }
  for (const t of demoTestimonies()) {
    store.addTestimony(t);
  }

  // Run court first to get claims and episodes
  console.log('Running court...');
  try {
    const courtResult = await runCourt(subject.id, store, llm);
    console.log(`Court finished: ${courtResult.report?.totalClaims ?? 0} claims, ${courtResult.report?.episodeCount ?? 0} episodes`);
  } catch (err) {
    if (err instanceof InsufficientBalanceError || err instanceof BudgetExceededError) {
      console.error(`Budget/balance error during court: ${err.message}`);
      writeOutput(null, `Court failed: ${err.message}`, store);
      store.close();
      process.exit(0);
    }
    throw err;
  }

  // Generate biography
  console.log('Generating biography...');
  let result: GenerationResult;
  try {
    result = await generateBiography(llm, store, subject.id, {
      minWitnesses: 3,
      qualityThreshold: 75,
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError || err instanceof BudgetExceededError) {
      console.error(`Budget/balance error during biography: ${err.message}`);
      writeOutput(null, `Biography generation failed: ${err.message}`, store);
      store.close();
      process.exit(0);
    }
    throw err;
  }

  // Add silence note manually (no plugin host in script mode)
  result.biography.silenceNote = null;

  writeOutput(result, null, store);
  store.close();
  console.log(`Done. Output written to ${OUTPUT_FILE}`);
}

function writeOutput(result: GenerationResult | null, error: string | null, store: Store) {
  const usage = getUsageSummary();
  const lines: string[] = [];
  lines.push('# Biography Real Run');
  lines.push('');
  lines.push(`> Generated at ${new Date().toISOString()}`);
  lines.push(`> Subject: limo (demo)`);
  lines.push(`> Model: ${process.env.LLM_MODEL ?? 'unknown'}`);
  lines.push('');

  if (error) {
    lines.push('## Error');
    lines.push('');
    lines.push(error);
    lines.push('');
  }

  if (result) {
    const bio = result.biography;
    lines.push('## Biography');
    lines.push('');
    lines.push(`**${bio.title}**`);
    lines.push('');

    for (const section of bio.sections) {
      lines.push(`### ${section.chapterNo}. ${section.title}`);
      lines.push('');
      for (const para of section.paragraphs) {
        if (para.attribution) {
          lines.push(`*${para.attribution.displayName}:*`);
        }
        lines.push(para.text);
        if (para.conflict) {
          lines.push('*(conflicting account)*');
        }
        lines.push('');
      }
    }

    if (bio.silenceNote) {
      lines.push('### Silence');
      lines.push('');
      lines.push(bio.silenceNote);
      lines.push('');
    }

    lines.push('## Validation');
    lines.push('');
    if (result.validationFailures.size === 0) {
      lines.push('All chapters passed validation.');
    } else {
      for (const [chapterNo, failures] of result.validationFailures) {
        lines.push(`Chapter ${chapterNo}: ${failures.length} failure(s)`);
        for (const f of failures) {
          lines.push(`  - para ${f.paragraphIndex}: ${f.reason}`);
        }
      }
    }
    lines.push('');

    lines.push('## Quality Review');
    lines.push('');
    for (const [chapterNo, qr] of result.qualityResults) {
      lines.push(`Chapter ${chapterNo}: score=${qr.score}, requiresRewrite=${qr.requiresRewrite}`);
      for (const dim of qr.dimensions) {
        const issueStr = dim.issues.length > 0 ? ` [${dim.issues.join(', ')}]` : '';
        lines.push(`  - ${dim.key}: ${dim.score}${issueStr}`);
      }
    }
    lines.push('');

    lines.push('## Usage');
    lines.push('');
    lines.push(`Total LLM calls in biography: ${result.usageStats.totalCalls}`);
    lines.push(`Purposes: ${JSON.stringify(result.usageStats.purposes)}`);
    lines.push('');
  }

  lines.push('## Global Usage Summary');
  lines.push('');
  lines.push('```');
  lines.push(formatUsageSummary(usage));
  lines.push('```');
  lines.push('');

  lines.push('## Self-assessment');
  lines.push('');
  lines.push('(To be filled after reading the output.)');

  writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf-8');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
