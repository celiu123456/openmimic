/**
 * Process evaluation: structural tests with FakeLLM.
 *
 * These tests verify the evaluation framework's classification logic,
 * scenario definitions, and report generation. They do NOT run real models.
 *
 * For real-model runs, see docs/eval-ledger.md (entry TBD).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { Store } from '@openmimic/kernel';
import type { Claim } from '@openmimic/shared';
import {
  computeEvidenceCoverage,
  CONTRADICTION_SCENARIOS,
  classifyContradictionBehaviors,
  buildContradictionReport,
  MEMORY_REPAIR_SCENARIOS,
  classifyMemoryRepair,
  buildMemoryRepairReport,
  type ContradictionScenarioResult,
  type MemoryRepairScenarioResult,
} from '@openmimic/eval';

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function seedBasicData(store: Store): void {
  store.putSubject({ id: 's1', displayName: '测试' });
  store.putWitness({ id: 'w1', subjectId: 's1', relation: '发小', consentLevel: 'quotable' });
  store.putWitness({ id: 'w2', subjectId: 's1', relation: '同事', consentLevel: 'quotable' });
  store.putWitness({ id: 'w3', subjectId: 's1', relation: '同学', consentLevel: 'quotable' });
  store.addTestimony({
    id: 't1', witnessId: 'w1', subjectId: 's1',
    answers: [{ qid: 'q1', behindText: '他花钱大方,请客从不犹豫' }],
  });
  store.addTestimony({
    id: 't2', witnessId: 'w2', subjectId: 's1',
    answers: [{ qid: 'q1', behindText: '他对花钱很谨慎,从不浪费' }],
  });
  store.addTestimony({
    id: 't3', witnessId: 'w3', subjectId: 's1',
    answers: [{ qid: 'q1', behindText: '他花钱还行,该花的不含糊' }],
  });
}

/* ================================================================== */
/* 1. Evidence Coverage (three-element)                                */
/* ================================================================== */

