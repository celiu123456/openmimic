#!/usr/bin/env npx tsx
/**
 * Episode verification script: verifies that the persona assembly includes
 * episodes after the truncation order fix, then chats one round with the
 * assembled persona to confirm the LLM can reference episode content.
 *
 * Reads LLM configuration from `.env` (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL).
 * Outputs results to `docs/p1a-real-run-4.md`.
 *
 * Usage: npx tsx scripts/episode-verify.ts
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Store, assemblePersonaContext } from '@openmimic/kernel';
import { OpenAICompatClient, runCourt } from '@openmimic/engine-court';
import {
  demoSubject,
  demoTestimonies,
  demoWitnesses,
} from '@openmimic/fixtures';

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

async function main() {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;

  if (!baseUrl || !apiKey || !model) {
    console.error('episode-verify: LLM not configured (missing LLM_BASE_URL, LLM_API_KEY, or LLM_MODEL)');
    process.exit(1);
  }

  const outPath = resolve(import.meta.dirname ?? '.', '..', 'docs', 'p1a-real-run-4.md');
  console.log(`LLM: ${baseUrl} model=${model}`);
  console.log(`Output: ${outPath}`);

  const chat = new OpenAICompatClient({ baseUrl, apiKey, model, timeoutMs: 120_000 });
  if (!chat.configured || !chat.hasApiKey) {
    console.error('episode-verify: OpenAICompatClient reports not configured');
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
      console.error(`episode-verify: LLM returned ${response.status}: ${body.slice(0, 200)}`);
      process.exit(1);
    }
    const text = await response.text();
    console.log(`LLM connectivity OK: ${text.slice(0, 50)}`);
  } catch (err) {
    console.error(`episode-verify: LLM unreachable: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Create a fresh store and seed 林默
  const store = new Store();
  const subjectId = `episode-verify-${randomUUID().slice(0, 8)}`;
  console.log(`Creating subject ${subjectId}...`);

  store.putSubject({
    ...demoSubject(),
    id: subjectId,
    displayName: `林默-episode-${Date.now()}`,
  });

  const origWitnesses = demoWitnesses();
  const origTestimonies = demoTestimonies();
  const witnessIdMap = new Map<string, string>();
  const witnessRelationMap = new Map<string, string>();

  for (const w of origWitnesses) {
    const newId = randomUUID();
    witnessIdMap.set(w.id, newId);
    witnessRelationMap.set(newId, w.relation);
    store.putWitness({ ...w, id: newId, subjectId });
  }

  for (const t of origTestimonies) {
    const newId = randomUUID();
    const newWitnessId = witnessIdMap.get(t.witnessId);
    if (!newWitnessId) throw new Error(`Missing witness mapping for ${t.witnessId}`);
    store.addTestimony({
      ...t,
      id: newId,
      witnessId: newWitnessId,
      subjectId,
    });
  }

  // Run court v2
  console.log('Running court v2...');
  const session = await runCourt(subjectId, store, chat);
  const totalClaims = session.report?.totalClaims ?? 0;
  console.log(`Court finished: ${totalClaims} claims`);

  // Assemble persona
  console.log('Assembling persona prompt...');
  const { systemPrompt, meta } = await assemblePersonaContext(subjectId, store);

  const episodes = store.listEpisodesBySubject(subjectId);
  const claims = store.listClaimsBySubject(subjectId);

  // CRITICAL ASSERTION: episodeCount must be > 0
  const episodeCheckPassed = meta.episodeCount > 0;
  console.log(`Episode count: ${meta.episodeCount} (${episodeCheckPassed ? 'PASS' : 'FAIL'})`);
  console.log(`Episodes in store: ${episodes.length}`);
  console.log(`Prompt contains "别人讲过的事": ${systemPrompt.includes('别人讲过的事')}`);

  // Chat one round with the persona
  console.log('Chatting one round with the persona...');
  let chatReply = '';
  let chatError = '';
  try {
    const chatResponse = await chat.chatRaw([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '林默是一个什么样的人？别人怎么评价他？' },
    ]);
    if (!chatResponse.ok) {
      chatError = `HTTP ${chatResponse.status}`;
      const body = await chatResponse.text().catch(() => '');
      chatError += `: ${body.slice(0, 200)}`;
    } else {
      const body = await chatResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
      chatReply = body.choices?.[0]?.message?.content ?? '[no content in response]';
    }
  } catch (err) {
    chatError = err instanceof Error ? err.message : String(err);
  }
  console.log(`Chat reply length: ${chatReply.length}`);

  // Write output
  const lines = [
    '# P1a Real Run 4 — Episode Verification',
    '',
    `Date: ${new Date().toISOString()}`,
    `LLM: ${baseUrl} model=${model}`,
    `Subject: ${subjectId}`,
    '',
    '## Purpose',
    '',
    'Verify the truncation order fix: episodes must appear in the assembled',
    'persona prompt (episodeCount > 0), and the LLM should be able to reference',
    'episode content in its responses.',
    '',
    '## Results',
    '',
    `| Metric | Value |`,
    `|---|---|`,
    `| Episode count in meta | ${meta.episodeCount} |`,
    `| Episodes in store | ${episodes.length} |`,
    `| Prompt has episode section | ${systemPrompt.includes('别人讲过的事')} |`,
    `| Total claims | ${claims.length} |`,
    `| Included claims | ${meta.includedClaimIds.length} |`,
    `| Excluded claims | ${meta.excludedClaimIds.length} |`,
    `| Corpus count | ${meta.corpusCount} |`,
    `| Self-report included | ${meta.selfReportIncluded} |`,
    `| Truncated | ${meta.truncated} |`,
    `| Prompt char count | ${meta.charCount} |`,
    `| Divergence count | ${meta.divergenceCount} |`,
    `| **episodeCount > 0 check** | **${episodeCheckPassed ? 'PASS' : 'FAIL'}** |`,
    '',
    '## Court Report',
    '',
    '```json',
    JSON.stringify(session.report, null, 2),
    '```',
    '',
    '## Episodes in Prompt',
    '',
    ...episodes.slice(0, 20).map((e) =>
      `- [${witnessRelationMap.get(e.witnessId) ?? e.witnessId.slice(0, 8)}] ${e.text.slice(0, 100)}${e.text.length > 100 ? '...' : ''}`,
    ),
    '',
    '## Chat Round',
    '',
    '**User**: 林默是一个什么样的人？别人怎么评价他？',
    '',
    chatError
      ? `**Error**: ${chatError}`
      : `**Reply**:\n\n${chatReply}`,
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

  if (!episodeCheckPassed) {
    console.error('FAIL: episodeCount is 0 — the fix did not work');
    process.exit(1);
  }

  console.log('PASS: episodes are present in the persona prompt');
  store.close();
}

main().catch((err) => {
  console.error('episode-verify failed:', err);
  process.exit(1);
});
