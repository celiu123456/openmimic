/**
 * Liveness pairwise judge.
 *
 * Given two replies to the same trigger, decide which one "sounds more
 * like a real person typed it." The judge MUST cite signal ids from the
 * rubric before declaring a winner — any judgment that cites only
 * invented reasons is discarded (method iron-law #8).
 *
 * Position swap: each pair is judged twice with A/B positions swapped.
 * Inconsistent results discard the pair (method iron-law #2).
 *
 * Prompt SHA freeze: the judge prompt is hashed and compared before
 * every run; a mismatch refuses to proceed (method iron-law #4).
 *
 * Ported from personality_structure_server/eval/reply-liveness/judge.ts,
 * adapted to use the existing eval LLM client interface.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LLMClient, LLMCompletionRequest } from '@openmimic/engine-court';
import {
  normalizeSignalIds,
  renderRubricForJudge,
  RUBRIC_VERSION,
  SIGNAL_BY_ID,
} from './liveness-rubric';

/* ------------------------------------------------------------------ */
/* Prompt & SHA-256 freeze                                             */
/* ------------------------------------------------------------------ */

const LIVENESS_JUDGE_SYSTEM = [
  '你是一位「活人感」评审。你要在同一场景下的两条聊天回复里,选出更像**真人随手打出来**的那条。',
  '',
  '你不打分。你按下面的信号清单判:先在两条回复里分别指认命中的信号 id,再据此选出赢家。',
  '判定原则:真人痕迹信号多、AI 腔信号少的一侧胜。若两侧信号相当,选更不像"在完成任务"的那条。',
  '不要因为回复更长、更有帮助、更礼貌就判它赢——那恰恰是 AI 腔。',
  '',
  renderRubricForJudge(),
  '',
  '只输出 JSON,不要代码块围栏,不要任何解释性前后缀:',
  '{"winner":"one"|"two","signalsOne":["信号id"],"signalsTwo":["信号id"],"reason":"不超过60字,必须引用回复里的具体字句作为证据"}',
].join('\n');

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

export const LIVENESS_JUDGE_PROMPT_SHA = sha256(LIVENESS_JUDGE_SYSTEM);

