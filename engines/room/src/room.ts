import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CONSENT_OVERLAP_LENGTH,
  containsConsentOverlap,
  normalizeProviderError,
  wrapUntrusted,
  appendGuardInstruction,
  type Room,
  type RoomUtterance,
  type Testimony,
  type UtteranceAnchor,
  type Witness,
} from '@openmimic/shared';
import { UnknownRoomError, computeFingerprint, type Store } from '@openmimic/kernel';
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
  /** Called with generation statistics after the room is built. */
  onStats?: (stats: RoomStats) => void;
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

/**
 * Attempt an LLM call, retrying only on retryable errors.
 * Non-retryable errors (402 quota, 401 auth) surface immediately.
 */
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
      // Non-retryable provider errors: stop immediately
      const normalized = normalizeProviderError('llm', caught);
      if (!normalized.retryable) {
        return { ok: false, error: normalized };
      }
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
  /** Max character length for the utterance (used on retry). */
  lengthHint?: number;
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
    // Front mode: use frontText as primary material, second person
    lines.push(
      `你是${subjectName}的${witness.relation}。${subjectName}刚走进来,一屋子人都在。`,
      '你只说你自己亲眼见过、亲耳听过的事,不要编造。',
      '当面说话要自然。说话像真正碰面时会说的话:短句、口语。一次最多一句。',
      '不要提"证言""问卷""数据""分析"这类词。',
      `${subjectName}就坐在面前,你不会当面评价TA、不会翻旧账、不会说重话。`,
      `★最重要的规则:你是对着${subjectName}说话,所以称呼必须用"你"或名字(${subjectName}),绝对不能用"他/她/TA"来指代${subjectName}。你的素材里可能是第三人称写的,你要改成第二人称说出来。`,
    );

    if (extra.halfTruthSlot) {
      // This witness is chosen to let slip a half-sentence echoing behind-room talk
      // Extract short phrases from behind memory for the model to use verbatim
      const behindPhrases = context.memory
        .filter((m) => m.text.startsWith('(你背后说过:'))
        .map((m) => m.text.replace(/^\(你背后说过:/, '').replace(/\)$/, ''))
        .flatMap((t) => {
          // Extract 4-6 char substrings as candidate phrases
          const phrases: string[] = [];
          for (let len = 6; len >= 4; len--) {
            for (let i = 0; i <= t.length - len; i++) {
              const p = t.substring(i, i + len);
              // Skip phrases that are mostly punctuation
              if (/^[\p{P}\s]+$/u.test(p)) continue;
              phrases.push(p);
            }
          }
          return phrases;
        });
      // Pick a random subset of candidate phrases
      const shuffledPhrases = shuffleArray(behindPhrases).slice(0, 5);

      lines.push(
        `你忍不住了——说一句极短的话(10-15字),话说一半就收住。`,
        '★关键要求:从下面的候选词里选一个,原封不动地放进你的句子里:',
        `候选词:${shuffledPhrases.map((p) => `"${p}"`).join('、')}`,
        '格式:"你"+候选词+几个字+"……"或"算了"。整句不超过20字。',
        '例:如果候选词是"没告诉我",你可以说"你那次没告诉我……算了。"',
        'qids给空数组。',
      );
    } else if (extra.deflectAfterHalfTruth) {
      lines.push(
        '刚才有人差点说漏嘴了,你赶紧岔开话题,说点完全不相关的事。不要追问刚才的话。',
        'qids给空数组。',
      );
    } else if (actionHint === 'react') {
      lines.push(
        '这轮你只需要自然地接一句,不要说实质内容。qids给空数组。',
        '注意:不要说"坐吧""喝口水"之类的招呼话——前面已经有人说过了。说点具体的。',
        `记住:对着${subjectName}说话,用"你",不要用"他"。`,
      );
    } else {
      lines.push(
        '你的记忆里有你曾经想好"当面会怎么说"的话——请以那些内容为素材,改成对他本人说的话(用"你")说出来。',
        '不要泛泛寒暄、不要说"坐吧""喝口水"之类所有人都会说的话。说点只有你才会说的内容。',
      );
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
  if (extra.lengthHint) {
    lines.push(`★这句话不要超过${extra.lengthHint}个字。短一点,像对话不像念稿。`);
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
      : context.memory.map((entry) => `- [${entry.qid}] ${wrapUntrusted(`memory:${entry.qid}`, entry.text)}`).join('\n');

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
      parts.push(`${context.subjectName}就坐在面前。你忍不住了,用极短一句(不超过15字)说一半就收住。用"你"开头,以"……"或"算了"结尾。`);
    } else if (extra.deflectAfterHalfTruth) {
      parts.push(`${context.subjectName}就坐在面前。赶紧岔开话题,说点别的。`);
    } else if (actionHint === 'react') {
      parts.push(`${context.subjectName}就坐在面前,对着TA自然地接一句。用"你"称呼,不要用"他"。`);
    } else {
      parts.push(`${context.subjectName}就坐在面前,根据你想好的当面话,对着TA说一句。用"你"称呼,不要照搬原文里的第三人称。`);
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

/* ------------------------------------------------------------------ */
/* Room generation statistics                                          */
/* ------------------------------------------------------------------ */

/**
 * Statistics from a room generation run.
 * Used for diagnostics, run logging, and tuning.
 */
export interface RoomStats {
  /** The no-talk list generated for this room. */
  noTalkList: NoTalkItem[];
  /** Total LLM verification calls for no-talk detection. */
  verifyCallCount: number;
  /** Number of lines blocked by no-talk detection. */
  blockedCount: number;
  /** Number of blocked lines successfully rewritten. */
  rewriteSuccessCount: number;
  /** Number of lines that became stage directions (after rewrite failure). */
  stageDirectionCount: number;
  /** Total LLM calls in the room (generation + verification + rewrite). */
  totalLlmCalls: number;
}

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
 * Split Chinese text into sentences on common sentence-end punctuation.
 */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！？；\n])/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Extract private sentence ranges from a testimony text.
 * Returns the private sentences (sentence containing a marker + the preceding one).
 */
