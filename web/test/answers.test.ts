import { describe, expect, it } from 'vitest';
import {
  answersStorageKey,
  emptyDraft,
  loadDraft,
  saveDraft,
  clearDraft,
  type InterviewDraft,
} from '../src/answers';
import type { KeyValueStore } from '../src/storage';

class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const sampleDraft = (): InterviewDraft => ({
  ...emptyDraft(),
  relationChoice: '朋友',
  currentIndex: 2,
  consentLevel: 'quotable',
  answers: {
    q1: { behindText: '她总是提前买单。', frontText: '', frontSkipped: true },
    q2: { behindText: '生气就不说话。', frontText: '我会直接问她。', frontSkipped: false },
  },
});

describe('answers local draft', () => {
  it('returns undefined when nothing was stored for the token', () => {
    expect(loadDraft(new MemoryStore(), 'missing-token')).toBeUndefined();
  });

  it('round-trips a full draft through storage', () => {
    const store = new MemoryStore();
    const draft = sampleDraft();
    saveDraft(store, 'tok', draft);
    expect(store.getItem(answersStorageKey('tok'))).not.toBeNull();
    expect(loadDraft(store, 'tok')).toEqual(draft);
  });

  it('clears the draft after a successful submission', () => {
    const store = new MemoryStore();
    saveDraft(store, 'tok', sampleDraft());
    clearDraft(store, 'tok');
    expect(loadDraft(store, 'tok')).toBeUndefined();
  });

  it('survives corrupt JSON and unknown fields without throwing', () => {
    const store = new MemoryStore();
    store.setItem(answersStorageKey('tok'), '{not json');
    expect(loadDraft(store, 'tok')).toBeUndefined();

    store.setItem(
      answersStorageKey('tok'),
      JSON.stringify({ relationChoice: 42, answers: { q1: { behindText: 'ok' } }, junk: true }),
    );
    const draft = loadDraft(store, 'tok');
    expect(draft?.relationChoice).toBe('');
    expect(draft?.answers.q1).toEqual({ behindText: 'ok', frontText: '', frontSkipped: false });
    expect(draft?.consentLevel).toBe('synthesis_only');
  });

  it('defaults consent to synthesis_only (private by default)', () => {
    expect(emptyDraft().consentLevel).toBe('synthesis_only');
  });
});
