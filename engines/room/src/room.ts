import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CONSENT_OVERLAP_LENGTH,
  containsConsentOverlap,
  type Room,
  type RoomUtterance,
  type Testimony,
  type UtteranceAnchor,
  type Witness,
} from '@openmimic/shared';
import { UnknownRoomError, type Store } from '@openmimic/kernel';
import { RoomRefusedError } from './errors';
import type { LLMClient, LLMCompletionRequest } from './llm';
import { classifyUtterance, type WitnessTestimony } from './tier';
import { findCrisisWord, findDiagnosisWord } from './wordlist';

/* ------------------------------------------------------------------ */
/* Public constants                                                    */
/* ------------------------------------------------------------------ */

/** The seed topic when the caller does not pick one. */
export const DEFAULT_TOPIC_SEED = '最近怎么看 TA';

/** Hard ceiling on turns in one transcript; `opts` may only lower it. */
export const DEFAULT_MAX_UTTERANCES = 12;

/** Each witness speaks at most twice; `opts` may only lower it. */
export const DEFAULT_MAX_TURNS_PER_WITNESS = 2;

/**
 * The overlap guard now lives in `@openmimic/shared` so the HTTP layer can
 * reuse the exact same definition when it masks a court transcript. It is
 * re-exported here to keep the room engine's public surface unchanged.
 */
export { CONSENT_OVERLAP_LENGTH, containsConsentOverlap };

/** Replacement line when a `synthesis_only` witness keeps quoting. */
export const CONSENT_FALLBACK_STAGE = '他含糊地带过了这个话题';

/** Replacement line when a witness keeps talking in diagnostic labels. */
export const DIAGNOSIS_FALLBACK_STAGE = '他张了张嘴,把话咽了回去';

/**
 * The only lines a witness with no `frontText` is ever allowed to produce.
 *
 * A missing front answer means "I would not say this to their face" — so the
 * engine must not invent an opinion for them. All it may do is stage the
 * refusal. Five is the floor the task sets; there are six so the rotation does
 * not visibly repeat in a short transcript.
 */
export const FIXED_STAGE_LINES: readonly string[] = [
  '笑了笑,把话题接给了别人',
  '低头喝了口水',
  '盯着杯子没接话',
  '换了个坐姿,看向窗外',
  '打了个哈哈,说起别的事',
  '点了点头,没往下说',
];

/* ------------------------------------------------------------------ */
/* Anonymous witness display labels                                    */
/* ------------------------------------------------------------------ */

const ANON_LETTERS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;

/**
 * Build a display label for an anonymous witness.
 *
 * When `knownFromYear` is available: "一位认识他 N 年的人"
 * Otherwise: "一位认识他的人"
 *
 * When there are ≥2 anonymous witnesses, they are distinguished by
 * 甲/乙/丙/… suffixes. The order is shuffled per room generation.
 */
export function anonymousDisplayLabel(
  index: number,
  anonymousCount: number,
  knownFromYear?: number,
): string {
  const currentYear = new Date().getFullYear();
  const years = knownFromYear !== undefined ? currentYear - knownFromYear : undefined;
  const base = years !== undefined && years > 0
    ? `一位认识他 ${years} 年的人`
    : '一位认识他的人';

  if (anonymousCount >= 2) {
    const letter = ANON_LETTERS[index % ANON_LETTERS.length] ?? String(index);
    return `${base}${letter}`;
  }
  return base;
}

/**
 * Fisher-Yates shuffle (returns a new array).
 * Uses a seeded approach when a seed function is provided.
 */