function extractPrivateSentences(text: string): string[] {
  const sentences = splitSentences(text);
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

/* ------------------------------------------------------------------ */
/* Fact-level private content elements                                 */
/* ------------------------------------------------------------------ */

/**
 * Chinese amount patterns: 两万, 三千, 十万, 五百, 一千二, etc.
 * Also captures Arabic numerals with 万/千/百/元/块.
 * Excludes "千万别/千万不" (emphasis, not an amount).
 */
const CN_AMOUNT_PATTERN =
  /(?<!千)[一二两三四五六七八九十百\d]+[万千百亿](?:[一二两三四五六七八九十百千万]*)(?:块|元)?|\d[\d,.]*(?:万|千|百|元|块)/g;

/**
 * Action verbs that indicate private-content-related actions.
 */
const PRIVATE_ACTION_VERBS = [
  '借', '还钱', '欠', '转账', '打电话', '求',
];

/**
 * Key fact elements extracted from a private fragment.
 * A leak is detected when a generated line matches 2+ element categories.
 */
export interface PrivateFactElements {
  /** The full private text (for substring fallback). */
  text: string;
  /** Chinese/Arabic amounts found in the private text. */
  amounts: string[];
  /** Action verbs found in the private text. */
  verbs: string[];
  /** Key nouns (>= 2 chars, not in stop list) extracted from the private text. */
  nouns: string[];
}

/** Common words that should not be treated as significant nouns. */
const NOUN_STOP_LIST = new Set([
  '他', '她', '我', '你', '的', '了', '是', '在', '和', '也',
  '就', '都', '还', '又', '说', '这', '那', '有', '不', '很',
  '他们', '她们', '我们', '你们', '什么', '怎么', '一个', '一下',
  '但是', '因为', '所以', '如果', '虽然', '但', '而',
  '上个月', '下个月', '这个月', '那天', '最近', '以前',
]);

/**
 * Generic topic nouns for financial privacy detection.
 * Domain-specific terms (illness, resignation, etc.) are NOT hardcoded here;
 * they come from the LLM-generated no-talk list keywords.
 */
const PRIVATE_TOPIC_NOUNS = [
  '借钱', '借款', '欠钱', '欠债', '手头紧', '周转',
  '钱', '工资', '债', '贷款',
];

/**
 * Derived compound nouns: verb + object patterns that indicate the topic
 * even when the original text uses a different form (e.g. "借了两万" -> "借钱").
 */
const VERB_DERIVED_NOUNS: Record<string, string[]> = {
  '借': ['借钱', '借款'],
  '欠': ['欠钱', '欠债', '欠款'],
  '还钱': ['还债'],
};

/**
 * Extract fact-level elements from private text.
 */
export function extractFactElements(text: string): PrivateFactElements {
  // Amounts
  const amounts = [...text.matchAll(CN_AMOUNT_PATTERN)].map((m) => m[0]);

  // Verbs
  const verbs = PRIVATE_ACTION_VERBS.filter((v) => text.includes(v));

  // Key nouns: topic-specific nouns found in the private text
  const nouns = PRIVATE_TOPIC_NOUNS.filter((n) => text.includes(n));

  // Add derived nouns for detected verbs (e.g. 借 -> 借钱)
  for (const v of verbs) {
    const derived = VERB_DERIVED_NOUNS[v];
    if (derived) {
      for (const d of derived) {
        if (!nouns.includes(d)) nouns.push(d);
      }
    }
  }

  return { text, amounts, verbs, nouns };
}

/**
 * Fact-level leak detection: check whether a generated line reveals private
 * content by matching 2+ categories of fact elements (amounts, verbs, nouns).
 *
 * This catches paraphrased leaks that substring matching would miss.
 * E.g. "借了两万" -> amount "两万" + verb "借" = 2 categories = leak.
 */
export function hasFactLevelLeak(
  utteranceText: string,
  elements: readonly PrivateFactElements[],
): boolean {
  for (const el of elements) {
    let categoryHits = 0;

    // Check amounts
    if (el.amounts.some((a) => utteranceText.includes(a))) {
      categoryHits++;
    }

    // Check verbs
    if (el.verbs.some((v) => utteranceText.includes(v))) {
      categoryHits++;
    }

    // Check nouns (any significant noun match)
    if (el.nouns.some((n) => utteranceText.includes(n))) {
      categoryHits++;
    }

    if (categoryHits >= 2) return true;
  }
  return false;
}

/**
 * Check if a generated line leaks private content from testimony.
 *
 * Two-layer detection:
 *   1. Substring overlap: >= 6 contiguous characters in common with private text
 *   2. Fact-level: matches 2+ categories of extracted fact elements
 */
function hasPrivateLeak(
  text: string,
  privateTexts: readonly string[],
  privateElements: readonly PrivateFactElements[] = [],
): boolean {
  const MIN_OVERLAP = 8; // substring overlap (fact-level catches paraphrases)
  // Layer 1: substring overlap
  for (const priv of privateTexts) {
    if (priv.length < MIN_OVERLAP || text.length < MIN_OVERLAP) continue;
    for (let start = 0; start + MIN_OVERLAP <= priv.length; start++) {
      if (text.includes(priv.slice(start, start + MIN_OVERLAP))) return true;
    }
  }
  // Layer 2: fact-level element matching
  if (privateElements.length > 0 && hasFactLevelLeak(text, privateElements)) {
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Memory sanitisation: strip private facts from generation context    */
/* ------------------------------------------------------------------ */

/**
 * Remove private sentences from a testimony text, replacing them with
 * a content-free marker. The witness's prompt memory should never contain
 * the actual private facts -- only the knowledge that something private exists.
 */
export function sanitiseMemory(text: string): string {
  const sentences = splitSentences(text);
  const privateIndices = new Set<number>();

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]!;
    if (PRIVATE_MARKERS.some((m) => sentence.includes(m))) {
      privateIndices.add(i);
      if (i > 0) privateIndices.add(i - 1); // the fact sentence too
    }
  }

  if (privateIndices.size === 0) return text;

  // Replace private sentences with a marker (at most one marker per block)
  const result: string[] = [];
  let markerInserted = false;
  for (let i = 0; i < sentences.length; i++) {
    if (privateIndices.has(i)) {
      if (!markerInserted) {
        result.push('(你知道一件TA嘱咐别外传的事,群里不能说;最多欲言又止一次)');
        markerInserted = true;
      }
    } else {
      result.push(sentences[i]!);
      markerInserted = false; // reset for next block
    }
  }

  return result.join('');
}

/* ------------------------------------------------------------------ */
/* Cross-witness knowledge conflict detection ("no-talk list")         */
/* ------------------------------------------------------------------ */

/**
 * A topic that should not be discussed in the room because mentioning it
 * would reveal to a present witness something they demonstrably don't know.
 */
export interface NoTalkItem {
  /** What should not be discussed. */
  topic: string;
  /** 3-6 key words/phrases that signal this topic in generated text. */
  keywords: string[];
  /** Fact elements to detect this topic in generated text (derived from keywords). */
  elements: PrivateFactElements;
  /** Which witness would be harmed by this being said. */
  blindWitnessId: string;
  /** The claim the blind witness holds instead. */
  blindClaim: string;
  /** Which witnesses know this secret. */
  knowingWitnessIds: string[];
  /** Source text fragment that justifies this entry. */
  sourceFragment: string;
  /** Severity: 'high' or 'medium'. Items from rule-based fallback default to 'high'. */
  severity?: 'high' | 'medium';
  /** One-sentence justification for why this item is high-cost. */
  reason?: string;
}

/* ------------------------------------------------------------------ */
/* LLM-based no-talk list generation                                   */
/* ------------------------------------------------------------------ */

const NO_TALK_LIST_SCHEMA = z.array(z.object({
  topic: z.string(),
  keywords: z.array(z.string()).min(3).max(6),
  knowingWitnessIds: z.array(z.string()),
  blindWitnessId: z.string(),
  blindClaim: z.string(),
  sourceFragment: z.string(),
  severity: z.enum(['high', 'medium']),
  reason: z.string(),
}));

/** Hard cap on LLM-generated no-talk items. Rule-based fallback items are added on top. */
const NO_TALK_LIST_CAP = 8;

/**
 * Use LLM calls to produce the no-talk list for this room.
 *
 * Input: each witness's relation and a summary of their testimony.
 * Output: topics that would reveal secrets to present witnesses, with
 *   keywords for post-generation checking.
 *
 * The prompt restricts the list to high-cost secrets only:
 *   (a) explicit secrecy requests in the testimony, or
 *   (b) facts that would directly overturn a present witness's belief
 *       about the subject's major life situation (career, health,
 *       relationships, major finances, residence).
 *
 * Ordinary details that another witness simply hasn't heard about are
 * explicitly excluded. The model generates twice; results are unioned
 * for stability, then capped at {@link NO_TALK_LIST_CAP} by severity.
 */
export async function generateNoTalkList(
  llm: LLMClient,
  subjectName: string,
  drafts: readonly { witness: Witness; memory: readonly MemoryEntry[] }[],
): Promise<NoTalkItem[]> {
  const witnessSummaries = drafts.map((d) => {
    const text = d.memory.map((m) => m.text).join(' ');
    const summary = text.length > 300 ? text.substring(0, 300) + '……' : text;
    return `【${d.witness.relation}(${d.witness.id})】${wrapUntrusted(`witness:${d.witness.id}`, summary)}`;
  }).join('\n\n');

  const system = [
    `你是一位隐私保护分析师。以下是关于"${subjectName}"的多位证人的证言。这些证人马上要坐在同一个房间里聊天。`,
    '你的任务:找出少数几件**高代价的秘密**——如果在房间里说出来,会让某位在场证人当场发现自己被瞒了一件大事。',
    '',
    '★只收两类:',
    '(a) 证言中有**明确嘱托保密**的事("别跟XX说""千万别让XX知道"等)。',
    '(b) 说出后会**直接推翻**某位在场证人对此人**重大现状**的认知的事。',
    '    "重大现状"指:工作去留(辞职/被辞)、健康(重大疾病)、感情存续(分手/离婚)、重大财务(大额借贷/严重拮据)、居住地变动(搬城市)。',
    '    判断标准:知道了会**根本改变**此人对主人公处境的理解,且主人公**显然没有告诉**此人。',
    '',
    '★明确排除——以下不算:',
    '- 对方只是没听说过的日常细节(团建买单、陪人改PPT、游戏习惯、吃便利店饭团、文档模板……)',
    '- 性格层面的观察或评价(他嘴严、他发火冷下来、他不会拒绝人……)',
    '- 已经过去且对当下没有现实后果的旧事(去年搬家、前年露营吵架……)',
    '- 日常行为(回家吃饭、跑步、看手机、午饭一个人吃……)',
    '如果一件事只是"A知道而B不知道"但不会伤害任何人,不要列入。这个房间的意义就是各人讲自己视角的细节。',
    '',
    '对每一条,给出:',
    '- topic: 简短描述(10字以内)',
    '- keywords: 3-6个标志性词/短语,涵盖直接说法和间接/委婉说法,用于检测',
    '- knowingWitnessIds: 知情证人id列表',
    '- blindWitnessId: 不该知道的在场证人id',
    '- blindClaim: 该证人目前相信的版本(20字以内)',
    '- sourceFragment: 判断依据的原文片段(30字以内)',
    '- severity: "high"(嘱托保密 或 推翻重大现状认知) 或 "medium"',
    '- reason: 一句话说明为什么算高代价',
    '',
    `上限 ${NO_TALK_LIST_CAP} 条,按严重度排序(high优先)。如果高代价的事不足 ${NO_TALK_LIST_CAP} 条,就只列那几条。`,
    '只输出 JSON 数组,不要其他文字。如果没有需要禁谈的话题,输出空数组 []。',
  ].join('\n');

  const user = `在场证人:\n${witnessSummaries}`;

  const parseOne = (resp: string): NoTalkItem[] => {
    try {
      const jsonMatch = resp.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = NO_TALK_LIST_SCHEMA.parse(JSON.parse(jsonMatch[0]));
      return parsed.map((item) => ({
        ...item,
        elements: {
          text: item.sourceFragment,
          amounts: [],
          verbs: [],
          nouns: item.keywords.slice(),
        },
      }));
    } catch {
      return [];
    }
  };

  // Single-generate by default; double-generate only when stability is
  // more important than budget.  The old double-generate + union approach
  // is available when the LLM_NOTALK_DOUBLE_GENERATE env var is set.
  let items: NoTalkItem[];
  if (process.env.LLM_NOTALK_DOUBLE_GENERATE === '1') {
    const [resp1, resp2] = await Promise.all([
      llm.complete({ system, user, purpose: 'room-notalk' }),
      llm.complete({ system, user, purpose: 'room-notalk' }),
    ]);
    const items1 = parseOne(resp1);
    const items2 = parseOne(resp2);
    const seen = new Map<string, NoTalkItem>();
    for (const item of [...items1, ...items2]) {
      const key = `${item.topic}::${item.blindWitnessId}`;
      const existing = seen.get(key);
      if (!existing || item.keywords.length > existing.keywords.length) {
        seen.set(key, item);
      }
    }
    items = [...seen.values()];
  } else {
    const resp = await llm.complete({ system, user, purpose: 'room-notalk' });
    items = parseOne(resp);
  }

  // Sort by severity (high first), then cap
  items.sort((a, b) => {
    if (a.severity === 'high' && b.severity !== 'high') return -1;
    if (a.severity !== 'high' && b.severity === 'high') return 1;
    return 0;
  });

  return items.slice(0, NO_TALK_LIST_CAP);
}

/* ------------------------------------------------------------------ */
/* Rule-based no-talk fallback (explicit secrecy markers only)         */
/* ------------------------------------------------------------------ */

/**
 * Fallback: detect no-talk items from explicit secrecy markers only.
 * Handles "别跟他妈/爸提" patterns and extracts fact elements.
 * No domain-specific guessing (resignation, illness, etc.).
 */
export function buildNoTalkListFallback(
  drafts: readonly { witness: Witness; memory: readonly MemoryEntry[] }[],
): NoTalkItem[] {
  const items: NoTalkItem[] = [];

  for (const draft of drafts) {
    for (const mem of draft.memory) {
      const sentences = splitSentences(mem.text);
      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i]!;
        if (!PRIVATE_MARKERS.some((m) => sentence.includes(m))) continue;

        // Gather fact sentences: the marker sentence + the preceding one (context)
        const factSentences: string[] = [];
        if (i > 0) factSentences.push(sentences[i - 1]!);
        factSentences.push(sentence);
        const factText = factSentences.join('');
        const elements = extractFactElements(factText);

        // Derive topic from the marker sentence itself (what should be kept secret)
        const topic = sentence.substring(0, 40);

        // Derive keywords from extracted elements (amounts, verbs, nouns)
        const keywords = [
          ...elements.amounts,
          ...elements.verbs,
          ...elements.nouns,
        ];

        // Identify who should NOT know this based on the marker sentence
        const blindTargets: string[] = [];
        // Generic family role matching
        const rolePatterns: [RegExp, RegExp][] = [
          [/妈|母亲|老妈/, /母|妈/],
          [/爸|父亲|老爸/, /父|爸/],
          [/老婆|妻子|媳妇/, /妻|老婆|媳/],
          [/老公|丈夫/, /夫|老公/],
        ];
        for (const [markerRe, relationRe] of rolePatterns) {
          if (markerRe.test(sentence)) {
            for (const d of drafts) {
              if (relationRe.test(d.witness.relation)) {
                blindTargets.push(d.witness.id);
              }
            }
          }
        }

        for (const blindId of blindTargets) {
          const blindDraft = drafts.find((d) => d.witness.id === blindId);
          items.push({
            topic,
            keywords,
            elements,
            blindWitnessId: blindId,
            blindClaim: blindDraft
              ? blindDraft.memory.map((m) => m.text).join(' ').substring(0, 50)
              : '(unknown)',
            knowingWitnessIds: [draft.witness.id],
            sourceFragment: factText.substring(0, 40),
            severity: 'high',
            reason: '证言中有明确嘱托保密的标记',
          });
        }
      }
    }
  }

  return items;
}

