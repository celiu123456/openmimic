#!/usr/bin/env npx tsx
/**
 * Real-model biography generation: run court + biography against a real LLM.
 *
 * Two modes:
 *   1. Full run: seeds demo data, runs court, then biography.
 *   2. Reuse court: if /tmp/openmimic-biography-court.db exists (from a previous
 *      court run), skips court and only runs biography generation.
 *
 * Usage:
 *   # Full run (court + biography):
 *   LLM_BUDGET_CALLS=80 npx tsx scripts/biography-real-run.ts
 *
 *   # Biography-only (reuses court DB):
 *   LLM_BUDGET_CALLS=15 npx tsx scripts/biography-real-run.ts --reuse-court
 *
 * Writes results to docs/biography-run.md.
 */
import { writeFileSync, readFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '@openmimic/kernel';
import { OpenAICompatClient, runCourt } from '@openmimic/engine-court';
import { generateBiography, buildMaterialBuckets, type GenerationResult } from '@openmimic/output-biography';
import {
  demoSubject,
  demoTestimonies,
  demoWitnesses,
} from '@openmimic/fixtures';
import {
  getUsageSummary,
  formatUsageSummary,
  resetUsage,
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

const COURT_DB = '/tmp/openmimic-biography-court.db';
const BIO_DB = '/tmp/openmimic-biography-run.db';
const OUTPUT_FILE = resolve(import.meta.dirname ?? '.', '..', 'docs', 'biography-run.md');
const reuseCourt = process.argv.includes('--reuse-court');

async function main() {
  const llm = new OpenAICompatClient();
  if (!llm.configured) {
    console.error('LLM not configured. Set LLM_BASE_URL and LLM_MODEL in .env');
    process.exit(1);
  }

  let store: Store;
  let courtUsageSummary = '';

  if (reuseCourt && existsSync(COURT_DB)) {
    console.log('Reusing court DB from previous run...');
    try { unlinkSync(BIO_DB); } catch { /* ok */ }
    copyFileSync(COURT_DB, BIO_DB);
    store = new Store({ path: BIO_DB });
    resetUsage();
    courtUsageSummary = '(court reused from previous run)';
  } else {
    console.log('Setting up store with demo data...');
    for (const p of [COURT_DB, BIO_DB]) {
      try { unlinkSync(p); } catch { /* ok */ }
    }
    store = new Store({ path: BIO_DB });

    const subject = demoSubject();
    store.putSubject(subject);
    for (const w of demoWitnesses()) store.putWitness(w);
    for (const t of demoTestimonies()) store.addTestimony(t);

    console.log('Running court...');
    try {
      const courtResult = await runCourt(subject.id, store, llm);
      console.log(`Court finished: ${courtResult.report?.totalClaims ?? 0} claims, ${courtResult.report?.episodeCount ?? 0} episodes`);
    } catch (err) {
      if (err instanceof InsufficientBalanceError || err instanceof BudgetExceededError) {
        console.error(`Budget/balance error during court: ${err.message}`);
        writeOutput(null, `Court failed: ${err.message}`, courtUsageSummary);
        store.close();
        process.exit(0);
      }
      throw err;
    }

    courtUsageSummary = formatUsageSummary(getUsageSummary());

    // Save court DB for reuse
    store.close();
    copyFileSync(BIO_DB, COURT_DB);
    store = new Store({ path: BIO_DB });
    resetUsage();

    // Set biography-only budget for the remaining work
    process.env.LLM_BUDGET_CALLS = '15';
  }

  // Diagnostic: dump material buckets
  const subjectId = 'limo';
  const witnesses = store.listWitnessesBySubject(subjectId);
  const testimonies = store.listBySubject(subjectId);
  const episodes = store.listEpisodesBySubject(subjectId);
  const claims = store.listClaimsBySubject(subjectId);
  const { buckets, quotableIndex } = buildMaterialBuckets(witnesses, testimonies, episodes, claims);

  console.log(`Material: ${buckets.length} buckets, ${quotableIndex.length} quotable entries`);

  // Generate biography
  console.log('Generating biography...');
  let result: GenerationResult;
  try {
    result = await generateBiography(llm, store, subjectId, {
      minWitnesses: 3,
      qualityThreshold: 75,
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError || err instanceof BudgetExceededError) {
      console.error(`Budget/balance error during biography: ${err.message}`);
      writeOutput(null, `Biography generation failed: ${err.message}`, courtUsageSummary, buckets.length, quotableIndex.length);
      store.close();
      process.exit(0);
    }
    throw err;
  }

  result.biography.silenceNote = null;
  writeOutput(result, null, courtUsageSummary, buckets.length, quotableIndex.length);
  store.close();
  console.log(`Done. Output written to ${OUTPUT_FILE}`);
}

function writeOutput(
  result: GenerationResult | null,
  error: string | null,
  courtUsage: string,
  bucketCount?: number,
  quotableCount?: number,
) {
  const usage = getUsageSummary();

  // Read existing file to preserve first run as comparison
  let existingContent = '';
  try {
    existingContent = readFileSync(OUTPUT_FILE, 'utf-8');
  } catch { /* first run */ }

  const lines: string[] = [];
  lines.push('# Biography Real Run');
  lines.push('');

  // If there's existing content and doesn't already have the "first run" label,
  // preserve it as first-run comparison section
  if (existingContent.length > 0 && !existingContent.includes('第一次')) {
    lines.push('## 第一次:管线故障');
    lines.push('');
    const oldBody = existingContent.replace(/^# Biography Real Run\n+/, '');
    lines.push(oldBody);
    lines.push('');
    lines.push('---');
    lines.push('');
  } else if (existingContent.includes('第一次')) {
    // Already has first-run section; extract it
    const marker = '---';
    const idx = existingContent.indexOf(marker);
    if (idx > 0) {
      lines.push(existingContent.slice(existingContent.indexOf('## 第一次'), idx + marker.length));
      lines.push('');
    }
  }

  lines.push('## 第二次:修正后');
  lines.push('');
  lines.push(`> Generated at ${new Date().toISOString()}`);
  lines.push(`> Subject: limo (demo)`);
  lines.push(`> Model: ${process.env.LLM_MODEL ?? 'unknown'}`);
  lines.push(`> Buckets: ${bucketCount ?? '?'}, Quotable entries: ${quotableCount ?? '?'}`);
  lines.push('');

  if (error) {
    lines.push('### Error');
    lines.push('');
    lines.push(error);
    lines.push('');
  }

  if (result) {
    const bio = result.biography;
    lines.push('### Biography');
    lines.push('');
    lines.push(`**${bio.title}**`);
    lines.push('');

    for (const section of bio.sections) {
      lines.push(`#### ${section.chapterNo}. ${section.title}`);
      lines.push('');
      for (const para of section.paragraphs) {
        if (para.attribution) {
          lines.push(`*${para.attribution.displayName}:*`);
        }
        lines.push(para.text);
        if (para.conflict) {
          lines.push('*(分歧记录)*');
        }
        lines.push('');
      }
    }

    if (bio.silenceNote) {
      lines.push('#### 沉默');
      lines.push('');
      lines.push(bio.silenceNote);
      lines.push('');
    }

    lines.push('### Validation');
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

    lines.push('### Quality Review');
    lines.push('');
    for (const [chapterNo, qr] of result.qualityResults) {
      lines.push(`Chapter ${chapterNo}: score=${qr.score}, requiresRewrite=${qr.requiresRewrite}`);
      for (const dim of qr.dimensions) {
        const issueStr = dim.issues.length > 0 ? ` [${dim.issues.join(', ')}]` : '';
        lines.push(`  - ${dim.key}: ${dim.score}${issueStr}`);
      }
    }
    lines.push('');

    lines.push('### Usage (biography only)');
    lines.push('');
    lines.push(`Total LLM calls: ${result.usageStats.totalCalls}`);
    lines.push(`Purposes: ${JSON.stringify(result.usageStats.purposes)}`);
    lines.push('');
  }

  if (courtUsage) {
    lines.push('### Court Usage');
    lines.push('');
    lines.push('```');
    lines.push(courtUsage);
    lines.push('```');
    lines.push('');
  }

  lines.push('### Global Usage Summary (biography phase)');
  lines.push('');
  lines.push('```');
  lines.push(formatUsageSummary(usage));
  lines.push('```');
  lines.push('');

  lines.push('### Self-assessment');
  lines.push('');
  lines.push('(To be filled after reading the output.)');

  writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf-8');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
