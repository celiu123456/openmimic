/**
 * Irritation simulator for liveness evaluation.
 *
 * Plays the "uncooperative real human" side of a scripted conversation.
 * In scripted mode (the default), output is fully deterministic given
 * the same (scenario, seed, turnIndex, irritation) — the bench can
 * regress.
 *
 * Ported from personality_structure_server/eval/reply-liveness/simulator.ts.
 * LLM mode removed (OpenMimic eval uses EvalLLMClient directly).
 */

import type {
  PersonaCard,
  ScenarioScript,
  UncooperativeBehavior,
} from './liveness-scenarios';

/* ------------------------------------------------------------------ */
/* Deterministic RNG                                                   */
/* ------------------------------------------------------------------ */

/** mulberry32: small, fast, deterministic. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface SimulatorTurn {
  turnIndex: number;
  content: string;
  behavior: UncooperativeBehavior | null;
  source: 'script' | 'behavior_override';
}

export interface SimulatorState {
  scenarioId: string;
  turnIndex: number;
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Irritation level 0-5; rises when the AI reply is long/warm/listy. */
  irritation: number;
}

export function createSimulatorState(scenario: ScenarioScript): SimulatorState {
  return {
    scenarioId: scenario.id,
    turnIndex: 0,
    transcript: [],
    irritation: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Behavior lines (deterministic pool)                                 */
/* ------------------------------------------------------------------ */

const BEHAVIOR_LINES: Record<UncooperativeBehavior, string[]> = {
  short_reply: ['嗯行', '知道了', '哦这样', '行吧', '好'],
  grunt: ['嗯', '哦', '啊', '……', '嗯嗯'],
  topic_shift: [
    '对了 你吃饭了没',
    '不说这个了',
    '话说你那边天气咋样',
    '突然想起来个事',
  ],
  nitpick: [
    '你这话说的',
    '你干嘛这么说话',
    '你刚那句什么意思',
    '你以前不这么讲话',
  ],
  delayed: ['刚在忙', '回来了', '刚看到'],
};

/* ------------------------------------------------------------------ */
/* Irritation measurement                                              */
/* ------------------------------------------------------------------ */

/** Signs in the AI reply that increase user irritation. */
export function measureIrritationDelta(assistantReply: string): number {
  const text = String(assistantReply || '');
  let delta = 0;
  if (text.length > 120) delta += 1;
  if (/(建议你|你可以试试|其实是|需要注意的是|首先|其次)/.test(text))
    delta += 1;
  if (/(加油|你真|太棒了|辛苦了|我很高兴|相信你)/.test(text)) delta += 1;
  if (/(^|\n)\s*([0-9]+[.、)]|[-*·])/m.test(text)) delta += 1;
  if (text.length <= 20) delta -= 1;
  return delta;
}

export function applyAssistantReply(
  state: SimulatorState,
  reply: string,
): SimulatorState {
  return {
    ...state,
    transcript: [...state.transcript, { role: 'assistant', content: reply }],
    irritation: Math.max(
      0,
      Math.min(5, state.irritation + measureIrritationDelta(reply)),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Next user message                                                   */
/* ------------------------------------------------------------------ */

export interface SimulatorOptions {
  seed?: number;
  /**
   * When irritation reaches this threshold, the simulator forces an
   * uncooperative behavior even if the script didn't mark one.
   */
  irritationThreshold?: number;
}

/**
 * Generate the next user message. Deterministic for the same
 * (scenario, seed, turnIndex, irritation).
 */
export function nextUserMessage(
  scenario: ScenarioScript,
  state: SimulatorState,
  options: SimulatorOptions = {},
): SimulatorTurn | null {
  const turnIndex = state.turnIndex;
  if (turnIndex >= scenario.userTurns.length) return null;

  const scriptedLine = scenario.userTurns[turnIndex]!;
  const scriptedBehavior = scenario.behaviors[turnIndex] ?? null;
  const threshold = options.irritationThreshold ?? 3;

  // Irritation above threshold + script has no behavior → force one
  if (!scriptedBehavior && state.irritation >= threshold) {
    const rng = createRng(
      (options.seed ?? hashSeed(scenario.id)) +
        turnIndex * 7919 +
        state.irritation,
    );
    const forced: UncooperativeBehavior =
      rng() < 0.5 ? 'grunt' : 'short_reply';
    const pool = BEHAVIOR_LINES[forced];
    return {
      turnIndex,
      content: pool[Math.floor(rng() * pool.length)]!,
      behavior: forced,
      source: 'behavior_override',
    };
  }

  return {
    turnIndex,
    content: scriptedLine,
    behavior: scriptedBehavior,
    source: 'script',
  };
}

export function advance(
  state: SimulatorState,
  turn: SimulatorTurn,
): SimulatorState {
  return {
    ...state,
    turnIndex: state.turnIndex + 1,
    transcript: [...state.transcript, { role: 'user', content: turn.content }],
  };
}

/** Render persona card as text (for prompts). */
export function renderPersonaCard(persona: PersonaCard): string {
  return [
    `名字:${persona.name}`,
    `与对方的关系:${persona.relation}`,
    `此刻心情:${persona.mood}`,
    `这次聊天的目的:${persona.goal}`,
    `口头禅:${persona.tics.join('、')}`,
    `共同经历:${persona.background}`,
  ].join('\n');
}

/**
 * Run a complete scripted dialogue: each turn gets a user message,
 * which is fed to the replyFn to produce the AI reply.
 */
export async function runScenarioDialogue(
  scenario: ScenarioScript,
  replyFn: (
    userMessage: string,
    state: SimulatorState,
  ) => Promise<string>,
  options: SimulatorOptions = {},
): Promise<SimulatorState> {
  let state = createSimulatorState(scenario);
  for (;;) {
    const turn = nextUserMessage(scenario, state, options);
    if (!turn) break;
    state = advance(state, turn);
    const reply = await replyFn(turn.content, state);
    state = applyAssistantReply(state, reply);
  }
  return state;
}
