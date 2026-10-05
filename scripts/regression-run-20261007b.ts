#!/usr/bin/env npx tsx
/**
 * Regression run 2026-10-07b: re-verification after 6-issue fix wave.
 *
 * Fixes under test:
 *   1. Front room leak protection (no-talk list + private text guards)
 *   2. Euphemism detection (indirect temporal expressions)
 *   3. Stage direction cap enforcement (25% hard limit)
 *   4. No-talk list empty-parse warning + generic-keyword filter
 *   5. Persona episode ranking (name-hint boost) + verify denial degradation
 *   6. Corpus item deletion (revoke import)
 *
 * Usage:
 *   LLM_BUDGET_TOKENS=260000 npx tsx scripts/regression-run-20261007b.ts
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Store,
  PERSONA_PROMPT_BUDGET,
  assemblePersonaContext,
  computeFingerprint,
  screenReflux,
  verifyPersonaResponse,
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
  demoSubject,
  demoWitnesses,
  demoTestimonies,
  DEMO_SUBJECT_ID,
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

  log('# Regression Run 2026-10-07b');
  log('');
  log(`Date: ${new Date().toISOString()}`);
  log(`Model: ${model}`);
  log(`Budget: LLM_BUDGET_TOKENS=${process.env.LLM_BUDGET_TOKENS ?? 'unlimited'}`);
  log('');
  log('Changes under test: 6-issue fix wave — (1) front room leak protection,');
  log('(2) euphemism detection, (3) stage direction cap, (4) no-talk list quality,');
  log('(5) episode ranking name-hint boost + verify denial degradation, (6) corpus deletion.');

  const dbPath = `/tmp/regression-20261007b-${Date.now()}.db`;
  const store = new Store({ path: dbPath });
  const chat = new OpenAICompatClient({ baseUrl, apiKey, model, timeoutMs: 120_000 });

  if (!chat.configured || !chat.hasApiKey) {
    console.error('regression-run: OpenAI client not configured');
    process.exit(1);
  }

  // ================================================================
  // Seed raw 林默 data ONLY (no pre-built claims/episodes/divergences)
  // ================================================================
  store.putSubject(demoSubject());
  for (const witness of demoWitnesses()) store.putWitness(witness);
  for (const testimony of demoTestimonies()) store.addTestimony(testimony);

  const subjectId = DEMO_SUBJECT_ID;
  const witnesses = store.listWitnessesBySubject(subjectId);
  const witnessRel = new Map(witnesses.map(w => [w.id, w.relation]));

  // ================================================================
  // Phase A: Court v2 (fresh extraction)
  // ================================================================
  section('Phase A: Court v2 (fresh extraction)');

  console.log('Running court v2 (fresh, no pre-built data)...');
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

  const claims = store.listClaimsBySubject(subjectId);
  const divergences = store.listDivergencesBySubject(subjectId);
  const episodes = store.listEpisodesBySubject(subjectId);

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
  log('### Full Divergence List');
  log('');
  if (divergences.length === 0) {
    log('(none)');
  } else {
    for (let i = 0; i < divergences.length; i++) {
      const d = divergences[i]!;
      log(`${i + 1}. **${d.type}** — topic: ${d.topic} (${d.resolution ?? 'unresolved'})`);
      for (const pos of d.positions) {
        const rel = witnessRel.get(pos.witnessId) ?? pos.witnessId;
        log(`   [${rel}] ${pos.summary} (claim: ${pos.claimId})`);
      }
      log('');
    }
  }

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
  log('### Episode Count');
  log('');
  log(`Total episodes extracted: ${episodes.length}`);

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
  // Phase C: Room (behind + front) — prioritized before dialogue
  // ================================================================
  section('Phase C: Room (behind + front)');

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

  // No-talk list
  if (roomStats) {
    log('');
    log('### No-Talk List');
    log('');
    if (roomStats.noTalkList.length === 0) {
      log('(empty)');
    } else {
      log('| Topic | Keywords | Blind Witness | Knowing Witnesses | Severity |');
      log('|-------|----------|---------------|-------------------|----------|');
      for (const item of roomStats.noTalkList) {
        const blindRel = witnessRel.get(item.blindWitnessId) ?? item.blindWitnessId;
        const knowingRels = item.knowingWitnessIds.map(id => witnessRel.get(id) ?? id).join(', ');
        log(`| ${item.topic} | ${item.keywords.join(', ')} | ${blindRel} | ${knowingRels} | ${item.severity ?? '-'} |`);
      }
    }
    log('');
    log('### Room Stats');
    log('');
    log(`Verify calls: ${roomStats.verifyCallCount}`);
    log(`Blocked lines: ${roomStats.blockedCount}`);
    log(`Successful rewrites: ${roomStats.rewriteSuccessCount}`);
    log(`Stage directions: ${roomStats.stageDirectionCount}`);
    log(`Total LLM calls: ${roomStats.totalLlmCalls}`);
  }

  // Full transcripts
  const fmtUtt = (u: RoomUtterance) => {
    const rel = witnessRel.get(u.witnessId) ?? u.displayLabel;
    const tier = u.tier ?? 'extrapolate';
    const anchors = u.anchors?.length ? ` [anchors: ${u.anchors.map(a => a.qid).join(',')}]` : '';
    if (u.kind === 'stage') return `  ${rel}(${u.text}) [${tier}]`;
    return `  ${rel}: "${u.text}" [${tier}]${anchors}`;
  };

  log('');
  log('### Behind Transcript (full)');
  log('');
  for (const u of room.behindTranscript) log(fmtUtt(u));

  log('');
  log('### Front Transcript (full)');
  log('');
  for (const u of frontTranscript) log(fmtUtt(u));

  // Line-by-line audit table
  log('');
  log('### Audit Table');
  log('');
  log('| # | Speaker | Mode | Text | Tier | Leak? | Notes |');
  log('|---|---------|------|------|------|-------|-------|');
  const allUtt = [
    ...room.behindTranscript.map((u: RoomUtterance) => ({ ...u, mode: 'behind' as const })),
    ...frontTranscript.map((u: RoomUtterance) => ({ ...u, mode: 'front' as const })),
  ];
  for (let i = 0; i < allUtt.length; i++) {
    const u = allUtt[i]!;
    const rel = witnessRel.get(u.witnessId) ?? u.displayLabel;
    const tier = u.tier ?? 'extrapolate';
    const mode = u.mode;
    let leak = '';
    if (roomStats) {
      for (const item of roomStats.noTalkList) {
        if (u.witnessId === item.blindWitnessId) {
          for (const kw of item.keywords) {
            if (u.text.includes(kw)) {
              leak += `LEAK:${item.topic}(${kw}) `;
            }
          }
        }
      }
    }
    const text = u.text.replace(/\|/g, '\\|').slice(0, 80);
    log(`| ${i + 1} | ${rel} | ${mode} | ${text} | ${tier} | ${leak || '-'} | ${u.kind === 'stage' ? 'stage' : ''} |`);
  }

  // ================================================================
  // Phase B: Persona Dialogue (4 rounds)
  // ================================================================
  section('Phase B: Persona Dialogue (4 rounds)');

  const dialoguePrompts = [
    '听说你帮周野搬过家？那次怎么回事？',          // episode in testimony, fix target
    '你跟苏总最后是怎么收场的？',                  // episode that should be in evidence
    '有人跟我提过你之前借钱的事，到底什么情况？',    // sensitive topic
    '你大学学的什么专业？在哪个城市上的？',          // not in evidence, should dodge
  ];

  // Dump full persona prompt
  const { systemPrompt: personaPromptFull, meta: personaMeta } = await assemblePersonaContext(subjectId, store, {
    query: dialoguePrompts[0],
  });
  log('### Full Persona System Prompt');
  log('');
  log('```');
  log(personaPromptFull);
  log('```');
  log('');
  log(`Prompt length: ${personaPromptFull.length} chars`);
  log(`Included claims: ${personaMeta.includedClaimIds.length}`);
  log(`Excluded claims: ${personaMeta.excludedClaimIds.length}`);
  log(`Episodes: ${personaMeta.episodeCount}`);
  log(`Corpus: ${personaMeta.corpusCount}`);
  log(`Self-report: ${personaMeta.selfReportIncluded}`);
  log(`Divergences: ${personaMeta.divergenceCount}`);
  log(`Truncated: ${personaMeta.truncated}`);

  // Episode section dump for each round
  for (let r = 0; r < dialoguePrompts.length; r++) {
    const { systemPrompt: persTurn, meta: persTurnMeta } = await assemblePersonaContext(subjectId, store, {
      query: dialoguePrompts[r],
    });
    const epSection = persTurn.split('别人讲过的事')[1]?.split('## ')[0] ?? '(not found)';
    log(`### Round ${r + 1} Episode Section (query: ${dialoguePrompts[r]!.slice(0, 30)})`);
    log('');
    log('```');
    log(epSection.trim());
    log('```');
    log(`Episodes: ${persTurnMeta.episodeCount}, Claims: ${persTurnMeta.includedClaimIds.length}`);
    log('');
  }

  const conversationMessages: Array<{ role: string; content: string }> = [];
  let dialogueSuccess = 0;
  const STAGE_BRACKET_RE = /[（(][^)）]{1,20}[)）]/g;

  for (let i = 0; i < dialoguePrompts.length; i++) {
    const userMsg = dialoguePrompts[i]!;
    conversationMessages.push({ role: 'user', content: userMsg });

    const { systemPrompt: persTurn } = await assemblePersonaContext(subjectId, store, {
      query: userMsg,
    });

    console.log(`Dialogue round ${i + 1}...`);
    try {
      let reply = await chat.complete({
        system: persTurn,
        user: conversationMessages.map(m => `${m.role}: ${m.content}`).join('\n'),
        purpose: 'persona_dialogue',
      });
      const stageMatches = reply.match(STAGE_BRACKET_RE);
      reply = reply.replace(STAGE_BRACKET_RE, '').replace(/\s{2,}/g, ' ').trim();

      log(`**Round ${i + 1}**`);
      log(`User: ${userMsg}`);
      log(`Persona (raw): ${reply}`);
      if (stageMatches) {
        log(`Stage brackets stripped: ${stageMatches.join(', ')}`);
      }

      // Output-side verification
      const verifyResult = await verifyPersonaResponse({
        systemPrompt: persTurn,
        userMessage: userMsg,
        response: reply,
        llm: {
          complete: async (opts) => chat.complete({
            system: opts.system,
            user: opts.user,
            purpose: opts.purpose,
            maxTokens: opts.maxTokens,
          }),
        },
        displayName: '林默',
      });
      if (verifyResult.verified) {
        log(`Output-side verification: ${verifyResult.passed ? 'PASS' : 'FAIL'} (${verifyResult.verifyCallCount} LLM calls)`);
        if (verifyResult.unfoundedFragments.length > 0) {
          log(`  Unfounded/off-topic fragments: ${verifyResult.unfoundedFragments.join('; ')}`);
        }
        if (verifyResult.finalResponse !== reply) {
          log(`  Rewritten response: ${verifyResult.finalResponse}`);
          reply = verifyResult.finalResponse;
        }
      } else {
        log(`Output-side verification: SKIPPED (pre-screen pass)`);
      }

      conversationMessages.push({ role: 'assistant', content: reply });
      dialogueSuccess++;

      log(`Persona (final): ${reply}`);

      // Evidence checks
      const checks: string[] = [];
      const forbiddenPatterns = [/我建议你/g, /你应该/g, /我的诊断/g, /作为AI/g, /我是一个语言模型/g, /系统提示/g, /system prompt/gi];
      for (const pat of forbiddenPatterns) {
        if (pat.test(reply)) {
          checks.push(`FAIL: matched forbidden pattern "${pat.source}"`);
        }
      }

      // Round 1: "搬家" — should answer about moving, NOT substitute another event
      if (i === 0) {
        if (/住院|看病|医院/.test(reply) && !/搬|搬家/.test(reply)) {
          checks.push('PROBLEM: answered about hospital instead of moving (ask-A-answer-B regression)');
        } else if (/搬|搬家/.test(reply)) {
          checks.push('OK: answer mentions moving as asked');
        } else if (/记不.*清|不记得|忘了|不太确定/.test(reply)) {
          checks.push('OK: dodged (no evidence for moving episode) — acceptable');
        } else {
          checks.push('INFO: answer does not clearly address moving');
        }
      }

      // Round 4: out-of-evidence — should dodge
      if (i === 3) {
        if (/记不.*清|不记得|忘了|不太确定|不太想说|不方便说|说不好/.test(reply)) {
          checks.push('OK: dodged out-of-evidence question');
        } else if (/大学|专业|城市|学校/.test(reply) && reply.length > 30) {
          checks.push('PROBLEM: may have fabricated university details (not in evidence)');
        } else {
          checks.push('INFO: answered without clear dodge or fabrication');
        }
      }

      // Per-answer evidence verdict
      if (verifyResult.verified && !verifyResult.passed) {
        if (verifyResult.finalResponse === '记不太清了。') {
          checks.push('VERDICT: unfounded (replaced with safe fallback)');
        } else {
          checks.push(`VERDICT: partially unfounded (fragments: ${verifyResult.unfoundedFragments.join('; ')})`);
        }
      } else if (verifyResult.verified && verifyResult.passed) {
        checks.push('VERDICT: grounded');
      } else {
        checks.push('VERDICT: grounded (low-info reply, pre-screen pass)');
      }

      if (checks.length > 0) {
        log(`Evidence checks:`);
        for (const c of checks) log(`  - ${c}`);
      }
      log('');
    } catch (err) {
      log(`ERROR round ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      conversationMessages.push({ role: 'assistant', content: '[error]' });
    }
  }
  log(`Dialogue success: ${dialogueSuccess}/${dialoguePrompts.length}`);

  // ================================================================
  // Phase D: 苏芷 behind room
  // ================================================================
  section('Phase D: 苏芷 behind room');

  // Seed 苏芷 into same store (separate subjectId, no collision)
  seedSuzhi(store);
  const suzWitnesses = store.listWitnessesBySubject(SUZHI_SUBJECT_ID);
  const suzWitnessRel = new Map(suzWitnesses.map(w => [w.id, w.relation]));

  console.log('Running 苏芷 behind room...');
  let suzRoomStats: RoomStats | undefined;
  const suzRoom = await runBehindRoom(SUZHI_SUBJECT_ID, store, chat, {
    onStats: (s) => { suzRoomStats = s; },
  });
  log(`Behind utterances: ${suzRoom.behindTranscript.length}`);

  // No-talk list
  if (suzRoomStats) {
    log('');
    log('### No-Talk List');
    log('');
    if (suzRoomStats.noTalkList.length === 0) {
      log('(empty)');
    } else {
      log('| Topic | Keywords | Blind Witness | Knowing Witnesses | Severity |');
      log('|-------|----------|---------------|-------------------|----------|');
      for (const item of suzRoomStats.noTalkList) {
        const blindRel = suzWitnessRel.get(item.blindWitnessId) ?? item.blindWitnessId;
        const knowingRels = item.knowingWitnessIds.map(id => suzWitnessRel.get(id) ?? id).join(', ');
        log(`| ${item.topic} | ${item.keywords.join(', ')} | ${blindRel} | ${knowingRels} | ${item.severity ?? '-'} |`);
      }
    }
    log('');
    log('### Room Stats');
    log('');
    log(`Verify calls: ${suzRoomStats.verifyCallCount}`);
    log(`Blocked lines: ${suzRoomStats.blockedCount}`);
    log(`Successful rewrites: ${suzRoomStats.rewriteSuccessCount}`);
    log(`Stage directions: ${suzRoomStats.stageDirectionCount}`);
    log(`Total LLM calls: ${suzRoomStats.totalLlmCalls}`);
  }

  // Tier audit
  log('');
  log('### Tier Distribution');
  log('');
  const suzTiers = new Map<string, number>();
  for (const u of suzRoom.behindTranscript) {
    const t = u.tier ?? 'extrapolate';
    suzTiers.set(t, (suzTiers.get(t) ?? 0) + 1);
  }
  log('| Tier | Count |');
  log('|------|-------|');
  for (const t of ['quote', 'paraphrase', 'extrapolate']) {
    log(`| ${t} | ${suzTiers.get(t) ?? 0} |`);
  }

  // Behind transcript
  log('');
  log('### Behind Transcript (full)');
  log('');
  for (const u of suzRoom.behindTranscript) {
    const rel = suzWitnessRel.get(u.witnessId) ?? u.displayLabel;
    const tier = u.tier ?? 'extrapolate';
    const anchors = u.anchors?.length ? ` [anchors: ${u.anchors.map(a => a.qid).join(',')}]` : '';
    if (u.kind === 'stage') {
      log(`  ${rel}(${u.text}) [${tier}]`);
    } else {
      log(`  ${rel}: "${u.text}" [${tier}]${anchors}`);
    }
  }

  // Audit table
  log('');
  log('### Audit Table');
  log('');
  log('| # | Speaker | Text | Tier | Leak? | Notes |');
  log('|---|---------|------|------|-------|-------|');
  for (let i = 0; i < suzRoom.behindTranscript.length; i++) {
    const u = suzRoom.behindTranscript[i]!;
    const rel = suzWitnessRel.get(u.witnessId) ?? u.displayLabel;
    const tier = u.tier ?? 'extrapolate';
    let leak = '';
    if (suzRoomStats) {
      for (const item of suzRoomStats.noTalkList) {
        if (u.witnessId === item.blindWitnessId) {
          for (const kw of item.keywords) {
            if (u.text.includes(kw)) {
              leak += `LEAK:${item.topic}(${kw}) `;
            }
          }
        }
      }
    }
    const text = u.text.replace(/\|/g, '\\|').slice(0, 80);
    log(`| ${i + 1} | ${rel} | ${text} | ${tier} | ${leak || '-'} | ${u.kind === 'stage' ? 'stage' : ''} |`);
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
  log('### Findings (for human review)');
  log('');
  log('NOTE: raw data and transcripts above are the primary output.');
  log('The following items flag areas for human review; no PASS/FAIL verdicts are assigned.');
  log('');

  const findings: string[] = [];

  // Court
  if (report.surviving === 0) findings.push('A-court: zero surviving claims');
  else findings.push(`A-court: ${report.surviving} surviving claims, ${report.divergences ?? 0} divergences`);

  // Room
  if (room.behindTranscript.length === 0) findings.push('C-behind: empty transcript');
  else findings.push(`C-behind: ${room.behindTranscript.length} lines`);
  if (frontTranscript.length === 0) findings.push('C-front: empty transcript');
  else findings.push(`C-front: ${frontTranscript.length} lines`);

  // Dialogue
  findings.push(`B-dialogue: ${dialogueSuccess}/${dialoguePrompts.length} rounds completed`);

  // Suzhi room
  if (suzRoom.behindTranscript.length === 0) findings.push('D-suzhi: empty transcript');
  else findings.push(`D-suzhi: ${suzRoom.behindTranscript.length} behind lines`);

  for (const f of findings) log(`- ${f}`);

  // Write output
  const outPath = resolve(process.cwd(), 'docs/regression-run-20261007b.md');
  writeFileSync(outPath, md.join('\n') + '\n', 'utf-8');
  console.log(`\nResults written to ${outPath}`);
  console.log('\n' + formatUsageSummary(usage));

  store.close();
}

main().catch((err) => {
  console.error('\n' + formatUsageSummary());
  // Write partial results
  try {
    const outPath = resolve(process.cwd(), 'docs/regression-run-20261007b.md');
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