function shuffleArray<T>(arr: readonly T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/**
 * Build a witness-id-to-displayLabel map that respects `anonymousInRoom`.
 * Anonymous witnesses get shuffled indices.
 */
export function buildDisplayLabels(
  witnesses: readonly Witness[],
): Map<string, string> {
  const labels = new Map<string, string>();
  const anonymousWitnesses = witnesses.filter((w) => w.anonymousInRoom);
  const shuffledAnon = shuffleArray(anonymousWitnesses);

  for (const witness of witnesses) {
    if (witness.anonymousInRoom) {
      const anonIndex = shuffledAnon.indexOf(witness);
      labels.set(
        witness.id,
        anonymousDisplayLabel(anonIndex, anonymousWitnesses.length, witness.knownFromYear),
      );
    } else {
      labels.set(witness.id, witness.relation);
    }
  }
  return labels;
}

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

export interface RunBehindRoomOptions {
  /** Topic seed; defaults to {@link DEFAULT_TOPIC_SEED}. */
  topicSeed?: string;
  /** Id factory, injectable for deterministic tests. */
  newId?: () => string;
  /** Clock, injectable for deterministic tests. */
  now?: () => string;
  /** Upper bound on utterances; values above 12 are clamped down. */
  maxUtterances?: number;
  /** Upper bound on turns per witness; values above 2 are clamped down. */
  maxTurnsPerWitness?: number;
}

export interface OpenDoorOptions {
  /** Clock, injectable for deterministic tests. */
  now?: () => string;
  /** Upper bound on utterances; values above 12 are clamped down. */
  maxUtterances?: number;
  /** Upper bound on turns per witness; values above 2 are clamped down. */
  maxTurnsPerWitness?: number;
}

/* ------------------------------------------------------------------ */
/* LLM plumbing                                                        */
/* ------------------------------------------------------------------ */

const TextResponseSchema = z.object({
  text: z.string().min(1),
  qids: z.array(z.string().min(1)).optional(),
});

export interface ParsedRoomResponse {
  text: string;
  qids: string[];
}

/**
 * Pull `{"text": "...", "qids": [...]}` out of a response that may be wrapped
 * in prose or a markdown fence. Throws when there is no usable object, which
 * the caller turns into one retry and then a skipped turn.
 */
export function parseRoomResponse(raw: string): ParsedRoomResponse {
  const trimmed = raw.trim();
  const attempts = [trimmed];
  const braced = /\{[\s\S]*\}/.exec(trimmed);
  if (braced?.[0]) attempts.push(braced[0]);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) attempts.push(fenced[1].trim());

  for (const candidate of attempts) {
    try {
      const parsed = TextResponseSchema.parse(JSON.parse(candidate) as unknown);
      return { text: parsed.text, qids: parsed.qids ?? [] };
    } catch {
      /* try the next, more forgiving candidate */
    }
  }
  throw new Error('room response did not contain a {"text": ...} object');
}

/** @deprecated Use {@link parseRoomResponse} instead. */
export function parseRoomText(raw: string): string {
  return parseRoomResponse(raw).text;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: Error };

async function attemptResponse(
  llm: LLMClient,
  request: LLMCompletionRequest,
  attempts: number,
): Promise<Attempt<ParsedRoomResponse>> {
  let error: Error = new Error('no attempt was made');
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      return { ok: true, value: parseRoomResponse(await llm.complete(request)) };
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }
  }
  return { ok: false, error };
}

/* ------------------------------------------------------------------ */
/* Prompt construction                                                 */
/* ------------------------------------------------------------------ */

type RoomMode = 'behind' | 'front';

export interface MemoryEntry {
  qid: string;
  text: string;
}

interface PersonaContext {
  witness: Witness;
  subjectName: string;
  /** Raw evidence this persona alone may draw on (behindText or frontText). */
  memory: MemoryEntry[];
}

/**
 * Action hint for a turn: whether the model should contribute testimony info
 * or just react casually (agree, short filler, change topic).
 */
export type ActionHint = 'contribute' | 'react';

/**
 * Opening styles for front-room witnesses. Each witness gets a different one
 * so they don't all say "来了/坐吧" in unison.
 */
export const OPENING_STYLES = [
  { tag: 'ask-recent', instruction: '问问TA最近的近况(工作、生活),用你自己的话,别说"最近怎么样"这种泛泛的。' },
  { tag: 'reminisce', instruction: '叙旧——提一件你们共同经历过的具体事,轻松自然。' },
  { tag: 'tease', instruction: '打趣TA一下,开个善意的小玩笑,让气氛轻松。' },
  { tag: 'care', instruction: '关心TA一件你知道的具体事(身体、搬家、忙不忙),不要笼统。' },
  { tag: 'deflect', instruction: '聊一件跟TA无关的事岔开话题(天气、吃的、最近看的剧),自然地带过。' },
] as const;

export type OpeningStyle = (typeof OPENING_STYLES)[number]['tag'];

interface BuildSystemExtra {
  /** For front mode: the opening style for this witness's first utterance. */
  openingStyle?: OpeningStyle;
  /** For front mode: whether this turn is the half-truth slot. */
  halfTruthSlot?: boolean;
  /** For front mode: whether the previous turn was the half-truth (so deflect). */
  deflectAfterHalfTruth?: boolean;
}