describe('computeEvidenceCoverage', () => {
  let store: Store;

  afterEach(() => store?.close());

  it('returns empty report for subject with no claims', () => {
    store = new Store();
    store.putSubject({ id: 's1', displayName: '空' });
    const report = computeEvidenceCoverage('s1', store);
    expect(report.totalClaims).toBe(0);
    expect(report.averageScore).toBe(0);
  });

  it('claim with episode has hasSupport=true', () => {
    store = new Store();
    seedBasicData(store);
    // Add claim with episode
    store.putClaim({
      id: 'c1', subjectId: 's1', text: '花钱大方',
      conviction: 0.7, evidence: ['t1'], status: 'surviving',
      courtSessionId: 'cs1', episodeIds: ['ep1'],
      witnessIds: ['w1'],
    });
    store.putEpisode({
      id: 'ep1', subjectId: 's1', witnessId: 'w1',
      testimonyId: 't1', qid: 'q1', text: '他花钱大方,请客从不犹豫',
      elicited: false,
    });

    const report = computeEvidenceCoverage('s1', store);
    expect(report.totalClaims).toBe(1);
    expect(report.details[0]!.hasSupport).toBe(true);
  });

  it('claim without episode has hasSupport=false', () => {
    store = new Store();
    seedBasicData(store);
    store.putClaim({
      id: 'c1', subjectId: 's1', text: '花钱大方',
      conviction: 0.7, evidence: ['t1'], status: 'surviving',
      courtSessionId: 'cs1', witnessIds: ['w1'],
    });

    const report = computeEvidenceCoverage('s1', store);
    expect(report.details[0]!.hasSupport).toBe(false);
  });

  it('claim with qualifiers has hasCounterEvidence=true', () => {
    store = new Store();
    seedBasicData(store);
    store.putClaim({
      id: 'c1', subjectId: 's1', text: '花钱大方',
      conviction: 0.7, evidence: ['t1'], status: 'surviving',
      courtSessionId: 'cs1', witnessIds: ['w1'],
      qualifiers: ['在朋友面前'],
    });

    const report = computeEvidenceCoverage('s1', store);
    expect(report.details[0]!.hasCounterEvidence).toBe(true);
  });

  it('claim with context has hasContext=true', () => {
    store = new Store();
    seedBasicData(store);
    store.putClaim({
      id: 'c1', subjectId: 's1', text: '花钱大方',
      conviction: 0.7, evidence: ['t1'], status: 'surviving',
      courtSessionId: 'cs1', witnessIds: ['w1'],
      context: { period: '2020-2025' },
    });

    const report = computeEvidenceCoverage('s1', store);
    expect(report.details[0]!.hasContext).toBe(true);
  });

  it('claim with all three elements scores 3', () => {
    store = new Store();
    seedBasicData(store);
    store.putClaim({
      id: 'c1', subjectId: 's1', text: '花钱大方',
      conviction: 0.7, evidence: ['t1'], status: 'surviving',
      courtSessionId: 'cs1', episodeIds: ['ep1'],
      witnessIds: ['w1'], qualifiers: ['朋友场合'],
      context: { period: '2020-2025', audience: '朋友' },
    });
    store.putEpisode({
      id: 'ep1', subjectId: 's1', witnessId: 'w1',
      testimonyId: 't1', qid: 'q1', text: '他花钱大方,请客从不犹豫',
      elicited: false,
    });

    const report = computeEvidenceCoverage('s1', store);
    expect(report.details[0]!.score).toBe(3);
    expect(report.fullCoverage).toBe(1);
  });

  it('only counts surviving claims', () => {
    store = new Store();
    seedBasicData(store);
    store.putClaim({
      id: 'c1', subjectId: 's1', text: '花钱大方',
      conviction: 0.7, evidence: ['t1'], status: 'surviving',
      courtSessionId: 'cs1', witnessIds: ['w1'],
    });
    store.putClaim({
      id: 'c2', subjectId: 's1', text: '有抑郁症',
      conviction: 0.5, evidence: ['t1'], status: 'retired',
      courtSessionId: 'cs1', witnessIds: ['w1'],
    });

    const report = computeEvidenceCoverage('s1', store);
    expect(report.totalClaims).toBe(1);
  });
});

/* ================================================================== */
/* 2. Contradiction Scenarios                                          */
/* ================================================================== */

