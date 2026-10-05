import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus, PluginHost, Store, UnknownRoomError } from '@openmimic/kernel';
import {
  CONSENT_FALLBACK_STAGE,
  CRISIS_WORDS,
  DIAGNOSIS_FALLBACK_STAGE,
  DIAGNOSIS_WORDS,
  FIXED_STAGE_LINES,
  FakeLLM,
  FrontUnavailableError,
  MENTAL_HEALTH_WORDS,
  MIN_FRONT_TEXT_WITNESSES,
  RoomRefusedError,
  containsConsentOverlap,
  openDoor,
  roomPlugin,
  runBehindRoom,
  type RoomEngine,
} from '@openmimic/engine-room';

const line = (text: string): string => JSON.stringify({ text });

interface WitnessSpec {
  id: string;
  relation: string;
  stance?: string;
  consentLevel?: 'quotable' | 'synthesis_only';
  behind: string[];
  front?: string[];
}

function seedSubject(store: Store, witnesses: readonly WitnessSpec[]): void {
  store.putSubject({ id: 's1', displayName: '林默' });
  for (const witness of witnesses) {
    store.putWitness({
      id: witness.id,
      subjectId: 's1',
      relation: witness.relation,
      ...(witness.stance !== undefined ? { stance: witness.stance } : {}),
      consentLevel: witness.consentLevel ?? 'quotable',
    });
    store.addTestimony({
      id: `t-${witness.id}`,
      witnessId: witness.id,
      subjectId: 's1',
      answers: witness.behind.map((behindText, index) => ({
        qid: `q${index + 1}`,
        behindText,
        ...(witness.front?.[index] !== undefined
          ? { frontText: witness.front[index] as string }
          : {}),
      })),
    });
  }
}

const threeWitnesses: readonly WitnessSpec[] = [
  { id: 'w-a', relation: '发小', stance: '护着他', behind: ['甲-只有我知道的细节-温泉那次'] },
  { id: 'w-b', relation: '同事', behind: ['乙-只有我知道的细节-报销单'] },
  { id: 'w-c', relation: '前任', behind: ['丙-只有我知道的细节-冷战十九天'] },
];