function buildSystem(
  context: PersonaContext,
  mode: RoomMode,
  topicSeed: string,
  actionHint: ActionHint = 'contribute',
  extra: BuildSystemExtra = {},
): string {
  const { witness, subjectName } = context;
  const lines: string[] = [];

  if (mode === 'behind') {
    lines.push(
      `你是${subjectName}的${witness.relation}。现在一屋子认识TA的人闲聊,话题是「${topicSeed}」。`,
      '你只说你自己亲眼见过、亲耳听过的事,不要编造。',
      '说话要像真正的饭桌上随口聊天:短句、口语、可以不完整。一次最多一两句,不要讲一整段。',
      '不要提"证言""问卷""数据""分析"这类词。',
    );
    // Action hint determines whether this turn should add testimony content
    if (actionHint === 'react') {
      lines.push(
        '这轮你只需要简单回应一下:接一句别人的话、附和一声、换个话题、或者说句无关的闲话。',
        '不要讲任何你记忆里的实质内容,qids给空数组。',
        '例如:"嗯,是这样。""哈,他就那样。""对了最近天气不错。""行吧。"',
      );
    } else {
      lines.push(
        '接上面的话往下聊。别人刚说了什么,你可以接着说、补充、或者换个角度讲同一件事。不要突然跳到完全无关的话题。',
        '大多数时候只是平淡的观察、近况更新;别人说到一个点,你可以附和然后顺带补一个自己见过的小细节。',
        '不要上来就说重磅的事。你的记忆里有些秘密或难堪事——那是私下跟你说的,在这种群里绝对不能说出口。实在被聊到边上,至多含糊带过或岔开话题。',
        '在场的还有TA的其他熟人(可能包括家人),说话留分寸。不要把所有记忆一口气倒出来。',
      );
    }
  } else {
    // Front mode: use frontText as primary material
    lines.push(
      `你是${subjectName}的${witness.relation}。${subjectName}刚走进来,一屋子人都在。`,
      '你只说你自己亲眼见过、亲耳听过的事,不要编造。',
      '当面说话要自然。说话像真正碰面时会说的话:短句、口语。一次最多一句。',
      '不要提"证言""问卷""数据""分析"这类词。',
      `${subjectName}就坐在面前,你不会当面评价TA、不会翻旧账、不会说重话。`,
    );

    if (extra.halfTruthSlot) {
      // This witness is chosen to let slip one short line that subtly echoes their behind-the-back talk
      lines.push(
        '你忍不住了——用很短的一句(不超过15个字)说出一个你背后提过的细节片段。',
        '要求:你记忆里有"(你背后说过:……)"的内容——从中挑一个4-6个字的短语,原封不动地放进你这句话里。',
        '整句不超过15个字,说完就像差点说漏嘴的感觉。',
        'qids给空数组。',
      );
    } else if (extra.deflectAfterHalfTruth) {
      // The person right after the half-truth should change the subject
      lines.push(
        '刚才有人差点说漏嘴了,你赶紧岔开话题,说点完全不相关的事。不要追问刚才的话。',
        'qids给空数组。',
      );
    } else if (actionHint === 'react') {
      lines.push(
        '这轮你只需要自然地接一句,不要说实质内容。qids给空数组。',
        '注意:不要说"坐吧""喝口水"之类的招呼话——前面已经有人说过了。说点具体的。',
      );
    } else {
      // contribute: draw from frontText
      lines.push(
        '你的记忆里有你曾经想好"当面会怎么说"的话——请以那些内容为素材,用你自己的口吻说出来。',
        '不要泛泛寒暄、不要说"坐吧""喝口水"之类所有人都会说的话。说点只有你才会说的内容。',
      );
      // Opening style for first utterance
      const style = extra.openingStyle
        ? OPENING_STYLES.find((s) => s.tag === extra.openingStyle)
        : undefined;
      if (style) {
        lines.push(`你的打开方式:${style.instruction}`);
      }
    }
  }

  if (witness.stance) lines.push(`你的态度:${witness.stance}。`);
  if (witness.consentLevel === 'synthesis_only') {
    lines.push('你之前的话只授权用于合成转述,你只能用自己的话重讲,绝不能复述原话。');
  }
  lines.push('只输出 JSON,形如 {"text":"你要说的话","qids":["q1"]},qids 填你这句话依据的记忆编号(没有就给空数组)。不要输出任何别的内容。');
  return lines.join('\n');
}

function buildUser(
  context: PersonaContext,
  mode: RoomMode,
  topicSeed: string,
  transcript: readonly RoomUtterance[],
  actionHint: ActionHint = 'contribute',
  extra: BuildSystemExtra = {},
): string {
  const said =
    transcript.length === 0
      ? '(还没有人开口)'
      : transcript
          .map((utterance) =>
            utterance.kind === 'stage'
              ? `${utterance.displayLabel}(${utterance.text})`
              : `${utterance.displayLabel}说:「${utterance.text}」`,
          )
          .join('\n');

  const memory =
    context.memory.length === 0
      ? '(你没有什么可讲的)'
      : context.memory.map((entry) => `- [${entry.qid}] ${entry.text}`).join('\n');

  const parts = [
    `话题:${topicSeed}`,
    '房间里已经说过的话:',
    said,
    '',
  ];

  if (mode === 'front') {
    parts.push(
      '你之前想好了当面要怎么说(以下是你自己写的当面话):',
      memory,
      '',
    );
  } else {
    parts.push(
      '只有你自己知道的记忆(别人看不到这些):',
      memory,
      '',
    );
  }

  // Highlight the last thing that was said so the model can respond to it
  if (transcript.length > 0) {
    const last = transcript[transcript.length - 1]!;
    if (last.kind === 'speech') {
      parts.push(`刚刚${last.displayLabel}说了:「${last.text}」`);
    }
  }

  if (mode === 'behind') {
    if (actionHint === 'react') {
      parts.push('现在轮到你,随便接一句就行,不用说你记忆里的事。简短点。');
    } else {
      parts.push('现在轮到你,接着聊,背着TA说一句。简短自然,像聊天不像念稿。');
    }
  } else {
    if (extra.halfTruthSlot) {
      parts.push(`${context.subjectName}就坐在面前。你忍不住了,从你背后说过的话里挑一个4-6字的短语,放进一句不超过15字的话里说出来。`);
    } else if (extra.deflectAfterHalfTruth) {
      parts.push(`${context.subjectName}就坐在面前。赶紧岔开话题,说点别的。`);
    } else if (actionHint === 'react') {
      parts.push(`${context.subjectName}就坐在面前,自然地接一句。不要说"坐吧""喝口水"。`);
    } else {
      parts.push(`${context.subjectName}就坐在面前,根据你想好的当面话,说一句。用你自己的方式说出来,不要照搬原文。`);
    }
  }

  return parts.join('\n');
}

