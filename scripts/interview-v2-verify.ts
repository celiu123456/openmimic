#!/usr/bin/env npx tsx
/**
 * Interview v2 verification: run one v2 interview with scripted witness
 * answers against a real LLM to verify follow-up generation, intent
 * classification, retreat detection, and basis tagging.
 *
 * Reads LLM configuration from `.env`. Uses LLM_BUDGET_CALLS env var
 * (default 60) to limit total LLM calls.
 *
 * Usage: LLM_BUDGET_CALLS=60 npx tsx scripts/interview-v2-verify.ts
 *
 * Writes results to docs/interviewer-v2-run.md.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '@openmimic/kernel';
import { OpenAICompatClient } from '@openmimic/engine-court';
import {
  startInterview,
  answerQuestion,
  answerFollowup,
  finishInterview,
} from '@openmimic/engine-witness';
import {
  WITNESS_V2_FRIEND,
  classifyIntent,
  classifyBasis,
  detectRetreat,
} from '@openmimic/engine-witness';
import {
  getUsageSummary,
  formatUsageSummary,
  BudgetExceededError,
  InsufficientBalanceError,
} from '@openmimic/shared';

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

/** Scripted witness answers, designed to exercise different code paths. */
const SCRIPTED_ANSWERS: Array<{
  description: string;
  text: string;
  expectedBasis?: string;
  expectedIntent?: string;
  expectFollowup?: boolean;
  expectRetreat?: boolean;
}> = [
  {
    description: 'Bare evaluation (no clue) -- should trigger max 1 follow-up',
    text: '他人挺好的，挺随和的。',
    expectedBasis: 'unknown',
    expectedIntent: 'CONTENT',
    expectFollowup: true,
  },
  {
    description: 'Clue-bearing but concrete answer (>40 chars) -- no follow-up needed',
    text: '记得有一次我搬家，他二话没说请了一天假来帮忙，从早到晚，还自己开车把大件送过去。',
    expectedBasis: 'unknown',
    expectedIntent: 'CONTENT',
    expectFollowup: false,
  },
  {
    description: 'Long concrete answer -- should NOT trigger follow-up (concrete detail)',
    text: '去年冬天他刚升职，部门聚餐的时候他主动买了单，大概花了两千多。那天他说了一句话让我印象很深，他说"我知道大家最近加班辛苦，这顿算我请大家的"。当时我就觉得他是个会照顾人的人，不是那种只顾自己的领导。后来他还专门给每个人写了一张手写的感谢卡，每张卡上写的内容都不一样，你能看出来他是真的花了心思去观察每个人。',
    expectedBasis: 'inferred',  // "大概" triggers inferred pattern (quantity context, regex limitation)
    expectedIntent: 'CONTENT',
    expectFollowup: false,
  },
  {
    description: 'Heard evidence -- basis should be heard',
    text: '听别人说他以前在老公司的时候也是这样，同事们都很喜欢他。',
    expectedBasis: 'heard',
    expectedIntent: 'CONTENT',
  },
  {
    description: 'Inferred -- basis should be inferred',
    text: '我猜他可能小时候家里管得比较严，所以长大了对别人特别宽容。',
    expectedBasis: 'inferred',
    expectedIntent: 'CONTENT',
  },
  {
    description: 'Retreat signal -- should auto-skip',
    text: '这个不想说，换个话题吧。',
    expectRetreat: true,
  },
  {
    description: 'Skip intent',
    text: '这个话题不太了解，跳过吧。',
    expectedIntent: 'SKIP_TOPIC',
  },
  {
    description: 'Another clue-bearing answer',
    text: '比如说上次我们一起旅游，他总是主动帮大家拍照，自己几乎没怎么入镜。',
    expectedBasis: 'witnessed',
    expectedIntent: 'CONTENT',
    expectFollowup: true,
  },
];

