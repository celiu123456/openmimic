import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Room, RoomUtterance, Witness } from '@openmimic/shared';
import { UnknownRoomError, type Store } from '@openmimic/kernel';
import { RoomRefusedError } from './errors';
import type { LLMClient, LLMCompletionRequest } from './llm';
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

/** A verbatim overlap of this many characters counts as quoting. */
export const CONSENT_OVERLAP_LENGTH = 8;

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
/* Consent guard                                                       */
/* ------------------------------------------------------------------ */

/**
 * True when `text` contains a contiguous run of at least
 * {@link CONSENT_OVERLAP_LENGTH} characters copied from any `source`.
 *
 * This is how a `synthesis_only` witness is allowed to *participate* in a room
 * while their raw words stay unquoted: paraphrases pass, verbatim strings do
 * not. Sources shorter than the window can never match, which is correct — a
 * five-character answer has no eight-character quote inside it.
 */
export function containsConsentOverlap(
  text: string,
  sources: readonly string[],
  length: number = CONSENT_OVERLAP_LENGTH,
): boolean {
  if (text.length < length) return false;
  for (const source of sources) {
    if (source.length < length) continue;
    for (let start = 0; start + length <= source.length; start += 1) {
      if (text.includes(source.slice(start, start + length))) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* LLM plumbing                                                        */
/* ------------------------------------------------------------------ */

const TextResponseSchema = z.object({ text: z.string().min(1) });

/**
 * Pull `{"text": "..."}` out of a response that may be wrapped in prose or a
 * markdown fence. Throws when there is no usable object, which the caller
 * turns into one retry and then a skipped turn.
 */
export function parseRoomText(raw: string): string {
  const trimmed = raw.trim();
  const attempts = [trimmed];
  const braced = /\{[\s\S]*\}/.exec(trimmed);
  if (braced?.[0]) attempts.push(braced[0]);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) attempts.push(fenced[1].trim());

  for (const candidate of attempts) {
    try {
      return TextResponseSchema.parse(JSON.parse(candidate) as unknown).text;
    } catch {
      /* try the next, more forgiving candidate */
    }
  }
  throw new Error('room response did not contain a {"text": ...} object');
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: Error };

async function attemptText(
  llm: LLMClient,
  request: LLMCompletionRequest,
  attempts: number,
): Promise<Attempt<string>> {
  let error: Error = new Error('no attempt was made');
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      return { ok: true, value: parseRoomText(await llm.complete(request)) };
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

interface PersonaContext {
  witness: Witness;
  subjectName: string;
  /** Raw evidence this persona alone may draw on (behindText or frontText). */
  memory: string[];
}

function buildSystem(context: PersonaContext, mode: RoomMode, topicSeed: string): string {
  const { witness, subjectName } = context;
  const lines = [
    `你是${subjectName}的${witness.relation}。现在一屋子认识TA的人聊起了「${topicSeed}」。`,
    '你只说你自己亲眼见过、亲耳听过的事,不要编造。',
    '一次只说一两句,用口语,像饭桌上随口聊天。',
    '不要提"证言""问卷""数据""分析"这类词。',
  ];
  if (witness.stance) lines.push(`你自报的立场是:${witness.stance}。`);
  lines.push(
    mode === 'behind'
      ? `${subjectName}不在场,你可以说得直接一点。`
      : `${subjectName}此刻就坐在旁边,你看得见TA的表情。`,
  );
  if (witness.consentLevel === 'synthesis_only') {
    lines.push('你之前的话只授权用于合成转述,你只能用自己的话重讲,绝不能复述原话。');
  }
  lines.push('只输出 JSON,形如 {"text":"你要说的话"},不要输出任何别的内容。');
  return lines.join('\n');
}

function buildUser(
  context: PersonaContext,
  mode: RoomMode,
  topicSeed: string,
  transcript: readonly RoomUtterance[],
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
      : context.memory.map((entry) => `- ${entry}`).join('\n');

  return [
    `话题:${topicSeed}`,
    '房间里已经说过的话:',
    said,
    '',
    '只有你自己知道的记忆(别人看不到这些):',
    memory,
    '',
    mode === 'behind'
      ? '现在轮到你,背着TA说一句。'
      : `${context.subjectName}就在旁边,现在轮到你,当着TA的面说一句。`,
  ].join('\n');
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
}

/**
 * Generate one line for one persona, enforcing the two guards.
 *
 * Order of operations matches the task contract exactly:
 * 1. one LLM call (retried once on unparseable output, then the turn is
 *    skipped entirely);
 * 2. if the line quotes a `synthesis_only` memory or uses a diagnostic label,
 *    one rewrite call;
 * 3. if the rewrite is also unusable, a fixed stage direction replaces it.
 */
async function composeLine(
  llm: LLMClient,
  context: PersonaContext,
  mode: RoomMode,
  topicSeed: string,
  transcript: readonly RoomUtterance[],
): Promise<ComposedLine | undefined> {
  const system = buildSystem(context, mode, topicSeed);
  const user = buildUser(context, mode, topicSeed, transcript);

  const first = await attemptText(llm, { system, user }, 2);
  if (!first.ok) return undefined;

  // The verbatim-overlap rule protects `synthesis_only` words only: a
  // `quotable` witness is allowed to be quoted back in their own voice.
  const consentHit =
    context.witness.consentLevel === 'synthesis_only' &&
    containsConsentOverlap(first.value, context.memory);
  const diagnosisWord = findDiagnosisWord(first.value);
  if (!consentHit && !diagnosisWord) return { kind: 'speech', text: first.value };

  const rewritten = await attemptText(
    llm,
    { system, user: `${user}\n\n${rewriteInstruction(consentHit, diagnosisWord)}` },
    2,
  );
  if (rewritten.ok) {
    const stillQuoting =
      context.witness.consentLevel === 'synthesis_only' &&
      containsConsentOverlap(rewritten.value, context.memory);
    const stillDiagnosing = findDiagnosisWord(rewritten.value);
    if (!stillQuoting && !stillDiagnosing) return { kind: 'speech', text: rewritten.value };
  }

  return {
    kind: 'stage',
    text: consentHit ? CONSENT_FALLBACK_STAGE : DIAGNOSIS_FALLBACK_STAGE,
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
  memory: string[];
}

/**
 * Round-robin schedule over a set of personas.
 *
 * Simple by design: one turn per persona per round, at most
 * {@link DEFAULT_MAX_TURNS_PER_WITNESS} rounds, and a hard total ceiling of
 * {@link DEFAULT_MAX_UTTERANCES}. A skipped turn (unparseable LLM output) costs
 * that persona their slot in the round but does not shorten anyone else's.
 */
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
): Promise<RoomUtterance[]> {
  const utterances: RoomUtterance[] = [];

  for (let turn = 0; turn < turns && utterances.length < cap; turn += 1) {
    for (const draft of drafts) {
      if (utterances.length >= cap) break;
      const context: PersonaContext = {
        witness: draft.witness,
        subjectName,
        memory: draft.memory,
      };

      if (mode === 'front' && draft.memory.length === 0) {
        // No frontText => no invented opinion. Only a stage direction.
        utterances.push({
          witnessId: draft.witness.id,
          displayLabel: draft.witness.relation,
          text: stageLine(),
          kind: 'stage',
          at: now(),
        });
        continue;
      }

      const line = await composeLine(llm, context, mode, topicSeed, utterances);
      if (!line) continue; // unparseable twice: skip this turn
      utterances.push({
        witnessId: draft.witness.id,
        displayLabel: draft.witness.relation,
        text: line.text,
        kind: line.kind,
        at: now(),
      });
    }
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
    .map((witness) => ({
      witness,
      memory: testimonies
        .filter((testimony) => testimony.witnessId === witness.id)
        .flatMap((testimony) => testimony.answers.map((answer) => answer.behindText))
        .filter((text) => text.length > 0),
    }))
    .filter((draft) => draft.memory.length > 0);

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
  const drafts = store.listWitnessesBySubject(room.subjectId).map((witness) => ({
    witness,
    memory: testimonies
      .filter((testimony) => testimony.witnessId === witness.id)
      .flatMap((testimony) =>
        testimony.answers.map((answer) => answer.frontText ?? ''),
      )
      .filter((text) => text.length > 0),
  }));

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
  );

  return store.updateRoomFront(roomId, frontTranscript);
}