function rewriteInstruction(consentHit: boolean, diagnosisWord: string | undefined): string {
  const parts = ['刚才那句不能这么说,请重说一遍,仍然只输出 JSON {"text":"..."}。'];
  if (consentHit) {
    parts.push('请改为转述,不得引用原话:不要出现你记忆里连续八个字以上的原句。');
  }
  if (diagnosisWord) {
    parts.push(`不要用「${diagnosisWord}」这类诊断说法下判断,只讲具体发生了什么。`);
  }
  return parts.join('\n');
}

interface ComposedLine {
  kind: 'speech' | 'stage';
  text: string;
  qids: string[];
}

/** Stage direction used when a secret leak is caught and cannot be rewritten. */
export const SECRET_LEAK_FALLBACK_STAGE = '欲言又止,没说下去';

/**
 * Phrases that mark content as private/confidential in testimony.
 * Used for the secret leak guard.
 */
const PRIVATE_MARKERS = [
  '别告诉',
  '别跟',
  '千万别',
  '别外传',
  '只跟你说',
  '你可别',
  '你别跟',
  '谁都没说',
  '别人不知道',
  '没跟',
  '嘱咐我',
];

/**
 * Extract private sentence ranges from a testimony text.
 * Returns the private sentences (sentence containing a marker + the preceding one).
 */
function extractPrivateSentences(text: string): string[] {
  const sentences = text.split(/(?<=[。！？；\n])/).map((s) => s.trim()).filter(Boolean);
  const result: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]!;
    if (PRIVATE_MARKERS.some((m) => sentence.includes(m))) {
      if (i > 0) result.push(sentences[i - 1]!);
      result.push(sentence);
    }
  }
  return result;
}

/**
 * Check if a generated line leaks private content from testimony.
 * Returns true if there is a >= 8 character substring overlap with private content.
 */
function hasPrivateLeak(
  text: string,
  privateTexts: readonly string[],
): boolean {
  const MIN_OVERLAP = 8;
  if (text.length < MIN_OVERLAP) return false;
  for (const priv of privateTexts) {
    if (priv.length < MIN_OVERLAP) continue;
    for (let start = 0; start + MIN_OVERLAP <= priv.length; start++) {
      if (text.includes(priv.slice(start, start + MIN_OVERLAP))) return true;
    }
  }
  return false;
}

/**
 * Generate one line for one persona, enforcing the three guards.
 *
 * Order of operations:
 * 1. one LLM call (retried once on unparseable output, then the turn is
 *    skipped entirely);
 * 2. if the line quotes a `synthesis_only` memory or uses a diagnostic label,
 *    one rewrite call;
 * 3. if the line leaks private content, one rewrite call;
 * 4. if the rewrite is also unusable, a fixed stage direction replaces it.
 */
