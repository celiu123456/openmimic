#!/usr/bin/env npx tsx
/**
 * Room realism iteration: generate a behind + front room for 林默 using a real
 * LLM, measure with room-metrics, and append a run to docs/room-realism-runs.md.
 *
 * Usage: npx tsx scripts/room-realism-run.ts [run_number]
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '@openmimic/kernel';
import { OpenAICompatClient } from '@openmimic/engine-court';
import { runBehindRoom, openDoor } from '@openmimic/engine-room';
import {
  seedDemo,
  DEMO_SUBJECT_ID,
  DEMO_WITNESSES,
} from '../fixtures/limo';
import type { RoomUtterance } from '@openmimic/shared';
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
  const runNumber = parseInt(process.argv[2] ?? '1', 10);
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;

  if (!baseUrl || !apiKey || !model) {
    console.error('room-realism-run: LLM not configured');
    process.exit(1);
  }

  const dbPath = `/tmp/room-realism-run-${runNumber}-${Date.now()}.db`;
  const store = new Store({ path: dbPath });
  console.log(`Run ${runNumber} | DB: ${dbPath} | Model: ${model}`);

  seedDemo(store);

  const llm = new OpenAICompatClient({ baseUrl, apiKey, model, timeoutMs: 120_000 });

  // Generate behind room
  console.log('Generating behind room...');
  const room = await runBehindRoom(DEMO_SUBJECT_ID, store, llm);
  console.log(`Behind: ${room.behindTranscript.length} utterances`);

  // Open door
  console.log('Opening door...');
  const doorRoom = await openDoor(room.id, store, llm);
  const frontLen = doorRoom.frontTranscript?.length ?? 0;
  console.log(`Front: ${frontLen} utterances`);

  // Build metrics
  const testimonies = DEMO_WITNESSES.map((w) => ({
    witnessId: w.id,
    answers: w.answers.map((a) => ({ qid: a.qid, behindText: a.behindText })),
  }));
  const privateFragments = extractPrivateFragments(testimonies);

  // Extract frontText and behindText entries for new metrics
  const frontTextEntries: FrontTextInfo[] = DEMO_WITNESSES.flatMap((w) =>
    w.answers
      .filter((a) => (a.frontText ?? '').length > 0)
      .map((a) => ({ witnessId: w.id, qid: a.qid, frontText: a.frontText as string })),
  );
  const behindTextEntries: BehindTextInfo[] = DEMO_WITNESSES.flatMap((w) =>
    w.answers
      .filter((a) => a.behindText.length > 0)
      .map((a) => ({ witnessId: w.id, qid: a.qid, behindText: a.behindText })),
  );

  const report = buildReport(
    room.behindTranscript,
    doorRoom.frontTranscript,
    privateFragments,
    frontTextEntries,
    behindTextEntries,
  );
  const checks = checkCriteria(report);

  // Witness labels
  const witnesses = store.listWitnessesBySubject(DEMO_SUBJECT_ID);
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
    `## Run ${runNumber}`,
    '',
    `Date: ${new Date().toISOString()}`,
    `Model: ${model}`,
    '',
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
    '### Front Transcript (full)',
    '',
    ...(doorRoom.frontTranscript ?? []).map(formatUtt),
    '',
  ];

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

  store.close();
}

main().catch((e) => {
  console.error('room-realism-run failed:', e);
  process.exit(1);
});
