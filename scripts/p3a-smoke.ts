#!/usr/bin/env npx tsx
/**
 * P3a smoke test: generate a "behind" + "door open" room for 林默 using a real
 * LLM, record the tier distribution, and update docs/p3a-smoke.md.
 *
 * Usage: npx tsx scripts/p3a-smoke.ts
 *
 * Reads LLM credentials from .env.  Uses /tmp for the DB.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store, assemblePersonaContext } from '@openmimic/kernel';
import { OpenAICompatClient, runCourt } from '@openmimic/engine-court';
import { runBehindRoom, openDoor, tierDistribution, classifyUtterance } from '@openmimic/engine-room';
import {
  seedDemo,
  DEMO_SUBJECT_ID,
} from '../fixtures/limo';
import type { RoomUtterance } from '@openmimic/shared';

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
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;

  if (!baseUrl || !apiKey || !model) {
    console.error('p3a-smoke: LLM not configured');
    process.exit(1);
  }

  const dbPath = `/tmp/p3a-smoke-${Date.now()}.db`;
  const store = new Store({ path: dbPath });
  console.log(`DB: ${dbPath}`);
  console.log(`LLM: ${baseUrl} model=${model}`);

  seedDemo(store);
  console.log('Seeded 林默 demo data');

  const llm = new OpenAICompatClient({ baseUrl, apiKey, model, timeoutMs: 120_000 });

  // First, run court so there are claims (needed for persona assembly)
  console.log('Running court...');
  const courtSession = await runCourt(DEMO_SUBJECT_ID, store, llm);
  const claims = store.listClaimsBySubject(DEMO_SUBJECT_ID);
  console.log(`Court done: ${claims.length} claims`);

  // Generate behind room
  console.log('\nGenerating behind room...');
  const room = await runBehindRoom(DEMO_SUBJECT_ID, store, llm);
  console.log(`Behind room generated: ${room.behindTranscript.length} utterances`);

  // Open door
  console.log('Opening door...');
  const doorRoom = await openDoor(room.id, store, llm);
  const frontLen = doorRoom.frontTranscript?.length ?? 0;
  console.log(`Door opened: ${frontLen} front utterances`);

  // Tier distribution for behind transcript
  const behindDist = tierDistribution(room.behindTranscript);
  console.log(`\nBehind tier distribution: quote=${behindDist.quote} paraphrase=${behindDist.paraphrase} extrapolate=${behindDist.extrapolate}`);

  // Tier distribution for front transcript
  let frontDist = { quote: 0, paraphrase: 0, extrapolate: 0 };
  if (doorRoom.frontTranscript) {
    frontDist = tierDistribution(doorRoom.frontTranscript);
    console.log(`Front tier distribution: quote=${frontDist.quote} paraphrase=${frontDist.paraphrase} extrapolate=${frontDist.extrapolate}`);
  }

  // Check quote/paraphrase ratio
  const totalBehind = behindDist.quote + behindDist.paraphrase + behindDist.extrapolate;
  const anchoredBehind = behindDist.quote + behindDist.paraphrase;
  const anchoredRatio = totalBehind > 0 ? anchoredBehind / totalBehind : 0;
  console.log(`\nAnchored (quote+paraphrase) ratio: ${(anchoredRatio * 100).toFixed(0)}%`);

  // Sample utterances
  const sampleBehind = room.behindTranscript.slice(0, 5);
  const sampleFront = (doorRoom.frontTranscript ?? []).slice(0, 3);

  // Witnesses for relation labels
  const witnesses = store.listWitnessesBySubject(DEMO_SUBJECT_ID);
  const witnessRelation = new Map(witnesses.map((w) => [w.id, w.relation]));

  function formatUtterance(u: RoomUtterance): string {
    const relation = witnessRelation.get(u.witnessId) ?? u.displayLabel;
    const tier = u.tier ?? 'extrapolate';
    const anchors = u.anchors?.length ? ` [anchors: ${u.anchors.map((a) => a.qid).join(',')}]` : '';
    return `  - [${tier}] ${relation}: "${u.text.slice(0, 80)}${u.text.length > 80 ? '...' : ''}"${anchors}`;
  }

  // Build markdown
  const md = [
    '',
    `### Run 1`,
    '',
    `Date: ${new Date().toISOString()}`,
    `Model: ${model}`,
    `DB: ${dbPath}`,
    '',
    '#### Tier Distribution',
    '',
    '| Phase | quote | paraphrase | extrapolate | total |',
    '|-------|-------|------------|-------------|-------|',
    `| behind | ${behindDist.quote} | ${behindDist.paraphrase} | ${behindDist.extrapolate} | ${totalBehind} |`,
    `| front  | ${frontDist.quote} | ${frontDist.paraphrase} | ${frontDist.extrapolate} | ${frontDist.quote + frontDist.paraphrase + frontDist.extrapolate} |`,
    '',
    `Anchored ratio (behind): ${(anchoredRatio * 100).toFixed(0)}%`,
    '',
    '#### Example Behind Utterances',
    '',
    ...sampleBehind.map(formatUtterance),
    '',
    '#### Example Front Utterances',
    '',
    ...(sampleFront.length > 0 ? sampleFront.map(formatUtterance) : ['  (none)']),
    '',
    `#### Court Claims: ${claims.filter((c) => c.status === 'surviving').length} surviving / ${claims.length} total`,
    '',
  ];

  // Append to existing docs/p3a-smoke.md
  const outPath = resolve(process.cwd(), 'docs/p3a-smoke.md');
  const existing = readFileSync(outPath, 'utf8');
  // Replace the "未跑" line
  const updated = existing.replace(
    '未跑。原因:主控要求立即收尾,未配置 .env。',
    md.join('\n'),
  );
  writeFileSync(outPath, updated, 'utf8');
  console.log(`\nResults appended to ${outPath}`);

  store.close();
}

main().catch((e) => {
  console.error('p3a-smoke failed:', e);
  process.exit(1);
});