async function composeLine(
  llm: LLMClient,
  context: PersonaContext,
  mode: RoomMode,
  topicSeed: string,
  transcript: readonly RoomUtterance[],
  actionHint: ActionHint = 'contribute',
  privateTexts: readonly string[] = [],
  secretLeakBudget?: { remaining: number },
  extra: BuildSystemExtra = {},
): Promise<ComposedLine | undefined> {
  const system = buildSystem(context, mode, topicSeed, actionHint, extra);
  const user = buildUser(context, mode, topicSeed, transcript, actionHint, extra);

  const first = await attemptResponse(llm, { system, user }, 2);
  if (!first.ok) return undefined;

  // The verbatim-overlap rule protects `synthesis_only` words only: a
  // `quotable` witness is allowed to be quoted back in their own voice.
  const memoryTexts = context.memory.map((m) => m.text);
  const consentHit =
    context.witness.consentLevel === 'synthesis_only' &&
    containsConsentOverlap(first.value.text, memoryTexts);
  const diagnosisWord = findDiagnosisWord(first.value.text);

  // Check for private content leak
  const leaksSecret =
    privateTexts.length > 0 && hasPrivateLeak(first.value.text, privateTexts);

  if (!consentHit && !diagnosisWord && !leaksSecret) {
    return { kind: 'speech', text: first.value.text, qids: first.value.qids };
  }

  // Secret leak: try rewrite, then fall back to hesitation stage direction
  if (leaksSecret && !consentHit && !diagnosisWord) {
    // If we still have budget for a "hesitation" mention, use it
    if (secretLeakBudget && secretLeakBudget.remaining > 0) {
      secretLeakBudget.remaining -= 1;
      return { kind: 'stage', text: SECRET_LEAK_FALLBACK_STAGE, qids: [] };
    }
    // No budget: just skip the private content and try a plain rewrite
    const rewritten = await attemptResponse(
      llm,
      {
        system,
        user: `${user}\n\n刚才那句涉及私事,换一句说。说点别的,不要说任何秘密或私下的事。`,
      },
      2,
    );
    if (rewritten.ok && !hasPrivateLeak(rewritten.value.text, privateTexts)) {
      return { kind: 'speech', text: rewritten.value.text, qids: rewritten.value.qids };
    }
    // Skip the turn entirely rather than leak
    return undefined;
  }

  const rewritten = await attemptResponse(
    llm,
    { system, user: `${user}\n\n${rewriteInstruction(consentHit, diagnosisWord)}` },
    2,
  );
  if (rewritten.ok) {
    const stillQuoting =
      context.witness.consentLevel === 'synthesis_only' &&
      containsConsentOverlap(rewritten.value.text, memoryTexts);
    const stillDiagnosing = findDiagnosisWord(rewritten.value.text);
    const stillLeaking =
      privateTexts.length > 0 && hasPrivateLeak(rewritten.value.text, privateTexts);
    if (!stillQuoting && !stillDiagnosing && !stillLeaking) {
      return { kind: 'speech', text: rewritten.value.text, qids: rewritten.value.qids };
    }
  }

  return {
    kind: 'stage',
    text: consentHit ? CONSENT_FALLBACK_STAGE : DIAGNOSIS_FALLBACK_STAGE,
    qids: [],
  };
}

/* ------------------------------------------------------------------ */
/* Shared scheduling                                                   */
/* ------------------------------------------------------------------ */

const clampCap = (value: number | undefined): number =>
  Math.max(0, Math.min(value ?? DEFAULT_MAX_UTTERANCES, DEFAULT_MAX_UTTERANCES));

const clampTurns = (value: number | undefined): number =>
  Math.max(0, Math.min(value ?? DEFAULT_MAX_TURNS_PER_WITNESS, DEFAULT_MAX_TURNS_PER_WITNESS));

interface UtteranceDraft {
  witness: Witness;
  memory: MemoryEntry[];
  /** Testimonies for this witness (for tier classification). */
  witnessTestimonies: WitnessTestimony[];
}

/**
 * Decide the action hint for a given turn position.
 *
 * The pattern ensures ~40-60% of turns are "react" (casual filler) and the
 * rest are "contribute" (can draw on testimony). Early turns lean contribute
 * to establish the conversation; later turns sprinkle in more filler.
 *
 * For front mode, react ratio is even higher (most turns should be small talk).
 */
function decideActionHint(
  turnIndex: number,
  totalPlanned: number,
  mode: RoomMode,
): ActionHint {
  if (mode === 'front') {
    // Front: ~50% contribute so frontText actually gets used
    // First turn always contributes (opening); then alternate
    if (turnIndex === 0) return 'contribute';
    return turnIndex % 2 === 0 ? 'contribute' : 'react';
  }
  // Behind: first 2 turns contribute (establish topic), then alternate
  if (turnIndex < 2) return 'contribute';
  // Odd positions react, even contribute (roughly 50/50)
  return turnIndex % 2 === 1 ? 'react' : 'contribute';
}

/** Check if `text` has ≥minLen contiguous character overlap with any existing speech. */
function hasDedupConflict(
  text: string,
  existing: readonly RoomUtterance[],
  minLen: number = 5,
): boolean {
  for (const u of existing) {
    if (u.kind !== 'speech') continue;
    for (let start = 0; start + minLen <= text.length; start++) {
      if (u.text.includes(text.slice(start, start + minLen))) return true;
    }
  }
  return false;
}

/**
 * Pick the next speaker. Instead of strict round-robin, we allow the previous
 * speaker's "responder" to go next sometimes, creating more natural back-and-forth.
 *
 * Rules:
 * - No one speaks twice in a row.
 * - Each witness gets at most `maxTurnsPerWitness` total turns.
 * - A witness who just spoke cannot be the immediate next speaker.
 * - Occasionally (every 3rd pick), let someone who hasn't spoken recently go
 *   to prevent monopoly.
 */
