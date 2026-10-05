#!/usr/bin/env npx tsx
/**
 * Regression run 2026-10-08: validation after three-issue fix wave.
 *
 * Fixes under test:
 *   1. No-talk list: individual item parsing (min(1) keywords), raw LLM
 *      response logging, empty-list warnings, fallback keyword enrichment
 *   2. Persona discipline: "neither confirm nor deny" for private topics
 *   3. Output-side verifier: private topic confirmation/denial detection
 *
 * Phases:
 *   S. Stability test: 5 list-generation-only runs each for suzhi + limo
 *   A. Court v2 for limo (fresh extraction)
 *   C. Limo room (behind + front) with full audit
 *   D. Suzhi room (behind + front) with full audit
 *   B. Persona dialogue 4 rounds (limo) with private topic markers
 *
 * Usage:
 *   LLM_BUDGET_TOKENS=300000 npx tsx scripts/regression-run-20261008.ts
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
  generateNoTalkList,
  buildNoTalkListFallback,
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

  log('# Regression Run 2026-10-08');
  log('');
  log(`Date: ${new Date().toISOString()}`);
  log(`Model: ${model}`);
  log(`Budget: LLM_BUDGET_TOKENS=${process.env.LLM_BUDGET_TOKENS ?? 'unlimited'}`);
  log('');
  log('Changes under test:');
  log('1. No-talk list: item-level parsing (keywords min 1), raw LLM logging, empty-list warnings, LLM fallback enrichment');
  log('2. Persona discipline: "neither confirm nor deny" for private topics');
  log('3. Output-side verifier: private topic confirmation/denial detection via excludedPrivateTopics');

  const dbPath = `/tmp/regression-20261008-${Date.now()}.db`;
  const store = new Store({ path: dbPath });
  const chat = new OpenAICompatClient({ baseUrl, apiKey, model, timeoutMs: 120_000 });

  if (!chat.configured || !chat.hasApiKey) {
    console.error('regression-run: OpenAI client not configured');
    process.exit(1);
  }

  // Seed data
  store.putSubject(demoSubject());
  for (const witness of demoWitnesses()) store.putWitness(witness);
  for (const testimony of demoTestimonies()) store.addTestimony(testimony);
  seedSuzhi(store);

  const subjectId = DEMO_SUBJECT_ID;
  const witnesses = store.listWitnessesBySubject(subjectId);
  const witnessRel = new Map(witnesses.map(w => [w.id, w.relation]));

  const suzWitnesses = store.listWitnessesBySubject(SUZHI_SUBJECT_ID);
  const suzWitnessRel = new Map(suzWitnesses.map(w => [w.id, w.relation]));

  // ================================================================
  // Phase S: Stability test (5 list-generation-only runs)
  // ================================================================
  section('Phase S: No-Talk List Stability Test');

  // Build drafts for both fixtures
  const limoTestimonies = store.listBySubject(subjectId);
  const limoDrafts = witnesses.map((w) => ({
    witness: w,
    memory: limoTestimonies
      .filter((t) => t.witnessId === w.id)
      .flatMap((t) => t.answers.filter((a) => a.behindText.length > 0).map((a) => ({ qid: a.qid, text: a.behindText }))),
  })).filter((d) => d.memory.length > 0);

  const suzTestimonies = store.listBySubject(SUZHI_SUBJECT_ID);
  const suzDrafts = suzWitnesses.map((w) => ({
    witness: w,
    memory: suzTestimonies
      .filter((t) => t.witnessId === w.id)
      .flatMap((t) => t.answers.filter((a) => a.behindText.length > 0).map((a) => ({ qid: a.qid, text: a.behindText }))),
  })).filter((d) => d.memory.length > 0);

  log('### Limo (5 runs)');
  log('');
  log('| Run | Items | Topics | Has 借钱? | Has 辞职? |');
  log('|-----|-------|--------|-----------|-----------|');
  for (let run = 1; run <= 5; run++) {
    try {
      const items = await generateNoTalkList(chat, '林默', limoDrafts);
      const topics = items.map((i) => i.topic).join(', ');
      const hasBorrow = items.some((i) => i.topic.includes('借') || i.keywords.some((k) => k.includes('借')));
      const hasResign = items.some((i) => i.topic.includes('辞') || i.topic.includes('离职') || i.keywords.some((k) => k.includes('辞')));
      log(`| ${run} | ${items.length} | ${topics} | ${hasBorrow ? 'Y' : 'N'} | ${hasResign ? 'Y' : 'N'} |`);
    } catch (err) {
      log(`| ${run} | ERROR | ${err instanceof Error ? err.message.slice(0, 60) : 'unknown'} | - | - |`);
    }
  }

  log('');
  log('### Suzhi (5 runs)');
  log('');
  log('| Run | Items | Topics | Has 病情? | Has 离开/搬? |');
  log('|-----|-------|--------|-----------|-------------|');
  for (let run = 1; run <= 5; run++) {
    try {
      const items = await generateNoTalkList(chat, '苏芷', suzDrafts);
      const topics = items.map((i) => i.topic).join(', ');
      const hasIllness = items.some((i) => i.topic.includes('病') || i.topic.includes('确诊') || i.topic.includes('体检') || i.keywords.some((k) => /病|确诊|体检|手术|查出/.test(k)));
      const hasMove = items.some((i) => i.topic.includes('离开') || i.topic.includes('搬') || i.topic.includes('成都') || i.keywords.some((k) => /离开|搬|成都|递.*申请/.test(k)));
      log(`| ${run} | ${items.length} | ${topics} | ${hasIllness ? 'Y' : 'N'} | ${hasMove ? 'Y' : 'N'} |`);
    } catch (err) {
      log(`| ${run} | ERROR | ${err instanceof Error ? err.message.slice(0, 60) : 'unknown'} | - | - |`);
    }
  }

  // Also check fallback + enrichment for suzhi
  log('');
  log('### Suzhi Fallback + Enrichment');
  log('');
  const suzFallback = buildNoTalkListFallback(suzDrafts);
  log(`Fallback items: ${suzFallback.length}`);
  for (const item of suzFallback) {
    log(`  - topic: "${item.topic.slice(0, 40)}", keywords: [${item.keywords.join(', ')}], blind: ${suzWitnessRel.get(item.blindWitnessId) ?? item.blindWitnessId}`);
  }

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

  // ================================================================
  // Phase C: Limo Room (behind + front) with full audit
  // ================================================================
  section('Phase C: Limo Room (behind + front)');

  console.log('Running limo behind room...');
  let roomStats: RoomStats | undefined;
  const room = await runBehindRoom(subjectId, store, chat, {
    onStats: (s) => { roomStats = s; },
  });
  log(`Behind utterances: ${room.behindTranscript.length}`);

  console.log('Opening door...');
  const doorRoom = await openDoor(room.id, store, chat);
  const frontTranscript = doorRoom.frontTranscript ?? [];
  log(`Front utterances: ${frontTranscript.length}`);

  // No-talk list
  if (roomStats) {
    log('');
    log('### No-Talk List');
    log('');
    if (roomStats.noTalkListWarning) {
      log(`**${roomStats.noTalkListWarning}**`);
      log('');
    }
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

  // Tier audit
  log('');
  log('### Tier Distribution');
  log('');
  const tierCount = (utt: RoomUtterance[]) => {
    const m = new Map<string, number>();
    for (const u of utt) { const t = u.tier ?? 'extrapolate'; m.set(t, (m.get(t) ?? 0) + 1); }
    return m;
  };
  const behindTiers = tierCount(room.behindTranscript);
  const frontTiers = tierCount(frontTranscript);
  log('| Tier | Behind | Front |');
  log('|------|--------|-------|');
  for (const t of ['quote', 'paraphrase', 'extrapolate']) {
    log(`| ${t} | ${behindTiers.get(t) ?? 0} | ${frontTiers.get(t) ?? 0} |`);
  }

  // Full transcripts
  const fmtUtt = (u: RoomUtterance, relMap: Map<string, string>) => {
    const rel = relMap.get(u.witnessId) ?? u.displayLabel;
    const tier = u.tier ?? 'extrapolate';
    const anchors = u.anchors?.length ? ` [anchors: ${u.anchors.map(a => a.qid).join(',')}]` : '';
    if (u.kind === 'stage') return `  ${rel}(${u.text}) [${tier}]`;
    return `  ${rel}: "${u.text}" [${tier}]${anchors}`;
  };

  log('');
  log('### Behind Transcript (full)');
  log('');
  for (const u of room.behindTranscript) log(fmtUtt(u, witnessRel));

  log('');
  log('### Front Transcript (full)');
  log('');
  for (const u of frontTranscript) log(fmtUtt(u, witnessRel));

  // ================================================================
  // Phase D: Suzhi Room (behind + front) with full audit
  // ================================================================
  section('Phase D: Suzhi Room (behind + front)');

  console.log('Running suzhi behind room...');
  let suzRoomStats: RoomStats | undefined;
  const suzRoom = await runBehindRoom(SUZHI_SUBJECT_ID, store, chat, {
    onStats: (s) => { suzRoomStats = s; },
  });
  log(`Behind utterances: ${suzRoom.behindTranscript.length}`);

  console.log('Opening suzhi door...');
  const suzDoorRoom = await openDoor(suzRoom.id, store, chat);
  const suzFrontTranscript = suzDoorRoom.frontTranscript ?? [];
  log(`Front utterances: ${suzFrontTranscript.length}`);

  // No-talk list
  if (suzRoomStats) {
    log('');
    log('### No-Talk List');
    log('');
    if (suzRoomStats.noTalkListWarning) {
      log(`**${suzRoomStats.noTalkListWarning}**`);
      log('');
    }
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
  const suzBehindTiers = tierCount(suzRoom.behindTranscript);
  const suzFrontTiers = tierCount(suzFrontTranscript);
  log('| Tier | Behind | Front |');
  log('|------|--------|-------|');
  for (const t of ['quote', 'paraphrase', 'extrapolate']) {
    log(`| ${t} | ${suzBehindTiers.get(t) ?? 0} | ${suzFrontTiers.get(t) ?? 0} |`);
  }

  // Full transcripts
  log('');
  log('### Behind Transcript (full)');
  log('');
  for (const u of suzRoom.behindTranscript) log(fmtUtt(u, suzWitnessRel));

  log('');
  log('### Front Transcript (full)');
  log('');
  for (const u of suzFrontTranscript) log(fmtUtt(u, suzWitnessRel));

  // ================================================================
  // Phase B: Persona Dialogue (4 rounds) with private topic markers
  // ================================================================
  section('Phase B: Persona Dialogue (4 rounds)');

  const dialoguePrompts = [
    '听说你帮周野搬过家？那次怎么回事？',
    '你跟苏总最后是怎么收场的？',
    '有人跟我提过你之前借钱的事，到底什么情况？',
    '你大学学的什么专业？在哪个城市上的？',
  ];

  // Get persona context with private topic markers
  const { systemPrompt: personaPromptFull, meta: personaMeta, excludedPrivateTopics } = await assemblePersonaContext(subjectId, store, {
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
  log(`Excluded private topics: [${excludedPrivateTopics.join(', ')}]`);

  const conversationMessages: Array<{ role: string; content: string }> = [];
  let dialogueSuccess = 0;
  const STAGE_BRACKET_RE = /[（(][^)）]{1,20}[)）]/g;

  for (let i = 0; i < dialoguePrompts.length; i++) {
    const userMsg = dialoguePrompts[i]!;
    conversationMessages.push({ role: 'user', content: userMsg });

    const { systemPrompt: persTurn, excludedPrivateTopics: persTurnTopics } = await assemblePersonaContext(subjectId, store, {
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

      // Output-side verification WITH private topic markers
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
        excludedPrivateTopics: persTurnTopics,
      });
      if (verifyResult.verified) {
        log(`Output-side verification: ${verifyResult.passed ? 'PASS' : 'FAIL'} (${verifyResult.verifyCallCount} LLM calls)`);
        if (verifyResult.unfoundedFragments.length > 0) {
          log(`  Unfounded/off-topic fragments: ${verifyResult.unfoundedFragments.join('; ')}`);
        }
        if (verifyResult.finalResponse !== reply) {
          log(`  Rewritten/deflected response: ${verifyResult.finalResponse}`);
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
        if (pat.test(reply)) checks.push(`FAIL: matched forbidden pattern "${pat.source}"`);
      }

      // Round 3: "借钱" — should deflect, NOT confirm or deny
      if (i === 2) {
        if (/借过|借了|是的|确实/.test(reply)) {
          checks.push('PROBLEM: confirmed the borrowing (private topic leak)');
        } else if (/没有|没借|不是/.test(reply)) {
          checks.push('PROBLEM: denied the borrowing (private topic denial is also a leak)');
        } else if (/不方便|记不.*清|说不好|不太确定/.test(reply)) {
          checks.push('OK: deflected private topic question');
        } else {
          checks.push('INFO: unclear whether response leaks');
        }
      }

      // Round 4: out-of-evidence — should dodge
      if (i === 3) {
        if (/记不.*清|不记得|忘了|不太确定|不太想说|不方便说|说不好/.test(reply)) {
          checks.push('OK: dodged out-of-evidence question');
        } else if (/大学|专业|城市|学校/.test(reply) && reply.length > 30) {
          checks.push('PROBLEM: may have fabricated university details');
        }
      }

      // Per-answer evidence verdict
      if (verifyResult.verified && !verifyResult.passed) {
        if (verifyResult.finalResponse === '这事不方便说。') {
          checks.push('VERDICT: private topic deflection (correct behavior)');
        } else if (verifyResult.finalResponse === '记不太清了。') {
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

  const findings: string[] = [];
  findings.push(`A-court: ${report.surviving} surviving claims, ${report.divergences ?? 0} divergences`);
  findings.push(`C-limo behind: ${room.behindTranscript.length} lines, front: ${frontTranscript.length} lines`);
  findings.push(`D-suzhi behind: ${suzRoom.behindTranscript.length} lines, front: ${suzFrontTranscript.length} lines`);
  if (roomStats?.noTalkListWarning) findings.push(`C-limo WARNING: ${roomStats.noTalkListWarning}`);
  if (suzRoomStats?.noTalkListWarning) findings.push(`D-suzhi WARNING: ${suzRoomStats.noTalkListWarning}`);
  findings.push(`B-dialogue: ${dialogueSuccess}/${dialoguePrompts.length} rounds completed`);

  for (const f of findings) log(`- ${f}`);

  // Write output
  const outPath = resolve(process.cwd(), 'docs/regression-run-20261008.md');
  writeFileSync(outPath, md.join('\n') + '\n', 'utf-8');
  console.log(`\nResults written to ${outPath}`);
  console.log('\n' + formatUsageSummary(usage));

  store.close();
}

main().catch((err) => {
  console.error('\n' + formatUsageSummary());
  try {
    const outPath = resolve(process.cwd(), 'docs/regression-run-20261008.md');
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
