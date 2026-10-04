import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CourtSession } from '@openmimic/shared';
import { PluginHost, Store } from '@openmimic/kernel';
import {
  COURT_ENGINE_MANIFEST,
  FakeLLM,
  extractJson,
  registerCourtEngine,
  runCourt,
  type CourtEngine,
  type CourtEngineContext,
} from '@openmimic/engine-court';

const FILING_W1 = JSON.stringify([
  { text: 'She is generous.', evidenceTestimonyIds: ['t1'] },
]);
const FILING_W2 = JSON.stringify([
  { text: 'She is generous only when others are watching.', evidenceTestimonyIds: ['t2'] },
]);
const FILING_W3 = JSON.stringify([
  { text: 'She is never late.', evidenceTestimonyIds: ['t3'] },
]);
const VERDICT_SURVIVE = JSON.stringify({
  verdict: 'survive',
  reason: 'corroborated by another witness',
});
const VERDICT_QUALIFY = JSON.stringify({
  verdict: 'qualify',
  qualifier: 'only when observed',
  reason: 'context dependent',
});

function seedThreeWitnessTrial(store: Store): void {
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

describe('CourtEngine: three-witness trial', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    seedThreeWitnessTrial(store);
  });

  afterEach(() => {
    store.close();
  });

  it('files, cross-examines and adjudicates into a self-consistent report', async () => {
    const finished: CourtSession[] = [];
    store.events.on('court.finished', (session) => finished.push(session));

    const llm = new FakeLLM([
      FILING_W1,
      FILING_W2,
      FILING_W3,
      VERDICT_SURVIVE,
      VERDICT_QUALIFY,
    ]);

    const session = await runCourt('s1', store, llm);
    const report = session.report;

    // Five calls: three filings, two challenge judgments (the third candidate
    // had no conflicting material and was never cross-examined).
    expect(llm.calls).toHaveLength(5);
    expect(llm.calls[0]?.system).toContain('立案');

    // Report arithmetic must be self-consistent.
    expect(report).toBeDefined();
    expect(report?.totalClaims).toBe(3);
    expect(report?.surviving).toBe(2);
    expect(report?.qualified).toBe(1);
    expect(report?.rejected).toBe(0);
    expect(report?.totalClaims).toBe(
      (report?.surviving ?? 0) + (report?.qualified ?? 0) + (report?.rejected ?? 0),
    );
    expect(report?.evidenceCoverage).toBe(1);
    expect(report?.challengeCount).toBe(2);

    // Every persisted claim is anchored in real ledger entries.
    const claims = store.listClaimsBySubject('s1');
    expect(claims).toHaveLength(3);
    for (const claim of claims) {
      expect(claim.evidence.length).toBeGreaterThanOrEqual(1);
      for (const testimonyId of claim.evidence) {
        expect(store.getTestimony(testimonyId)).toBeDefined();
      }
    }

    const survivingStatus = claims.filter((claim) => claim.status === 'surviving');
    expect(survivingStatus.length).toBeGreaterThanOrEqual(2);

    // Exactly one claim survived only with a qualifier.
    const qualified = claims.filter((claim) => (claim.qualifiers?.length ?? 0) > 0);
    expect(qualified).toHaveLength(1);
    expect(qualified[0]?.evidence).toEqual(['t2']);
    expect(qualified[0]?.qualifiers).toEqual(['only when observed']);
    expect(qualified[0]?.conviction).toBe(0.65);

    // Challenged survival earns full conviction; unchallenged is capped at 0.6.
    const challengedSurvivor = claims.find((claim) => claim.evidence.includes('t1'));
    const unchallenged = claims.find((claim) => claim.evidence.includes('t3'));
    expect(challengedSurvivor?.conviction).toBe(0.8);
    expect(unchallenged?.conviction).toBe(0.6);

    // Transcript and persistence.
    expect(session.transcript.filter((event) => event.type === 'claim_proposed')).toHaveLength(3);
    expect(session.transcript.filter((event) => event.type === 'challenge')).toHaveLength(2);
    expect(session.transcript.filter((event) => event.type === 'adjudication')).toHaveLength(3);
    expect(store.getCourtSession(session.id)?.report).toEqual(report);

    // The kernel event fired exactly once with the recorded session.
    expect(finished).toHaveLength(1);
    expect(finished[0]?.id).toBe(session.id);
    expect(finished[0]?.report).toEqual(report);
  });

  it('retries a failed filing once per witness, then skips that witness', async () => {
    const soloStore = new Store();
    soloStore.putWitness({
      id: 'w1',
      subjectId: 's1',
      relation: 'colleague',
      consentLevel: 'quotable',
    });
    soloStore.putWitness({
      id: 'w2',
      subjectId: 's1',
      relation: 'friend',
      consentLevel: 'quotable',
    });
    soloStore.addTestimony({
      id: 't1',
      witnessId: 'w1',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: 'The sky is blue.' }],
    });
    soloStore.addTestimony({
      id: 't2',
      witnessId: 'w2',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: 'Rocks are heavy.' }],
    });

    try {
      const llm = new FakeLLM([
        '[{"text":"The sky is blue.","evidenceTestimonyIds":["t1"]}]',
        'this is not json',
        'still not json',
      ]);
      const session = await runCourt('s1', soloStore, llm);

      // 1 filing call for w1 + 2 (initial + retry) for the failing w2.
      expect(llm.calls).toHaveLength(3);
      expect(session.transcript.some((event) => event.text.includes('立案失败'))).toBe(true);
      expect(soloStore.listClaimsBySubject('s1')).toHaveLength(1);
      expect(session.report?.totalClaims).toBe(1);
      expect(session.report?.surviving).toBe(1);
      expect(session.report?.evidenceCoverage).toBe(1);
    } finally {
      soloStore.close();
    }
  });
});

describe('CourtEngine plugin assembly', () => {
  it('registers the official engine through the shared plugin path and runs it', async () => {
    const store = new Store();
    try {
      seedThreeWitnessTrial(store);
      const context: CourtEngineContext = {
        store,
        llm: new FakeLLM([
          FILING_W1,
          FILING_W2,
          FILING_W3,
          VERDICT_SURVIVE,
          VERDICT_QUALIFY,
        ]),
        engines: {},
      };
      const host = new PluginHost<CourtEngineContext>(context);
      await registerCourtEngine(host);

      expect(host.has(COURT_ENGINE_MANIFEST.name)).toBe(true);
      expect(host.get('court')?.kind).toBe('engine');

      const engine = context.engines.court as CourtEngine;
      expect(typeof engine.runCourt).toBe('function');

      const session = await engine.runCourt('s1');
      expect(session.report?.totalClaims).toBe(3);
      expect(store.listClaimsBySubject('s1')).toHaveLength(3);
    } finally {
      store.close();
    }
  });
});

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
