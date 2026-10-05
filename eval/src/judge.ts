/**
 * Pairwise judge: given a real answer R and two candidates A/B, ask which
 * candidate is closer in content to R. Each pair is run twice with positions
 * swapped; inconsistent results discard the pair.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { extractJson } from '@openmimic/shared';
import type { LLMClient, LLMCompletionRequest } from '@openmimic/engine-court';

/* ------------------------------------------------------------------ */
/* Prompt & SHA-256 freeze                                             */
/* ------------------------------------------------------------------ */

const __dirname = dirname(fileURLToPath(import.meta.url));

export const JUDGE_PROMPT_FILE = join(__dirname, 'judge-prompt.txt');

export function loadJudgePrompt(): string {
  return readFileSync(JUDGE_PROMPT_FILE, 'utf-8');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** The SHA-256 of the frozen judge prompt. Set after first write. */
let FROZEN_SHA: string | undefined;

export function getJudgePromptSha(): string {
  if (!FROZEN_SHA) {
    FROZEN_SHA = sha256(loadJudgePrompt());
  }
  return FROZEN_SHA;
}

export function verifyJudgePromptSha(expectedSha: string): void {
  const actual = getJudgePromptSha();
  if (actual !== expectedSha) {
    throw new Error(
      `Judge prompt SHA mismatch: expected ${expectedSha}, got ${actual}. ` +
        'The prompt has been modified since calibration — refusing to run.',
    );
  }
}

/* ------------------------------------------------------------------ */
/* Response schema                                                     */
/* ------------------------------------------------------------------ */

const JudgeResponseSchema = z.object({
  winner: z.enum(['A', 'B']),
  cue: z.string(),
});

export type JudgeResponse = z.infer<typeof JudgeResponseSchema>;

/* ------------------------------------------------------------------ */
/* Single LLM call                                                     */
/* ------------------------------------------------------------------ */

export interface JudgeCallOptions {
  /** Max tokens for the LLM response (default 256). */
  maxTokens?: number;
}

async function callJudge(
  llm: LLMClient,
  systemPrompt: string,
  realAnswer: string,
  candidateA: string,
  candidateB: string,
  options: JudgeCallOptions = {},
): Promise<JudgeResponse | null> {
  const user = [
    `## 真实回答 R`,
    realAnswer,
    '',
    `## 候选 A`,
    candidateA,
    '',
    `## 候选 B`,
    candidateB,
  ].join('\n');

  const request: LLMCompletionRequest = { system: systemPrompt, user, purpose: 'eval-judge' };

  // Two attempts: initial + one retry
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await llm.complete(request);
      const parsed = JudgeResponseSchema.parse(extractJson(text));
      return parsed;
    } catch {
      // retry once
    }
  }
  return null; // parse failure after retry => discard
}

/* ------------------------------------------------------------------ */
/* Pairwise comparison with position swap                              */
/* ------------------------------------------------------------------ */

export type PairResult =
  | { status: 'valid'; winner: 'first' | 'second'; cues: [string, string] }
  | { status: 'discarded'; reason: string };

/**
 * Compare two candidates against a real answer with position swap.
 *
 * Run 1: first=A, second=B. Run 2: first=B, second=A.
 * If both runs agree on which candidate wins, return valid.
 * If they disagree, discard.
 */
export async function judgePair(
  llm: LLMClient,
  realAnswer: string,
  candidateFirst: string,
  candidateSecond: string,
  options: JudgeCallOptions = {},
): Promise<PairResult> {
  const prompt = loadJudgePrompt();

  // Run 1: first as A, second as B
  const run1 = await callJudge(llm, prompt, realAnswer, candidateFirst, candidateSecond, options);
  if (!run1) return { status: 'discarded', reason: 'parse failure in run 1' };

  // Run 2: swap positions
  const run2 = await callJudge(llm, prompt, realAnswer, candidateSecond, candidateFirst, options);
  if (!run2) return { status: 'discarded', reason: 'parse failure in run 2' };

  // run1: A=first, B=second; run1.winner='A' means first wins
  // run2: A=second, B=first; run2.winner='A' means second wins (=first loses)
  const run1FirstWins = run1.winner === 'A';
  const run2FirstWins = run2.winner === 'B'; // B in run2 is candidateFirst

  if (run1FirstWins === run2FirstWins) {
    return {
      status: 'valid',
      winner: run1FirstWins ? 'first' : 'second',
      cues: [run1.cue, run2.cue],
    };
  }

  return { status: 'discarded', reason: 'position swap inconsistency' };
}