interface RoundRecord {
  round: number;
  qid: string;
  prompt: string;
  answer: string;
  intent: string;
  basis: string;
  retreat: string;
  followup: string;
  followupSkipped: boolean;
  notes: string;
}

async function main() {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  const budgetCalls = parseInt(process.env.LLM_BUDGET_CALLS ?? '60', 10);

  if (!baseUrl || !apiKey || !model) {
    console.error('interview-v2-verify: LLM not configured');
    process.exit(1);
  }

  console.log(`Model: ${model}`);
  console.log(`Budget: ${budgetCalls} calls`);
  console.log(`Questionnaire: ${WITNESS_V2_FRIEND.id} (${WITNESS_V2_FRIEND.questions.length} questions)`);

  // Budget is read from LLM_BUDGET_CALLS env var by the shared usage ledger.
  process.env.LLM_BUDGET_CALLS = String(budgetCalls);
  const llm = new OpenAICompatClient({ baseUrl, apiKey, model });
  const store = new Store();

  // Create subject and invite
  const subjectId = randomUUID();
  store.putSubject({ id: subjectId, displayName: '张三(虚构)' });
  const invite = {
    token: randomUUID(),
    subjectId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  store.putInvite(invite);

  // Create witness
  const witnessId = randomUUID();
  store.putWitness({
    id: witnessId,
    subjectId,
    relation: '朋友',
    consentLevel: 'quotable',
  });

  const options = {
    llm,
    questionnaireId: WITNESS_V2_FRIEND.id,
  };

  const records: RoundRecord[] = [];
  let stopped = false;

  try {
    const { sessionId } = startInterview(store, invite.token, options);
    console.log(`Session: ${sessionId}`);

    const questions = WITNESS_V2_FRIEND.questions;
    const answerCount = Math.min(SCRIPTED_ANSWERS.length, questions.length);

    for (let i = 0; i < answerCount && !stopped; i++) {
      const scripted = SCRIPTED_ANSWERS[i]!;
      const question = questions[i]!;
      console.log(`\n--- Round ${i + 1}: ${question.qid} ---`);
      console.log(`Q: ${question.prompt}`);
      console.log(`A: ${scripted.text}`);

      // Run the pure classifiers for diagnostics
      const intent = classifyIntent(scripted.text);
      const basis = classifyBasis(scripted.text);
      const retreat = detectRetreat(scripted.text);

      console.log(`  Intent: ${intent.primary}, Basis: ${basis}, Retreat: ${retreat?.kind ?? 'none'}`);

      // Verify classifier results
      const notes: string[] = [];
      if (scripted.expectedBasis && basis !== scripted.expectedBasis) {
        notes.push(`BASIS MISMATCH: expected ${scripted.expectedBasis}, got ${basis}`);
      }
      if (scripted.expectedIntent && intent.primary !== scripted.expectedIntent) {
        notes.push(`INTENT MISMATCH: expected ${scripted.expectedIntent}, got ${intent.primary}`);
      }
      if (scripted.expectRetreat && !retreat) {
        notes.push('RETREAT EXPECTED but not detected');
      }

      let step;
      try {
        step = await answerQuestion(store, sessionId, { text: scripted.text }, { ...options, llm });
      } catch (err) {
        if (err instanceof BudgetExceededError || err instanceof InsufficientBalanceError) {
          console.log('  BUDGET/BALANCE LIMIT HIT -- stopping');
          notes.push(`STOPPED: ${(err as Error).message}`);
          records.push({
            round: i + 1,
            qid: question.qid,
            prompt: question.prompt,
            answer: scripted.text,
            intent: intent.primary,
            basis,
            retreat: retreat?.kind ?? 'none',
            followup: '',
            followupSkipped: false,
            notes: notes.join('; '),
          });
          stopped = true;
          break;
        }
        throw err;
      }

      let followupText = '';
      let followupSkipped = false;

      if ('followup' in step) {
        followupText = step.followup;
        console.log(`  Follow-up: ${followupText}`);

        if (scripted.expectFollowup === false) {
          notes.push('UNEXPECTED FOLLOW-UP generated');
        }

        // Skip the follow-up to keep moving
        answerFollowup(store, sessionId, { skip: true }, options);
        followupSkipped = true;
      } else {
        if (scripted.expectFollowup === true) {
          notes.push('EXPECTED FOLLOW-UP but none generated');
        }
      }

      if ('done' in step) {
        console.log('  Interview ended.');
        stopped = true;
      }

      records.push({
        round: i + 1,
        qid: question.qid,
        prompt: question.prompt,
        answer: scripted.text,
        intent: intent.primary,
        basis,
        retreat: retreat?.kind ?? 'none',
        followup: followupText,
        followupSkipped,
        notes: notes.join('; '),
      });
    }

    // Finish the interview
    if (!stopped) {
      try {
        finishInterview(store, sessionId, { relation: '朋友', consentLevel: 'quotable' }, options);
        console.log('\nInterview finished successfully.');
      } catch {
        console.log('\nInterview finish call failed (may be expected if already done).');
      }
    }
  } catch (err) {
    console.error('Error during interview:', err);
  }

  // Build the report
  const usage = getUsageSummary();
  const report = buildReport(records, usage, model, budgetCalls);

  const outputPath = resolve(import.meta.dirname ?? '.', '..', 'docs', 'interviewer-v2-run.md');
  writeFileSync(outputPath, report, 'utf-8');
  console.log(`\nReport written to: ${outputPath}`);
  console.log(formatUsageSummary(usage));

  store.close();
}

function buildReport(
  records: RoundRecord[],
  usage: { totals: { calls: number; promptTokens: number; completionTokens: number } },
  model: string,
  budgetCalls: number,
): string {
  const lines: string[] = [
    '# Interviewer v2 Real Model Verification Run',
    '',
    `> Generated: ${new Date().toISOString().slice(0, 10)}`,
    `> Model: ${model}`,
    `> Budget: ${budgetCalls} calls`,
    `> Actual calls: ${usage.totals.calls}`,
    `> Tokens: ${usage.totals.promptTokens} in / ${usage.totals.completionTokens} out`,
    `> Questionnaire: witness-v2-friend (10 questions)`,
    '',
    '## Per-Round Records',
    '',
  ];

  for (const r of records) {
    lines.push(`### Round ${r.round} (${r.qid})`);
    lines.push('');
    lines.push(`**Question:** ${r.prompt}`);
    lines.push('');
    lines.push(`**Scripted answer:** ${r.answer}`);
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| Intent | ${r.intent} |`);
    lines.push(`| Basis | ${r.basis} |`);
    lines.push(`| Retreat | ${r.retreat} |`);
    lines.push(`| Follow-up | ${r.followup || '(none)'} |`);
    lines.push(`| Follow-up skipped | ${r.followupSkipped} |`);
    if (r.notes) {
      lines.push(`| **Notes** | ${r.notes} |`);
    }
    lines.push('');
  }

  // Summary
  const followupCount = records.filter((r) => r.followup).length;
  const retreatCount = records.filter((r) => r.retreat !== 'none').length;
  const mismatchCount = records.filter((r) => r.notes.includes('MISMATCH')).length;

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Rounds completed | ${records.length} |`);
  lines.push(`| Follow-ups generated | ${followupCount} |`);
  lines.push(`| Retreats detected | ${retreatCount} |`);
  lines.push(`| Classifier mismatches | ${mismatchCount} |`);
  lines.push(`| LLM calls | ${usage.totals.calls} |`);
  lines.push(`| Budget remaining | ${budgetCalls - usage.totals.calls} |`);
  lines.push('');

  if (mismatchCount > 0) {
    lines.push('## Mismatches');
    lines.push('');
    for (const r of records.filter((rr) => rr.notes.includes('MISMATCH'))) {
      lines.push(`- Round ${r.round}: ${r.notes}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
