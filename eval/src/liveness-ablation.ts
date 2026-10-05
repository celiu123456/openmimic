/**
 * Liveness ablation: compare prompt discipline variants on liveness
 * pairwise win rate.
 *
 * For a given persona, constructs several prompt variants by text
 * substitution on the assembled persona prompt (no kernel changes),
 * runs each variant through the same scenarios, then judges pairs
 * using the liveness judge.
 *
 * Reuses the existing Wilson interval and ledger from eval/src/.
 * Naming is prefixed with "liveness-" to distinguish from the
 * existing LOWO/content ablation in ablation.ts.
 */

import type { LLMClient, LLMCompletionRequest } from '@openmimic/engine-court';
import { wilsonInterval } from './wilson';
import { writeRun, type RunRecord } from './ledger';
import { requireLivenessCalibration } from './liveness-calibrate';
import {
  LIVENESS_JUDGE_PROMPT_SHA,
  verifyLivenessPromptSha,
  judgeLivenessPairs,
  type LivenessPairInput,
  type LivenessPairVerdict,
  type ConversationTurn,
} from './liveness-judge';
import {
  SCENARIOS,
  type ScenarioScript,
} from './liveness-scenarios';

/* ------------------------------------------------------------------ */
/* Prompt variants                                                     */
/* ------------------------------------------------------------------ */

export interface LivenessVariant {
  id: string;
  label: string;
  hypothesis: string;
  /**
   * Transform the base persona system prompt into this variant.
   * Return null to use the base prompt unchanged (= the control arm).
   */
  transform(basePrompt: string): string | null;
}

export const LIVENESS_VARIANTS: LivenessVariant[] = [
  {
    id: 'current',
    label: '现状',
    hypothesis:
      '基线。不做任何修改,与当前人格提示词逐字一致,作为其余变体的对照。',
    transform: () => null,
  },
  {
    id: 'slim',
    label: '精简纪律',
    hypothesis:
      '假设:行为纪律中的重复约束把模型推向"逐条交差"的 AI 腔。只保留不重复的约束行。',
    transform: (base) => {
      // Remove duplicate constraint lines (simple overlap heuristic)
      const lines = base.split('\n');
      const seen = new Set<string>();
      const result: string[] = [];
      for (const line of lines) {
        const norm = line
          .replace(/^[\s\-*·0-9.、)）]+/, '')
          .replace(/\s/g, '');
        if (
          /不要|不得|禁止|请勿|必须|避免/.test(line) &&
          norm.length > 0 &&
          seen.has(norm)
        ) {
          continue;
        }
        if (norm.length > 0) seen.add(norm);
        result.push(line);
      }
      return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    },
  },
  {
    id: 'redline_only',
    label: '仅红线',
    hypothesis:
      '假设:大部分风格约束是负收益的——它们让模型"在执行指令"而非"在说话"。只留不可越的红线。',
    transform: (base) => {
      const blocks = base
        .split(/\n{2,}/)
        .map((b) => b.trim())
        .filter(Boolean);
      const kept = blocks.filter((block) =>
        /(禁止|不得|严禁|切勿|红线|绝对不|任何情况下)/.test(block),
      );
      return (kept.length > 0 ? kept : blocks.slice(0, 1)).join('\n\n');
    },
  },
  {
    id: 'with_style',
    label: '加入风格画像',
    hypothesis:
      '假设:加入 style-stats 生成的说话风格画像能提升活人感,因为它提供了具体的表达参照。',
    transform: (base) => {
      // This variant is meant to be used with an actual style discipline
      // block appended. The caller should provide the rendered style
      // discipline as part of the base prompt. If no style discipline
      // is available, this variant equals the control.
      return base;
    },
  },
];

/* ------------------------------------------------------------------ */
/* Dialogue generation                                                 */
/* ------------------------------------------------------------------ */

export interface LivenessDialogueTurn {
  user: string;
  assistant: string;
}

export interface LivenessDialogue {
  scenarioId: string;
  variantId: string;
  turns: LivenessDialogueTurn[];
}

/**
 * Generate a variant dialogue by running the scenario's scripted user
 * turns against an LLM with the variant's system prompt.
 */
async function generateDialogue(
  llm: LLMClient,
  scenario: ScenarioScript,
  variant: LivenessVariant,
  basePrompt: string,
): Promise<LivenessDialogue> {
  const transformed = variant.transform(basePrompt);
  const systemPrompt = transformed ?? basePrompt;

  const turns: LivenessDialogueTurn[] = [];
  const history: ConversationTurn[] = [];

  for (const userLine of scenario.userTurns) {
    const request: LLMCompletionRequest = {
      system: systemPrompt,
      user: [
        ...history.map(
          (h) =>
            `${h.role === 'user' ? '对方' : '我'}:${h.content}`,
        ),
        `对方:${userLine}`,
      ].join('\n'),
      purpose: 'eval-liveness-ablation',
    };
    const assistant = await llm.complete(request);
    turns.push({ user: userLine, assistant });
    history.push({ role: 'user', content: userLine });
    history.push({ role: 'assistant', content: assistant });
  }

  return { scenarioId: scenario.id, variantId: variant.id, turns };
}

/* ------------------------------------------------------------------ */
/* Battle pairing                                                      */
/* ------------------------------------------------------------------ */

/**
 * Pick the turn with the shortest user message (coldest turn)
 * where both sides have non-empty replies.
 */