/* ------------------------------------------------------------------ */
/* LLM-based post-generation leak verification                         */
/* ------------------------------------------------------------------ */

/**
 * Check whether a generated line would reveal a no-talk topic to a blind
 * witness, given what that witness currently believes.
 *
 * The caller supplies the blind witness's current knowledge context
 * (blindWitnessContext): a summary of their testimony — what they believe
 * to be true. This anchors the LLM's judgment: a line is only a leak if
 * it contradicts or extends beyond what the blind witness already knows.
 *
 * Fail-closed: ambiguous answers (anything other than a clear "否") are
 * treated as leaks.
 *
 * Returns true if the line should be blocked (it leaks the topic).
 */
export async function llmVerifyLeak(
  llm: LLMClient,
  utteranceText: string,
  topic: string,
  blindWitnessRelation: string,
  blindClaim: string,
  blindWitnessContext?: string,
): Promise<boolean> {
  const system = '你是一个隐私判定器。只回答"是"或"否",不要其他文字。';
  const contextLine = blindWitnessContext
    ? `\n${blindWitnessRelation}目前了解到的全部情况:${wrapUntrusted('blind_witness_context', blindWitnessContext.slice(0, 200))}`
    : '';
  const user = [
    `在场的"${blindWitnessRelation}"目前相信的版本是:${wrapUntrusted('blind_claim', blindClaim)}。${contextLine}`,
    `以下这句话如果在聊天室里被说出来,${blindWitnessRelation}会不会因此得知或起疑事实并非如此——也就是发现"${topic}"?`,
    `台词:"${utteranceText}"`,
    '即使没有说出全部事实,只要这句话会让其**起疑或推断出**事实的一部分(例如说出要换城市、要走、不干了、身体出了问题),也算"是"。',
    '但纯情绪/状态的含糊表达(累、想歇歇、想换个节奏、最近不太开心)不算——这类话不包含可推断的具体事实。',
    '只回答"是"或"否"。',
  ].join('\n');

  const resp = await llm.complete({ system, user, purpose: 'room-verify' });
  // Fail-closed: only an unambiguous "否" is treated as safe
  const trimmed = resp.trim();
  return !trimmed.startsWith('否');
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
  privateElements: readonly PrivateFactElements[] = [],
): Promise<ComposedLine | undefined> {
  const system = buildSystem(context, mode, topicSeed, actionHint, extra);
  const user = buildUser(context, mode, topicSeed, transcript, actionHint, extra);

  const first = await attemptResponse(llm, { system, user, purpose: 'room-compose' }, 2);
  if (!first.ok) return undefined;

  // The verbatim-overlap rule protects `synthesis_only` words only: a
  // `quotable` witness is allowed to be quoted back in their own voice.
  const memoryTexts = context.memory.map((m) => m.text);
  const consentHit =
    context.witness.consentLevel === 'synthesis_only' &&
    containsConsentOverlap(first.value.text, memoryTexts);
  const diagnosisWord = findDiagnosisWord(first.value.text);

  // Check for private content leak (substring + fact-level)
  const leaksSecret =
    privateTexts.length > 0 && hasPrivateLeak(first.value.text, privateTexts, privateElements);

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
    if (rewritten.ok && !hasPrivateLeak(rewritten.value.text, privateTexts, privateElements)) {
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
      privateTexts.length > 0 && hasPrivateLeak(rewritten.value.text, privateTexts, privateElements);
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

/**
 * Check if a front-room line uses third-person pronouns (他/她) to refer to
 * the subject who is present. Returns true if the subject's name appears in a
 * "他/她 + verb" pattern or "他" is used as subject pronoun.
 *
 * Simple heuristic: if the text contains 他 or 她 (not inside quoted speech
 * marked by 「」), it's likely referring to the subject in third person.
 * We exclude cases where 他/她 is part of words like 其他/他们/她们.
 */
export function hasFrontThirdPerson(text: string): boolean {
  // Remove quoted text (「...」) to avoid false positives
  const cleaned = text.replace(/「[^」]*」/g, '');
  // Check for standalone 他/她 not part of compound words: 他们/她们/其他/他处
  // Note: "他人" (other people) is excluded, but "他" followed by most other
  // characters is a pronoun reference to the subject.
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (char !== '他' && char !== '她') continue;
    const prev = i > 0 ? cleaned[i - 1] : '';
    const next = i < cleaned.length - 1 ? cleaned[i + 1] : '';
    // Skip: 其他, 另他
    if (prev === '其' || prev === '另') continue;
    // Skip: 他们, 她们, 他处
    if (next === '们' || next === '处') continue;
    return true;
  }
  return false;
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
 * - When `preferLowBurden` is true (stage-direction cap approaching), prefer
 *   witnesses who are NOT the knowing side of any no-talk item (they are less
 *   likely to trigger blocks).
 */
function pickNextSpeaker(
  drafts: readonly UtteranceDraft[],
  utterances: readonly RoomUtterance[],
  turnCounts: Map<string, number>,
  maxPerWitness: number,
  turnIndex: number,
  preferLowBurden: boolean = false,
  noTalkBurden: ReadonlySet<string> = new Set(),
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

  // When stage-direction cap is approaching, prefer witnesses without no-talk burden
  if (preferLowBurden && noTalkBurden.size > 0) {
    const lowBurden = pool.filter((d) => !noTalkBurden.has(d.witness.id));
    if (lowBurden.length > 0) {
      return lowBurden[turnIndex % lowBurden.length];
    }
  }

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
 * Extract safe topics from a witness's memory that do not overlap with any
 * no-talk item's keywords. These are suggested as alternative conversation
 * material when a line is blocked by the no-talk guard.
 *
 * Returns 2-4 short topic phrases (truncated to 20 chars each).
 */
function extractSafeTopics(
  memory: readonly MemoryEntry[],
  noTalkList: readonly NoTalkItem[],
  witnessId: string,
): string[] {
  // Collect all no-talk keywords relevant to this witness (items where they know the secret)
  const forbiddenKeywords = new Set<string>();
  for (const item of noTalkList) {
    if (item.knowingWitnessIds.includes(witnessId)) {
      for (const kw of item.keywords) forbiddenKeywords.add(kw);
    }
  }
  if (forbiddenKeywords.size === 0) return [];

  // Split each memory entry into sentences, keep those not touching any keyword
  const safePhrases: string[] = [];
  for (const mem of memory) {
    const sentences = mem.text.split(/(?<=[。！？；\n])/).map((s) => s.trim()).filter(Boolean);
    for (const sentence of sentences) {
      const touchesForbidden = [...forbiddenKeywords].some((kw) => sentence.includes(kw));
      if (!touchesForbidden && sentence.length >= 4) {
        // Truncate to a useful snippet
        safePhrases.push(sentence.substring(0, 20));
      }
    }
  }

  // Deduplicate and pick up to 4
  const unique = [...new Set(safePhrases)];
  return unique.slice(0, 4);
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

/** Mutable stats accumulator passed through runSchedule. */
interface ScheduleStats {
  verifyCallCount: number;
  blockedCount: number;
  rewriteSuccessCount: number;
  stageFromNoTalk: number;
  totalLlmCalls: number;
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
  privateElements: readonly PrivateFactElements[] = [],
  noTalkList: readonly NoTalkItem[] = [],
  stats?: ScheduleStats,
): Promise<RoomUtterance[]> {
  const utterances: RoomUtterance[] = [];
  const turnCounts = new Map<string, number>();
  const maxPerWitness = turns;
  // At most 1 "hesitation" stage direction for secret leaks per room
  const secretLeakBudget = { remaining: mode === 'behind' ? 1 : 0 };
  // Running count of LLM verification calls used in this room
  let verifyCallsUsed = 0;
  // Track whether the half-truth has been spoken
  let halfTruthDone = false;
  // Track whether the previous turn was the half-truth (so next person deflects)
  let lastWasHalfTruth = false;
  // Stage direction count for the 25% cap
  let stageDirectionCount = 0;
  // Maximum allowed stage directions (25% of cap)
  const maxStageDirections = Math.floor(cap * 0.25);
  // Build set of witness IDs that carry no-talk burden (knowing side)
  const noTalkBurdenSet = new Set<string>();
  for (const item of noTalkList) {
    for (const wid of item.knowingWitnessIds) {
      noTalkBurdenSet.add(wid);
    }
  }

  for (let turnIndex = 0; utterances.length < cap; turnIndex += 1) {
    // When stage direction count is approaching the 25% cap, prefer low-burden witnesses
    const approachingStageCap = stageDirectionCount >= maxStageDirections - 1 && maxStageDirections > 0;
    const draft = pickNextSpeaker(
      drafts, utterances, turnCounts, maxPerWitness, turnIndex,
      approachingStageCap, noTalkBurdenSet,
    );
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
      stageDirectionCount += 1;
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
        // Give this persona a random subset of their behind-room memory
        // (2-3 items, shuffled) for variety across runs
        const behindMem = frontConfig.behindMemory.get(draft.witness.id) ?? [];
        if (behindMem.length > 0) {
          const shuffled = shuffleArray(behindMem);
          const subset = shuffled.slice(0, Math.min(3, shuffled.length));
          context.memory = [
            ...context.memory,
            ...subset.map((m) => ({ qid: m.qid, text: `(你背后说过:${m.text})` })),
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

    const witnessPrivateElements = mode === 'behind' ? privateElements : [];

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
      witnessPrivateElements,
    );
    if (!line) {
      // unparseable twice: skip this turn but still count
      turnCounts.set(draft.witness.id, (turnCounts.get(draft.witness.id) ?? 0) + 1);
      lastWasHalfTruth = false;
      continue;
    }

    // Two-level no-talk leak detection for behind-mode speech lines:
    //
    //   Level 1 — keyword fast-scan: if any no-talk item's keywords appear
    //   verbatim in the line, send it for LLM verification.
    //
    //   Level 2 — LLM semantic judgment: for substantive lines (>= 8 chars),
    //   even without a keyword hit, the LLM checks whether the line would
    //   reveal the secret to the blind witness. This catches euphemisms and
    //   indirect references that keyword matching misses.
    //
    // When a line IS a leak, the engine tries a *guided rewrite* (up to 2
    // attempts) before falling back to a stage direction. The rewrite prompt
    // tells the persona exactly which topic to avoid and offers safe
    // alternative material from the witness's own testimony.
    //
    // Skip: if the speaker IS the blind witness (they can't leak to themselves).
    //
    // Hard caps: MAX_VERIFY_PER_LINE = 3, MAX_VERIFY_CALLS_PER_ROOM = 15.
    const MAX_VERIFY_PER_LINE = 3;
    const MAX_VERIFY_CALLS_PER_ROOM = 15;
    const MAX_REWRITE_ATTEMPTS = 2;
    if (mode === 'behind' && line.kind === 'speech' && noTalkList.length > 0) {
      const isSubstantive = line.text.length >= 8;
      let verifyCount = 0;
      let leakedItem: NoTalkItem | undefined;
      for (const item of noTalkList) {
        if (verifyCount >= MAX_VERIFY_PER_LINE) break;
        if (draft.witness.id === item.blindWitnessId) continue;
        const keywordHit = item.keywords.some((kw) => line.text.includes(kw));

        // When LLM budget is exhausted, degrade to keyword-only detection
        if (verifyCallsUsed >= MAX_VERIFY_CALLS_PER_ROOM) {
          if (keywordHit) {
            leakedItem = item;
            break;
          }
          continue;
        }

        if (!keywordHit && !isSubstantive) continue;

        const blindDraft = drafts.find((d) => d.witness.id === item.blindWitnessId);
        const blindRelation = blindDraft?.witness.relation ?? '在场的人';
        const blindWitnessContext = blindDraft
          ? blindDraft.memory.map((m) => m.text).join(' ').slice(0, 200)
          : undefined;
        try {
          verifyCount += 1;
          verifyCallsUsed += 1;
          if (stats) stats.verifyCallCount += 1;
          const isLeak = await llmVerifyLeak(
            llm, line.text, item.topic, blindRelation, item.blindClaim,
            blindWitnessContext,
          );
          if (isLeak) {
            leakedItem = item;
            break;
          }
        } catch {
          // LLM call failed: err on the safe side, treat as leak
          leakedItem = item;
          break;
        }
      }

      // Guided rewrite when a leak is detected
      if (leakedItem) {
        if (stats) stats.blockedCount += 1;
        const blindDraft = drafts.find((d) => d.witness.id === leakedItem.blindWitnessId);
        const blindRelation = blindDraft?.witness.relation ?? '在场的人';
        const safeTopics = extractSafeTopics(draft.memory, noTalkList, draft.witness.id);
        const safeHint = safeTopics.length > 0
          ? `可以聊:${safeTopics.map((t) => `「${t}」`).join('、')}`
          : '换一个完全不涉及此事的话头';

        // Collect ALL forbidden keywords from ALL no-talk items where this
        // speaker is NOT the blind witness (they are checked against all items).
        const allForbiddenKws = new Set<string>();
        for (const item of noTalkList) {
          if (draft.witness.id === item.blindWitnessId) continue;
          for (const kw of item.keywords) allForbiddenKws.add(kw);
        }
        const forbiddenList = [...allForbiddenKws].slice(0, 15).map((k) => `「${k}」`).join('、');

        let rewritten = false;
        for (let attempt = 0; attempt < MAX_REWRITE_ATTEMPTS && !rewritten; attempt++) {
          const rewriteSystem = buildSystem(context, mode, topicSeed, actionHint, extra);
          const rewriteUser = buildUser(context, mode, topicSeed, utterances, actionHint, extra)
            + `\n\n★这句话会让「${blindRelation}」知道「${leakedItem!.topic}」,不能说。`
            + `\n禁用词:${forbiddenList}。这些词一个都不能出现。`
            + `\n换一个完全不涉及此事的话头。${safeHint}。`
            + '\n只输出 JSON {"text":"...","qids":[...]}。';
          const rewriteResult = await attemptResponse(llm, { system: rewriteSystem, user: rewriteUser }, 1);
          if (stats) stats.totalLlmCalls += 1;
          if (!rewriteResult.ok) continue;

          // Verify the rewrite doesn't still leak
          let stillLeaks = false;
          // Quick keyword check on all no-talk items
          for (const item of noTalkList) {
            if (draft.witness.id === item.blindWitnessId) continue;
            if (item.keywords.some((kw) => rewriteResult.value.text.includes(kw))) {
              stillLeaks = true;
              break;
            }
          }
          // Also check private content
          if (!stillLeaks && privateTexts.length > 0) {
            stillLeaks = hasPrivateLeak(rewriteResult.value.text, privateTexts, privateElements);
          }

          if (!stillLeaks) {
            line.text = rewriteResult.value.text;
            line.qids = rewriteResult.value.qids;
            rewritten = true;
            if (stats) stats.rewriteSuccessCount += 1;
          }
        }

        if (!rewritten) {
          // All rewrites failed: fall back to stage direction
          if (secretLeakBudget.remaining > 0) {
            secretLeakBudget.remaining -= 1;
            line.kind = 'stage';
            line.text = SECRET_LEAK_FALLBACK_STAGE;
            line.qids = [];
          } else {
            line.kind = 'stage';
            line.text = stageLine();
            line.qids = [];
          }
          stageDirectionCount += 1;
          if (stats) stats.stageFromNoTalk += 1;
        }
      }
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
        witnessPrivateElements,
      );
      if (retryLine && retryLine.kind === 'speech' && !hasDedupConflict(retryLine.text, utterances)) {
        // Use the retry
        Object.assign(line, retryLine);
      } else {
        // Still a dup: fall back to stage direction
        line.kind = 'stage';
        line.text = stageLine();
        line.qids = [];
        stageDirectionCount += 1;
      }
    }

    // Third-person pronoun guard (front mode only): lines must not use 他/她
    // to refer to the subject who is present in the room
    if (mode === 'front' && line.kind === 'speech' && hasFrontThirdPerson(line.text)) {
      const retryLine = await composeLine(
        llm, context, mode, topicSeed, utterances,
        actionHint, witnessPrivateTexts, secretLeakBudget, extra, witnessPrivateElements,
      );
      if (retryLine && retryLine.kind === 'speech' && !hasFrontThirdPerson(retryLine.text)) {
        Object.assign(line, retryLine);
      } else {
        // Still using third person: fall back to stage direction
        line.kind = 'stage';
        line.text = stageLine();
        line.qids = [];
        stageDirectionCount += 1;
      }
    }

    // Front room length guard: single utterances must not exceed 45 chars
    const FRONT_MAX_CHARS = 45;
    if (mode === 'front' && line.kind === 'speech' && line.text.length > FRONT_MAX_CHARS) {
      const retryLine = await composeLine(
        llm, context, mode, topicSeed, utterances,
        actionHint, witnessPrivateTexts, secretLeakBudget,
        { ...extra, lengthHint: FRONT_MAX_CHARS },
        witnessPrivateElements,
      );
      if (retryLine && retryLine.kind === 'speech' && retryLine.text.length <= FRONT_MAX_CHARS) {
        Object.assign(line, retryLine);
      } else if (line.text.length > FRONT_MAX_CHARS) {
        // Truncate at last natural break within limit, preserving meaning
        const truncated = line.text.substring(0, FRONT_MAX_CHARS);
        const lastBreak = Math.max(
          truncated.lastIndexOf('，'),
          truncated.lastIndexOf('。'),
          truncated.lastIndexOf('；'),
          truncated.lastIndexOf('——'),
        );
        if (lastBreak > 10) {
          line.text = truncated.substring(0, lastBreak + 1);
        } else {
          line.text = truncated;
        }
      }
    }

    // Accidental half-truth guard: non-half-truth front lines must not trigger
    // the half-truth metric (≥4 char behindText overlap AND ≤25 chars)
    if (
      mode === 'front' &&
      frontConfig &&
      !extra.halfTruthSlot &&
      line.kind === 'speech'
    ) {
      const witBehind = frontConfig.behindMemory.get(draft.witness.id) ?? [];
      const looksLikeHalfTruth = (text: string) => {
        if (text.length > 25) return false;
        return witBehind.some((m) => {
          for (let start = 0; start + 4 <= text.length; start++) {
            if (m.text.includes(text.slice(start, start + 4))) return true;
          }
          return false;
        });
      };
      if (looksLikeHalfTruth(line.text)) {
        // Rewrite once
        const retryLine = await composeLine(
          llm, context, mode, topicSeed, utterances,
          actionHint, witnessPrivateTexts, secretLeakBudget, extra, witnessPrivateElements,
        );
        if (retryLine && retryLine.kind === 'speech' && !looksLikeHalfTruth(retryLine.text)) {
          Object.assign(line, retryLine);
        } else {
          // Still echoes: fall back to stage direction to avoid metric fail
          line.kind = 'stage';
          line.text = stageLine();
          line.qids = [];
          stageDirectionCount += 1;
        }
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
      // Front mode: allow pronoun-normalised comparison (他→你) for tier
      pronounNormalize: mode === 'front',
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

  // First pass: build raw drafts (unsanitised, for extracting private content)
  const rawDrafts = store
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
  const privateElements: PrivateFactElements[] = [];
  for (const draft of rawDrafts) {
    for (const mem of draft.memory) {
      const sentences = extractPrivateSentences(mem.text);
      privateTexts.push(...sentences);
      for (const s of sentences) {
        privateElements.push(extractFactElements(s));
      }
    }
  }

  // Build no-talk list from cross-witness knowledge conflicts.
  // Only call the LLM when there are 2+ witnesses (conflict requires at least two).
  // Rule-based fallback items (explicit secrecy markers) are ALWAYS merged in and
  // never squeezed out by the LLM cap.
  let noTalkList: NoTalkItem[];
  if (rawDrafts.length >= 2) {
    let llmItems: NoTalkItem[] = [];
    try {
      llmItems = await generateNoTalkList(llm, subjectName, rawDrafts);
    } catch {
      // LLM failed; fallback only
    }
    // Always run rule-based fallback and merge on top.
    // If an LLM item covers the same (blindWitnessId, topic) as a fallback
    // item, merge the LLM's keywords into the fallback item rather than
    // dropping one or the other.
    const fallbackItems = buildNoTalkListFallback(rawDrafts);
    const mergedFallback = fallbackItems.map((fb) => {
      // Find an LLM item targeting the same blind witness with overlapping source
      const llmMatch = llmItems.find(
        (li) => li.blindWitnessId === fb.blindWitnessId
          && (li.sourceFragment.includes(fb.sourceFragment.substring(0, 8))
            || fb.sourceFragment.includes(li.sourceFragment.substring(0, 8))),
      );
      if (llmMatch) {
        // Merge LLM keywords into the fallback item
        const mergedKeywords = [...new Set([...fb.keywords, ...llmMatch.keywords])];
        return {
          ...fb,
          keywords: mergedKeywords,
          elements: {
            ...fb.elements,
            nouns: [...new Set([...fb.elements.nouns, ...llmMatch.elements.nouns])],
          },
        };
      }
      return fb;
    });
    // Add LLM items that don't overlap with any fallback item
    const extraLlm = llmItems.filter((item) => {
      return !fallbackItems.some(
        (f) => f.blindWitnessId === item.blindWitnessId
          && (item.sourceFragment.includes(f.sourceFragment.substring(0, 8))
            || f.sourceFragment.includes(item.sourceFragment.substring(0, 8))),
      );
    });
    noTalkList = [...mergedFallback, ...extraLlm];
  } else {
    noTalkList = [];
  }
  for (const item of noTalkList) {
    privateElements.push(item.elements);
    // Also add keywords as nouns for fact-level detection
    for (const kw of item.keywords) {
      if (kw.length >= 2 && !privateElements.some((pe) => pe.nouns.includes(kw))) {
        // Create a synthetic fact element entry for each keyword set
        privateElements.push({
          text: item.sourceFragment,
          amounts: [],
          verbs: [],
          nouns: [kw],
        });
      }
    }
  }

  // Second pass: sanitise each witness's memory (strip private sentences)
  const drafts = rawDrafts.map((draft) => ({
    ...draft,
    memory: draft.memory.map((mem) => ({
      qid: mem.qid,
      text: sanitiseMemory(mem.text),
    })),
  }));

  const scheduleStats: ScheduleStats = {
    verifyCallCount: 0,
    blockedCount: 0,
    rewriteSuccessCount: 0,
    stageFromNoTalk: 0,
    totalLlmCalls: 0,
  };

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
    undefined, // no frontConfig for behind room
    privateElements,
    noTalkList,
    scheduleStats,
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

  // Register AI fingerprint for reflux detection
  const roomText = utterances
    .filter((u) => u.kind === 'speech')
    .map((u) => u.text)
    .join(' ');
  if (roomText.trim()) {
    store.putFingerprint(computeFingerprint(`room:${room.id}`, subjectId, roomText));
  }

  // Emit stats if the caller requested them
  if (options.onStats) {
    const totalStageDirections = utterances.filter((u) => u.kind === 'stage').length;
    const generationCalls = utterances.length;
    const totalLlmCalls = generationCalls + scheduleStats.verifyCallCount
      + scheduleStats.totalLlmCalls
      + (noTalkList.length > 0 ? (process.env.LLM_NOTALK_DOUBLE_GENERATE === '1' ? 2 : 1) : 0);
    options.onStats({
      noTalkList,
      verifyCallCount: scheduleStats.verifyCallCount,
      blockedCount: scheduleStats.blockedCount,
      rewriteSuccessCount: scheduleStats.rewriteSuccessCount,
      stageDirectionCount: totalStageDirections,
      totalLlmCalls,
    });
  }

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