function pickNextSpeaker(
  drafts: readonly UtteranceDraft[],
  utterances: readonly RoomUtterance[],
  turnCounts: Map<string, number>,
  maxPerWitness: number,
  turnIndex: number,
): UtteranceDraft | undefined {
  const eligible = drafts.filter(
    (d) => (turnCounts.get(d.witness.id) ?? 0) < maxPerWitness,
  );
  if (eligible.length === 0) return undefined;

  const lastSpeaker = utterances.length > 0
    ? utterances[utterances.length - 1]!.witnessId
    : undefined;

  // Filter out the last speaker (no consecutive turns)
  const nonRepeat = eligible.filter((d) => d.witness.id !== lastSpeaker);
  const pool = nonRepeat.length > 0 ? nonRepeat : eligible;

  if (pool.length === 0) return undefined;

  // Every 3rd turn, prefer the least-spoken witness for variety
  if (turnIndex % 3 === 2) {
    const minTurns = Math.min(...pool.map((d) => turnCounts.get(d.witness.id) ?? 0));
    const leastSpoken = pool.filter(
      (d) => (turnCounts.get(d.witness.id) ?? 0) === minTurns,
    );
    if (leastSpoken.length > 0) {
      return leastSpoken[turnIndex % leastSpoken.length];
    }
  }

  // Default: round-robin through eligible pool
  return pool[turnIndex % pool.length];
}

/**
 * Schedule and generate room utterances.
 *
 * Uses a conversation-aware speaker selection instead of strict round-robin,
 * and assigns action hints to create a mix of testimony-anchored content and
 * casual filler.
 */
/** Extra scheduling config for the front room. */
interface FrontScheduleConfig {
  /** Opening style assignment: witnessId -> style tag. */
  openingStyles: Map<string, OpeningStyle>;
  /** The witness who should say the half-truth (if any). */
  halfTruthWitnessId: string | undefined;
  /** Behind-room behindText entries keyed by witnessId for the half-truth prompt. */
  behindMemory: Map<string, MemoryEntry[]>;
}

async function runSchedule(
  drafts: readonly UtteranceDraft[],
  subjectName: string,
  mode: RoomMode,
  topicSeed: string,
  llm: LLMClient,
  now: () => string,
  cap: number,
  turns: number,
  stageLine: () => string,
  displayLabels: Map<string, string>,
  privateTexts: readonly string[] = [],
  frontConfig?: FrontScheduleConfig,
): Promise<RoomUtterance[]> {
  const utterances: RoomUtterance[] = [];
  const turnCounts = new Map<string, number>();
  const maxPerWitness = turns;
  // At most 1 "hesitation" stage direction for secret leaks per room
  const secretLeakBudget = { remaining: mode === 'behind' ? 1 : 0 };
  // Track whether the half-truth has been spoken
  let halfTruthDone = false;
  // Track whether the previous turn was the half-truth (so next person deflects)
  let lastWasHalfTruth = false;

  for (let turnIndex = 0; utterances.length < cap; turnIndex += 1) {
    const draft = pickNextSpeaker(drafts, utterances, turnCounts, maxPerWitness, turnIndex);
    if (!draft) break; // all witnesses exhausted

    const displayLabel = displayLabels.get(draft.witness.id) ?? draft.witness.relation;
    const context: PersonaContext = {
      witness: draft.witness,
      subjectName,
      memory: draft.memory,
    };

    if (mode === 'front' && draft.memory.length === 0) {
      // No frontText => no invented opinion. Only a stage direction.
      utterances.push({
        witnessId: draft.witness.id,
        displayLabel,
        text: stageLine(),
        kind: 'stage',
        at: now(),
        tier: 'extrapolate',
        anchors: [],
      });
      turnCounts.set(draft.witness.id, (turnCounts.get(draft.witness.id) ?? 0) + 1);
      lastWasHalfTruth = false;
      continue;
    }

    let actionHint = decideActionHint(turnIndex, cap, mode);

    // Build extra hints for front mode
    const extra: BuildSystemExtra = {};
    if (mode === 'front' && frontConfig) {
      // Is this the first utterance for this witness? Assign opening style
      const witTurns = turnCounts.get(draft.witness.id) ?? 0;
      if (witTurns === 0) {
        extra.openingStyle = frontConfig.openingStyles.get(draft.witness.id);
        actionHint = 'contribute'; // first utterance always contributes
      }

      // Half-truth logic: trigger on the chosen witness's second turn (or first if only 1 turn),
      // but only if not already done
      if (
        !halfTruthDone &&
        draft.witness.id === frontConfig.halfTruthWitnessId &&
        witTurns >= 1 // second turn
      ) {
        extra.halfTruthSlot = true;
        // Give this persona their behind-room memory for the half-truth hint
        const behindMem = frontConfig.behindMemory.get(draft.witness.id) ?? [];
        if (behindMem.length > 0) {
          // Add behind memory as temporary context (doesn't go into the official memory)
          context.memory = [
            ...context.memory,
            ...behindMem.map((m) => ({ qid: m.qid, text: `(你背后说过:${m.text})` })),
          ];
        }
      }

      // Deflect after half-truth
      if (lastWasHalfTruth) {
        extra.deflectAfterHalfTruth = true;
      }
    }

    // Get private texts for this specific witness's testimony
    const witnessPrivateTexts = mode === 'behind'
      ? privateTexts
      : []; // front mode: no private content to guard (frontText is already filtered)

    const line = await composeLine(
      llm,
      context,
      mode,
      topicSeed,
      utterances,
      actionHint,
      witnessPrivateTexts,
      secretLeakBudget,
      extra,
    );
    if (!line) {
      // unparseable twice: skip this turn but still count
      turnCounts.set(draft.witness.id, (turnCounts.get(draft.witness.id) ?? 0) + 1);
      lastWasHalfTruth = false;
      continue;
    }

    // Dedup guard: check for ≥5 char contiguous overlap with existing utterances
    if (line.kind === 'speech' && hasDedupConflict(line.text, utterances)) {
      // Try one rewrite with an explicit instruction
      const retryLine = await composeLine(
        llm,
        context,
        mode,
        topicSeed,
        utterances,
        actionHint,
        witnessPrivateTexts,
        secretLeakBudget,
        extra,
      );
      if (retryLine && retryLine.kind === 'speech' && !hasDedupConflict(retryLine.text, utterances)) {
        // Use the retry
        Object.assign(line, retryLine);
      } else {
        // Still a dup: fall back to stage direction
        line.kind = 'stage';
        line.text = stageLine();
        line.qids = [];
      }
    }

    // Track half-truth
    if (extra.halfTruthSlot && line.kind === 'speech') {
      halfTruthDone = true;
      lastWasHalfTruth = true;
    } else {
      lastWasHalfTruth = false;
    }

    // Build anchors from model-cited qids
    const citedAnchors: UtteranceAnchor[] = line.qids.flatMap((qid) =>
      draft.witnessTestimonies.map((t) => ({ testimonyId: t.testimonyId, qid })),
    );

    const { tier, anchors } = classifyUtterance({
      text: line.text,
      kind: line.kind,
      witnessId: draft.witness.id,
      consentLevel: draft.witness.consentLevel,
      citedAnchors,
      testimonies: draft.witnessTestimonies,
    });

    utterances.push({
      witnessId: draft.witness.id,
      displayLabel,
      text: line.text,
      kind: line.kind,
      at: now(),
      tier,
      anchors,
    });
    turnCounts.set(draft.witness.id, (turnCounts.get(draft.witness.id) ?? 0) + 1);
  }

  return utterances;
}

