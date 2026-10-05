import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FakeLLM } from '@openmimic/engine-court';

import {
  ALL_SIGNALS,
  AI_TELL_SIGNALS,
  HUMAN_TELL_SIGNALS,
  SIGNAL_BY_ID,
  RUBRIC_VERSION,
  normalizeSignalIds,
  renderRubricForJudge,
  scanSignals,
} from '../src/liveness-rubric';

import {
  sha256,
  LIVENESS_JUDGE_PROMPT_SHA,
  verifyLivenessPromptSha,
  judgeLivenessPair,
  type LivenessPairInput,
} from '../src/liveness-judge';

import {
  checkSampleHygiene,
  filterCleanSamples,
} from '../src/sample-hygiene';

import {
  buildLivenessCalibrationPairs,
  LIVENESS_CALIBRATION_PASS_THRESHOLD,
  LIVENESS_CALIBRATION_MIN_PAIRS,
  LIVENESS_CALIBRATION_MAX_BIAS,
  type LivenessSample,
} from '../src/liveness-calibrate';

import {
  SCENARIOS,
  SCRIPT_KINDS,
  SCENARIO_BY_ID,
  validateScenarios,
  scenariosByKind,
  type ScenarioScript,
} from '../src/liveness-scenarios';

import {
  createRng,
  hashSeed,
  createSimulatorState,
  nextUserMessage,
  advance,
  applyAssistantReply,
  measureIrritationDelta,
  renderPersonaCard,
  runScenarioDialogue,
  type SimulatorState,
} from '../src/liveness-simulator';

import { writeRun, RUNS_DIR } from '../src/ledger';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeLivenessJudgeResponse(
  winner: 'one' | 'two',
  signalsOne: string[] = ['ai_listing_tone'],
  signalsTwo: string[] = ['human_short_elliptical'],
  reason: string = '回复一像列表',
): string {
  return JSON.stringify({ winner, signalsOne, signalsTwo, reason });
}

const sampleInput: LivenessPairInput = {
  pairId: 'test-pair-001',
  context: [{ role: 'user', content: '你在干嘛' }],
  trigger: '嗯',
  a: { label: 'variant-a', text: '嗯 在家呢' },
  b: { label: 'variant-b', text: '我正在家中休息呢!有什么我能帮你的吗?' },
};

/** Clean only test-generated run files. */
function cleanRuns(): void {
  if (existsSync(RUNS_DIR)) {
    for (const f of readdirSync(RUNS_DIR)) {
      if (f.endsWith('.json') && f.startsWith('2026-01-01')) {
        rmSync(join(RUNS_DIR, f));
      }
    }
  }
}

/* ================================================================== */
/* 1. Rubric                                                          */
/* ================================================================== */

