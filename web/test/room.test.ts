import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, type RoomPayload, type RoomUtterance } from '../src/api';
import {
  REPLAY_MAX_MS,
  REPLAY_MIN_MS,
  ReplayScheduler,
  WITNESS_TONE_COUNT,
  behindHeadline,
  beginDoor,
  buildPairs,
  canPushDoor,
  doorFailed,
  doorOpened,
  frontHeadline,
  hideContrast,
  initialDoorState,
  initialReplayState,
  isLinked,
  pairingKey,
  parseSubjectNames,
  rememberSubjectName,
  replayDelayMs,
  resolveSubjectName,
  showContrast,
  subjectNameFor,
  witnessTone,
  type ReplayState,
} from '../src/room';

const speech = (witnessId: string, text: string, displayLabel = witnessId): RoomUtterance => ({
  witnessId,
  displayLabel,
  text,
  kind: 'speech',
  at: '2026-09-28T21:00:00.000Z',
});

const stage = (witnessId: string, text: string, displayLabel = witnessId): RoomUtterance => ({
  witnessId,
  displayLabel,
  text,
  kind: 'stage',
  at: '2026-09-28T21:00:00.000Z',
});

const room: RoomPayload = {
  id: 'room-1',
  subjectId: 's1',
  topicSeed: '最近怎么看 TA',
  status: 'behind_only',
  behindTranscript: [speech('w1', '背后的话')],
  createdAt: '2026-09-28T09:00:00.000Z',
};

describe('replay scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps every beat between 1.2s and 2s, deterministically', () => {
    for (let index = 0; index < 40; index += 1) {
      const ms = replayDelayMs(index);
      expect(ms).toBeGreaterThanOrEqual(REPLAY_MIN_MS);
      expect(ms).toBeLessThan(REPLAY_MAX_MS);
      expect(replayDelayMs(index)).toBe(ms);
    }
    expect(replayDelayMs(-4)).toBe(REPLAY_MIN_MS);
  });

  it('reveals one line per beat, with a typing state in between', () => {
    vi.useFakeTimers();
    const states: ReplayState[] = [];
    const scheduler = new ReplayScheduler(3, { onUpdate: (state) => states.push({ ...state }) });

    scheduler.start();
    expect(scheduler.current).toEqual({ visibleCount: 0, typing: true, finished: false });

    vi.advanceTimersByTime(replayDelayMs(0));
    expect(scheduler.current.visibleCount).toBe(1);
    expect(scheduler.current.typing).toBe(true);

    vi.advanceTimersByTime(replayDelayMs(1));
    expect(scheduler.current.visibleCount).toBe(2);

    vi.advanceTimersByTime(replayDelayMs(2));
    expect(scheduler.current).toEqual({ visibleCount: 3, typing: false, finished: true });

    // Nothing ticks after the last line.
    vi.advanceTimersByTime(30_000);
    expect(states).toHaveLength(4);
  });

  it('jumps to the end and leaves no pending timer behind', () => {
    vi.useFakeTimers();
    const states: ReplayState[] = [];
    const scheduler = new ReplayScheduler(5, { onUpdate: (state) => states.push({ ...state }) });

    scheduler.start();
    vi.advanceTimersByTime(replayDelayMs(0));
    const settled = scheduler.skip();

    expect(settled).toEqual({ visibleCount: 5, typing: false, finished: true });
    const updatesAtSkip = states.length;
    vi.advanceTimersByTime(60_000);
    expect(states).toHaveLength(updatesAtSkip);
  });

  it('stops on request and treats an empty transcript as finished', () => {
    vi.useFakeTimers();
    const updates: number[] = [];
    const scheduler = new ReplayScheduler(4, {
      onUpdate: (state) => updates.push(state.visibleCount),
    });
    scheduler.start();
    scheduler.stop();
    vi.advanceTimersByTime(60_000);
    expect(updates).toEqual([0]);

    expect(initialReplayState(0)).toEqual({ visibleCount: 0, typing: false, finished: true });
    expect(initialReplayState(2)).toEqual({ visibleCount: 0, typing: true, finished: false });
  });

  it('pins the two fixed room sentences verbatim', () => {
    expect(behindHeadline('林默')).toBe('他们在聊 林默。林默 不在场。');
    expect(frontHeadline('林默')).toBe('林默 推门进来了。还是这群人。');
  });
});

describe('door state machine', () => {
  it('walks behind -> opening -> front -> contrast, and back', () => {
    let state = initialDoorState();
    expect(state.phase).toBe('behind');
    expect(canPushDoor(state)).toBe(true);

    state = beginDoor(state);
    expect(state.phase).toBe('opening');

    state = doorOpened(state);
    expect(state.phase).toBe('front');

    state = showContrast(state);
    expect(state.phase).toBe('contrast');

    state = hideContrast(state);
    expect(state.phase).toBe('front');
  });

  it('never opens the door twice', () => {
    let state = beginDoor(initialDoorState());
    expect(state.doorCalls).toBe(1);

    const whileOpening = beginDoor(state);
    expect(whileOpening).toBe(state);
    expect(whileOpening.doorCalls).toBe(1);

    state = doorOpened(state);
    const afterFront = beginDoor(state);
    expect(afterFront.phase).toBe('front');
    expect(afterFront.doorCalls).toBe(1);
  });

  it('falls back to behind after a failure so a retry is allowed', () => {
    let state = doorFailed(beginDoor(initialDoorState()));
    expect(state.phase).toBe('behind');
    expect(state.doorCalls).toBe(1);

    state = beginDoor(state);
    expect(state.phase).toBe('opening');
    expect(state.doorCalls).toBe(2);
  });

  it('ignores out-of-order transitions', () => {
    expect(doorOpened(initialDoorState()).phase).toBe('behind');
    expect(showContrast(initialDoorState()).phase).toBe('behind');
    expect(hideContrast(initialDoorState()).phase).toBe('behind');
    expect(canPushDoor(doorOpened(beginDoor(initialDoorState())))).toBe(false);
  });
});

