import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WITHHELD_PLACEHOLDER } from '@openmimic/shared';
import { Store } from '@openmimic/kernel';

describe('authorization gate', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    store.putWitness({
      id: 'w1',
      subjectId: 's1',
      relation: 'friend',
      consentLevel: 'synthesis_only',
    });
    store.putWitness({
      id: 'w2',
      subjectId: 's1',
      relation: 'colleague',
      consentLevel: 'quotable',
    });
  });

  afterEach(() => {
    store.close();
  });

  const addTestimony = (id: string, witnessId: string, behindText: string) =>
    store.addTestimony({
      id,
      witnessId,
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText, frontText: `${behindText} (to their face)` }],
      freeText: `${behindText} free text`,
    });

  it('withholds synthesis_only raw words from external viewers', () => {
    const testimony = addTestimony('t1', 'w1', 'secret raw words');
    const redacted = store.redact(testimony, 'external');

    expect(redacted.answers[0]?.behindText).toBe(WITHHELD_PLACEHOLDER);
    expect(redacted.answers[0]?.frontText).toBe(WITHHELD_PLACEHOLDER);
    expect(redacted.freeText).toBe(WITHHELD_PLACEHOLDER);
    expect(JSON.stringify(redacted)).not.toContain('secret raw words');
    // The stored ledger entry is untouched.
    expect(store.getTestimony('t1')?.answers[0]?.behindText).toBe('secret raw words');
  });

  it('shows synthesis_only raw words to the internal court view', () => {
    const testimony = addTestimony('t1', 'w1', 'secret raw words');
    const courtView = store.redact(testimony, 'court');

    expect(courtView).toBe(testimony);
    expect(courtView.answers[0]?.behindText).toBe('secret raw words');
    expect(courtView.freeText).toBe('secret raw words free text');
  });

  it('leaves quotable testimony untouched in every scope', () => {
    const testimony = addTestimony('t2', 'w2', 'visible words');

    expect(store.redact(testimony, 'external')).toBe(testimony);
    expect(store.redact(testimony, 'external').answers[0]?.behindText).toBe('visible words');
  });

  it('redacts a batch consistently', () => {
    const a = addTestimony('t1', 'w1', 'secret raw words');
    const b = addTestimony('t2', 'w2', 'visible words');
    const redacted = store.redactAll([a, b], 'external');

    expect(redacted.map((t) => t.answers[0]?.behindText)).toEqual([
      WITHHELD_PLACEHOLDER,
      'visible words',
    ]);
  });
});
