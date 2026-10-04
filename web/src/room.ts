import type { RoomUtterance } from './api';
import { writeJson, type KeyValueStore } from './storage';

/**
 * The room page's rules, kept as plain functions and one small scheduler.
 *
 * Three things here are load-bearing enough to be tested without a DOM:
 *
 * 1. {@link ReplayScheduler} — a transcript is not dumped on screen at once.
 *    Lines appear one at a time, with a typing beat in between, and a single
 *    press can jump straight to the end.
 * 2. the door state machine — `behind → opening → front → contrast`. The
 *    machine, not the view, owns the "never call the door twice" rule.
 * 3. the contrast pairing — a line is linked to the *same witness* on the
 *    other side; stage directions (a silence, a look away) belong to nobody
 *    who spoke, so they are never linked.
 */

/* ------------------------------------------------------------------ */
/* Copy — fixed, calm sentences, never generated                        */
/* ------------------------------------------------------------------ */

/** The one line pinned above the behind-mode transcript. */
export function behindHeadline(displayName: string): string {
  return `他们在聊 ${displayName}。${displayName} 不在场。`;
}

/** The one line pinned above the face-to-face transcript. */
export function frontHeadline(displayName: string): string {
  return `${displayName} 推门进来了。还是这群人。`;
}

/** Shown while the door request is in flight (may be seconds on a real LLM). */
export const DOOR_WAIT_LINE = '所有人都听到了脚步声…';

/* ------------------------------------------------------------------ */
/* Replay scheduler                                                     */
/* ------------------------------------------------------------------ */

/** Fastest beat between two lines. */
export const REPLAY_MIN_MS = 1200;
/** Slowest beat between two lines (exclusive). */
export const REPLAY_MAX_MS = 2000;
const REPLAY_STEP_MS = 350;
const REPLAY_SPREAD_MS = REPLAY_MAX_MS - REPLAY_MIN_MS;

/**
 * The gap before line `index` is revealed.
 *
 * Deliberately deterministic rather than random: a transcript should feel
 * like it is being typed, but a test (and a screenshot) must be repeatable.
 */
export function replayDelayMs(index: number): number {
  const safe = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return REPLAY_MIN_MS + ((safe * REPLAY_STEP_MS) % REPLAY_SPREAD_MS);
}

export interface ReplayState {
  /** How many lines of the transcript are on screen. */
  visibleCount: number;
  /** True while waiting to reveal the next line (the typing beat). */
  typing: boolean;
  /** True once every line is on screen. */
  finished: boolean;
}

export function initialReplayState(total: number): ReplayState {
  const count = Math.max(0, Math.floor(total));
  return { visibleCount: 0, typing: count > 0, finished: count === 0 };
}

export function revealedReplayState(total: number): ReplayState {
  const count = Math.max(0, Math.floor(total));
  return { visibleCount: count, typing: false, finished: true };
}

export type TimerHandle = ReturnType<typeof setTimeout>;

export interface ReplaySchedulerOptions {
  onUpdate: (state: ReplayState) => void;
  /** Overridable for tests; defaults to {@link replayDelayMs}. */
  delayMs?: (index: number) => number;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

/**
 * Drives the progressive reveal.
 *
 * `start()` emits the initial (typing) state and schedules the first line;
 * each tick emits the next state and schedules the following one. `skip()`
 * settles everything immediately, and `stop()` simply cancels pending work —
 * both leave no timer behind, so an unmounted view can never fire late.
 */
export class ReplayScheduler {
  private state: ReplayState;
  private timer: TimerHandle | null = null;
  private readonly total: number;
  private readonly onUpdate: (state: ReplayState) => void;
  private readonly delayMs: (index: number) => number;
  private readonly setTimer: (callback: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;

  constructor(total: number, options: ReplaySchedulerOptions) {
    this.total = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0));
    this.state = initialReplayState(this.total);
    this.onUpdate = options.onUpdate;
    this.delayMs = options.delayMs ?? replayDelayMs;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  get current(): ReplayState {
    return this.state;
  }

  /** Emit the opening state and, unless the transcript is empty, start ticking. */
  start(): ReplayState {
    this.onUpdate(this.state);
    if (!this.state.finished) this.scheduleNext();
    return this.state;
  }

  /** Reveal everything at once; any pending tick is discarded. */
  skip(): ReplayState {
    this.cancel();
    this.state = revealedReplayState(this.total);
    this.onUpdate(this.state);
    return this.state;
  }

  stop(): void {
    this.cancel();
  }

  private cancel(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    const index = this.state.visibleCount;
    this.cancel();
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.advance(this.state.visibleCount + 1);
    }, this.delayMs(index));
  }

  private advance(visibleCount: number): void {
    const finished = visibleCount >= this.total;
    this.state = { visibleCount, typing: !finished, finished };
    this.onUpdate(this.state);
    if (!finished) this.scheduleNext();
  }
}

/* ------------------------------------------------------------------ */
/* Door state machine                                                   */
/* ------------------------------------------------------------------ */

/**
 * `behind`  — watching from outside; the door button is available.
 * `opening` — the door request is in flight (the panels are moving).
 * `front`   — face to face; the front transcript is replaying.
 * `contrast`— both transcripts side by side.
 */
export type DoorPhase = 'behind' | 'opening' | 'front' | 'contrast';

export interface DoorState {
  phase: DoorPhase;
  /** How many times the door API was actually invoked. Never exceeds 1. */
  doorCalls: number;
}

export function initialDoorState(): DoorState {
  return { phase: 'behind', doorCalls: 0 };
}

export function canPushDoor(state: DoorState): boolean {
  return state.phase === 'behind';
}