describe('CONTRADICTION_SCENARIOS', () => {
  it('has >= 12 scenarios', () => {
    expect(CONTRADICTION_SCENARIOS.length).toBeGreaterThanOrEqual(12);
  });

  it('has >= 4 factual conflicts', () => {
    const fc = CONTRADICTION_SCENARIOS.filter((s) => s.type === 'factual_conflict');
    expect(fc.length).toBeGreaterThanOrEqual(4);
  });

  it('has >= 4 perspective differences', () => {
    const pd = CONTRADICTION_SCENARIOS.filter((s) => s.type === 'perspective_difference');
    expect(pd.length).toBeGreaterThanOrEqual(4);
  });

  it('has >= 4 temporal evolutions', () => {
    const te = CONTRADICTION_SCENARIOS.filter((s) => s.type === 'temporal_evolution');
    expect(te.length).toBeGreaterThanOrEqual(4);
  });

  it('each scenario has required fields', () => {
    for (const s of CONTRADICTION_SCENARIOS) {
      expect(s.id).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.existingClaimText).toBeTruthy();
      expect(s.contradictingAnswer).toBeTruthy();
      expect(s.qid).toBeTruthy();
    }
  });

  it('scenario IDs are unique', () => {
    const ids = CONTRADICTION_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('classifyContradictionBehaviors', () => {
  it('detects new claim creation', () => {
    const behaviors = classifyContradictionBehaviors({
      claimsBefore: [{ id: 'c1', text: '花钱大方', status: 'surviving', conviction: 0.7 }],
      claimsAfter: [
        { id: 'c1', text: '花钱大方', status: 'surviving', conviction: 0.7 },
        { id: 'c2', text: '花钱谨慎', status: 'surviving', conviction: 0.5 },
      ],
      divergencesBefore: 0,
      divergencesAfter: 0,
      targetClaimText: '花钱大方',
    });
    expect(behaviors).toContain('new_claim_created');
  });

  it('detects conviction decrease', () => {
    const behaviors = classifyContradictionBehaviors({
      claimsBefore: [{ id: 'c1', text: '花钱大方', status: 'surviving', conviction: 0.7 }],
      claimsAfter: [{ id: 'c1', text: '花钱大方', status: 'surviving', conviction: 0.4 }],
      divergencesBefore: 0,
      divergencesAfter: 0,
      targetClaimText: '花钱大方',
    });
    expect(behaviors).toContain('conviction_decreased');
  });

  it('detects old claim contested', () => {
    const behaviors = classifyContradictionBehaviors({
      claimsBefore: [{ id: 'c1', text: '花钱大方', status: 'surviving', conviction: 0.7 }],
      claimsAfter: [{ id: 'c1', text: '花钱大方', status: 'contested', conviction: 0 }],
      divergencesBefore: 0,
      divergencesAfter: 0,
      targetClaimText: '花钱大方',
    });
    expect(behaviors).toContain('old_claim_contested');
  });

  it('detects divergence creation', () => {
    const behaviors = classifyContradictionBehaviors({
      claimsBefore: [{ id: 'c1', text: '花钱大方', status: 'surviving', conviction: 0.7 }],
      claimsAfter: [{ id: 'c1', text: '花钱大方', status: 'surviving', conviction: 0.7 }],
      divergencesBefore: 0,
      divergencesAfter: 1,
      targetClaimText: '花钱大方',
    });
    expect(behaviors).toContain('divergence_created');
  });

  it('detects no_change when nothing happened', () => {
    const behaviors = classifyContradictionBehaviors({
      claimsBefore: [{ id: 'c1', text: '花钱大方', status: 'surviving', conviction: 0.7 }],
      claimsAfter: [{ id: 'c1', text: '花钱大方', status: 'surviving', conviction: 0.7 }],
      divergencesBefore: 0,
      divergencesAfter: 0,
      targetClaimText: '花钱大方',
    });
    expect(behaviors).toEqual(['no_change']);
  });

  it('returns no_change when target claim not found', () => {
    const behaviors = classifyContradictionBehaviors({
      claimsBefore: [{ id: 'c1', text: '其他', status: 'surviving', conviction: 0.7 }],
      claimsAfter: [{ id: 'c1', text: '其他', status: 'surviving', conviction: 0.7 }],
      divergencesBefore: 0,
      divergencesAfter: 0,
      targetClaimText: '花钱大方',
    });
    expect(behaviors).toEqual(['no_change']);
  });

  it('detects claim limitation via qualifiers', () => {
    const behaviors = classifyContradictionBehaviors({
      claimsBefore: [{ id: 'c1', text: '花钱大方', status: 'surviving', conviction: 0.7 }],
      claimsAfter: [{ id: 'c1', text: '花钱大方', status: 'surviving', conviction: 0.7, qualifiers: ['在朋友面前'] }],
      divergencesBefore: 0,
      divergencesAfter: 0,
      targetClaimText: '花钱大方',
    });
    expect(behaviors).toContain('old_claim_limited');
  });
});

describe('buildContradictionReport', () => {
  it('aggregates behavior counts', () => {
    const results: ContradictionScenarioResult[] = [
      {
        id: 'fc-1', description: 'test', type: 'factual_conflict',
        targetClaimText: 'a', contradictingText: 'b',
        behaviors: ['new_claim_created', 'divergence_created'],
        conflictRecognized: true,
      },
      {
        id: 'fc-2', description: 'test2', type: 'factual_conflict',
        targetClaimText: 'c', contradictingText: 'd',
        behaviors: ['no_change'],
        conflictRecognized: false,
      },
    ];
    const report = buildContradictionReport(results);
    expect(report.totalScenarios).toBe(2);
    expect(report.conflictsRecognized).toBe(1);
    expect(report.behaviorCounts.new_claim_created).toBe(1);
    expect(report.behaviorCounts.divergence_created).toBe(1);
    expect(report.behaviorCounts.no_change).toBe(1);
  });
});

/* ================================================================== */
/* 3. Memory Repair Scenarios                                          */
/* ================================================================== */

describe('MEMORY_REPAIR_SCENARIOS', () => {
  it('has >= 6 scenarios', () => {
    expect(MEMORY_REPAIR_SCENARIOS.length).toBeGreaterThanOrEqual(6);
  });

  it('each scenario has required fields', () => {
    for (const s of MEMORY_REPAIR_SCENARIOS) {
      expect(s.id).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.oldClaimText).toBeTruthy();
      expect(s.newTestimonyText).toBeTruthy();
      expect(s.qid).toBeTruthy();
    }
  });

  it('scenario IDs are unique', () => {
    const ids = MEMORY_REPAIR_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('classifyMemoryRepair', () => {
  it('detects proper supersede (old retired + new created)', () => {
    const result = classifyMemoryRepair({
      claimsBefore: [{ id: 'c1', text: '想歇一段', status: 'surviving' }],
      claimsAfter: [
        { id: 'c1', text: '想歇一段', status: 'retired' },
        { id: 'c2', text: '入职新公司', status: 'surviving' },
      ],
      divergencesAfter: [],
      oldClaimText: '想歇一段',
    });
    expect(result.oldClaimSuperseded).toBe(true);
    expect(result.newClaimCreated).toBe(true);
    expect(result.leftAsParallel).toBe(false);
  });

  it('detects proper supersede via supersedes divergence', () => {
    const result = classifyMemoryRepair({
      claimsBefore: [{ id: 'c1', text: '想歇一段', status: 'surviving' }],
      claimsAfter: [
        { id: 'c1', text: '想歇一段', status: 'surviving' },
        { id: 'c2', text: '入职新公司', status: 'surviving' },
      ],
      divergencesAfter: [{ type: 'supersedes' }],
      oldClaimText: '想歇一段',
    });
    expect(result.oldClaimSuperseded).toBe(true);
  });

  it('detects left as parallel (both surviving, no supersedes)', () => {
    const result = classifyMemoryRepair({
      claimsBefore: [{ id: 'c1', text: '想歇一段', status: 'surviving' }],
      claimsAfter: [
        { id: 'c1', text: '想歇一段', status: 'surviving' },
        { id: 'c2', text: '入职新公司', status: 'surviving' },
      ],
      divergencesAfter: [],
      oldClaimText: '想歇一段',
    });
    expect(result.oldClaimSuperseded).toBe(false);
    expect(result.leftAsParallel).toBe(true);
  });

  it('handles target not found', () => {
    const result = classifyMemoryRepair({
      claimsBefore: [{ id: 'c1', text: '其他', status: 'surviving' }],
      claimsAfter: [{ id: 'c1', text: '其他', status: 'surviving' }],
      divergencesAfter: [],
      oldClaimText: '不存在的',
    });
    expect(result.oldClaimSuperseded).toBe(false);
    expect(result.newClaimCreated).toBe(false);
    expect(result.leftAsParallel).toBe(false);
  });
});

describe('buildMemoryRepairReport', () => {
  it('aggregates results', () => {
    const results: MemoryRepairScenarioResult[] = [
      {
        id: 'mr-1', description: 'test', oldClaimText: 'a', newTestimonyText: 'b',
        oldClaimSuperseded: true, newClaimCreated: true, leftAsParallel: false,
      },
      {
        id: 'mr-2', description: 'test2', oldClaimText: 'c', newTestimonyText: 'd',
        oldClaimSuperseded: false, newClaimCreated: true, leftAsParallel: true,
      },
    ];
    const report = buildMemoryRepairReport(results);
    expect(report.totalScenarios).toBe(2);
    expect(report.properlySuperseded).toBe(1);
    expect(report.leftAsParallel).toBe(1);
  });
});