export function verifyLivenessPromptSha(expectedSha: string): void {
  if (LIVENESS_JUDGE_PROMPT_SHA !== expectedSha) {
    throw new Error(
      `Liveness judge prompt SHA mismatch: expected ${expectedSha}, ` +
        `got ${LIVENESS_JUDGE_PROMPT_SHA}. Prompt changed since calibration.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Response schema                                                     */
/* ------------------------------------------------------------------ */

const LivenessJudgeResponseSchema = z.object({
  winner: z.enum(['one', 'two']),
  signalsOne: z.array(z.string()),
  signalsTwo: z.array(z.string()),
  reason: z.string(),
});

/* ------------------------------------------------------------------ */
/* JSON extraction                                                     */
/* ------------------------------------------------------------------ */

function extractJson(raw: string): unknown {
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]!.trim() : text;
  const start = body.indexOf('{');
  if (start < 0)
    throw new Error(`Judge output contains no JSON: ${text.slice(0, 200)}`);
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') {
      depth--;
      if (depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error(`Judge output JSON unclosed: ${text.slice(0, 200)}`);
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface LivenessPairInput {
  pairId: string;
  scenarioId?: string;
  context: ConversationTurn[];
  trigger: string;
  a: { label: string; text: string };
  b: { label: string; text: string };
}

export interface SingleRunVerdict {
  chosenSlot: 'one' | 'two';
  winner: 'A' | 'B';
  signalsA: string[];
  signalsB: string[];
  reason: string;
  aInSlotOne: boolean;
}

export interface LivenessPairVerdict {
  pairId: string;
  scenarioId?: string;
  labels: { a: string; b: string };
  winner: 'A' | 'B' | 'tie';
  agreement: boolean;
  positionBias: boolean;
  runs: SingleRunVerdict[];
  signalsA: string[];
  signalsB: string[];
  reasons: string[];
  errors: string[];
}

/* ------------------------------------------------------------------ */
/* Single LLM call                                                     */
/* ------------------------------------------------------------------ */

function renderContext(context: ConversationTurn[]): string {
  if (!context?.length) return '(无上文)';
  return context
    .map((t) => `${t.role === 'user' ? '对方' : 'TA'}:${t.content}`)
    .join('\n');
}

function buildUserPrompt(
  input: LivenessPairInput,
  aInSlotOne: boolean,
): string {
  const one = aInSlotOne ? input.a : input.b;
  const two = aInSlotOne ? input.b : input.a;
  return [
    '【上文】',
    renderContext(input.context),
    '',
    `【对方刚发的这条】${input.trigger}`,
    '',
    '【回复一】',
    one.text,
    '',
    '【回复二】',
    two.text,
    '',
    '哪条更像真人随手打出来的?',
  ].join('\n');
}

async function runOnce(
  llm: LLMClient,
  input: LivenessPairInput,
  aInSlotOne: boolean,
): Promise<SingleRunVerdict> {
  const request: LLMCompletionRequest = {
    system: LIVENESS_JUDGE_SYSTEM,
    user: buildUserPrompt(input, aInSlotOne),
    purpose: 'eval-liveness-judge',
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await llm.complete(request);
      if (!raw.trim()) {
        throw new Error(
          'Judge content empty (reasoning model may have consumed all tokens ' +
            'on thinking — try increasing maxTokens or disabling thinking)',
        );
      }
      const parsed = LivenessJudgeResponseSchema.parse(extractJson(raw));
      const signalsOne = normalizeSignalIds(parsed.signalsOne);
      const signalsTwo = normalizeSignalIds(parsed.signalsTwo);

      // Discard if judge cited zero valid signals on BOTH sides
      // (method iron-law #8: judgment without rubric evidence is invalid)
      if (signalsOne.length === 0 && signalsTwo.length === 0) {
        throw new Error(
          'Judge cited zero valid signals on both sides — judgment discarded',
        );
      }

      const chosenSlot = parsed.winner;
      const winner: 'A' | 'B' =
        chosenSlot === 'one'
          ? aInSlotOne
            ? 'A'
            : 'B'
          : aInSlotOne
            ? 'B'
            : 'A';

      return {
        chosenSlot,
        winner,
        signalsA: aInSlotOne ? signalsOne : signalsTwo,
        signalsB: aInSlotOne ? signalsTwo : signalsOne,
        reason: parsed.reason.slice(0, 300),
        aInSlotOne,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/* ------------------------------------------------------------------ */
/* Pairwise comparison with position swap                              */
/* ------------------------------------------------------------------ */

const uniq = (values: string[]) => Array.from(new Set(values));

/**
 * Judge one pair. Runs two rounds with position swap.
 *
 * Result semantics:
 *   - Both rounds agree on winner → that winner, agreement=true
 *   - Both chose the same slot → tie, positionBias=true (pair voided)
 *   - Otherwise → tie, agreement=false (judge wavered)
 */
export async function judgeLivenessPair(
  llm: LLMClient,
  input: LivenessPairInput,
): Promise<LivenessPairVerdict> {
  const runs: SingleRunVerdict[] = [];
  const errors: string[] = [];

  for (const aInSlotOne of [true, false]) {
    try {
      runs.push(await runOnce(llm, input, aInSlotOne));
    } catch (err: unknown) {
      errors.push(String((err as Error)?.message ?? err));
    }
  }

  const base = {
    pairId: input.pairId,
    scenarioId: input.scenarioId,
    labels: { a: input.a.label, b: input.b.label },
    runs,
    signalsA: uniq(runs.flatMap((r) => r.signalsA)),
    signalsB: uniq(runs.flatMap((r) => r.signalsB)),
    reasons: runs.map((r) => r.reason).filter(Boolean),
    errors,
  };

  if (!runs.length) {
    return { ...base, winner: 'tie', agreement: false, positionBias: false };
  }
  if (runs.length === 1) {
    return {
      ...base,
      winner: runs[0]!.winner,
      agreement: false,
      positionBias: false,
    };
  }

  const [first, second] = runs as [SingleRunVerdict, SingleRunVerdict];
  const positionBias = first.chosenSlot === second.chosenSlot;
  const agreement = first.winner === second.winner;
  return {
    ...base,
    winner: agreement ? first.winner : 'tie',
    agreement,
    positionBias,
  };
}

/** Serialize judge calls for an array of pairs. */
export async function judgeLivenessPairs(
  llm: LLMClient,
  inputs: LivenessPairInput[],
): Promise<LivenessPairVerdict[]> {
  const out: LivenessPairVerdict[] = [];
  for (const input of inputs) {
    out.push(await judgeLivenessPair(llm, input));
  }
  return out;
}

export { LIVENESS_JUDGE_SYSTEM };
