#!/usr/bin/env npx tsx
/**
 * Room realism iteration: generate a behind room (and optionally front room)
 * for a fixture using a real LLM, measure with room-metrics, and append a
 * run to docs/room-realism-runs.md.
 *
 * Usage:
 *   npx tsx scripts/room-realism-run.ts [run_number]              # 林默 (default)
 *   npx tsx scripts/room-realism-run.ts [run_number] --fixture suzhi  # 苏芷
 *   npx tsx scripts/room-realism-run.ts [run_number] --behind-only    # no front room
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '@openmimic/kernel';
import { OpenAICompatClient } from '@openmimic/engine-court';
import { runBehindRoom, openDoor, type RoomStats } from '@openmimic/engine-room';
import {
  seedDemo,
  DEMO_SUBJECT_ID,
  DEMO_WITNESSES,
} from '../fixtures/limo';
import {
  seedSuzhi,
  SUZHI_SUBJECT_ID,
  SUZHI_WITNESSES,
} from '../fixtures/suzhi';
import type { RoomUtterance } from '@openmimic/shared';
import {
  getUsageSummary,
  formatUsageSummary,
  writeUsageSummary,
  BudgetExceededError,
  InsufficientBalanceError,
} from '@openmimic/shared';
import {
  buildReport,
  formatReport,
  checkCriteria,
  extractPrivateFragments,
  type FrontTextInfo,
  type BehindTextInfo,
} from './room-metrics';

// Load .env manually
const envPath = resolve(process.cwd(), '.env');
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
} catch { /* no .env */ }