describe('runBehindRoom', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('keeps each persona blind to the others and caps the transcript', async () => {
    seedSubject(store, threeWitnesses);
    // First two replies are consumed by the double-generate no-talk list generation
    const llm = new FakeLLM(['[]', '[]', ...Array.from({ length: 12 }, (_, i) => line(`第${i}句`))]);

    const room = await runBehindRoom('s1', store, llm);

    expect(room.status).toBe('behind_only');
    expect(room.behindTranscript.length).toBeLessThanOrEqual(6);
    expect(room.behindTranscript.length).toBeGreaterThanOrEqual(3);

    // Core invariant: each composeLine call's prompt contains only its own
    // witness's memory marker, never another witness's.
    // Skip the first call (no-talk list generation) which contains all witnesses.
    const markersByRelation = new Map([
      ['发小', '甲-只有我知道的细节-温泉那次'],
      ['同事', '乙-只有我知道的细节-报销单'],
      ['前任', '丙-只有我知道的细节-冷战十九天'],
    ]);
    const allMarkers = [...markersByRelation.values()];
    const composeCalls = llm.calls.slice(2); // skip 2 no-talk list calls (double-generate)

    for (const call of composeCalls) {
      const prompt = `${call.system}\n${call.user}`;
      // Exactly one marker should be present
      const found = allMarkers.filter((m) => prompt.includes(m));
      expect(found.length).toBe(1);
      // The others must be absent
      for (const m of allMarkers) {
        if (m !== found[0]) expect(prompt).not.toContain(m);
      }
      // Discipline is asserted too, not just the memory block.
      expect(call.system).toContain('只输出 JSON');
      // Behind mode prompt
      expect(call.system).toContain('闲聊');
    }

    // All three witnesses should appear in the transcript
    const speakers = new Set(room.behindTranscript.map((u) => u.displayLabel));
    expect(speakers.has('发小')).toBe(true);
    expect(speakers.has('同事')).toBe(true);
    expect(speakers.has('前任')).toBe(true);

    // No witness speaks more than twice (maxTurnsPerWitness default = 2)
    for (const rel of ['发小', '同事', '前任']) {
      const count = room.behindTranscript.filter((u) => u.displayLabel === rel).length;
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('cannot be raised above the hard ceiling of twelve utterances', async () => {
    const six: WitnessSpec[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((suffix) => ({
      id: `w-${suffix}`,
      relation: `关系-${suffix}`,
      behind: [`记忆-${suffix}`],
    }));
    seedSubject(store, six);
    // +2 for the double-generate no-talk list calls at the start
    const llm = new FakeLLM(['[]', '[]', ...Array.from({ length: 12 }, (_, index) => line(`第${index}句`))]);

    const room = await runBehindRoom('s1', store, llm, {
      maxUtterances: 99,
      maxTurnsPerWitness: 99,
    });

    expect(room.behindTranscript).toHaveLength(12);
    expect(llm.calls).toHaveLength(14); // 2 no-talk + 12 compose
  });

  it('honours a smaller cap', async () => {
    seedSubject(store, threeWitnesses);
    // +2 for the double-generate no-talk list calls
    const llm = new FakeLLM(['[]', '[]', line('一'), line('二')]);

    const room = await runBehindRoom('s1', store, llm, { maxUtterances: 2 });

    expect(room.behindTranscript).toHaveLength(2);
    expect(llm.calls).toHaveLength(4); // 2 no-talk + 2 compose
  });

  it('refuses a crisis topic before any model call or write', async () => {
    seedSubject(store, threeWitnesses);
    const llm = new FakeLLM();

    await expect(
      runBehindRoom('s1', store, llm, { topicSeed: '他最近是不是想自杀' }),
    ).rejects.toBeInstanceOf(RoomRefusedError);

    expect(llm.calls).toHaveLength(0);
    expect(store.listRoomsBySubject('s1')).toEqual([]);
  });
});

describe('consent enforcement in the behind room', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  const source = '他其实特别怕一个人待着,晚上必须开着灯';

  it('rewrites a synthesis_only quote instead of dropping the turn', async () => {
    seedSubject(store, [
      { id: 'w-syn', relation: '前任', consentLevel: 'synthesis_only', behind: [source] },
    ]);
    const llm = new FakeLLM([
      line('他其实特别怕一个人待着,这话他从来不说'),
      line('他不太能一个人过夜,总要留盏灯'),
    ]);

    const room = await runBehindRoom('s1', store, llm, { maxTurnsPerWitness: 1 });

    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]?.user).toContain('请改为转述,不得引用原话');
    expect(room.behindTranscript[0]).toMatchObject({
      kind: 'speech',
      text: '他不太能一个人过夜,总要留盏灯',
    });
  });

  it('falls back to a stage direction when the rewrite still quotes', async () => {
    seedSubject(store, [
      { id: 'w-syn', relation: '前任', consentLevel: 'synthesis_only', behind: [source] },
    ]);
    const llm = new FakeLLM([
      line('他其实特别怕一个人待着'),
      line('他其实特别怕一个人待着,真的'),
    ]);

    const room = await runBehindRoom('s1', store, llm, { maxTurnsPerWitness: 1 });

    expect(llm.calls).toHaveLength(2);
    expect(room.behindTranscript[0]).toEqual(
      expect.objectContaining({
        witnessId: 'w-syn',
        kind: 'stage',
        text: CONSENT_FALLBACK_STAGE,
      }),
    );
  });

  it('lets an eight-character overlap be detected and a seven-character one pass', () => {
    const source = '他其实特别怕一个人待着';
    expect(containsConsentOverlap('前面他其实特别怕一个后面', [source])).toBe(true);
    expect(containsConsentOverlap('他其实特别怕一', [source])).toBe(false);
    expect(containsConsentOverlap('很短', ['很短'])).toBe(false);
  });
});

describe('diagnosis-word guard', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    store.putSubject({ id: 's1', displayName: '林默' });
    store.putWitness({ id: 'w-1', subjectId: 's1', relation: '发小', consentLevel: 'quotable' });
    store.addTestimony({
      id: 't-1',
      witnessId: 'w-1',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '他这两个月很少出门' }],
    });
  });

  afterEach(() => {
    store.close();
  });

  it('rewrites a diagnostic label into a factual line', async () => {
    const llm = new FakeLLM([
      line('他就是抑郁症,得治'),
      line('他这两个月很少出门,喊他吃饭也推'),
    ]);

    const room = await runBehindRoom('s1', store, llm, { maxTurnsPerWitness: 1 });

    expect(llm.calls[1]?.user).toContain('诊断');
    expect(room.behindTranscript[0]).toMatchObject({
      kind: 'speech',
      text: '他这两个月很少出门,喊他吃饭也推',
    });
  });

  it('drops to a stage direction when the label persists', async () => {
    const llm = new FakeLLM([
      line('他这是躁郁,情绪起伏大'),
      line('反正就是躁郁,家里人都这么说'),
    ]);

    const room = await runBehindRoom('s1', store, llm, { maxTurnsPerWitness: 1 });

    expect(room.behindTranscript[0]).toMatchObject({
      kind: 'stage',
      text: DIAGNOSIS_FALLBACK_STAGE,
    });
  });
});

