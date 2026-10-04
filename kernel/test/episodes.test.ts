/**
 * Episode, Divergence, CorpusItem store operations and validation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NoAnchorError, Store } from '@openmimic/kernel';

describe('Store: episodes', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    store.putWitness({ id: 'w1', subjectId: 's1', relation: '同事', consentLevel: 'quotable' });
    store.addTestimony({
      id: 't1',
      witnessId: 'w1',
      subjectId: 's1',
      answers: [
        {
          qid: 'q1',
          behindText: '他总是最后一个走,有一次他在公司加班到凌晨三点。',
          followupText: '追问之下他承认自己确实很累。',
        },
      ],
    });
  });

  afterEach(() => {
    store.close();
  });

  it('accepts a verbatim substring of behindText as non-elicited', () => {
    const episode = store.putEpisode({
      id: 'ep1',
      subjectId: 's1',
      witnessId: 'w1',
      testimonyId: 't1',
      qid: 'q1',
      text: '有一次他在公司加班到凌晨三点',
      elicited: false,
    });
    expect(episode.id).toBe('ep1');
    expect(episode.elicited).toBe(false);
    expect(store.getEpisode('ep1')).toEqual(episode);
  });

  it('accepts a verbatim substring of followupText as elicited', () => {
    const episode = store.putEpisode({
      id: 'ep2',
      subjectId: 's1',
      witnessId: 'w1',
      testimonyId: 't1',
      qid: 'q1',
      text: '追问之下他承认自己确实很累',
      elicited: true,
    });
    expect(episode.elicited).toBe(true);
  });

  it('rejects text that is not a verbatim substring (off by one char)', () => {
    expect(() =>
      store.putEpisode({
        id: 'ep-bad',
        subjectId: 's1',
        witnessId: 'w1',
        testimonyId: 't1',
        qid: 'q1',
        text: '有一次他在公司加班到凌晨四点', // 三 → 四
        elicited: false,
      }),
    ).toThrow(NoAnchorError);
  });

  it('rejects elicited=false when text is only in followupText', () => {
    expect(() =>
      store.putEpisode({
        id: 'ep-bad2',
        subjectId: 's1',
        witnessId: 'w1',
        testimonyId: 't1',
        qid: 'q1',
        text: '追问之下他承认自己确实很累',
        elicited: false, // text is in followupText, not behindText
      }),
    ).toThrow(NoAnchorError);
  });

  it('rejects elicited=true when text is only in behindText', () => {
    expect(() =>
      store.putEpisode({
        id: 'ep-bad3',
        subjectId: 's1',
        witnessId: 'w1',
        testimonyId: 't1',
        qid: 'q1',
        text: '有一次他在公司加班到凌晨三点',
        elicited: true, // text is in behindText, not followupText
      }),
    ).toThrow(NoAnchorError);
  });

  it('lists episodes by subject', () => {
    store.putEpisode({
      id: 'ep1',
      subjectId: 's1',
      witnessId: 'w1',
      testimonyId: 't1',
      qid: 'q1',
      text: '有一次他在公司加班到凌晨三点',
      elicited: false,
    });
    store.putEpisode({
      id: 'ep2',
      subjectId: 's1',
      witnessId: 'w1',
      testimonyId: 't1',
      qid: 'q1',
      text: '追问之下他承认自己确实很累',
      elicited: true,
    });
    const episodes = store.listEpisodesBySubject('s1');
    expect(episodes).toHaveLength(2);
  });
});

describe('Store: divergences', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('puts and gets a divergence', () => {
    const divergence = store.putDivergence({
      id: 'div1',
      subjectId: 's1',
      courtSessionId: 'court-1',
      topic: '情绪管理',
      type: 'perspective',
      positions: [
        { witnessId: 'w1', claimId: 'c1', summary: '稳重' },
        { witnessId: 'w2', claimId: 'c2', summary: '冲动' },
      ],
      resolution: 'kept_both',
    });
    expect(divergence.id).toBe('div1');
    expect(store.getDivergence('div1')).toEqual(divergence);
    expect(store.listDivergencesBySubject('s1')).toHaveLength(1);
  });
});

describe('Store: corpus items', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('puts and lists corpus items', () => {
    store.putCorpusItem({
      id: 'c1',
      subjectId: 's1',
      text: '太累了。',
      source: 'pasted',
      createdAt: new Date().toISOString(),
    });
    store.putCorpusItem({
      id: 'c2',
      subjectId: 's1',
      text: '想歇一歇。',
      source: 'pasted',
      createdAt: new Date().toISOString(),
    });
    const items = store.listCorpusItemsBySubject('s1');
    expect(items).toHaveLength(2);
    expect(items[0]?.text).toBe('太累了。');
    expect(store.getCorpusItem('c1')?.text).toBe('太累了。');
  });

  it('corpus text never appears in testimonies', () => {
    // This is a design invariant: corpus_items is physically separate from
    // testimonies. There is no code path to copy corpus into testimony.
    store.putCorpusItem({
      id: 'c1',
      subjectId: 's1',
      text: '我的原话。',
      source: 'pasted',
      createdAt: new Date().toISOString(),
    });
    // No testimony should contain corpus text
    const testimonies = store.listBySubject('s1');
    for (const t of testimonies) {
      for (const a of t.answers) {
        expect(a.behindText).not.toContain('我的原话');
      }
    }
  });
});