async function main() {
  const args = process.argv.slice(2);
  const runNumber = parseInt(args.find((a) => !a.startsWith('--')) ?? '1', 10);
  const fixtureName = args.includes('--fixture') ? args[args.indexOf('--fixture') + 1] : 'limo';
  const behindOnly = args.includes('--behind-only');

  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;

  if (!baseUrl || !apiKey || !model) {
    console.error('room-realism-run: LLM not configured');
    process.exit(1);
  }

  const dbPath = `/tmp/room-realism-run-${fixtureName}-${runNumber}-${Date.now()}.db`;
  const store = new Store({ path: dbPath });
  console.log(`Run ${runNumber} | Fixture: ${fixtureName} | DB: ${dbPath} | Model: ${model}`);

  // Select fixture
  type FixtureWitness = { id: string; answers: { qid: string; behindText: string; frontText?: string }[] };
  let subjectId: string;
  let fixtureWitnesses: readonly FixtureWitness[];

  if (fixtureName === 'suzhi') {
    seedSuzhi(store);
    subjectId = SUZHI_SUBJECT_ID;
    fixtureWitnesses = SUZHI_WITNESSES;
  } else {
    seedDemo(store);
    subjectId = DEMO_SUBJECT_ID;
    fixtureWitnesses = DEMO_WITNESSES;
  }

  const llm = new OpenAICompatClient({ baseUrl, apiKey, model, timeoutMs: 120_000 });

  // Generate behind room
  console.log('Generating behind room...');
  let roomStats: RoomStats | undefined;
  const room = await runBehindRoom(subjectId, store, llm, {
    onStats: (s) => { roomStats = s; },
  });
  console.log(`Behind: ${room.behindTranscript.length} utterances`);

  // Open door (unless behind-only)
  let frontTranscript: RoomUtterance[] | undefined;
  if (!behindOnly) {
    console.log('Opening door...');
    const doorRoom = await openDoor(room.id, store, llm);
    frontTranscript = doorRoom.frontTranscript;
    console.log(`Front: ${frontTranscript?.length ?? 0} utterances`);
  }

  // Build metrics
  const testimonies = fixtureWitnesses.map((w) => ({
    witnessId: w.id,
    answers: w.answers.map((a) => ({ qid: a.qid, behindText: a.behindText })),
  }));
  const privateFragments = extractPrivateFragments(testimonies);

  const frontTextEntries: FrontTextInfo[] = fixtureWitnesses.flatMap((w) =>
    w.answers
      .filter((a) => (a.frontText ?? '').length > 0)
      .map((a) => ({ witnessId: w.id, qid: a.qid, frontText: a.frontText as string })),
  );
  const behindTextEntries: BehindTextInfo[] = fixtureWitnesses.flatMap((w) =>
    w.answers
      .filter((a) => a.behindText.length > 0)
      .map((a) => ({ witnessId: w.id, qid: a.qid, behindText: a.behindText })),
  );

  const report = buildReport(
    room.behindTranscript,
    frontTranscript,
    privateFragments,
    frontTextEntries,
    behindTextEntries,
  );
  const checks = checkCriteria(report);

  // Witness labels
  const witnesses = store.listWitnessesBySubject(subjectId);
  const witnessRelation = new Map(witnesses.map((w) => [w.id, w.relation]));

  function formatUtt(u: RoomUtterance): string {
    const rel = witnessRelation.get(u.witnessId) ?? u.displayLabel;
    const tier = u.tier ?? 'extrapolate';
    const anchors = u.anchors?.length ? ` [anchors: ${u.anchors.map((a) => a.qid).join(',')}]` : '';
    if (u.kind === 'stage') return `  - [${tier}] ${rel}(${u.text})`;
    return `  - [${tier}] ${rel}: "${u.text}"${anchors}`;
  }

  // Build markdown
  const md: string[] = [
    `## Run ${runNumber} (${fixtureName})`,
    '',
    `Date: ${new Date().toISOString()}`,
    `Model: ${model}`,
    '',
  ];

  // No-talk list and verification stats
  if (roomStats) {
    md.push('### No-Talk List', '');
    md.push(`清单条数: ${roomStats.noTalkList.length}`, '');
    if (roomStats.noTalkList.length === 0) {
      md.push('(none)', '');
    } else {
      md.push('| Topic | Keywords | Blind Witness | Blind Claim | Knowing Witnesses | Severity | Reason |');
      md.push('|-------|----------|---------------|-------------|-------------------|----------|--------|');
      for (const item of roomStats.noTalkList) {
        const blindRel = witnessRelation.get(item.blindWitnessId) ?? item.blindWitnessId;
        const knowingRels = item.knowingWitnessIds
          .map((id) => witnessRelation.get(id) ?? id)
          .join(', ');
        const severity = item.severity ?? '-';
        const reason = item.reason ?? '-';
        md.push(`| ${item.topic} | ${item.keywords.join(', ')} | ${blindRel} | ${item.blindClaim} | ${knowingRels} | ${severity} | ${reason} |`);
      }
      md.push('');
    }

    md.push('### Room Statistics', '');
    md.push('| Metric | Value |');
    md.push('|--------|-------|');
    md.push(`| Verify calls | ${roomStats.verifyCallCount} |`);
    md.push(`| Lines blocked | ${roomStats.blockedCount} |`);
    md.push(`| Successful rewrites | ${roomStats.rewriteSuccessCount} |`);
    md.push(`| Stage directions | ${roomStats.stageDirectionCount} |`);
    md.push(`| Total LLM calls | ${roomStats.totalLlmCalls} |`);
    md.push('');
  }

  md.push(
    formatReport(report),
    '',
    '### Criteria Checks',
    '',
    '| Check | Pass | Detail |',
    '|-------|------|--------|',
    ...checks.map((c) => `| ${c.name} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.detail} |`),
    '',
    '### Behind Transcript (full)',
    '',
    ...room.behindTranscript.map(formatUtt),
    '',
  );

  if (frontTranscript) {
    md.push(
      '### Front Transcript (full)',
      '',
      ...frontTranscript.map(formatUtt),
      '',
    );
  }

  // Write to docs/room-realism-runs.md
  const outPath = resolve(process.cwd(), 'docs/room-realism-runs.md');
  let existing = '';
  if (existsSync(outPath)) {
    existing = readFileSync(outPath, 'utf8');
  } else {
    existing = '# Room Realism Iteration Runs\n\n';
  }
  writeFileSync(outPath, existing + md.join('\n') + '\n', 'utf8');
  console.log(`\nResults written to ${outPath}`);

  // Summary
  console.log('\n=== CRITERIA ===');
  const allPass = checks.every((c) => c.pass);
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);
  }
  console.log(`\nOverall: ${allPass ? 'ALL PASS' : 'SOME FAILED'}`);

  // Print and persist usage summary
  const usageSummary = getUsageSummary();
  console.log('\n' + formatUsageSummary(usageSummary));
  writeUsageSummary(`/tmp/room-realism-usage-${fixtureName}-${runNumber}.json`, usageSummary);

  // Append usage to the run doc
  const usageMd: string[] = ['### LLM Usage', ''];
  const sorted = Object.entries(usageSummary.buckets).sort(([a], [b]) => a.localeCompare(b));
  usageMd.push('| Bucket | Calls | Prompt Tokens | Completion Tokens | Cached |');
  usageMd.push('|--------|-------|---------------|-------------------|--------|');
  for (const [name, b] of sorted) {
    usageMd.push(`| ${name} | ${b.calls} | ${b.promptTokens} | ${b.completionTokens} | ${b.cachedTokens} |`);
  }
  const t = usageSummary.totals;
  usageMd.push(`| **TOTAL** | ${t.calls} | ${t.promptTokens} | ${t.completionTokens} | ${t.cachedTokens} |`);
  usageMd.push('');

  // Re-read and append usage section
  const currentDoc = readFileSync(outPath, 'utf8');
  writeFileSync(outPath, currentDoc + usageMd.join('\n') + '\n', 'utf8');

  store.close();
}

main().catch((e) => {
  // Print usage even on failure
  console.error('\n' + formatUsageSummary());
  if (e instanceof BudgetExceededError || e instanceof InsufficientBalanceError) {
    console.error(`room-realism-run stopped: ${e.message}`);
    process.exit(2);
  }
  console.error('room-realism-run failed:', e);
  process.exit(1);
});
