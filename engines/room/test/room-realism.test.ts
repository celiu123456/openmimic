/**
 * Tests for room realism improvements: action hints, speaker scheduling,
 * and the secret leak guard.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import {
  FakeLLM,
  SECRET_LEAK_FALLBACK_STAGE,
  runBehindRoom,
  openDoor,
} from '@openmimic/engine-room';

const line = (text: string, qids: string[] = []): string =>
  JSON.stringify({ text, qids });

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

describe('action hints', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('some prompts include react hints (no testimony content expected)', async () => {
    seedSubject(store, [
      { id: 'w-a', relation: '发小', behind: ['甲记忆'] },
      { id: 'w-b', relation: '同事', behind: ['乙记忆'] },
    ]);
    // Provide enough scripted replies
    const llm = new FakeLLM(Array.from({ length: 12 }, () => line('嗯')));

    await runBehindRoom('s1', store, llm, { maxTurnsPerWitness: 2 });

    // At least one call should have the "react" instruction
    const reactCalls = llm.calls.filter(
      (c) => c.system.includes('简单回应') || c.user.includes('随便接一句'),
    );
    // At least one call should have the "contribute" instruction
    const contributeCalls = llm.calls.filter(
      (c) => c.system.includes('接上面的话'),
    );
    expect(reactCalls.length).toBeGreaterThan(0);
    expect(contributeCalls.length).toBeGreaterThan(0);
  });
});

describe('speaker scheduling', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('no witness speaks more than maxTurnsPerWitness times', async () => {
    seedSubject(store, [
      { id: 'w-a', relation: '发小', behind: ['甲'] },
      { id: 'w-b', relation: '同事', behind: ['乙'] },
      { id: 'w-c', relation: '前任', behind: ['丙'] },
    ]);
    const llm = new FakeLLM(Array.from({ length: 12 }, (_, i) => line(`句${i}`)));

    const room = await runBehindRoom('s1', store, llm, {
      maxTurnsPerWitness: 2,
    });

    const counts = new Map<string, number>();
    for (const u of room.behindTranscript) {
      counts.set(u.witnessId, (counts.get(u.witnessId) ?? 0) + 1);
    }
    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('no witness speaks twice in a row', async () => {
    seedSubject(store, [
      { id: 'w-a', relation: '发小', behind: ['甲'] },
      { id: 'w-b', relation: '同事', behind: ['乙'] },
    ]);
    const llm = new FakeLLM(Array.from({ length: 12 }, (_, i) => line(`句${i}`)));

    const room = await runBehindRoom('s1', store, llm);

    for (let i = 1; i < room.behindTranscript.length; i++) {
      expect(room.behindTranscript[i]!.witnessId).not.toBe(
        room.behindTranscript[i - 1]!.witnessId,
      );
    }
  });

  it('all witnesses get at least one turn', async () => {
    seedSubject(store, [
      { id: 'w-a', relation: '发小', behind: ['甲'] },
      { id: 'w-b', relation: '同事', behind: ['乙'] },
      { id: 'w-c', relation: '前任', behind: ['丙'] },
    ]);
    const llm = new FakeLLM(Array.from({ length: 12 }, (_, i) => line(`句${i}`)));

    const room = await runBehindRoom('s1', store, llm);

    const speakers = new Set(room.behindTranscript.map((u) => u.witnessId));
    expect(speakers.has('w-a')).toBe(true);
    expect(speakers.has('w-b')).toBe(true);
    expect(speakers.has('w-c')).toBe(true);
  });
});

describe('secret leak guard', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('catches a leak of private content and replaces with hesitation', async () => {
    // The testimony contains "千万别" which marks the surrounding text as private
    seedSubject(store, [
      {
        id: 'w-a',
        relation: '发小',
        behind: ['上个月他半夜给我打电话,借了两万。他嘱咐我千万别跟他妈提。'],
      },
    ]);

    // The model's first response leaks the private content
    const llm = new FakeLLM([
      line('他半夜给我打电话借了两万,说手头紧'),
      // The model tries another response
      line('他最近联系少了,约他吃饭也不来'),
    ]);

    const room = await runBehindRoom('s1', store, llm, {
      maxTurnsPerWitness: 1,
    });

    // The first attempt should have been caught and replaced
    expect(room.behindTranscript.length).toBe(1);
    const utt = room.behindTranscript[0]!;
    // Either a hesitation stage direction or a clean rewrite
    if (utt.kind === 'stage') {
      expect(utt.text).toBe(SECRET_LEAK_FALLBACK_STAGE);
    } else {
      // If rewritten, it should not contain the private content
      expect(utt.text).not.toContain('借了两万');
    }
  });

  it('allows non-private content through', async () => {
    seedSubject(store, [
      {
        id: 'w-a',
        relation: '发小',
        behind: ['他最近联系少了,约他吃饭推了两回。他嘱咐我千万别跟他妈提借钱的事。'],
      },
    ]);

    // The model's response does NOT leak the private part
    const llm = new FakeLLM([line('他最近联系是少了,约他吃饭老说忙')]);

    const room = await runBehindRoom('s1', store, llm, {
      maxTurnsPerWitness: 1,
    });

    expect(room.behindTranscript.length).toBe(1);
    expect(room.behindTranscript[0]!.kind).toBe('speech');
    expect(room.behindTranscript[0]!.text).toContain('联系');
  });
});

describe('front room constraints', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('front prompts include courtesy-only instructions', async () => {
    seedSubject(store, [
      {
        id: 'w-a',
        relation: '发小',
        behind: ['背后的话'],
        front: ['当面客气的话'],
      },
    ]);

    const behindLlm = new FakeLLM([line('背后说的')]);
    const room = await runBehindRoom('s1', store, behindLlm, { maxTurnsPerWitness: 1 });

    const frontLlm = new FakeLLM([line('来了啊')]);
    await openDoor(room.id, store, frontLlm, { maxTurnsPerWitness: 1 });

    // Front mode should contain courtesy + second-person + frontText instructions
    expect(frontLlm.calls[0]!.system).toContain('不会当面评价');
    expect(frontLlm.calls[0]!.system).toContain('称呼必须用"你"');
    expect(frontLlm.calls[0]!.system).toContain('当面会怎么说');
  });

  it('highlights the last utterance for conversational flow', async () => {
    seedSubject(store, [
      { id: 'w-a', relation: '发小', behind: ['甲的记忆'] },
      { id: 'w-b', relation: '同事', behind: ['乙的记忆'] },
    ]);

    const llm = new FakeLLM([
      '[]', '[]', // no-talk list double-generate calls
      line('第一句话'),
      line('第二句话'),
      line('第三句话'),
      line('第四句话'),
    ]);

    await runBehindRoom('s1', store, llm);

    // calls[0..1] = no-talk list (double-generate), calls[2] = first composeLine, calls[3] = second
    // The second composeLine call should include "刚刚...说了" to highlight the last speaker
    const secondComposeCall = llm.calls[3];
    expect(secondComposeCall).toBeDefined();
    expect(secondComposeCall!.user).toContain('刚刚');
    expect(secondComposeCall!.user).toContain('第一句话');
  });
});
