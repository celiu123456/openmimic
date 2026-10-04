import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store, UnknownTestimonyError } from '@openmimic/kernel';

describe('testimony correction chain', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    store.addTestimony({
      id: 't1',
      witnessId: 'w1',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: 'original words' }],
    });
  });

  afterEach(() => {
    store.close();
  });

  it('appends a correction instead of rewriting history', () => {
    const correction = store.addTestimony({
      id: 't2',
      witnessId: 'w1',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: 'corrected words' }],
      correctionOf: 't1',
    });

    const chain = store.listBySubject('s1');
    expect(chain.map((testimony) => testimony.id)).toEqual(['t1', 't2']);
    expect(chain[1]?.correctionOf).toBe('t1');
    expect(correction.correctionOf).toBe('t1');
    // The original entry survives byte-for-byte.
    expect(store.getTestimony('t1')?.answers[0]?.behindText).toBe('original words');
  });

  it('refuses to correct a testimony that is not in the ledger', () => {
    expect(() =>
      store.addTestimony({
        id: 't3',
        witnessId: 'w1',
        subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'dangling correction' }],
        correctionOf: 'missing',
      }),
    ).toThrow(UnknownTestimonyError);
    expect(store.getTestimony('t3')).toBeUndefined();
  });
});
