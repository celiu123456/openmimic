/**
 * Court engine v2 pipeline tests.
 *
 * Rewritten from v1: the pipeline is now filing (with episodes) → pairing →
 * relation judgment → computeConviction, replacing the old filing →
 * cross-examination → adjudication flow.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CourtSession } from '@openmimic/shared';
import { EventBus, FakeEmbedding, PluginHost, Store } from '@openmimic/kernel';
import {
  EmbeddingClaimPairFinder,
  FakeLLM,
  KeywordClaimPairFinder,
  computeConviction,
  courtPlugin,
  extractJson,
  runCourt,
  type CourtEngine,
} from '@openmimic/engine-court';

/* ------------------------------------------------------------------ */
/* v2 filing responses: each witness produces episodes + claims         */
/* ------------------------------------------------------------------ */

const FILING_W1 = JSON.stringify({
  episodes: [
    { qid: 'q1', text: 'extremely generous and always pays for lunch' },
  ],
  claims: [
    { text: 'She is generous.', kind: 'observation', domain: 'observable',
      evidenceTestimonyIds: ['t1'], episodeTexts: ['extremely generous'] },
  ],
});

const FILING_W2 = JSON.stringify({
  episodes: [
    { qid: 'q1', text: 'generous only when others are watching' },
  ],
  claims: [
    { text: 'She is generous only when others are watching.',
      kind: 'observation', domain: 'observable',
      context: { audience: 'public', situation: 'social events' },
      evidenceTestimonyIds: ['t2'] },
  ],
});

const FILING_W3 = JSON.stringify({
  episodes: [
    { qid: 'q1', text: 'meticulous calendar and is never late' },
  ],
  claims: [
    { text: 'She keeps a meticulous calendar and is never late.',
      kind: 'fact', domain: 'observable', evidenceTestimonyIds: ['t3'] },
  ],
});

/** Relation: w1 & w2's claims are a perspective difference on generosity. */
const RELATION_PERSPECTIVE = JSON.stringify({
  relation: 'perspective_difference',
  topic: 'generosity',
  reason: 'w1 sees unconditional generosity, w2 sees it as situational',
});

/** Relation: agreement (for an alternative scenario). */
const RELATION_AGREEMENT = JSON.stringify({
  relation: 'agreement',
  topic: 'generosity',
  reason: 'both witnesses agree she is generous',
  mergedText: 'She is consistently generous in social situations.',
});

/** Relation: factual_conflict. */
const RELATION_FACTUAL = JSON.stringify({
  relation: 'factual_conflict',
  topic: 'punctuality',
  reason: 'one says always on time, other says frequently late',
});

/** Confrontation: unresolved → both contested. */
const CONFRONTATION_UNRESOLVED = JSON.stringify({
  verdict: 'unresolved',
  reason: 'cannot reconcile',
});

/** Confrontation: qualified → both get qualifier. */
const CONFRONTATION_QUALIFIED = JSON.stringify({
  verdict: 'qualified',
  qualifier: 'only in professional context',
  reason: 'may be context-dependent',
});

