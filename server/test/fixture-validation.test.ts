/**
 * Fixture validation: ensures the limo demo data is internally consistent.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import {
  DEMO_CLAIMS,
  DEMO_CORPUS,
  DEMO_DIVERGENCES,
  DEMO_EPISODES,
  DEMO_SUBJECT_ID,
  demoCourtReport,
  seedDemo,
} from '@openmimic/fixtures';

describe('limo fixture validation', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  it('seeds idempotently', () => {
    store = new Store();
    expect(seedDemo(store)).toBe(true);
    expect(seedDemo(store)).toBe(false);
  });

  it('every episode text is a verbatim substring of its testimony answer', () => {
    store = new Store();
    seedDemo(store);

    for (const episode of DEMO_EPISODES) {
      const testimony = store.getTestimony(episode.testimonyId);
      expect(testimony).toBeDefined();
      const answer = testimony!.answers.find((a) => a.qid === episode.qid);
      expect(answer).toBeDefined();
      const source = episode.elicited ? answer!.followupText : answer!.behindText;
      expect(source).toBeDefined();
      expect(source).toContain(episode.text);
    }
  });

  it('has >= 3 episodes per witness', () => {
    const episodesByWitness = new Map<string, number>();
    for (const ep of DEMO_EPISODES) {
      episodesByWitness.set(ep.witnessId, (episodesByWitness.get(ep.witnessId) ?? 0) + 1);
    }
    for (const [witnessId, count] of episodesByWitness) {
      expect(count, `witness ${witnessId} has < 3 episodes`).toBeGreaterThanOrEqual(3);
    }
  });

  it('has >= 4 divergences with >= 1 factual', () => {
    expect(DEMO_DIVERGENCES.length).toBeGreaterThanOrEqual(4);
    const factual = DEMO_DIVERGENCES.filter((d) => d.type === 'factual');
    expect(factual.length).toBeGreaterThanOrEqual(1);
  });

  it('has 8-12 corpus items', () => {
    expect(DEMO_CORPUS.length).toBeGreaterThanOrEqual(8);
    expect(DEMO_CORPUS.length).toBeLessThanOrEqual(12);
  });

  it('court report is self-consistent', () => {
    const report = demoCourtReport();
    const surviving = DEMO_CLAIMS.filter(
      (c) => c.status === 'surviving' && (c.qualifiers?.length ?? 0) === 0,
    ).length;
    const qualified = DEMO_CLAIMS.filter(
      (c) => c.status === 'surviving' && (c.qualifiers?.length ?? 0) > 0,
    ).length;
    const contested = DEMO_CLAIMS.filter((c) => c.status === 'contested').length;

    expect(report.surviving).toBe(surviving);
    expect(report.qualified).toBe(qualified);
    expect(report.contested).toBe(contested);
    expect(report.totalClaims).toBe(DEMO_CLAIMS.length);
    expect(report.episodeCount).toBe(DEMO_EPISODES.length);
    expect(report.divergences).toBe(DEMO_DIVERGENCES.length);
  });

  it('all episodes pass store validation (putEpisode does not throw)', () => {
    store = new Store();
    seedDemo(store);

    // All episodes were seeded successfully via seedDemo
    const episodes = store.listEpisodesBySubject(DEMO_SUBJECT_ID);
    expect(episodes.length).toBe(DEMO_EPISODES.length);
  });

  it('every divergence references valid claims', () => {
    const claimIds = new Set(DEMO_CLAIMS.map((c) => c.id));
    for (const div of DEMO_DIVERGENCES) {
      for (const pos of div.positions) {
        expect(claimIds.has(pos.claimId), `divergence ${div.id} references missing claim ${pos.claimId}`).toBe(true);
      }
    }
  });

  it('every claim with episodeIds references real episodes', () => {
    const episodeIds = new Set(DEMO_EPISODES.map((e) => e.id));
    for (const claim of DEMO_CLAIMS) {
      for (const epId of claim.episodeIds ?? []) {
        expect(episodeIds.has(epId), `claim ${claim.id} references missing episode ${epId}`).toBe(true);
      }
    }
  });
});