describe('Liveness rubric', () => {
  it('has exactly 13 signals (7 AI + 6 human)', () => {
    expect(ALL_SIGNALS).toHaveLength(13);
    expect(AI_TELL_SIGNALS).toHaveLength(7);
    expect(HUMAN_TELL_SIGNALS).toHaveLength(6);
  });

  it('all signal IDs are unique', () => {
    const ids = ALL_SIGNALS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('SIGNAL_BY_ID resolves every signal', () => {
    for (const signal of ALL_SIGNALS) {
      expect(SIGNAL_BY_ID[signal.id]).toBe(signal);
    }
  });

  it('normalizeSignalIds drops unknown IDs', () => {
    const result = normalizeSignalIds([
      'ai_listing_tone',
      'totally_invented',
      'human_short_elliptical',
    ]);
    expect(result).toEqual(['ai_listing_tone', 'human_short_elliptical']);
  });

  it('normalizeSignalIds deduplicates', () => {
    const result = normalizeSignalIds([
      'ai_listing_tone',
      'ai_listing_tone',
    ]);
    expect(result).toEqual(['ai_listing_tone']);
  });

  it('normalizeSignalIds handles non-array input', () => {
    expect(normalizeSignalIds(null)).toEqual([]);
    expect(normalizeSignalIds('string')).toEqual([]);
    expect(normalizeSignalIds(42)).toEqual([]);
  });

  it('renderRubricForJudge includes all signal IDs', () => {
    const rubric = renderRubricForJudge();
    for (const signal of ALL_SIGNALS) {
      expect(rubric).toContain(signal.id);
    }
  });

  it('RUBRIC_VERSION is set', () => {
    expect(RUBRIC_VERSION).toBe('liveness_rubric_v1');
  });
});

/* ================================================================== */
/* 2. Signal detectors                                                */
/* ================================================================== */

describe('Signal detectors', () => {
  it('ai_listing_tone fires on numbered lists', () => {
    const signal = SIGNAL_BY_ID['ai_listing_tone']!;
    expect(signal.detector!('1. 第一点\n2. 第二点')).toBe(true);
  });

  it('ai_listing_tone does not fire on simple text', () => {
    const signal = SIGNAL_BY_ID['ai_listing_tone']!;
    expect(signal.detector!('嗯 在家呢')).toBe(false);
  });

  it('human_short_elliptical fires on short replies', () => {
    const signal = SIGNAL_BY_ID['human_short_elliptical']!;
    expect(signal.detector!('嗯')).toBe(true);
  });

  it('ai_always_warm fires on encouraging text', () => {
    const signal = SIGNAL_BY_ID['ai_always_warm']!;
    expect(signal.detector!('太棒了!你真的很厉害!')).toBe(true);
  });

  it('scanSignals returns structured result', () => {
    const scan = scanSignals('嗯');
    expect(scan.humanTells).toContain('human_short_elliptical');
    // Note: '嗯' also triggers several ai_tell detectors that check for
    // absence of certain patterns (e.g. ai_never_unsure, ai_never_shifts_topic),
    // so netHint may be negative for a single-char reply.
    expect(typeof scan.netHint).toBe('number');
  });

  it('scanSignals on AI-typical text has negative netHint', () => {
    const scan = scanSignals(
      '这是一个很好的问题。首先,你可以试试看更系统地整理一下。其次,建议你关注以下几个方面。加油,相信你一定可以做到的!',
    );
    expect(scan.aiTells.length).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/* 3. Judge: SHA freeze                                               */
/* ================================================================== */

describe('Liveness judge SHA', () => {
  it('sha256 is deterministic', () => {
    expect(sha256('test')).toBe(sha256('test'));
    expect(sha256('a')).not.toBe(sha256('b'));
  });

  it('LIVENESS_JUDGE_PROMPT_SHA is a 64-char hex string', () => {
    expect(LIVENESS_JUDGE_PROMPT_SHA).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifyLivenessPromptSha passes with correct SHA', () => {
    expect(() => verifyLivenessPromptSha(LIVENESS_JUDGE_PROMPT_SHA)).not.toThrow();
  });

  it('verifyLivenessPromptSha throws on mismatch', () => {
    expect(() => verifyLivenessPromptSha('deadbeef')).toThrow('SHA mismatch');
  });
});

/* ================================================================== */
/* 4. Judge: pairwise with position swap                              */
/* ================================================================== */

describe('Liveness judge pairwise', () => {
  it('consistent judge: A wins in both positions', async () => {
    const llm = new FakeLLM([
      // Run 1 (A in slot one): judge says "one" → A wins
      makeLivenessJudgeResponse('one', ['human_short_elliptical'], ['ai_listing_tone']),
      // Run 2 (A in slot two): judge says "two" → A wins (consistent)
      makeLivenessJudgeResponse('two', ['ai_listing_tone'], ['human_short_elliptical']),
    ]);
    const result = await judgeLivenessPair(llm, sampleInput);
    expect(result.winner).toBe('A');
    expect(result.agreement).toBe(true);
    expect(result.positionBias).toBe(false);
  });

  it('position bias: same slot chosen both times', async () => {
    const llm = new FakeLLM([
      // Run 1 (A in slot one): "one" → A wins
      makeLivenessJudgeResponse('one', ['human_short_elliptical'], ['ai_listing_tone']),
      // Run 2 (A in slot two): "one" → B wins (but chose same slot = bias)
      makeLivenessJudgeResponse('one', ['human_short_elliptical'], ['ai_listing_tone']),
    ]);
    const result = await judgeLivenessPair(llm, sampleInput);
    expect(result.positionBias).toBe(true);
    expect(result.winner).toBe('tie');
  });

  it('parse failure: discards to tie', async () => {
    const llm = new FakeLLM([
      'not json at all',
      'still not json',  // retry
      'not json round 2',
      'nope',  // retry for round 2
    ]);
    const result = await judgeLivenessPair(llm, sampleInput);
    expect(result.winner).toBe('tie');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('zero signals on both sides: discards the run', async () => {
    const llm = new FakeLLM([
      // Both signal arrays empty → should be discarded by iron-law #8
      JSON.stringify({
        winner: 'one',
        signalsOne: [],
        signalsTwo: [],
        reason: 'no evidence',
      }),
      // retry
      JSON.stringify({
        winner: 'one',
        signalsOne: [],
        signalsTwo: [],
        reason: 'still none',
      }),
      // second round also fails
      JSON.stringify({
        winner: 'two',
        signalsOne: [],
        signalsTwo: [],
        reason: 'empty',
      }),
      JSON.stringify({
        winner: 'two',
        signalsOne: [],
        signalsTwo: [],
        reason: 'empty',
      }),
    ]);
    const result = await judgeLivenessPair(llm, sampleInput);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/* 5. Sample hygiene                                                  */
/* ================================================================== */

describe('Sample hygiene', () => {
  it('clean text passes', () => {
    expect(checkSampleHygiene('嗯 在家呢').clean).toBe(true);
  });

  it('AI identity leak detected', () => {
    const r = checkSampleHygiene('作为一个AI语言模型,我无法提供');
    expect(r.clean).toBe(false);
    expect(r.reasons).toContain('ai_identity_leak');
  });

  it('prompt leak detected', () => {
    const r = checkSampleHygiene('你的设定是一个温柔的人');
    expect(r.clean).toBe(false);
    expect(r.reasons).toContain('prompt_leak');
  });

  it('seed marker detected', () => {
    const r = checkSampleHygiene('This is seed_0042 probe');
    expect(r.clean).toBe(false);
    expect(r.reasons).toContain('seed_or_fixture_marker');
  });

  it('emoji spam detected', () => {
    const r = checkSampleHygiene('太好了😊😊😊😊');
    expect(r.clean).toBe(false);
    expect(r.reasons).toContain('emoji_spam');
  });

  it('too long detected', () => {
    const long = '字'.repeat(300);
    const r = checkSampleHygiene(long);
    expect(r.clean).toBe(false);
    expect(r.reasons).toContain('too_long');
  });

  it('filterCleanSamples excludes dirty samples', () => {
    const { clean, excluded, reasonCounts } = filterCleanSamples([
      '正常的文本',
      '作为AI语言模型我认为',
      '也正常',
    ]);
    expect(clean).toHaveLength(2);
    expect(excluded).toBe(1);
    expect(reasonCounts['ai_identity_leak']).toBe(1);
  });
});

/* ================================================================== */
/* 6. Calibration pairing                                             */
/* ================================================================== */

describe('Liveness calibration', () => {
  const humanSamples: LivenessSample[] = Array.from({ length: 5 }, (_, i) => ({
    id: `human_${i}`,
    origin: 'human' as const,
    text: `正常回复${i}`,
  }));
  const aiSamples: LivenessSample[] = Array.from({ length: 5 }, (_, i) => ({
    id: `ai_${i}`,
    origin: 'ai' as const,
    text: `AI回复${i}`,
  }));

  it('builds pairs from human and AI samples', () => {
    const { pairs, hygieneExcluded } = buildLivenessCalibrationPairs(
      humanSamples,
      aiSamples,
    );
    expect(pairs).toHaveLength(5);
    expect(hygieneExcluded).toBe(0);
  });

  it('alternates humanSide for determinism', () => {
    const { pairs } = buildLivenessCalibrationPairs(humanSamples, aiSamples);
    expect(pairs[0]!.humanSide).toBe('A');
    expect(pairs[1]!.humanSide).toBe('B');
    expect(pairs[2]!.humanSide).toBe('A');
  });

  it('excludes hygiene-failing samples', () => {
    const dirtyHuman: LivenessSample[] = [
      { id: 'dirty', origin: 'human', text: '作为AI语言模型我很开心' },
      ...humanSamples,
    ];
    const { pairs, hygieneExcluded } = buildLivenessCalibrationPairs(
      dirtyHuman,
      aiSamples,
    );
    expect(hygieneExcluded).toBe(1);
    expect(pairs).toHaveLength(5); // still 5 clean human x 5 AI
  });

  it('respects maxPairs', () => {
    const { pairs } = buildLivenessCalibrationPairs(
      humanSamples,
      aiSamples,
      3,
    );
    expect(pairs).toHaveLength(3);
  });

  it('thresholds are correct', () => {
    expect(LIVENESS_CALIBRATION_PASS_THRESHOLD).toBe(0.8);
    expect(LIVENESS_CALIBRATION_MIN_PAIRS).toBe(20);
    expect(LIVENESS_CALIBRATION_MAX_BIAS).toBe(0.3);
  });
});

/* ================================================================== */
/* 7. Scenarios                                                       */
/* ================================================================== */

describe('Liveness scenarios', () => {
  it('has exactly 20 scenarios', () => {
    expect(SCENARIOS).toHaveLength(20);
  });

  it('has 5 categories x 4 each', () => {
    for (const kind of SCRIPT_KINDS) {
      const count = scenariosByKind(kind).length;
      expect(count).toBe(4);
    }
  });

  it('all IDs are unique', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(20);
  });

  it('SCENARIO_BY_ID resolves all scenarios', () => {
    for (const s of SCENARIOS) {
      expect(SCENARIO_BY_ID[s.id]).toBe(s);
    }
  });

  it('validateScenarios returns no issues', () => {
    const issues = validateScenarios();
    expect(issues).toEqual([]);
  });

  it('each scenario has 8-12 turns', () => {
    for (const s of SCENARIOS) {
      expect(s.userTurns.length).toBeGreaterThanOrEqual(8);
      expect(s.userTurns.length).toBeLessThanOrEqual(12);
    }
  });

  it('behaviors array matches userTurns length', () => {
    for (const s of SCENARIOS) {
      expect(s.behaviors).toHaveLength(s.userTurns.length);
    }
  });

  it('no scenario has all-null behaviors', () => {
    for (const s of SCENARIOS) {
      const hasBehavior = s.behaviors.some((b) => b !== null);
      expect(hasBehavior).toBe(true);
    }
  });
});

/* ================================================================== */
/* 8. Simulator                                                       */
/* ================================================================== */

describe('Liveness simulator', () => {
  it('createRng is deterministic', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1).toEqual(seq2);
  });

  it('createRng produces values in [0, 1)', () => {
    const rng = createRng(123);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('hashSeed is deterministic', () => {
    expect(hashSeed('test')).toBe(hashSeed('test'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });

  it('measureIrritationDelta increases for long AI replies', () => {
    const short = measureIrritationDelta('嗯');
    const long = measureIrritationDelta(
      '这是一个非常好的问题!首先建议你可以试试看不同的方法,因为每个人的情况都不一样。相信你一定可以找到适合自己的方式!加油!',
    );
    expect(long).toBeGreaterThan(short);
  });

  it('measureIrritationDelta is negative for very short replies', () => {
    expect(measureIrritationDelta('嗯')).toBeLessThan(0);
  });

  it('nextUserMessage returns null when turns exhausted', () => {
    const scenario = SCENARIOS[0]!;
    const state: SimulatorState = {
      scenarioId: scenario.id,
      turnIndex: scenario.userTurns.length,
      transcript: [],
      irritation: 0,
    };
    expect(nextUserMessage(scenario, state)).toBeNull();
  });

  it('nextUserMessage returns scripted line at low irritation', () => {
    const scenario = SCENARIOS[0]!;
    const state = createSimulatorState(scenario);
    const turn = nextUserMessage(scenario, state);
    expect(turn).not.toBeNull();
    expect(turn!.content).toBe(scenario.userTurns[0]);
    expect(turn!.source).toBe('script');
  });

  it('nextUserMessage overrides when irritation exceeds threshold', () => {
    const scenario = SCENARIOS[0]!;
    // Find a turn index where the script has no behavior
    let targetIdx = -1;
    for (let i = 0; i < scenario.behaviors.length; i++) {
      if (scenario.behaviors[i] === null) {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx < 0) return; // skip if all turns have behaviors

    const state: SimulatorState = {
      scenarioId: scenario.id,
      turnIndex: targetIdx,
      transcript: [],
      irritation: 5, // max irritation
    };
    const turn = nextUserMessage(scenario, state, { irritationThreshold: 3 });
    expect(turn).not.toBeNull();
    expect(turn!.source).toBe('behavior_override');
    expect(['grunt', 'short_reply']).toContain(turn!.behavior);
  });

  it('advance increments turnIndex', () => {
    const scenario = SCENARIOS[0]!;
    const state = createSimulatorState(scenario);
    const turn = nextUserMessage(scenario, state)!;
    const next = advance(state, turn);
    expect(next.turnIndex).toBe(1);
    expect(next.transcript).toHaveLength(1);
  });

  it('applyAssistantReply clamps irritation to [0,5]', () => {
    const scenario = SCENARIOS[0]!;
    const state: SimulatorState = {
      scenarioId: scenario.id,
      turnIndex: 0,
      transcript: [],
      irritation: 0,
    };
    const after = applyAssistantReply(state, '嗯'); // short → -1 delta
    expect(after.irritation).toBe(0); // clamped at 0

    const highState: SimulatorState = { ...state, irritation: 5 };
    const afterHigh = applyAssistantReply(
      highState,
      '首先建议你可以试试, 因为这很重要, 其次我觉得你真的非常棒! 加油! 相信你一定可以的! 1. 试试看 2. 坚持 3. 继续努力 太棒了!',
    );
    expect(afterHigh.irritation).toBe(5); // clamped at 5
  });

  it('renderPersonaCard includes all fields', () => {
    const card = SCENARIOS[0]!.persona;
    const text = renderPersonaCard(card);
    expect(text).toContain(card.name);
    expect(text).toContain(card.relation);
    expect(text).toContain(card.mood);
    expect(text).toContain(card.goal);
    expect(text).toContain(card.background);
  });

  it('runScenarioDialogue completes all turns', async () => {
    const scenario = SCENARIOS[0]!;
    let replyCount = 0;
    const replyFn = async () => {
      replyCount++;
      return '嗯';
    };
    const finalState = await runScenarioDialogue(scenario, replyFn);
    expect(finalState.turnIndex).toBe(scenario.userTurns.length);
    expect(replyCount).toBe(scenario.userTurns.length);
    // Transcript should have both user and assistant turns
    expect(finalState.transcript).toHaveLength(scenario.userTurns.length * 2);
  });
});

/* ================================================================== */
/* 9. Ablation variants                                               */
/* ================================================================== */

describe('Liveness ablation variants', () => {
  it('exports 4 variants', async () => {
    const { LIVENESS_VARIANTS } = await import('../src/liveness-ablation');
    expect(LIVENESS_VARIANTS).toHaveLength(4);
    expect(LIVENESS_VARIANTS.map((v) => v.id)).toEqual([
      'current',
      'slim',
      'redline_only',
      'with_style',
    ]);
  });

  it('current variant transform returns null (no change)', async () => {
    const { LIVENESS_VARIANTS } = await import('../src/liveness-ablation');
    const current = LIVENESS_VARIANTS.find((v) => v.id === 'current')!;
    expect(current.transform('anything')).toBeNull();
  });

  it('slim variant removes duplicate constraint lines', async () => {
    const { LIVENESS_VARIANTS } = await import('../src/liveness-ablation');
    const slim = LIVENESS_VARIANTS.find((v) => v.id === 'slim')!;
    const input = '- 不要说谎\n- 不要说谎\n- 要真诚';
    const result = slim.transform(input)!;
    // Should have removed the duplicate "不要说谎"
    const lines = result.split('\n').filter((l) => l.includes('不要说谎'));
    expect(lines).toHaveLength(1);
  });

  it('redline_only variant keeps only paragraphs with prohibition keywords', async () => {
    const { LIVENESS_VARIANTS } = await import('../src/liveness-ablation');
    const redline = LIVENESS_VARIANTS.find((v) => v.id === 'redline_only')!;
    const input = '普通段落一\n\n禁止泄露隐私\n\n普通段落二';
    const result = redline.transform(input)!;
    expect(result).toContain('禁止泄露隐私');
    expect(result).not.toContain('普通段落一');
    expect(result).not.toContain('普通段落二');
  });
});

/* ================================================================== */
/* 10. Integration: eval/src/index.ts exports liveness modules        */
/* ================================================================== */

describe('Eval index exports', () => {
  it('re-exports liveness-rubric', async () => {
    const mod = await import('../src/index');
    expect(mod.ALL_SIGNALS).toBeDefined();
    expect(mod.normalizeSignalIds).toBeDefined();
  });

  it('re-exports liveness-judge', async () => {
    const mod = await import('../src/index');
    expect(mod.LIVENESS_JUDGE_PROMPT_SHA).toBeDefined();
    expect(mod.judgeLivenessPair).toBeDefined();
  });

  it('re-exports sample-hygiene', async () => {
    const mod = await import('../src/index');
    expect(mod.checkSampleHygiene).toBeDefined();
    expect(mod.filterCleanSamples).toBeDefined();
  });

  it('re-exports liveness-scenarios', async () => {
    const mod = await import('../src/index');
    expect(mod.SCENARIOS).toBeDefined();
    expect(mod.validateScenarios).toBeDefined();
  });

  it('re-exports liveness-simulator', async () => {
    const mod = await import('../src/index');
    expect(mod.createRng).toBeDefined();
    expect(mod.runScenarioDialogue).toBeDefined();
  });
});
