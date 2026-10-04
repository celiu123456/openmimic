import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import { demoRoom, seedDemo } from '../../../fixtures/limo';
import { tierDistribution } from '@openmimic/engine-room';

describe('fixture tier consistency', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    seedDemo(store);
  });

  afterEach(() => {
    store.close();
  });

  it('demo room behind transcript has tier on every utterance', () => {
    const room = demoRoom();
    for (const u of room.behindTranscript) {
      expect(u.tier).toBeDefined();
      expect(['quote', 'paraphrase', 'extrapolate']).toContain(u.tier);
    }
  });

  it('demo room front transcript has tier on every utterance', () => {
    const room = demoRoom();
    for (const u of room.frontTranscript ?? []) {
      expect(u.tier).toBeDefined();
      expect(['quote', 'paraphrase', 'extrapolate']).toContain(u.tier);
    }
  });

  it('stage directions are always extrapolate', () => {
    const room = demoRoom();
    const allLines = [...room.behindTranscript, ...(room.frontTranscript ?? [])];
    const stageLines = allLines.filter((u) => u.kind === 'stage');
    for (const u of stageLines) {
      expect(u.tier).toBe('extrapolate');
    }
  });

  it('behind transcript has at least some paraphrase lines (fixture lines cite qids)', () => {
    const room = demoRoom();
    const dist = tierDistribution(room.behindTranscript);
    expect(dist.paraphrase).toBeGreaterThan(0);
  });

  it('seedDemo is still idempotent', () => {
    // seedDemo called in beforeEach; calling again should return false
    expect(seedDemo(store)).toBe(false);
    // And the room is still readable
    expect(store.getRoom('room-limo-1')).toBeDefined();
  });

  it('stored room round-trips tier and anchors', () => {
    const room = store.getRoom('room-limo-1');
    expect(room).toBeDefined();
    // Check first behind utterance has tier
    const first = room!.behindTranscript[0];
    expect(first?.tier).toBeDefined();
  });
});