/**
 * Push the door: `behind → opening`, counting the API call.
 *
 * Called from any other phase it is a no-op, which is how "推门两次不重复
 * 调接口" is enforced: the view asks {@link canPushDoor} first and the machine
 * refuses a second transition regardless.
 */
export function beginDoor(state: DoorState): DoorState {
  if (!canPushDoor(state)) return state;
  return { phase: 'opening', doorCalls: state.doorCalls + 1 };
}

/** The request failed: fall back to `behind` so the button can be retried. */
export function doorFailed(state: DoorState): DoorState {
  return state.phase === 'opening' ? { ...state, phase: 'behind' } : state;
}

/** The request succeeded and the panels finished opening. */
export function doorOpened(state: DoorState): DoorState {
  return state.phase === 'opening' ? { ...state, phase: 'front' } : state;
}

export function canShowContrast(state: DoorState): boolean {
  return state.phase === 'front';
}

export function showContrast(state: DoorState): DoorState {
  return state.phase === 'front' ? { ...state, phase: 'contrast' } : state;
}

/** Leave the side-by-side view; the door stays open. */
export function hideContrast(state: DoorState): DoorState {
  return state.phase === 'contrast' ? { ...state, phase: 'front' } : state;
}

/* ------------------------------------------------------------------ */
/* Contrast pairing                                                     */
/* ------------------------------------------------------------------ */

/**
 * The key two lines share when they should highlight together.
 *
 * `null` for a stage direction: it carries a witness id for attribution but
 * is not something that witness said, so it is never part of a pair.
 */
export function pairingKey(utterance: RoomUtterance): string | null {
  return utterance.kind === 'stage' ? null : utterance.witnessId;
}

export function isLinked(utterance: RoomUtterance, activeWitnessId: string | null): boolean {
  if (activeWitnessId === null) return false;
  return pairingKey(utterance) === activeWitnessId;
}

export interface WitnessPair {
  witnessId: string;
  displayLabel: string;
  /** Indices into the behind transcript (speech only). */
  behind: number[];
  /** Indices into the front transcript (speech only). */
  front: number[];
}

/**
 * Group both transcripts by witness, keeping first-appearance order.
 *
 * A witness present on only one side still gets a row: "this person had
 * nothing to say to his face" is itself the finding.
 */
export function buildPairs(
  behind: readonly RoomUtterance[],
  front: readonly RoomUtterance[],
): WitnessPair[] {
  const pairs: WitnessPair[] = [];
  const byWitness = new Map<string, WitnessPair>();

  const ensure = (utterance: RoomUtterance): WitnessPair => {
    const existing = byWitness.get(utterance.witnessId);
    if (existing) return existing;
    const created: WitnessPair = {
      witnessId: utterance.witnessId,
      displayLabel: utterance.displayLabel,
      behind: [],
      front: [],
    };
    byWitness.set(utterance.witnessId, created);
    pairs.push(created);
    return created;
  };

  behind.forEach((utterance, index) => {
    if (utterance.kind === 'stage') return;
    ensure(utterance).behind.push(index);
  });
  front.forEach((utterance, index) => {
    if (utterance.kind === 'stage') return;
    ensure(utterance).front.push(index);
  });

  return pairs;
}

/* ------------------------------------------------------------------ */
/* Witness tones                                                        */
/* ------------------------------------------------------------------ */

/** How many distinct bubble hues a room can use. */
export const WITNESS_TONE_COUNT = 6;

/**
 * A stable hue bucket per witness, so the same person keeps the same colour
 * across the behind and front transcripts — that constancy is what makes the
 * contrast view readable at a glance.
 */
export function witnessTone(witnessId: string): number {
  let hash = 0;
  for (let index = 0; index < witnessId.length; index += 1) {
    hash = (hash * 31 + witnessId.charCodeAt(index)) >>> 0;
  }
  return hash % WITNESS_TONE_COUNT;
}

/* ------------------------------------------------------------------ */
/* Subject name cache                                                   */
/* ------------------------------------------------------------------ */

/**
 * The room API returns `subjectId`, not the display name. Room links carry the
 * name in `?name=`, and whatever the operator typed when creating a subject is
 * remembered here so a hard refresh (or a link without the query) still reads
 * naturally. No name means "TA", never a blank sentence.
 */
export const SUBJECT_NAMES_KEY = 'openmimic.subjectNames';
export const FALLBACK_SUBJECT_NAME = 'TA';

export function parseSubjectNames(raw: string | null): Record<string, string> {
  if (raw === null || raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const names: Record<string, string> = {};
    for (const [id, name] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof name === 'string' && name.trim() !== '') names[id] = name.trim();
    }
    return names;
  } catch {
    return {};
  }
}

export function rememberSubjectName(
  store: KeyValueStore,
  subjectId: string,
  displayName: string,
): void {
  if (subjectId === '' || displayName.trim() === '') return;
  const names = parseSubjectNames(store.getItem(SUBJECT_NAMES_KEY));
  names[subjectId] = displayName.trim();
  writeJson(store, SUBJECT_NAMES_KEY, names);
}

export function subjectNameFor(store: KeyValueStore, subjectId: string): string | undefined {
  return parseSubjectNames(store.getItem(SUBJECT_NAMES_KEY))[subjectId];
}

/** Query parameter used on `/room/:id` links to carry the name verbatim. */
export function resolveSubjectName(
  queryName: unknown,
  storeName: string | undefined,
): string {
  if (typeof queryName === 'string' && queryName.trim() !== '') return queryName.trim();
  if (typeof storeName === 'string' && storeName.trim() !== '') return storeName.trim();
  return FALLBACK_SUBJECT_NAME;
}
