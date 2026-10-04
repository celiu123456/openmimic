import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import {
  FakeLLM,
  anonymousDisplayLabel,
  buildDisplayLabels,
  runBehindRoom,
} from '@openmimic/engine-room';
import type { Witness } from '@openmimic/shared';

const line = (text: string): string => JSON.stringify({ text, qids: [] });

describe('anonymousDisplayLabel', () => {
  it('shows "一位认识他的人" for a single anonymous witness without knownFromYear', () => {
    expect(anonymousDisplayLabel(0, 1)).toBe('一位认识他的人');
  });

  it('shows years when knownFromYear is available', () => {
    const currentYear = new Date().getFullYear();
    const label = anonymousDisplayLabel(0, 1, currentYear - 5);
    expect(label).toBe('一位认识他 5 年的人');
  });

  it('appends 甲/乙 when there are 2+ anonymous witnesses', () => {
    expect(anonymousDisplayLabel(0, 2)).toBe('一位认识他的人甲');
    expect(anonymousDisplayLabel(1, 2)).toBe('一位认识他的人乙');
  });

  it('combines years and letter suffix', () => {
    const currentYear = new Date().getFullYear();
    const label = anonymousDisplayLabel(0, 3, currentYear - 10);
    expect(label).toBe('一位认识他 10 年的人甲');
  });
});

describe('buildDisplayLabels', () => {
  it('uses relation for non-anonymous witnesses', () => {
    const witnesses: Witness[] = [
      { id: 'w-1', subjectId: 's1', relation: '发小', consentLevel: 'quotable' },
      { id: 'w-2', subjectId: 's1', relation: '前任', consentLevel: 'quotable' },
    ];
    const labels = buildDisplayLabels(witnesses);
    expect(labels.get('w-1')).toBe('发小');
    expect(labels.get('w-2')).toBe('前任');
  });

  it('anonymises witnesses with anonymousInRoom=true', () => {
    const witnesses: Witness[] = [
      { id: 'w-1', subjectId: 's1', relation: '发小', consentLevel: 'quotable' },
      { id: 'w-2', subjectId: 's1', relation: '前任', consentLevel: 'quotable', anonymousInRoom: true },
    ];
    const labels = buildDisplayLabels(witnesses);
    expect(labels.get('w-1')).toBe('发小');
    expect(labels.get('w-2')).toContain('一位认识他的人');
    // Single anonymous => no suffix
    expect(labels.get('w-2')).not.toContain('甲');
  });

  it('adds 甲/乙 suffixes when 2+ witnesses are anonymous', () => {
    const witnesses: Witness[] = [
      { id: 'w-1', subjectId: 's1', relation: '发小', consentLevel: 'quotable', anonymousInRoom: true },
      { id: 'w-2', subjectId: 's1', relation: '前任', consentLevel: 'quotable', anonymousInRoom: true },
    ];
    const labels = buildDisplayLabels(witnesses);
    const values = [labels.get('w-1'), labels.get('w-2')];
    const suffixes = values.map((v) => v?.slice(-1));
    // Both should end with 甲 or 乙
    expect(suffixes).toContain('甲');
    expect(suffixes).toContain('乙');
  });

  it('shuffles anonymous indices so they differ across calls (probabilistic)', () => {
    const witnesses: Witness[] = [
      { id: 'w-1', subjectId: 's1', relation: '同事A', consentLevel: 'quotable', anonymousInRoom: true },
      { id: 'w-2', subjectId: 's1', relation: '同事B', consentLevel: 'quotable', anonymousInRoom: true },
      { id: 'w-3', subjectId: 's1', relation: '同事C', consentLevel: 'quotable', anonymousInRoom: true },
    ];
    // Build labels multiple times and check that at least one ordering differs
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const labels = buildDisplayLabels(witnesses);
      const key = [labels.get('w-1'), labels.get('w-2'), labels.get('w-3')].join('|');
      results.add(key);
    }
    // With 3! = 6 orderings and 20 attempts, it's extremely unlikely to always
    // get the same ordering (probability (1/6)^19 ~ 5.8e-15)
    expect(results.size).toBeGreaterThan(1);
  });
});

describe('anonymous witness in room generation', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('uses anonymous label in generated transcript', async () => {
    store.putSubject({ id: 's1', displayName: '林默' });
    store.putWitness({
      id: 'w-anon',
      subjectId: 's1',
      relation: '发小',
      consentLevel: 'quotable',
      anonymousInRoom: true,
      knownFromYear: 2020,
    });
    store.addTestimony({
      id: 't-anon',
      witnessId: 'w-anon',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '他最近状态不太好,经常加班' }],
    });

    const llm = new FakeLLM([line('他最近状态不太好')]);
    const room = await runBehindRoom('s1', store, llm, { maxTurnsPerWitness: 1 });

    expect(room.behindTranscript).toHaveLength(1);
    // Should NOT show '发小'
    expect(room.behindTranscript[0]?.displayLabel).not.toBe('发小');
    expect(room.behindTranscript[0]?.displayLabel).toContain('一位认识他');
  });
});