describe('openDoor', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('only permits fixed stage lines for a witness with no frontText, and is idempotent', async () => {
    seedSubject(store, [
      { id: 'w-a', relation: '发小', behind: ['甲的记忆'], front: ['甲当面会说的话'] },
      { id: 'w-b', relation: '前任', behind: ['乙的记忆'] },
    ]);
    const behind = await runBehindRoom('s1', store, new FakeLLM([line('甲'), line('乙')]), {
      maxTurnsPerWitness: 1,
    });

    // Front room now builds its own no-talk list (1 LLM call for 2 witnesses),
    // plus 1 call for the witness who has frontText
    // minFrontTextWitnesses: 1 because this test intentionally has only one
    // witness with frontText to verify stage-direction-only behavior for the other
    const llm = new FakeLLM(['[]', line('甲当着面说了一句')]);
    const opened = await openDoor(behind.id, store, llm, { maxTurnsPerWitness: 1, minFrontTextWitnesses: 1 });

    expect(opened.status).toBe('door_opened');
    expect(llm.calls).toHaveLength(2); // no-talk list + 1 witness with front text
    const staged = opened.frontTranscript?.filter((u) => u.witnessId === 'w-b') ?? [];
    expect(staged.length).toBeGreaterThan(0);
    for (const utterance of staged) {
      expect(utterance.kind).toBe('stage');
      expect(FIXED_STAGE_LINES).toContain(utterance.text);
    }

    const callsBefore = llm.calls.length;
    const again = await openDoor(behind.id, store, llm, { maxTurnsPerWitness: 1 });
    expect(again).toEqual(opened);
    expect(llm.calls).toHaveLength(callsBefore);
    expect(store.getRoom(behind.id)?.frontTranscript).toEqual(opened.frontTranscript);
  });

  it('switches the context to frontText only', async () => {
    seedSubject(store, [
      {
        id: 'w-a',
        relation: '发小',
        behind: ['背后-绝密内容XYZ'],
        front: ['当面-可以说的话ABC'],
      },
    ]);

    const behindLlm = new FakeLLM([line('背后那句')]);
    const room = await runBehindRoom('s1', store, behindLlm, { maxTurnsPerWitness: 1 });
    expect(behindLlm.calls[0]?.user).toContain('背后-绝密内容XYZ');
    expect(behindLlm.calls[0]?.user).not.toContain('当面-可以说的话ABC');

    const frontLlm = new FakeLLM([line('当面那句')]);
    await openDoor(room.id, store, frontLlm, { maxTurnsPerWitness: 1, minFrontTextWitnesses: 1 });
    expect(frontLlm.calls[0]?.user).toContain('当面-可以说的话ABC');
    expect(frontLlm.calls[0]?.user).not.toContain('背后-绝密内容XYZ');
    expect(frontLlm.calls[0]?.system).toContain('坐在面前');
  });

  it('rejects an unknown room', async () => {
    await expect(openDoor('nope', store, new FakeLLM())).rejects.toBeInstanceOf(UnknownRoomError);
  });

  it('throws FrontUnavailableError when fewer than threshold witnesses have frontText', async () => {
    // All witnesses have behind text but NO frontText
    seedSubject(store, [
      { id: 'w-a', relation: '发小', behind: ['甲的记忆'] },
      { id: 'w-b', relation: '前任', behind: ['乙的记忆'] },
      { id: 'w-c', relation: '母亲', behind: ['丙的记忆'] },
    ]);
    const behind = await runBehindRoom('s1', store, new FakeLLM([
      '[]', line('甲'), line('乙'), line('丙'),
    ]), { maxTurnsPerWitness: 1 });

    await expect(openDoor(behind.id, store, new FakeLLM()))
      .rejects.toBeInstanceOf(FrontUnavailableError);
  });

  it('throws FrontUnavailableError when only 1 witness has frontText (threshold = 2)', async () => {
    seedSubject(store, [
      { id: 'w-a', relation: '发小', behind: ['甲的记忆'], front: ['甲当面说'] },
      { id: 'w-b', relation: '前任', behind: ['乙的记忆'] },
    ]);
    const behind = await runBehindRoom('s1', store, new FakeLLM([
      '[]', line('甲'), line('乙'),
    ]), { maxTurnsPerWitness: 1 });

    // Default threshold is MIN_FRONT_TEXT_WITNESSES = 2
    expect(MIN_FRONT_TEXT_WITNESSES).toBe(2);
    await expect(openDoor(behind.id, store, new FakeLLM()))
      .rejects.toBeInstanceOf(FrontUnavailableError);
  });

  it('FrontUnavailableError carries a human-readable reason', async () => {
    seedSubject(store, [
      { id: 'w-a', relation: '发小', behind: ['甲的记忆'] },
      { id: 'w-b', relation: '前任', behind: ['乙的记忆'] },
    ]);
    const behind = await runBehindRoom('s1', store, new FakeLLM([
      '[]', line('甲'), line('乙'),
    ]), { maxTurnsPerWitness: 1 });

    try {
      await openDoor(behind.id, store, new FakeLLM());
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FrontUnavailableError);
      expect((err as FrontUnavailableError).reason).toContain('当面');
    }
  });
});