describe('contrast pairing', () => {
  it('pairs the same witness across both sides and skips stage directions', () => {
    const behind = [speech('w1', 'b1'), stage('w1', '看了看窗外'), speech('w2', 'b2')];
    const front = [stage('w2', '笑了一下'), speech('w1', 'f1'), speech('w3', 'f3')];

    const pairs = buildPairs(behind, front);
    expect(pairs.map((pair) => pair.witnessId)).toEqual(['w1', 'w2', 'w3']);

    expect(pairs[0]).toMatchObject({ witnessId: 'w1', behind: [0], front: [1] });
    // w2 only ever gets a stage direction on the front side: nothing to pair,
    // and the stage line is not counted as something w2 said.
    expect(pairs[1]).toMatchObject({ witnessId: 'w2', behind: [2], front: [] });
    expect(pairs[2]).toMatchObject({ witnessId: 'w3', behind: [], front: [2] });
  });

  it('never links a stage direction to anything', () => {
    const silence = stage('w1', '沉默');
    expect(pairingKey(silence)).toBeNull();
    expect(isLinked(silence, 'w1')).toBe(false);

    expect(pairingKey(speech('w1', 'x'))).toBe('w1');
    expect(isLinked(speech('w1', 'x'), 'w1')).toBe(true);
    expect(isLinked(speech('w2', 'x'), 'w1')).toBe(false);
    expect(isLinked(speech('w1', 'x'), null)).toBe(false);
  });

  it('gives every witness a stable tone inside the palette', () => {
    for (const id of ['w-faxiao', 'w-boss', 'w-ex', 'w-mother']) {
      const tone = witnessTone(id);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(WITNESS_TONE_COUNT);
      expect(witnessTone(id)).toBe(tone);
    }
  });
});

describe('subject name cache', () => {
  function memoryStore(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
  }

  it('reads, writes and falls back without ever producing a blank name', () => {
    const store = memoryStore();
    rememberSubjectName(store, 'limo', '林默');
    expect(subjectNameFor(store, 'limo')).toBe('林默');
    expect(subjectNameFor(store, 'nobody')).toBeUndefined();

    expect(resolveSubjectName('林默', undefined)).toBe('林默');
    expect(resolveSubjectName('  ', '林默')).toBe('林默');
    expect(resolveSubjectName(undefined, '林默')).toBe('林默');
    expect(resolveSubjectName(undefined, undefined)).toBe('TA');

    expect(parseSubjectNames(null)).toEqual({});
    expect(parseSubjectNames('not json')).toEqual({});
    expect(parseSubjectNames('["limo"]')).toEqual({});
    expect(parseSubjectNames('{"limo":"林默","bad":3}')).toEqual({ limo: '林默' });
  });
});

describe('room api client', () => {
  interface Call {
    url: string;
    init?: RequestInit;
  }

  function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  function makeClient(handler: (call: Call) => Response) {
    const calls: Call[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = { url: String(input), init };
      calls.push(call);
      return handler(call);
    }) as typeof fetch;
    return { api: createApiClient({ baseUrl: 'http://api.test', fetchImpl }), calls };
  }

  it('GETs a room and opens its door with POST', async () => {
    const { api, calls } = makeClient(() => jsonResponse(room));
    await expect(api.getRoom('room 1')).resolves.toMatchObject({ id: 'room-1' });
    await expect(api.openDoor('room 1')).resolves.toMatchObject({ id: 'room-1' });

    expect(calls[0]?.url).toBe('http://api.test/api/rooms/room%201');
    expect(calls[1]?.url).toBe('http://api.test/api/rooms/room%201/door');
    expect(calls[1]?.init?.method).toBe('POST');
  });

  it('unwraps the room list and creates a room with an optional topic', async () => {
    const { api, calls } = makeClient((call) =>
      call.init?.method === 'POST' ? jsonResponse(room, 201) : jsonResponse({ rooms: [room] }),
    );

    await expect(api.getSubjectRooms('s1')).resolves.toHaveLength(1);
    await expect(api.createRoom('s1')).resolves.toMatchObject({ id: 'room-1' });
    await expect(api.createRoom('s1', '最近怎么看 TA')).resolves.toMatchObject({ id: 'room-1' });

    expect(calls[0]?.url).toBe('http://api.test/api/subjects/s1/rooms');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({});
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ topicSeed: '最近怎么看 TA' });
  });
});
