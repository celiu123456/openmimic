import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Claim } from '@openmimic/shared';
import { NoEvidenceError, Store } from '@openmimic/kernel';

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'c1',
    subjectId: 's1',
    text: 'She is generous.',
    conviction: 0.5,
    evidence: ['t1'],
    status: 'surviving',
    courtSessionId: 'cs1',
    ...overrides,
  };
}

describe('claim repository — no anchor, no claim', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    store.addTestimony({
      id: 't1',
      witnessId: 'w1',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: 'She is generous.' }],
    });
  });

  afterEach(() => {
    store.close();
  });

  it('rejects a claim with an empty evidence list', () => {
    expect(() => store.putClaim(makeClaim({ evidence: [] }))).toThrow(NoEvidenceError);
    expect(store.listClaimsBySubject('s1')).toEqual([]);
  });

  it('rejects a claim citing a testimony that is not in the ledger', () => {
    expect(() => store.putClaim(makeClaim({ evidence: ['ghost'] }))).toThrow(NoEvidenceError);
    expect(store.listClaimsBySubject('s1')).toEqual([]);
  });

  it('rejects the whole claim when only part of its evidence is real', () => {
    expect(() =>
      store.putClaim(makeClaim({ evidence: ['t1', 'ghost'] })),
    ).toThrow(NoEvidenceError);
    expect(store.getClaim('c1')).toBeUndefined();
  });

  it('persists a claim whose evidence all exists', () => {
    const stored = store.putClaim(makeClaim());
    expect(stored.evidence).toEqual(['t1']);
    expect(store.getClaim('c1')).toEqual(stored);
    expect(store.listClaimsBySubject('s1')).toHaveLength(1);
  });
});