function pickBattleTurn(
  left: LivenessDialogue,
  right: LivenessDialogue,
): number {
  const count = Math.min(left.turns.length, right.turns.length);
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < count; i++) {
    if (!left.turns[i]!.assistant.trim() || !right.turns[i]!.assistant.trim())
      continue;
    const score = left.turns[i]!.user.length;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function buildBattlePairs(
  dialogues: LivenessDialogue[],
  scenarios: ScenarioScript[],
): LivenessPairInput[] {
  const byScenario = new Map<string, LivenessDialogue[]>();
  for (const d of dialogues) {
    const list = byScenario.get(d.scenarioId) ?? [];
    list.push(d);
    byScenario.set(d.scenarioId, list);
  }

  const pairs: LivenessPairInput[] = [];
  for (const scenario of scenarios) {
    const list = byScenario.get(scenario.id) ?? [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const left = list[i]!;
        const right = list[j]!;
        const turnIdx = pickBattleTurn(left, right);
        if (turnIdx < 0) continue;
        const context: ConversationTurn[] = [];
        for (let k = 0; k < turnIdx; k++) {
          context.push({
            role: 'user',
            content: left.turns[k]!.user,
          });
          context.push({
            role: 'assistant',
            content: left.turns[k]!.assistant,
          });
        }
        pairs.push({
          pairId: `liveness__${scenario.id}__${left.variantId}__vs__${right.variantId}__t${turnIdx}`,
          scenarioId: scenario.id,
          context,
          trigger: left.turns[turnIdx]!.user,
          a: {
            label: left.variantId,
            text: left.turns[turnIdx]!.assistant,
          },
          b: {
            label: right.variantId,
            text: right.turns[turnIdx]!.assistant,
          },
        });
      }
    }
  }
  return pairs;
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export interface LivenessVariantStats {
  variantId: string;
  label: string;
  wins: number;
  losses: number;
  ties: number;
  validPairs: number;
  winRate: number;
  wilson95: { lower: number; center: number; upper: number };
}

export interface LivenessAblationResult {
  modelName: string;
  promptSha: string;
  scenarioCount: number;
  standings: LivenessVariantStats[];
  dialogues: LivenessDialogue[];
  verdicts: LivenessPairVerdict[];
}

function computeStandings(
  verdicts: LivenessPairVerdict[],
  variants: LivenessVariant[],
): LivenessVariantStats[] {
  const tally: Record<
    string,
    { wins: number; losses: number; ties: number }
  > = {};
  for (const v of variants) {
    tally[v.id] = { wins: 0, losses: 0, ties: 0 };
  }

  for (const verdict of verdicts) {
    const aId = verdict.labels.a;
    const bId = verdict.labels.b;
    if (!tally[aId] || !tally[bId]) continue;
    if (verdict.positionBias) continue;
    if (verdict.winner === 'tie') {
      tally[aId]!.ties++;
      tally[bId]!.ties++;
    } else if (verdict.winner === 'A') {
      tally[aId]!.wins++;
      tally[bId]!.losses++;
    } else {
      tally[bId]!.wins++;
      tally[aId]!.losses++;
    }
  }

  return variants.map((v) => {
    const t = tally[v.id]!;
    const valid = t.wins + t.losses;
    const wi = wilsonInterval(t.wins, valid);
    return {
      variantId: v.id,
      label: v.label,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      validPairs: valid,
      winRate: valid > 0 ? t.wins / valid : 0,
      wilson95: wi,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

export interface LivenessAblationOptions {
  modelName: string;
  /** Base persona system prompt to apply variants on. */
  basePrompt: string;
  /** Optional: base prompt with style discipline appended, for the with_style variant. */
  basePromptWithStyle?: string;
  scenarios?: ScenarioScript[];
  variants?: LivenessVariant[];
  skipCalibrationCheck?: boolean;
}

export async function runLivenessAblation(
  llm: LLMClient,
  options: LivenessAblationOptions,
): Promise<LivenessAblationResult> {
  if (!options.skipCalibrationCheck) {
    requireLivenessCalibration(options.modelName);
    verifyLivenessPromptSha(LIVENESS_JUDGE_PROMPT_SHA);
  }

  const scenarios = options.scenarios ?? SCENARIOS;
  const variants = options.variants ?? LIVENESS_VARIANTS;
  const dialogues: LivenessDialogue[] = [];

  for (const scenario of scenarios) {
    for (const variant of variants) {
      const base =
        variant.id === 'with_style' && options.basePromptWithStyle
          ? options.basePromptWithStyle
          : options.basePrompt;
      dialogues.push(
        await generateDialogue(llm, scenario, variant, base),
      );
    }
  }

  const pairs = buildBattlePairs(dialogues, scenarios);
  const verdicts = await judgeLivenessPairs(llm, pairs);
  const standings = computeStandings(verdicts, variants);

  const result: LivenessAblationResult = {
    modelName: options.modelName,
    promptSha: LIVENESS_JUDGE_PROMPT_SHA,
    scenarioCount: scenarios.length,
    standings,
    dialogues,
    verdicts,
  };

  // Write run log
  const run: RunRecord = {
    kind: 'liveness-ablation',
    modelName: options.modelName,
    promptSha: LIVENESS_JUDGE_PROMPT_SHA,
    commitSha: 'unknown',
    params: {
      scenarioCount: scenarios.length,
      variantCount: variants.length,
    },
    results: {
      standings: standings.map((s) => ({
        variantId: s.variantId,
        winRate: s.winRate,
        wilson95: s.wilson95,
        validPairs: s.validPairs,
      })),
    },
    details: [],
  };
  writeRun(run);

  return result;
}