describe('LLM failure handling', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    seedSubject(store, [{ id: 'w-a', relation: '发小', behind: ['甲的记忆'] }]);
  });

  afterEach(() => {
    store.close();
  });

  it('retries unparseable JSON once and then skips the turn', async () => {
    const llm = new FakeLLM(['not json', 'still not json', 'not json again', 'nope']);

    const room = await runBehindRoom('s1', store, llm, { maxTurnsPerWitness: 2 });

    expect(room.behindTranscript).toEqual([]);
    expect(llm.calls).toHaveLength(4); // two attempts for each of two turns
  });
});

describe('mental-health word list', () => {
  it('is a small, de-duplicated list of at least twenty words', () => {
    expect(CRISIS_WORDS.length).toBeGreaterThan(0);
    expect(DIAGNOSIS_WORDS.length).toBeGreaterThan(0);
    expect(MENTAL_HEALTH_WORDS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(MENTAL_HEALTH_WORDS).size).toBe(MENTAL_HEALTH_WORDS.length);
    for (const word of MENTAL_HEALTH_WORDS) expect(word.length).toBeGreaterThan(0);
  });
});

describe('RoomEngine plugin assembly', () => {
  it('loads the official room plugin and runs it', async () => {
    const store = new Store();
    try {
      seedSubject(store, [{ id: 'w-a', relation: '发小', behind: ['甲的记忆'] }]);
      const events = new EventBus();
      const host = new PluginHost(events);
      host.providePreset('store', store);
      host.providePreset('llm', new FakeLLM([line('甲说')]));
      await host.load(roomPlugin);

      expect(host.has('room')).toBe(true);
      expect(host.get('room')?.kind).toBe('engine');
      const engine = host.getService<RoomEngine>('room');
      const room = await engine.runBehindRoom('s1', { maxTurnsPerWitness: 1 });
      expect(room.behindTranscript).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});

describe('Store rooms', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('persists rooms and lets only the front transcript be updated', () => {
    const room = {
      id: 'r1',
      subjectId: 's1',
      topicSeed: '最近怎么看 TA',
      status: 'behind_only' as const,
      behindTranscript: [
        { witnessId: 'w1', displayLabel: '发小', text: '他最近不太好', kind: 'speech' as const, at: '2026-01-01T00:00:00.000Z' },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    store.putRoom(room);

    expect(store.getRoom('r1')?.behindTranscript).toHaveLength(1);
    expect(store.listRoomsBySubject('s1')).toHaveLength(1);

    const updated = store.updateRoomFront('r1', [
      { witnessId: 'w1', displayLabel: '发小', text: '笑了笑,把话题接给了别人', kind: 'stage', at: '2026-01-01T00:01:00.000Z' },
    ]);

    expect(updated.status).toBe('door_opened');
    expect(store.getRoom('r1')?.frontTranscript).toHaveLength(1);
    // The behind transcript was not rewritten, and the append-only ledger is
    // untouched by any of this.
    expect(store.getRoom('r1')?.behindTranscript).toEqual(room.behindTranscript);
    expect(store.listBySubject('s1')).toEqual([]);

    expect(() => store.updateRoomFront('missing', [])).toThrow(UnknownRoomError);
  });
});