function seedThreeWitnessTrial(store: Store): void {
  store.putSubject({ id: 's1', displayName: 'Alice' });
  store.putWitness({
    id: 'w1',
    subjectId: 's1',
    relation: 'colleague',
    consentLevel: 'quotable',
  });
  store.putWitness({
    id: 'w2',
    subjectId: 's1',
    relation: 'friend',
    consentLevel: 'quotable',
  });
  store.putWitness({
    id: 'w3',
    subjectId: 's1',
    relation: 'sibling',
    consentLevel: 'synthesis_only',
  });

  store.addTestimony({
    id: 't1',
    witnessId: 'w1',
    subjectId: 's1',
    answers: [
      { qid: 'q1', behindText: 'She is extremely generous and always pays for lunch.' },
    ],
  });
  store.addTestimony({
    id: 't2',
    witnessId: 'w2',
    subjectId: 's1',
    answers: [{ qid: 'q1', behindText: 'She is generous only when others are watching.' }],
  });
  store.addTestimony({
    id: 't3',
    witnessId: 'w3',
    subjectId: 's1',
    answers: [
      { qid: 'q1', behindText: 'She keeps a meticulous calendar and is never late.' },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* computeConviction unit tests (pure function, §2.3.4)                */
/* ------------------------------------------------------------------ */

describe('computeConviction', () => {
  it('base 0.5 for a single witness, no episode, not paired', () => {
    // base 0.5, no-episode cap 0.55, unpaired cap 0.6 → min(0.5, 0.55, 0.6) = 0.5
    expect(computeConviction({
      witnessCount: 1, hasEpisode: false, allEpisodesElicited: false,
      wasPaired: false, isContested: false,
    })).toBe(0.5);
  });

  it('returns 0 when contested', () => {
    expect(computeConviction({
      witnessCount: 3, hasEpisode: true, allEpisodesElicited: false,
      wasPaired: true, isContested: true,
    })).toBe(0);
  });

  it('caps at 0.55 without episode', () => {
    expect(computeConviction({
      witnessCount: 3, hasEpisode: false, allEpisodesElicited: false,
      wasPaired: true, isContested: false,
    })).toBe(0.55);
  });

  it('caps at CONVICTION_UNCHALLENGED_CAP (0.6) when never paired', () => {
    expect(computeConviction({
      witnessCount: 2, hasEpisode: true, allEpisodesElicited: false,
      wasPaired: false, isContested: false,
    })).toBe(0.6);
  });

  it('applies 0.85 multiplier when all episodes are elicited', () => {
    const result = computeConviction({
      witnessCount: 1, hasEpisode: true, allEpisodesElicited: true,
      wasPaired: true, isContested: false,
    });
    // base 0.5 * 0.85 = 0.425
    expect(result).toBe(0.43); // rounded
  });

  it('adds +0.12 per additional witness, cap 0.9', () => {
    expect(computeConviction({
      witnessCount: 4, hasEpisode: true, allEpisodesElicited: false,
      wasPaired: true, isContested: false,
    })).toBe(0.86); // 0.5 + 0.36 = 0.86

    // Cap at 0.9
    expect(computeConviction({
      witnessCount: 10, hasEpisode: true, allEpisodesElicited: false,
      wasPaired: true, isContested: false,
    })).toBe(0.9);
  });
});

/* ------------------------------------------------------------------ */
/* Three-witness trial: v2 pipeline                                    */
/* ------------------------------------------------------------------ */

describe('CourtEngine v2: three-witness trial', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    seedThreeWitnessTrial(store);
  });

  afterEach(() => {
    store.close();
  });

  it('perspective_difference: both claims survive and produce a Divergence', async () => {
    const finished: CourtSession[] = [];
    store.events.on('court.finished', (session) => finished.push(session));

    // The keyword pair finder will pair w1 and w2 claims (both mention "generous")
    const llm = new FakeLLM([
      FILING_W1,
      FILING_W2,
      FILING_W3,
      RELATION_PERSPECTIVE,
    ]);

    const session = await runCourt('s1', store, llm, {
      pairFinder: new KeywordClaimPairFinder(1),
    });
    const report = session.report;

    // Filing: 3 calls, Relation: 1 call for the paired claims
    expect(llm.calls[0]?.system).toContain('立案');
    expect(report).toBeDefined();

    // Both generous claims survive, plus the calendar claim
    const claims = store.listClaimsBySubject('s1')
      .filter((c) => c.courtSessionId === session.id);
    const surviving = claims.filter((c) => c.status === 'surviving');
    expect(surviving.length).toBeGreaterThanOrEqual(2);

    // A perspective divergence was created
    const divergences = store.listDivergencesBySubject('s1');
    expect(divergences.length).toBeGreaterThanOrEqual(1);
    expect(divergences[0]?.type).toBe('perspective');
    expect(divergences[0]?.resolution).toBe('kept_both');
    expect(report?.divergences).toBeGreaterThanOrEqual(1);

    // Episodes were extracted
    const episodes = store.listEpisodesBySubject('s1');
    expect(episodes.length).toBeGreaterThanOrEqual(1);
    expect(report?.episodeCount).toBeGreaterThanOrEqual(1);

    // Report is self-consistent
    expect(report?.evidenceCoverage).toBe(1);

    // Event fired
    expect(finished).toHaveLength(1);
    expect(finished[0]?.id).toBe(session.id);
  });

  it('agreement: claims merge evidence, retire one, and use mergedText', async () => {
    const llm = new FakeLLM([
      FILING_W1,
      FILING_W2,
      FILING_W3,
      RELATION_AGREEMENT,
    ]);

    const session = await runCourt('s1', store, llm, {
      pairFinder: new KeywordClaimPairFinder(1),
    });

    const claims = store.listClaimsBySubject('s1')
      .filter((c) => c.courtSessionId === session.id);
    const retired = claims.filter((c) => c.status === 'retired');
    expect(retired.length).toBeGreaterThanOrEqual(1);

    // The surviving claim should have merged evidence from both witnesses
    const surviving = claims.filter((c) => c.status === 'surviving');
    const mergedClaim = surviving.find((c) =>
      c.witnessIds && c.witnessIds.length >= 2,
    );
    expect(mergedClaim).toBeDefined();
    // The merged claim text should be the mergedText, not either witness's original text
    expect(mergedClaim!.text).toBe('She is consistently generous in social situations.');
    expect(session.report?.retired).toBeGreaterThanOrEqual(1);
  });

  it('agreement without mergedText is treated as unrelated (no merge)', async () => {
    const agreementNoText = JSON.stringify({
      relation: 'agreement',
      topic: 'generosity',
      reason: 'both witnesses agree',
      // mergedText is missing
    });

    const llm = new FakeLLM([
      FILING_W1,
      FILING_W2,
      FILING_W3,
      agreementNoText,
    ]);

    const session = await runCourt('s1', store, llm, {
      pairFinder: new KeywordClaimPairFinder(1),
    });

    const claims = store.listClaimsBySubject('s1')
      .filter((c) => c.courtSessionId === session.id);
    // No claims should be retired (no merge happened)
    const retired = claims.filter((c) => c.status === 'retired');
    expect(retired).toHaveLength(0);

    // Transcript should mention the fallback
    expect(session.transcript.some((e) =>
      e.text.includes('缺少 mergedText'),
    )).toBe(true);
  });

  it('factual_conflict + unresolved: both claims contested, conviction=0', async () => {
    // Set up two witnesses with factual conflict about punctuality
    const conflictStore = new Store();
    try {
      conflictStore.putWitness({
        id: 'w1', subjectId: 's1', relation: 'colleague', consentLevel: 'quotable',
      });
      conflictStore.putWitness({
        id: 'w2', subjectId: 's1', relation: 'friend', consentLevel: 'quotable',
      });
      conflictStore.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'She is always punctual and never late to meetings.' }],
      });
      conflictStore.addTestimony({
        id: 't2', witnessId: 'w2', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'She is frequently late and never punctual to meetings.' }],
      });

      const llm = new FakeLLM([
        JSON.stringify({
          episodes: [{ qid: 'q1', text: 'always punctual and never late to meetings' }],
          claims: [{ text: 'She is always punctual to meetings.', kind: 'fact',
            evidenceTestimonyIds: ['t1'] }],
        }),
        JSON.stringify({
          episodes: [{ qid: 'q1', text: 'frequently late and never punctual to meetings' }],
          claims: [{ text: 'She is frequently late to meetings.', kind: 'fact',
            evidenceTestimonyIds: ['t2'] }],
        }),
        RELATION_FACTUAL,
        CONFRONTATION_UNRESOLVED,
      ]);

      // Use keyword overlap=1 so "punctual" and "meetings" trigger pairing
      const session = await runCourt('s1', conflictStore, llm, {
        pairFinder: new KeywordClaimPairFinder(1),
      });

      const claims = conflictStore.listClaimsBySubject('s1')
        .filter((c) => c.courtSessionId === session.id);
      const contested = claims.filter((c) => c.status === 'contested');
      expect(contested.length).toBe(2);
      // Contested claims have conviction 0
      for (const c of contested) {
        expect(c.conviction).toBe(0);
      }

      // A factual divergence was created
      const divergences = conflictStore.listDivergencesBySubject('s1');
      expect(divergences).toHaveLength(1);
      expect(divergences[0]?.type).toBe('factual');
      expect(divergences[0]?.resolution).toBe('unresolved');
      expect(session.report?.factualConflicts).toBe(1);
      expect(session.report?.contested).toBe(2);
    } finally {
      conflictStore.close();
    }
  });

  it('retries a failed filing once per witness, then degrades to sentence split', async () => {
    const soloStore = new Store();
    try {
      soloStore.putWitness({
        id: 'w1', subjectId: 's1', relation: 'colleague', consentLevel: 'quotable',
      });
      soloStore.putWitness({
        id: 'w2', subjectId: 's1', relation: 'friend', consentLevel: 'quotable',
      });
      soloStore.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'She is extremely generous and always pays for lunch.' }],
      });
      soloStore.addTestimony({
        id: 't2', witnessId: 'w2', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: '去年她请全组吃了一顿大餐。' }],
      });

      const llm = new FakeLLM([
        FILING_W1,
        'not json at all',
        'still not json',
      ]);
      const session = await runCourt('s1', soloStore, llm);

      // 1 filing for w1 + 2 (initial + retry) for failing w2
      expect(llm.calls).toHaveLength(3);
      expect(session.transcript.some((e) => e.text.includes('立案失败'))).toBe(true);

      // w2 degradation: sentence split may produce episodes if they match heuristics
      // At minimum, w1's claims are persisted
      expect(soloStore.listClaimsBySubject('s1').length).toBeGreaterThanOrEqual(1);
    } finally {
      soloStore.close();
    }
  });

  it('no-LLM degradation: only produces episodes, no claims', async () => {
    const degradeStore = new Store();
    try {
      degradeStore.putWitness({
        id: 'w1', subjectId: 's1', relation: 'colleague', consentLevel: 'quotable',
      });
      degradeStore.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: '去年他在公司加班到凌晨三点。他说"太累了"。' }],
      });

      // All LLM calls fail
      const llm = new FakeLLM(['bad json', 'bad json']);
      const session = await runCourt('s1', degradeStore, llm);

      // Degradation should produce episodes from sentence heuristic
      // "去年" is a time word, should match
      const episodes = degradeStore.listEpisodesBySubject('s1');
      expect(episodes.length).toBeGreaterThanOrEqual(1);
      // No claims from degradation
      const claims = degradeStore.listClaimsBySubject('s1');
      expect(claims).toHaveLength(0);
      expect(session.report?.totalClaims).toBe(0);
    } finally {
      degradeStore.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Embedding pair finder                                               */
/* ------------------------------------------------------------------ */

describe('EmbeddingClaimPairFinder', () => {
  it('pairs claims from different witnesses with high cosine similarity', async () => {
    const embedding = new FakeEmbedding();
    const finder = new EmbeddingClaimPairFinder(embedding, 0.3);

    const claims = [
      {
        id: 'c1', subjectId: 's1', text: 'She is generous.', conviction: 0.8,
        evidence: ['t1'], status: 'surviving' as const, courtSessionId: 'court-1',
        witnessIds: ['w1'],
      },
      {
        id: 'c2', subjectId: 's1', text: 'She is generous with money.', conviction: 0.7,
        evidence: ['t2'], status: 'surviving' as const, courtSessionId: 'court-1',
        witnessIds: ['w2'],
      },
      {
        id: 'c3', subjectId: 's1', text: 'She likes cats.', conviction: 0.6,
        evidence: ['t3'], status: 'surviving' as const, courtSessionId: 'court-1',
        witnessIds: ['w3'],
      },
    ];

    const pairs = await finder.findPairs(claims);
    // "generous" and "generous with money" should pair
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    const generousPair = pairs.find(
      (p) =>
        (p.claimA.id === 'c1' && p.claimB.id === 'c2') ||
        (p.claimA.id === 'c2' && p.claimB.id === 'c1'),
    );
    expect(generousPair).toBeDefined();
  });

  it('does not pair claims from the same witness', async () => {
    const embedding = new FakeEmbedding();
    const finder = new EmbeddingClaimPairFinder(embedding, 0.01);

    const claims = [
      {
        id: 'c1', subjectId: 's1', text: 'She is generous.', conviction: 0.8,
        evidence: ['t1'], status: 'surviving' as const, courtSessionId: 'court-1',
        witnessIds: ['w1'],
      },
      {
        id: 'c2', subjectId: 's1', text: 'She is generous with money.', conviction: 0.7,
        evidence: ['t1b'], status: 'surviving' as const, courtSessionId: 'court-1',
        witnessIds: ['w1'],
      },
    ];

    const pairs = await finder.findPairs(claims);
    expect(pairs).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Keyword pair finder fallback                                        */
/* ------------------------------------------------------------------ */

describe('KeywordClaimPairFinder', () => {
  it('pairs claims sharing keywords from different witnesses', async () => {
    const finder = new KeywordClaimPairFinder(1);

    const claims = [
      {
        id: 'c1', subjectId: 's1', text: 'She is generous.', conviction: 0.8,
        evidence: ['t1'], status: 'surviving' as const, courtSessionId: 'court-1',
        witnessIds: ['w1'],
      },
      {
        id: 'c2', subjectId: 's1', text: 'She is generous only sometimes.', conviction: 0.7,
        evidence: ['t2'], status: 'surviving' as const, courtSessionId: 'court-1',
        witnessIds: ['w2'],
      },
    ];

    const pairs = await finder.findPairs(claims);
    expect(pairs).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Plugin assembly                                                     */
/* ------------------------------------------------------------------ */

describe('CourtEngine plugin assembly', () => {
  it('loads the official court plugin and runs it', async () => {
    const store = new Store();
    try {
      seedThreeWitnessTrial(store);
      const events = new EventBus();
      const host = new PluginHost(events);
      host.providePreset('store', store);
      host.providePreset('llm', new FakeLLM([
        FILING_W1,
        FILING_W2,
        FILING_W3,
        RELATION_PERSPECTIVE,
      ]));

      await host.load(courtPlugin);

      expect(host.has('court')).toBe(true);
      expect(host.get('court')?.kind).toBe('engine');

      const engine = host.getService<CourtEngine>('court');
      expect(typeof engine.runCourt).toBe('function');

      const session = await engine.runCourt('s1', {
        pairFinder: new KeywordClaimPairFinder(1),
      });
      expect(session.report).toBeDefined();
      expect(store.listClaimsBySubject('s1').length).toBeGreaterThanOrEqual(1);
    } finally {
      store.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* extractJson                                                         */
/* ------------------------------------------------------------------ */

describe('extractJson', () => {
  it('parses bare JSON', () => {
    expect(extractJson('{"ok":true}')).toEqual({ ok: true });
  });

  it('parses JSON inside a markdown fence', () => {
    expect(extractJson('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });

  it('parses JSON surrounded by prose', () => {
    expect(extractJson('Sure, here it is: [{"a":1}] — done.')).toEqual([{ a: 1 }]);
  });

  it('throws when there is no JSON at all', () => {
    expect(() => extractJson('no structured output here')).toThrow(/parseable JSON/);
  });
});

/* ------------------------------------------------------------------ */
/* Defect regression tests: lenient filing, truncated output, etc.      */
/* ------------------------------------------------------------------ */

describe('Defect regressions', () => {
  it('keeps valid claims when some items in the filing are malformed', async () => {
    const store = new Store();
    try {
      store.putWitness({
        id: 'w1', subjectId: 's1', relation: 'colleague', consentLevel: 'quotable',
      });
      store.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'She is extremely generous and always pays for lunch.' }],
      });

      // Response has one valid claim and one malformed claim (missing text)
      const filing = JSON.stringify({
        episodes: [
          { qid: 'q1', text: 'extremely generous and always pays for lunch' },
        ],
        claims: [
          { text: 'She is generous.', kind: 'observation', evidenceTestimonyIds: ['t1'] },
          { text: '', kind: 'observation', evidenceTestimonyIds: ['t1'] }, // invalid: empty text
          { kind: 'observation', evidenceTestimonyIds: ['t1'] }, // invalid: no text field
        ],
      });

      const llm = new FakeLLM([filing]);
      const session = await runCourt('s1', store, llm, {
        pairFinder: new KeywordClaimPairFinder(100), // high threshold so no pairing
      });

      // Should have kept the valid claim
      const claims = store.listClaimsBySubject('s1');
      expect(claims.length).toBeGreaterThanOrEqual(1);
      expect(claims.some((c) => c.text === 'She is generous.')).toBe(true);
    } finally {
      store.close();
    }
  });

  it('handles JSON wrapped in markdown code blocks from filing', async () => {
    const store = new Store();
    try {
      store.putWitness({
        id: 'w1', subjectId: 's1', relation: 'colleague', consentLevel: 'quotable',
      });
      store.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'She is always punctual to meetings.' }],
      });

      // Response wrapped in markdown fence
      const filing = '```json\n' + JSON.stringify({
        episodes: [{ qid: 'q1', text: 'always punctual to meetings' }],
        claims: [{ text: 'She is punctual.', kind: 'fact', evidenceTestimonyIds: ['t1'] }],
      }) + '\n```';

      const llm = new FakeLLM([filing]);
      const session = await runCourt('s1', store, llm, {
        pairFinder: new KeywordClaimPairFinder(100),
      });

      const claims = store.listClaimsBySubject('s1');
      expect(claims.length).toBe(1);
      expect(claims[0]?.text).toBe('She is punctual.');
    } finally {
      store.close();
    }
  });

  it('does not create claims about the witness themselves (self-evaluation)', async () => {
    // This is a prompt-level constraint; here we verify that the filing
    // system prompt includes the instruction about subject-only claims
    const store = new Store();
    try {
      store.putSubject({ id: 's1', displayName: 'Alice' });
      store.putWitness({
        id: 'w1', subjectId: 's1', relation: 'boss', consentLevel: 'quotable',
      });
      store.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'This was my worst performance as a manager.' }],
      });

      const llm = new FakeLLM([
        JSON.stringify({
          episodes: [],
          claims: [{ text: 'The witness performed poorly as manager.', kind: 'observation', evidenceTestimonyIds: ['t1'] }],
        }),
      ]);

      // Verify that the filing prompt mentions the constraint
      await runCourt('s1', store, llm, {
        pairFinder: new KeywordClaimPairFinder(100),
      });

      // The filing system prompt should use the subject's displayName
      expect(llm.calls[0]?.system).toContain('论断的主语必须是Alice');
      // And instruct to use relation names not "证人"
      expect(llm.calls[0]?.system).toContain('关系名');
    } finally {
      store.close();
    }
  });

  it('filing prompt uses subject displayName and witness relation', async () => {
    const store = new Store();
    try {
      store.putSubject({ id: 's1', displayName: '林默' });
      store.putWitness({
        id: 'w1', subjectId: 's1', relation: '发小', consentLevel: 'quotable',
      });
      store.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'He is generous and always pays.' }],
      });

      const llm = new FakeLLM([
        JSON.stringify({
          episodes: [{ qid: 'q1', text: 'generous and always pays' }],
          claims: [{ text: '林默对朋友花钱大方。', kind: 'observation', evidenceTestimonyIds: ['t1'] }],
        }),
      ]);

      await runCourt('s1', store, llm, {
        pairFinder: new KeywordClaimPairFinder(100),
      });

      // System prompt should reference 林默 as the subject name
      expect(llm.calls[0]?.system).toContain('关于林默的证言');
      expect(llm.calls[0]?.system).toContain('论断的主语必须是林默');
      // The prompt explicitly tells the LLM not to use "当事人"
      expect(llm.calls[0]?.system).toContain('不要用"当事人"');
      // User prompt should reference the witness relation
      expect(llm.calls[0]?.user).toContain('发小');
      expect(llm.calls[0]?.user).toContain('林默');
    } finally {
      store.close();
    }
  });

  it('relation judgment correctly identifies unrelated claims on different dimensions', async () => {
    const store = new Store();
    try {
      store.putWitness({
        id: 'w1', subjectId: 's1', relation: 'boss', consentLevel: 'quotable',
      });
      store.putWitness({
        id: 'w2', subjectId: 's1', relation: 'ex', consentLevel: 'quotable',
      });
      store.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'He made phone calls alone in the stairwell.' }],
      });
      store.addTestimony({
        id: 't2', witnessId: 'w2', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'He is very talkative with strangers.' }],
      });

      const llm = new FakeLLM([
        JSON.stringify({
          episodes: [{ qid: 'q1', text: 'phone calls alone in the stairwell' }],
          claims: [{ text: 'Makes phone calls alone in stairwell when stressed.', kind: 'observation', evidenceTestimonyIds: ['t1'] }],
        }),
        JSON.stringify({
          episodes: [{ qid: 'q1', text: 'very talkative with strangers' }],
          claims: [{ text: 'Very talkative with strangers.', kind: 'observation', evidenceTestimonyIds: ['t2'] }],
        }),
        // LLM pair finder responds
        JSON.stringify([{ a: 0, b: 1 }]),
        // Relation: unrelated (different dimensions)
        JSON.stringify({
          relation: 'unrelated',
          topic: '',
          reason: 'different behavioral dimensions: stress coping vs social communication',
        }),
      ]);

      const session = await runCourt('s1', store, llm);

      // No divergences should be created for unrelated claims
      const divergences = store.listDivergencesBySubject('s1');
      expect(divergences).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it('relation judgment prompt requires same behavioral dimension for perspective_difference', async () => {
    const store = new Store();
    try {
      store.putWitness({
        id: 'w1', subjectId: 's1', relation: 'friend', consentLevel: 'quotable',
      });
      store.putWitness({
        id: 'w2', subjectId: 's1', relation: 'ex', consentLevel: 'quotable',
      });
      store.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'He spends freely on friends.' }],
      });
      store.addTestimony({
        id: 't2', witnessId: 'w2', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'He is stingy with his partner on money.' }],
      });

      const llm = new FakeLLM([
        JSON.stringify({
          episodes: [{ qid: 'q1', text: 'spends freely on friends' }],
          claims: [{ text: 'Spends freely on friends.', kind: 'observation', evidenceTestimonyIds: ['t1'] }],
        }),
        JSON.stringify({
          episodes: [{ qid: 'q1', text: 'stingy with his partner on money' }],
          claims: [{ text: 'Stingy with partner on money.', kind: 'observation', evidenceTestimonyIds: ['t2'] }],
        }),
        // LLM pair finder
        JSON.stringify([{ a: 0, b: 1 }]),
        // Relation: perspective_difference on the SAME dimension (spending)
        JSON.stringify({
          relation: 'perspective_difference',
          topic: '消费态度',
          reason: 'same dimension (spending attitude) but different directions',
        }),
      ]);

      const session = await runCourt('s1', store, llm);

      const divergences = store.listDivergencesBySubject('s1');
      expect(divergences).toHaveLength(1);
      expect(divergences[0]?.type).toBe('perspective');
      expect(divergences[0]?.topic).toBe('消费态度');
      // Both claims survive
      const claims = store.listClaimsBySubject('s1').filter((c) => c.status === 'surviving');
      expect(claims.length).toBe(2);
    } finally {
      store.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* LLMClaimPairFinder                                                   */
/* ------------------------------------------------------------------ */

describe('LLMClaimPairFinder', () => {
  it('uses LLM to find semantically related pairs from different witnesses', async () => {
    const { LLMClaimPairFinder } = await import('@openmimic/engine-court');

    const llm = new FakeLLM([
      JSON.stringify([{ a: 0, b: 1 }]),
    ]);

    const finder = new LLMClaimPairFinder(llm);
    const claims = [
      {
        id: 'c1', subjectId: 's1', text: 'He is generous with friends.',
        conviction: 0.8, evidence: ['t1'], status: 'surviving' as const,
        courtSessionId: 'court-1', witnessIds: ['w1'],
      },
      {
        id: 'c2', subjectId: 's1', text: 'He is stingy with his partner.',
        conviction: 0.7, evidence: ['t2'], status: 'surviving' as const,
        courtSessionId: 'court-1', witnessIds: ['w2'],
      },
      {
        id: 'c3', subjectId: 's1', text: 'He likes cats.',
        conviction: 0.6, evidence: ['t3'], status: 'surviving' as const,
        courtSessionId: 'court-1', witnessIds: ['w3'],
      },
    ];

    const pairs = await finder.findPairs(claims);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.claimA.id).toBe('c1');
    expect(pairs[0]?.claimB.id).toBe('c2');
  });

  it('falls back to keyword pairing when LLM fails', async () => {
    const { LLMClaimPairFinder } = await import('@openmimic/engine-court');

    const llm = new FakeLLM(['not json at all']);
    const finder = new LLMClaimPairFinder(llm);

    // Use Chinese text so CJK bigram tokenization produces enough overlap
    const claims = [
      {
        id: 'c1', subjectId: 's1', text: '他对朋友花钱大方,请客从不犹豫。',
        conviction: 0.8, evidence: ['t1'], status: 'surviving' as const,
        courtSessionId: 'court-1', witnessIds: ['w1'],
      },
      {
        id: 'c2', subjectId: 's1', text: '他对女朋友花钱很抠,精确AA。',
        conviction: 0.7, evidence: ['t2'], status: 'surviving' as const,
        courtSessionId: 'court-1', witnessIds: ['w2'],
      },
    ];

    const pairs = await finder.findPairs(claims);
    // Should fall back to keyword finder and find overlap on "花钱" bigrams
    expect(pairs.length).toBeGreaterThanOrEqual(1);
  });

  it('does not pair claims from the same witness', async () => {
    const { LLMClaimPairFinder } = await import('@openmimic/engine-court');

    const llm = new FakeLLM([
      JSON.stringify([{ a: 0, b: 1 }]), // LLM incorrectly pairs same-witness
    ]);

    const finder = new LLMClaimPairFinder(llm);
    const claims = [
      {
        id: 'c1', subjectId: 's1', text: 'She is generous.',
        conviction: 0.8, evidence: ['t1'], status: 'surviving' as const,
        courtSessionId: 'court-1', witnessIds: ['w1'],
      },
      {
        id: 'c2', subjectId: 's1', text: 'She is kind.',
        conviction: 0.7, evidence: ['t1b'], status: 'surviving' as const,
        courtSessionId: 'court-1', witnessIds: ['w1'], // same witness
      },
    ];

    const pairs = await finder.findPairs(claims);
    expect(pairs).toHaveLength(0); // filtered out
  });
});