/* ------------------------------------------------------------------ */
/* Behind the back                                                     */
/* ------------------------------------------------------------------ */

/**
 * Run the "behind the subject's back" room.
 *
 * Every witness of the subject becomes a persona. Each persona's context
 * contains *only its own* raw `behindText` (court scope: a room is internal
 * synthesis, so the authorization gate does not redact here) plus what has
 * already been said out loud in the room. No persona ever sees another
 * persona's testimony.
 */
export async function runBehindRoom(
  subjectId: string,
  store: Store,
  llm: LLMClient,
  options: RunBehindRoomOptions = {},
): Promise<Room> {
  const topicSeed = options.topicSeed ?? DEFAULT_TOPIC_SEED;
  const crisisWord = findCrisisWord(topicSeed);
  if (crisisWord) {
    // Refuse before touching the store or the LLM: this is not a room.
    throw new RoomRefusedError(
      `话题种子包含危机词面「${crisisWord}」,拒绝开房`,
    );
  }

  const newId = options.newId ?? (() => randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  const cap = clampCap(options.maxUtterances);
  const turns = clampTurns(options.maxTurnsPerWitness);

  const subjectName = store.getSubject(subjectId)?.displayName ?? 'TA';
  const testimonies = store.listBySubject(subjectId);
  const drafts = store
    .listWitnessesBySubject(subjectId)
    .map((witness) => {
      const witTestimonies = testimonies.filter((t) => t.witnessId === witness.id);
      return {
        witness,
        memory: witTestimonies
          .flatMap((testimony) =>
            testimony.answers
              .filter((answer) => answer.behindText.length > 0)
              .map((answer) => ({ qid: answer.qid, text: answer.behindText })),
          ),
        witnessTestimonies: witTestimonies.map((t) => ({
          testimonyId: t.id,
          witnessId: t.witnessId,
          answers: t.answers,
        })),
      };
    })
    .filter((draft) => draft.memory.length > 0);

  const witnesses = store.listWitnessesBySubject(subjectId);
  const displayLabels = buildDisplayLabels(witnesses);

  // Extract private content from all testimony for the secret leak guard
  const privateTexts: string[] = [];
  for (const draft of drafts) {
    for (const mem of draft.memory) {
      const sentences = extractPrivateSentences(mem.text);
      privateTexts.push(...sentences);
    }
  }

  let stageCursor = 0;
  const utterances = await runSchedule(
    drafts,
    subjectName,
    'behind',
    topicSeed,
    llm,
    now,
    cap,
    turns,
    () => {
      const line = FIXED_STAGE_LINES[stageCursor % FIXED_STAGE_LINES.length] as string;
      stageCursor += 1;
      return line;
    },
    displayLabels,
    privateTexts,
  );

  const room: Room = {
    id: newId(),
    subjectId,
    topicSeed,
    status: 'behind_only',
    behindTranscript: utterances,
    createdAt: now(),
  };
  store.putRoom(room);
  return room;
}

/* ------------------------------------------------------------------ */
/* Open the door                                                       */
/* ------------------------------------------------------------------ */

/**
 * Open the door: regenerate the same room with the subject present.
 *
 * The context switches to the `frontText` column only. A witness who never
 * wrote a front answer is *not* given one by the model — they may only produce
 * a line from {@link FIXED_STAGE_LINES}, which is what "当面不会说" honestly
 * looks like.
 *
 * Idempotent: calling it on an already-opened room returns the stored room and
 * makes no LLM calls.
 */
export async function openDoor(
  roomId: string,
  store: Store,
  llm: LLMClient,
  options: OpenDoorOptions = {},
): Promise<Room> {
  const room = store.getRoom(roomId);
  if (!room) throw new UnknownRoomError(`room not found: ${roomId}`);
  if (room.status === 'door_opened' && room.frontTranscript) return room;

  const now = options.now ?? (() => new Date().toISOString());
  const cap = clampCap(options.maxUtterances);
  const turns = clampTurns(options.maxTurnsPerWitness);

  const subjectName = store.getSubject(room.subjectId)?.displayName ?? 'TA';
  const testimonies = store.listBySubject(room.subjectId);
  const witnesses = store.listWitnessesBySubject(room.subjectId);
  const displayLabels = buildDisplayLabels(witnesses);
  const drafts = witnesses.map((witness) => {
    const witTestimonies = testimonies.filter((t) => t.witnessId === witness.id);
    return {
      witness,
      memory: witTestimonies
        .flatMap((testimony) =>
          testimony.answers
            .filter((answer) => (answer.frontText ?? '').length > 0)
            .map((answer) => ({ qid: answer.qid, text: answer.frontText as string })),
        ),
      witnessTestimonies: witTestimonies.map((t) => ({
        testimonyId: t.id,
        witnessId: t.witnessId,
        answers: t.answers,
      })),
    };
  });

  // Build behind-room memory for half-truth selection
  const behindMemoryByWit = new Map<string, MemoryEntry[]>();
  for (const witness of witnesses) {
    const witTestimonies = testimonies.filter((t) => t.witnessId === witness.id);
    const behindMem = witTestimonies.flatMap((testimony) =>
      testimony.answers
        .filter((a) => a.behindText.length > 0)
        .map((a) => ({ qid: a.qid, text: a.behindText })),
    );
    if (behindMem.length > 0) behindMemoryByWit.set(witness.id, behindMem);
  }

  // Choose half-truth witness: the one with the most behind-talk who also has frontText
  const draftsWithFront = drafts.filter((d) => d.memory.length > 0);
  let halfTruthWitnessId: string | undefined;
  if (draftsWithFront.length > 0) {
    let maxBehind = 0;
    for (const d of draftsWithFront) {
      const behindLen = (behindMemoryByWit.get(d.witness.id) ?? [])
        .reduce((sum, m) => sum + m.text.length, 0);
      if (behindLen > maxBehind) {
        maxBehind = behindLen;
        halfTruthWitnessId = d.witness.id;
      }
    }
  }

  // Assign opening styles to witnesses who have frontText
  const openingStyles = new Map<string, OpeningStyle>();
  const shuffledStyles = shuffleArray([...OPENING_STYLES]);
  let styleIdx = 0;
  for (const d of draftsWithFront) {
    const style = shuffledStyles[styleIdx % shuffledStyles.length]!;
    openingStyles.set(d.witness.id, style.tag);
    styleIdx++;
  }

  const frontConfig: FrontScheduleConfig = {
    openingStyles,
    halfTruthWitnessId,
    behindMemory: behindMemoryByWit,
  };

  let stageCursor = 0;
  const frontTranscript = await runSchedule(
    drafts,
    subjectName,
    'front',
    room.topicSeed,
    llm,
    now,
    cap,
    turns,
    () => {
      const line = FIXED_STAGE_LINES[stageCursor % FIXED_STAGE_LINES.length] as string;
      stageCursor += 1;
      return line;
    },
    displayLabels,
    [], // no private texts in front mode
    frontConfig,
  );

  return store.updateRoomFront(roomId, frontTranscript);
}
