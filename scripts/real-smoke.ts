#!/usr/bin/env npx tsx
/**
 * Real-smoke test: run the full court v2 pipeline against a real LLM.
 *
 * Reads LLM configuration from `.env`. Copies 林默's six witnesses and
 * testimony into a fresh subject, runs court v2, assembles the persona
 * prompt, and writes the results to `docs/p1a-real-run.md`.
 *
 * Usage: npx tsx scripts/real-smoke.ts
 *
 * If the LLM is not configured or the API call fails, the script exits
 * with a message and does NOT create the output file.
 */
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Store, assemblePersonaContext } from '@openmimic/kernel';
import { OpenAICompatClient, runCourt } from '@openmimic/engine-court';
import {
  DEMO_WITNESSES,
  demoSubject,
  demoTestimonies,
  demoWitnesses,
} from '@openmimic/fixtures';

// Load .env manually (no dotenv dependency)
import { readFileSync } from 'node:fs';
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

async function main() {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;

  if (!baseUrl || !apiKey || !model) {
    console.error('real-smoke: LLM not configured (missing LLM_BASE_URL, LLM_API_KEY, or LLM_MODEL)');
    process.exit(1);
  }

  console.log(`LLM: ${baseUrl} model=${model}`);

  const chat = new OpenAICompatClient({ baseUrl, apiKey, model });
  if (!chat.configured || !chat.hasApiKey) {
    console.error('real-smoke: OpenAICompatClient reports not configured');
    process.exit(1);
  }

  // Quick connectivity test
  console.log('Testing LLM connectivity...');
  try {
    const response = await chat.chatRaw([
      { role: 'system', content: 'Reply with exactly: OK' },
      { role: 'user', content: 'ping' },
    ]);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`real-smoke: LLM returned ${response.status}: ${body.slice(0, 200)}`);
      process.exit(1);
    }
    const text = await response.text();
    console.log(`LLM connectivity OK: ${text.slice(0, 50)}`);
  } catch (err) {
    console.error(`real-smoke: LLM unreachable: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Create a fresh store and seed a copy of 林默 as a new subject
  const store = new Store();
  const newSubjectId = `smoke-${randomUUID().slice(0, 8)}`;

  console.log(`Creating subject ${newSubjectId}...`);
  store.putSubject({
    ...demoSubject(),
    id: newSubjectId,
    displayName: `林默-smoke-${Date.now()}`,
  });

  const origWitnesses = demoWitnesses();
  const origTestimonies = demoTestimonies();
  const witnessIdMap = new Map<string, string>();
  const testimonyIdMap = new Map<string, string>();

  for (const w of origWitnesses) {
    const newId = randomUUID();
    witnessIdMap.set(w.id, newId);
    store.putWitness({ ...w, id: newId, subjectId: newSubjectId });
  }

  for (const t of origTestimonies) {
    const newId = randomUUID();
    testimonyIdMap.set(t.id, newId);
    const newWitnessId = witnessIdMap.get(t.witnessId);
    if (!newWitnessId) throw new Error(`Missing witness mapping for ${t.witnessId}`);
    store.addTestimony({
      ...t,
      id: newId,
      witnessId: newWitnessId,
      subjectId: newSubjectId,
    });
  }

  // Run court v2
  console.log('Running court v2...');
  const session = await runCourt(newSubjectId, store, chat);
  console.log(`Court finished: ${session.report?.totalClaims ?? 0} claims`);

  // Assemble persona
  console.log('Assembling persona prompt...');
  const { systemPrompt, meta } = await assemblePersonaContext(newSubjectId, store);

  // Gather results
  const claims = store.listClaimsBySubject(newSubjectId);
  const episodes = store.listEpisodesBySubject(newSubjectId);
  const divergences = store.listDivergencesBySubject(newSubjectId);

  // Write output
  const outPath = resolve(import.meta.dirname ?? '.', '..', 'docs', 'p1a-real-run.md');
  const lines = [
    '# P1a Real Smoke Run',
    '',
    `Date: ${new Date().toISOString()}`,
    `LLM: ${baseUrl} model=${model}`,
    `Subject: ${newSubjectId}`,
    '',
    '## Court Report',
    '',
    '```json',
    JSON.stringify(session.report, null, 2),
    '```',
    '',
    `Claims: ${claims.length}`,
    `Episodes: ${episodes.length}`,
    `Divergences: ${divergences.length}`,
    '',
    '### Claims',
    '',
    ...claims.map((c) =>
      `- [${c.status}] (${c.conviction.toFixed(2)}) ${c.text}${c.qualifiers?.length ? ` [限定: ${c.qualifiers.join('; ')}]` : ''}`,
    ),
    '',
    '### Divergences',
    '',
    ...divergences.map((d) =>
      `- [${d.type}/${d.resolution ?? 'none'}] ${d.topic}: ${d.positions.map((p) => p.summary).join(' / ')}`,
    ),
    '',
    '### Episodes',
    '',
    ...episodes.map((e) =>
      `- [${e.witnessId.slice(0, 8)}] ${e.text.slice(0, 80)}${e.text.length > 80 ? '...' : ''}`,
    ),
    '',
    '## Persona Prompt',
    '',
    '```',
    systemPrompt,
    '```',
    '',
    '## Meta',
    '',
    '```json',
    JSON.stringify(meta, null, 2),
    '```',
    '',
  ];

  writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`Results written to ${outPath}`);

  store.close();
}

main().catch((err) => {
  console.error('real-smoke failed:', err);
  process.exit(1);
});
