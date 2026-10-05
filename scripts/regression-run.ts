#!/usr/bin/env npx tsx
/**
 * Phase-2 regression run for deferred-wiring batch (2026-10-06).
 *
 * Runs four steps sequentially:
 *   A. Court v2 for 林默 — claim/divergence/pre-judgment stats
 *   B. Behind room + openDoor — leak/tier/disclosure audit
 *   C. 5 rounds persona dialogue via OpenAI-compatible endpoint (in-process)
 *   D. Reflux fingerprint test — submit room line as testimony, verify detection
 *
 * Output: docs/regression-run-20261006.md
 *
 * Usage:
 *   LLM_BUDGET_TOKENS=350000 npx tsx scripts/regression-run.ts
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  Store,
  assemblePersonaContext,
  computeFingerprint,
  screenReflux,
  deriveDisclosure,
  classifyContentSubject,
} from '@openmimic/kernel';
import {
  OpenAICompatClient,
  runCourt,
} from '@openmimic/engine-court';
import {
  runBehindRoom,
  openDoor,
  type RoomStats,
} from '@openmimic/engine-room';
import {
  seedDemo,
  DEMO_SUBJECT_ID,
  DEMO_WITNESSES,
} from '../fixtures/limo';
import type { RoomUtterance } from '@openmimic/shared';
import {
  getUsageSummary,
  formatUsageSummary,
  BudgetExceededError,
  InsufficientBalanceError,
} from '@openmimic/shared';

// Load .env manually
const envPath = resolve(process.cwd(), '.env');
try {
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
} catch { /* no .env */ }

const md: string[] = [];
function log(s: string) { console.log(s); md.push(s); }
function section(title: string) { log(''); log(`## ${title}`); log(''); }

async function main() {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;

  if (!baseUrl || !apiKey || !model) {
    console.error('regression-run: LLM not configured (missing LLM_BASE_URL, LLM_API_KEY, or LLM_MODEL)');
    process.exit(1);
  }

  log('# Regression Run 2026-10-06');
  log('');
  log(`Date: ${new Date().toISOString()}`);
  log(`Model: ${model}`);
  log(`Budget: LLM_BUDGET_TOKENS=${process.env.LLM_BUDGET_TOKENS ?? 'unlimited'}`);

  const dbPath = `/tmp/regression-run-${Date.now()}.db`;
  const store = new Store({ path: dbPath });
  const chat = new OpenAICompatClient({ baseUrl, apiKey, model, timeoutMs: 120_000 });

  if (!chat.configured || !chat.hasApiKey) {
    console.error('regression-run: OpenAI client not configured');
    process.exit(1);
  }

  // Seed 林默
  seedDemo(store);
  const subjectId = DEMO_SUBJECT_ID;

  // ================================================================
  // Phase 2A: Court
  // ================================================================
  section('Phase 2A: Court v2');

  console.log('Running court v2...');
  const courtSession = await runCourt(subjectId, store, chat);
  const report = courtSession.report!;

  log(`Total claims: ${report.totalClaims}`);
  log(`Surviving: ${report.surviving}`);
  log(`Contested: ${report.contested ?? 0}`);
  log(`Retired: ${report.retired ?? 0}`);
  log(`Pre-judged pairs: ${report.preJudgedPairs ?? 0}`);
  log(`LLM-judged pairs: ${report.llmJudgedPairs ?? 0}`);
  log(`Total divergences: ${report.divergences ?? 0}`);
  log(`Factual conflicts: ${report.factualConflicts ?? 0}`);

  // Breakdown
  const claims = store.listClaimsBySubject(subjectId);
  const divergences = store.listDivergencesBySubject(subjectId);
  const episodes = store.listEpisodesBySubject(subjectId);
  const witnesses = store.listWitnessesBySubject(subjectId);
  const witnessRel = new Map(witnesses.map(w => [w.id, w.relation]));

  log('');
  log('### Divergence Type Breakdown');
  log('');
  const divByType = new Map<string, number>();
  const divByRes = new Map<string, number>();
  for (const d of divergences) {
    divByType.set(d.type, (divByType.get(d.type) ?? 0) + 1);
    const res = d.resolution ?? 'none';
    divByRes.set(res, (divByRes.get(res) ?? 0) + 1);
  }
  log('| Type | Count |');
  log('|------|-------|');
  for (const [t, c] of divByType) log(`| ${t} | ${c} |`);
  log('');
  log('| Resolution | Count |');
  log('|------------|-------|');
  for (const [r, c] of divByRes) log(`| ${r} | ${c} |`);

  log('');
  log('### Per-Witness Claim Count');
  log('');
  for (const w of witnesses) {
    const count = claims.filter(c => c.status !== 'retired' && c.witnessIds?.includes(w.id)).length;
    log(`- ${w.relation}: ${count} claims`);
  }

  log('');
  log('### Conviction Distribution');
  log('');
  const surviving = claims.filter(c => c.status === 'surviving');
  const convictions = surviving.map(c => c.conviction).sort((a, b) => b - a);
  log(`Range: ${convictions.at(-1)?.toFixed(2) ?? 'N/A'} - ${convictions[0]?.toFixed(2) ?? 'N/A'}`);
  log(`Above 0.5: ${convictions.filter(v => v > 0.5).length}/${surviving.length}`);
  log(`Merged (multi-witness): ${surviving.filter(c => (c.witnessIds?.length ?? 0) >= 2).length}`);

  log('');
  log('### Court Errors');
  log('');
  const errors = courtSession.transcript.filter(
    e => e.text.includes('失败') || e.text.includes('丢弃') || e.text.includes('降级'),
  );
  if (errors.length === 0) {
    log('(none)');
  } else {
    for (const e of errors) {
      log(`- [${e.type}] ${e.text.slice(0, 200)}`);
    }
  }

  // ================================================================
  // Phase 2B: Room
  // ================================================================
  section('Phase 2B: Behind Room + Open Door');

  console.log('Running behind room...');
  let roomStats: RoomStats | undefined;
  const room = await runBehindRoom(subjectId, store, chat, {
    onStats: (s) => { roomStats = s; },
  });

  log(`Behind utterances: ${room.behindTranscript.length}`);

  console.log('Opening door...');
  const doorRoom = await openDoor(room.id, store, chat);
  const frontTranscript = doorRoom.frontTranscript ?? [];
  log(`Front utterances: ${frontTranscript.length}`);

  // Tier audit
  log('');
  log('### Tier Distribution');
  log('');
  const tierCount = (utt: RoomUtterance[]) => {
    const m = new Map<string, number>();
    for (const u of utt) {
      const t = u.tier ?? 'extrapolate';
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  };
  const behindTiers = tierCount(room.behindTranscript);
  const frontTiers = tierCount(frontTranscript);
  log('| Tier | Behind | Front |');
  log('|------|--------|-------|');
  for (const t of ['quote', 'paraphrase', 'extrapolate']) {
    log(`| ${t} | ${behindTiers.get(t) ?? 0} | ${frontTiers.get(t) ?? 0} |`);
  }

  // Room stats
  if (roomStats) {
    log('');
    log('### Room Stats');
    log('');
    log(`Verify calls: ${roomStats.verifyCallCount}`);
    log(`Blocked lines: ${roomStats.blockedCount}`);
    log(`Successful rewrites: ${roomStats.rewriteSuccessCount}`);
    log(`Stage directions: ${roomStats.stageDirectionCount}`);
    log(`Total LLM calls: ${roomStats.totalLlmCalls}`);
    log(`No-talk list items: ${roomStats.noTalkList.length}`);
  }

  // Disclosure audit: check persona assembly with disclosure
  log('');
  log('### Disclosure Audit');
  log('');
  const { systemPrompt, meta } = await assemblePersonaContext(subjectId, store);
  const disclosureLines = systemPrompt.split('\n').filter(
    l => l.includes('[仅可引述大意]') || l.includes('[仅可感知氛围]') || l.includes('[不主动提起]'),
  );
  log(`Disclosure-annotated lines in persona prompt: ${disclosureLines.length}`);
  for (const l of disclosureLines.slice(0, 10)) {
    log(`  ${l.trim().slice(0, 120)}`);
  }
  log(`Total claims in persona: ${meta.includedClaimIds.length}`);
  log(`Prompt length: ${systemPrompt.length} chars`);

  // Leak detection: check no-talk-list keywords in behind transcript
  if (roomStats && roomStats.noTalkList.length > 0) {
    log('');
    log('### Leak Detection');
    log('');
    let leakCount = 0;
    for (const item of roomStats.noTalkList) {
      const blindRel = witnessRel.get(item.blindWitnessId) ?? item.blindWitnessId;
      // Check if blind witness said anything containing no-talk keywords
      const blindUtterances = room.behindTranscript.filter(u => u.witnessId === item.blindWitnessId);
      for (const u of blindUtterances) {
        for (const kw of item.keywords) {
          if (u.text.includes(kw)) {
            log(`- LEAK: ${blindRel} mentioned "${kw}" (topic: ${item.topic})`);
            leakCount++;
          }
        }
      }
    }
    if (leakCount === 0) {
      log('No leaks detected.');
    } else {
      log(`Total leaks: ${leakCount}`);
    }
  }

  // ================================================================
  // Phase 2C: Persona Dialogue (5 rounds, in-process)
  // ================================================================
  section('Phase 2C: Persona Dialogue (5 rounds)');

  const dialoguePrompts = [
    '你好，我是你的朋友，最近怎么样？',
    '听说你之前工作压力挺大的，能聊聊吗？',
    '你觉得自己最大的优点是什么？',
    '如果你能改变一件过去的事，你会选什么？',
    '你对未来有什么期待？',
  ];

  const conversationMessages: Array<{ role: string; content: string }> = [];
  let dialogueSuccess = 0;

  for (let i = 0; i < dialoguePrompts.length; i++) {
    const userMsg = dialoguePrompts[i];
    conversationMessages.push({ role: 'user', content: userMsg });

    // Build messages with persona system prompt
    const { systemPrompt: persTurn } = await assemblePersonaContext(subjectId, store, {
      query: userMsg,
    });
    const messages = [
      { role: 'system' as const, content: persTurn },
      ...conversationMessages,
    ];

    console.log(`Dialogue round ${i + 1}...`);
    try {
      const reply = await chat.complete({
        system: messages[0].content,
        user: conversationMessages.map(m => `${m.role}: ${m.content}`).join('\n'),
        purpose: 'persona_dialogue',
      });
      conversationMessages.push({ role: 'assistant', content: reply });
      dialogueSuccess++;

      log(`**Round ${i + 1}**`);
      log(`User: ${userMsg}`);
      log(`Persona: ${reply.slice(0, 300)}${reply.length > 300 ? '...' : ''}`);
      log('');

      // Check OBSERVER_GUARD: persona should not give advice/diagnosis/judgment
      const advicePatterns = [/我建议你/g, /你应该/g, /我的诊断/g, /作为AI/g, /我是一个语言模型/g];
      for (const pat of advicePatterns) {
        if (pat.test(reply)) {
          log(`WARNING: reply ${i + 1} may violate observer guard: matched "${pat.source}"`);
        }
      }
    } catch (err) {
      log(`ERROR round ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      conversationMessages.push({ role: 'assistant', content: '[error]' });
    }
  }
  log(`Dialogue success: ${dialogueSuccess}/5`);

  // ================================================================
  // Phase 2D: Reflux Fingerprint Test
  // ================================================================
  section('Phase 2D: Reflux Fingerprint Test');

  // Pick a room line to test reflux
  const sampleUtterance = room.behindTranscript.find(
    u => u.kind !== 'stage' && u.text.length > 20,
  );

  if (!sampleUtterance) {
    log('SKIP: no suitable behind-room utterance found for reflux test');
  } else {
    const sampleText = sampleUtterance.text;
    const sampleWitness = witnessRel.get(sampleUtterance.witnessId) ?? sampleUtterance.witnessId;
    log(`Test text (from ${sampleWitness}): "${sampleText.slice(0, 120)}..."`);
    log('');

    // Register the room fingerprint if not already done
    // (runBehindRoom should have done it, but let's also do it explicitly)
    const roomFingerprint = computeFingerprint(
      `room:${room.id}`,
      subjectId,
      room.behindTranscript.filter(u => u.kind !== 'stage').map(u => u.text).join('\n'),
    );
    store.putFingerprint(roomFingerprint);

    // Screen the room line as if it were new testimony
    const fingerprints = store.listFingerprints(subjectId);
    log(`Registered fingerprints for subject: ${fingerprints.length}`);

    const result = screenReflux(sampleText, fingerprints);
    log(`Reflux result: suspicion=${result.suspicion}, signal=${result.signal ?? 'N/A'}, similarity=${result.similarity?.toFixed(3) ?? 'N/A'}`);
    log(`Matched artifact: ${result.matchedArtifactId ?? 'none'}`);

    if (result.suspicion === 'none') {
      log('');
      log('WARNING: expected reflux detection for verbatim room line but got none');
      log('This may indicate the fingerprint was too short or the screening threshold is too strict.');
    } else {
      log('');
      log('PASS: reflux detection correctly flagged AI-generated room text');
    }

    // Also test with a fresh human-like sentence that should NOT match
    const freshText = '我今天在公园散步，看到了一只很可爱的小猫咪，它在追蝴蝶。';
    const freshResult = screenReflux(freshText, fingerprints);
    log('');
    log(`Control (fresh human text): suspicion=${freshResult.suspicion}`);
    if (freshResult.suspicion === 'none') {
      log('PASS: fresh text correctly NOT flagged');
    } else {
      log(`WARNING: false positive on fresh text (similarity=${freshResult.similarity?.toFixed(3)})`);
    }
  }

  // ================================================================
  // Summary
  // ================================================================
  section('Summary');

  const usage = getUsageSummary();
  log('### LLM Usage');
  log('');
  log('| Bucket | Calls | Prompt | Completion | Cached |');
  log('|--------|-------|--------|------------|--------|');
  const sorted = Object.entries(usage.buckets).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, b] of sorted) {
    log(`| ${name} | ${b.calls} | ${b.promptTokens} | ${b.completionTokens} | ${b.cachedTokens} |`);
  }
  const t = usage.totals;
  log(`| **TOTAL** | ${t.calls} | ${t.promptTokens} | ${t.completionTokens} | ${t.cachedTokens} |`);

  log('');
  log('### Verdict');
  log('');

  const verdicts: string[] = [];
  // A: court
  if (report.surviving > 0) verdicts.push('A-court: PASS');
  else verdicts.push('A-court: FAIL (no surviving claims)');
  if ((report.preJudgedPairs ?? 0) > 0) verdicts.push('A-pre-judge: PASS (classifyPair active)');
  else verdicts.push('A-pre-judge: INFO (no pre-judged pairs — may need evaluative claims)');

  // B: room
  if (room.behindTranscript.length > 0) verdicts.push('B-behind: PASS');
  else verdicts.push('B-behind: FAIL (empty transcript)');
  if (frontTranscript.length > 0) verdicts.push('B-front: PASS');
  else verdicts.push('B-front: FAIL (empty front transcript)');

  // C: dialogue
  if (dialogueSuccess === 5) verdicts.push('C-dialogue: PASS');
  else verdicts.push(`C-dialogue: PARTIAL (${dialogueSuccess}/5)`);

  // D: reflux
  if (sampleUtterance) {
    const fps = store.listFingerprints(subjectId);
    const check = screenReflux(sampleUtterance.text, fps);
    if (check.suspicion !== 'none') verdicts.push('D-reflux: PASS');
    else verdicts.push('D-reflux: FAIL (room line not detected)');
  } else {
    verdicts.push('D-reflux: SKIP');
  }

  for (const v of verdicts) log(`- ${v}`);

  // Write output
  const outPath = resolve(process.cwd(), 'docs/regression-run-20261006.md');
  writeFileSync(outPath, md.join('\n') + '\n', 'utf-8');
  console.log(`\nResults written to ${outPath}`);
  console.log('\n' + formatUsageSummary(usage));

  store.close();
}

main().catch((err) => {
  console.error('\n' + formatUsageSummary());
  // Write partial results
  try {
    const outPath = resolve(process.cwd(), 'docs/regression-run-20261006.md');
    md.push('');
    md.push('## ABORTED');
    md.push('');
    md.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
    md.push('');
    md.push(formatUsageSummary());
    writeFileSync(outPath, md.join('\n') + '\n', 'utf-8');
    console.error(`Partial results written to ${outPath}`);
  } catch { /* best effort */ }
  if (err instanceof BudgetExceededError || err instanceof InsufficientBalanceError) {
    console.error(`regression-run stopped: ${err.message}`);
    process.exit(2);
  }
  console.error('regression-run failed:', err);
  process.exit(1);
});
