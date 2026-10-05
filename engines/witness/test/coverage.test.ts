import { describe, expect, it } from 'vitest';
import type { Testimony, Witness } from '@openmimic/shared';
import {
  computeCoverage,
  planQuestions,
  adviseRelationGaps,
  type CoverageSnapshot,
  type DimensionCoverageState,
} from '../src/coverage';
import {
  WITNESS_V2_FRIEND,
  WITNESS_V2_FAMILY,
  WITNESS_V2_COLLEAGUE,
  OBSERVER_DIMENSIONS,
} from '../src/questionnaires/witness-v2';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let _id = 0;
function nextId(): string {
  return `test-${++_id}`;
}

function makeWitness(
  overrides: Partial<Witness> & { id: string; subjectId: string },
): Witness {
  return {
    relation: '朋友',
    consentLevel: 'quotable',
    ...overrides,
  };
}

function makeTestimony(
  overrides: Partial<Testimony> & Pick<Testimony, 'witnessId' | 'subjectId'>,
): Testimony {
  return {
    id: nextId(),
    createdAt: '2026-01-01T00:00:00.000Z',
    answers: [],
    ...overrides,
  };
}

const SUBJECT = 'subject-1';

/* ------------------------------------------------------------------ */
/* computeCoverage                                                     */
/* ------------------------------------------------------------------ */

describe('computeCoverage', () => {
  it('returns all dimensions as untouched with no testimonies', () => {
    const snap = computeCoverage(SUBJECT, [], [], [WITNESS_V2_FRIEND]);
    expect(snap.dimensions).toHaveLength(OBSERVER_DIMENSIONS.length);
    for (const dim of snap.dimensions) {
      expect(dim.state).toBe('untouched');
      expect(dim.witnessCount).toBe(0);
      expect(dim.hasConcreteExample).toBe(false);
    }
    expect(snap.totalWitnesses).toBe(0);
    expect(snap.relationTypes).toEqual([]);
  });

  it('marks a dimension shallow when answered without concrete detail', () => {
    const w = makeWitness({ id: 'w1', subjectId: SUBJECT });
    const t = makeTestimony({
      witnessId: 'w1',
      subjectId: SUBJECT,
      answers: [{ qid: 'wv2-f-01', behindText: '很久以前认识的' }],
    });
    const snap = computeCoverage(SUBJECT, [t], [w], [WITNESS_V2_FRIEND]);
    const dim = snap.dimensions.find(
      (d) => d.dimensionId === 'relationship_origin_shared_history',
    )!;
    expect(dim.state).toBe('shallow');
    expect(dim.witnessCount).toBe(1);
    expect(dim.hasConcreteExample).toBe(false);
  });

  it('marks a dimension covered when an answer has concrete detail', () => {
    const w = makeWitness({ id: 'w1', subjectId: SUBJECT });
    const t = makeTestimony({
      witnessId: 'w1',
      subjectId: SUBJECT,
      answers: [
        {
          qid: 'wv2-f-01',
          behindText:
            '我们是2018年在大学的Python选修课上认识的，当时他坐我旁边，第一次作业就主动来问我怎么装环境。后来每次上课都坐一起，慢慢就熟了。',
        },
      ],
    });
    const snap = computeCoverage(SUBJECT, [t], [w], [WITNESS_V2_FRIEND]);
    const dim = snap.dimensions.find(
      (d) => d.dimensionId === 'relationship_origin_shared_history',
    )!;
    expect(dim.state).toBe('covered');
    expect(dim.hasConcreteExample).toBe(true);
  });

  it('marks a dimension cautious when multiple witnesses avoid it', () => {
    const w1 = makeWitness({ id: 'w1', subjectId: SUBJECT });
    const w2 = makeWitness({ id: 'w2', subjectId: SUBJECT });
    const w3 = makeWitness({ id: 'w3', subjectId: SUBJECT });
    const t1 = makeTestimony({
      witnessId: 'w1',
      subjectId: SUBJECT,
      answers: [],
      avoidedQids: ['wv2-f-06'],
    });
    const t2 = makeTestimony({
      witnessId: 'w2',
      subjectId: SUBJECT,
      answers: [],
      avoidedQids: ['wv2-f-06'],
    });
    const t3 = makeTestimony({
      witnessId: 'w3',
      subjectId: SUBJECT,
      answers: [],
      avoidedQids: ['wv2-f-06'],
    });
    const snap = computeCoverage(
      SUBJECT,
      [t1, t2, t3],
      [w1, w2, w3],
      [WITNESS_V2_FRIEND],
    );
    const dim = snap.dimensions.find(
      (d) => d.dimensionId === 'observed_pressure_vulnerability',
    )!;
    expect(dim.state).toBe('cautious');
  });

  it('counts distinct witnesses per dimension', () => {
    const w1 = makeWitness({ id: 'w1', subjectId: SUBJECT });
    const w2 = makeWitness({ id: 'w2', subjectId: SUBJECT });
    const t1 = makeTestimony({
      witnessId: 'w1',
      subjectId: SUBJECT,
      answers: [
        { qid: 'wv2-f-02', behindText: '他做事很认真，上次搬家一个人扛了一整天的箱子，中间腰都扭了也没吭声，到晚上才说疼，典型的那种能扛事的人。' },
      ],
    });
    const t2 = makeTestimony({
      witnessId: 'w2',
      subjectId: SUBJECT,
      answers: [
        { qid: 'wv2-f-02', behindText: '挺靠谱的' },
      ],
    });
    const snap = computeCoverage(
      SUBJECT,
      [t1, t2],
      [w1, w2],
      [WITNESS_V2_FRIEND],
    );
    const dim = snap.dimensions.find(
      (d) => d.dimensionId === 'observed_concrete_behavior',
    )!;
    expect(dim.witnessCount).toBe(2);
    expect(dim.state).toBe('covered');
  });

  it('detects hearsay-only dimension', () => {
    const w = makeWitness({ id: 'w1', subjectId: SUBJECT });
    const t = makeTestimony({
      witnessId: 'w1',
      subjectId: SUBJECT,
      answers: [
        {
          qid: 'wv2-f-08',
          behindText: '听说之前不太一样',
          basis: 'heard' as const,
        },
      ],
    });
    const snap = computeCoverage(SUBJECT, [t], [w], [WITNESS_V2_FRIEND]);
    const dim = snap.dimensions.find(
      (d) => d.dimensionId === 'observed_change_turning_point',
    )!;
    expect(dim.hearsayOnly).toBe(true);
  });

  it('tracks relation types across witnesses', () => {
    const w1 = makeWitness({ id: 'w1', subjectId: SUBJECT, relation: '朋友' });
    const w2 = makeWitness({ id: 'w2', subjectId: SUBJECT, relation: '同事' });
    const t1 = makeTestimony({
      witnessId: 'w1',
      subjectId: SUBJECT,
      answers: [{ qid: 'wv2-f-01', behindText: '大学同学' }],
    });
    const t2 = makeTestimony({
      witnessId: 'w2',
      subjectId: SUBJECT,
      answers: [{ qid: 'wv2-c-01', behindText: '同一个组' }],
    });
    const snap = computeCoverage(
      SUBJECT,
      [t1, t2],
      [w1, w2],
      [WITNESS_V2_FRIEND, WITNESS_V2_COLLEAGUE],
    );
    expect(snap.totalWitnesses).toBe(2);
    expect(snap.relationTypes).toContain('朋友');
    expect(snap.relationTypes).toContain('同事');
  });

  it('handles followupText in concrete-detail detection', () => {
    const w = makeWitness({ id: 'w1', subjectId: SUBJECT });
    const t = makeTestimony({
      witnessId: 'w1',
      subjectId: SUBJECT,
      answers: [
        {
          qid: 'wv2-f-03',
          behindText: '有',
          followupText:
            '他每次出门前一定要把所有灯关了检查两遍，有一次我在他家住，半夜他还起来检查了一次，差点把我吓醒。',
        },
      ],
    });
    const snap = computeCoverage(SUBJECT, [t], [w], [WITNESS_V2_FRIEND]);
    const dim = snap.dimensions.find(
      (d) => d.dimensionId === 'observed_habit_interest_ability',
    )!;
    expect(dim.hasConcreteExample).toBe(true);
    expect(dim.state).toBe('covered');
  });
});

/* ------------------------------------------------------------------ */
/* planQuestions                                                        */
/* ------------------------------------------------------------------ */

describe('planQuestions', () => {
  it('returns default order with no prior coverage', () => {
    const emptyCoverage: CoverageSnapshot = {
      subjectId: SUBJECT,
      dimensions: OBSERVER_DIMENSIONS.map((d) => ({
        dimensionId: d.id,
        label: d.label,
        state: 'untouched' as const,
        witnessCount: 0,
        hasConcreteExample: false,
        hearsayOnly: false,
      })),
      totalWitnesses: 0,
      relationTypes: [],
    };
    const plan = planQuestions(emptyCoverage, '朋友', WITNESS_V2_FRIEND);
    // All questions should be in the plan since everything is untouched
    expect(plan.length).toBe(WITNESS_V2_FRIEND.questions.length);
    // All should be priority (untouched)
    for (const p of plan) {
      expect(p.reason).toBe('priority');
      expect(p.skippable).toBe(false);
    }
  });

  it('prioritizes untouched dimensions over covered ones', () => {
    const dims = OBSERVER_DIMENSIONS.map((d, i) => ({
      dimensionId: d.id,
      label: d.label,
      state: (i < 3 ? 'covered' : 'untouched') as DimensionCoverageState,
      witnessCount: i < 3 ? 4 : 0,
      hasConcreteExample: i < 3,
      hearsayOnly: false,
    }));
    const coverage: CoverageSnapshot = {
      subjectId: SUBJECT,
      dimensions: dims,
      totalWitnesses: 4,
      relationTypes: ['朋友'],
    };
    const plan = planQuestions(coverage, '朋友', WITNESS_V2_FRIEND);
    // First questions should be from untouched dimensions
    const firstThree = plan.slice(0, 3);
    for (const p of firstThree) {
      const dim = dims.find((d) => d.dimensionId === p.dimensionId);
      expect(dim?.state).not.toBe('covered');
    }
  });

  it('moves saturated dimensions to the end', () => {
    const dims = OBSERVER_DIMENSIONS.map((d, i) => ({
      dimensionId: d.id,
      label: d.label,
      state: (i < 5 ? 'covered' : 'untouched') as DimensionCoverageState,
      witnessCount: i < 5 ? 4 : 0,
      hasConcreteExample: i < 5,
      hearsayOnly: false,
    }));
    const coverage: CoverageSnapshot = {
      subjectId: SUBJECT,
      dimensions: dims,
      totalWitnesses: 4,
      relationTypes: ['朋友'],
    };
    const plan = planQuestions(coverage, '朋友', WITNESS_V2_FRIEND, {
      saturatedThreshold: 3,
    });
    // Saturated questions should be at the end or omitted
    const saturatedIndices = plan
      .map((p, i) => (p.reason === 'saturated' ? i : -1))
      .filter((i) => i >= 0);
    const nonSaturatedIndices = plan
      .map((p, i) => (p.reason !== 'saturated' ? i : -1))
      .filter((i) => i >= 0);
    if (saturatedIndices.length > 0 && nonSaturatedIndices.length > 0) {
      const lastNonSat = Math.max(...nonSaturatedIndices);
      const firstSat = Math.min(...saturatedIndices);
      expect(firstSat).toBeGreaterThanOrEqual(lastNonSat);
    }
  });

  it('respects minQuestions floor', () => {
    // All dimensions covered by 5 witnesses -> everything is saturated
    const dims = OBSERVER_DIMENSIONS.map((d) => ({
      dimensionId: d.id,
      label: d.label,
      state: 'covered' as const,
      witnessCount: 5,
      hasConcreteExample: true,
      hearsayOnly: false,
    }));
    const coverage: CoverageSnapshot = {
      subjectId: SUBJECT,
      dimensions: dims,
      totalWitnesses: 5,
      relationTypes: ['朋友'],
    };
    const plan = planQuestions(coverage, '朋友', WITNESS_V2_FRIEND, {
      minQuestions: 5,
    });
    expect(plan.length).toBeGreaterThanOrEqual(5);
  });

  it('does not add more questions to cautious dimensions', () => {
    const dims = OBSERVER_DIMENSIONS.map((d, i) => ({
      dimensionId: d.id,
      label: d.label,
      state: (i === 2 ? 'cautious' : 'untouched') as DimensionCoverageState,
      witnessCount: i === 2 ? 0 : 0,
      hasConcreteExample: false,
      hearsayOnly: false,
    }));
    const coverage: CoverageSnapshot = {
      subjectId: SUBJECT,
      dimensions: dims,
      totalWitnesses: 3,
      relationTypes: ['朋友'],
    };
    const plan = planQuestions(coverage, '朋友', WITNESS_V2_FRIEND);
    const cautiousPlan = plan.filter((p) => p.reason === 'cautious');
    // Cautious questions should exist and be skippable
    for (const p of cautiousPlan) {
      expect(p.skippable).toBe(true);
    }
    // They should be after non-cautious questions
    const cautiousIndices = plan
      .map((p, i) => (p.reason === 'cautious' ? i : -1))
      .filter((i) => i >= 0);
    const normalIndices = plan
      .map((p, i) => (p.reason === 'priority' || p.reason === 'normal' ? i : -1))
      .filter((i) => i >= 0);
    if (cautiousIndices.length > 0 && normalIndices.length > 0) {
      expect(Math.min(...cautiousIndices)).toBeGreaterThan(
        Math.max(...normalIndices),
      );
    }
  });

  it('works with family variant', () => {
    const emptyCoverage: CoverageSnapshot = {
      subjectId: SUBJECT,
      dimensions: OBSERVER_DIMENSIONS.map((d) => ({
        dimensionId: d.id,
        label: d.label,
        state: 'untouched' as const,
        witnessCount: 0,
        hasConcreteExample: false,
        hearsayOnly: false,
      })),
      totalWitnesses: 0,
      relationTypes: [],
    };
    const plan = planQuestions(emptyCoverage, '家人', WITNESS_V2_FAMILY);
    expect(plan.length).toBe(WITNESS_V2_FAMILY.questions.length);
  });

  it('works with colleague variant', () => {
    const emptyCoverage: CoverageSnapshot = {
      subjectId: SUBJECT,
      dimensions: OBSERVER_DIMENSIONS.map((d) => ({
        dimensionId: d.id,
        label: d.label,
        state: 'untouched' as const,
        witnessCount: 0,
        hasConcreteExample: false,
        hearsayOnly: false,
      })),
      totalWitnesses: 0,
      relationTypes: [],
    };
    const plan = planQuestions(emptyCoverage, '同事', WITNESS_V2_COLLEAGUE);
    expect(plan.length).toBe(WITNESS_V2_COLLEAGUE.questions.length);
  });

  it('question count stays within questionnaire range', () => {
    // Some covered, some not
    const dims = OBSERVER_DIMENSIONS.map((d, i) => ({
      dimensionId: d.id,
      label: d.label,
      state: (i % 2 === 0 ? 'covered' : 'shallow') as DimensionCoverageState,
      witnessCount: i % 2 === 0 ? 2 : 1,
      hasConcreteExample: i % 2 === 0,
      hearsayOnly: false,
    }));
    const coverage: CoverageSnapshot = {
      subjectId: SUBJECT,
      dimensions: dims,
      totalWitnesses: 2,
      relationTypes: ['朋友'],
    };
    const plan = planQuestions(coverage, '朋友', WITNESS_V2_FRIEND);
    expect(plan.length).toBeLessThanOrEqual(WITNESS_V2_FRIEND.questions.length);
    expect(plan.length).toBeGreaterThanOrEqual(5); // default minQuestions
  });
});

/* ------------------------------------------------------------------ */
/* adviseRelationGaps                                                  */
/* ------------------------------------------------------------------ */

describe('adviseRelationGaps', () => {
  it('returns undefined with no witnesses', () => {
    expect(adviseRelationGaps([])).toBeUndefined();
  });

  it('suggests family and colleague when all are friends', () => {
    const witnesses = [
      makeWitness({ id: 'w1', subjectId: SUBJECT, relation: '朋友' }),
      makeWitness({ id: 'w2', subjectId: SUBJECT, relation: '朋友' }),
    ];
    const advice = adviseRelationGaps(witnesses)!;
    expect(advice).toBeDefined();
    expect(advice.missingTypes).toContain('family');
    expect(advice.missingTypes).toContain('colleague');
    expect(advice.message).toContain('朋友');
  });

  it('suggests friend and colleague when all are family', () => {
    const witnesses = [
      makeWitness({ id: 'w1', subjectId: SUBJECT, relation: '妈妈' }),
    ];
    const advice = adviseRelationGaps(witnesses)!;
    expect(advice.missingTypes).toContain('friend');
    expect(advice.missingTypes).toContain('colleague');
  });

  it('returns undefined when all relation types are present', () => {
    const witnesses = [
      makeWitness({ id: 'w1', subjectId: SUBJECT, relation: '朋友' }),
      makeWitness({ id: 'w2', subjectId: SUBJECT, relation: '妈妈' }),
      makeWitness({ id: 'w3', subjectId: SUBJECT, relation: '同事' }),
    ];
    expect(adviseRelationGaps(witnesses)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Session fixation: planned questions don't change mid-interview      */
/* ------------------------------------------------------------------ */

describe('session fixation', () => {
  it('planQuestions is deterministic for the same input', () => {
    const dims = OBSERVER_DIMENSIONS.map((d, i) => ({
      dimensionId: d.id,
      label: d.label,
      state: (i < 3 ? 'covered' : i === 5 ? 'cautious' : 'untouched') as DimensionCoverageState,
      witnessCount: i < 3 ? 4 : 0,
      hasConcreteExample: i < 3,
      hearsayOnly: false,
    }));
    const coverage: CoverageSnapshot = {
      subjectId: SUBJECT,
      dimensions: dims,
      totalWitnesses: 4,
      relationTypes: ['朋友'],
    };
    const plan1 = planQuestions(coverage, '朋友', WITNESS_V2_FRIEND);
    const plan2 = planQuestions(coverage, '朋友', WITNESS_V2_FRIEND);
    expect(plan1.map((p) => p.question.qid)).toEqual(
      plan2.map((p) => p.question.qid),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Integration: coverage -> plan -> right output                       */
/* ------------------------------------------------------------------ */

describe('coverage-to-plan integration', () => {
  it('full cycle: compute coverage then plan questions for next witness', () => {
    const w1 = makeWitness({ id: 'w1', subjectId: SUBJECT, relation: '朋友' });
    const w2 = makeWitness({ id: 'w2', subjectId: SUBJECT, relation: '朋友' });
    const t1 = makeTestimony({
      witnessId: 'w1',
      subjectId: SUBJECT,
      answers: [
        {
          qid: 'wv2-f-01',
          behindText: '大学Python课认识的，他主动来问我怎么装环境，后来每次上课都坐一起慢慢就熟了。',
        },
        {
          qid: 'wv2-f-02',
          behindText: '搬家那天一个人扛了一整天箱子，中间腰扭了都没吭声，到晚上才说疼。',
        },
      ],
      avoidedQids: ['wv2-f-09'],
    });
    const t2 = makeTestimony({
      witnessId: 'w2',
      subjectId: SUBJECT,
      answers: [
        {
          qid: 'wv2-f-01',
          behindText: '朋友介绍的',
        },
        {
          qid: 'wv2-f-03',
          behindText: '爱打篮球',
        },
      ],
      avoidedQids: ['wv2-f-09'],
    });

    const coverage = computeCoverage(
      SUBJECT,
      [t1, t2],
      [w1, w2],
      [WITNESS_V2_FRIEND],
    );

    expect(coverage.totalWitnesses).toBe(2);

    // relationship_origin_shared_history: covered (w1 has detail)
    const dimOrigin = coverage.dimensions.find(
      (d) => d.dimensionId === 'relationship_origin_shared_history',
    )!;
    expect(dimOrigin.state).toBe('covered');
    expect(dimOrigin.witnessCount).toBe(2);

    // observed_habit_interest_ability: shallow (w2 answered briefly)
    const dimHabit = coverage.dimensions.find(
      (d) => d.dimensionId === 'observed_habit_interest_ability',
    )!;
    expect(dimHabit.state).toBe('shallow');

    // observed_impression_counterexample: cautious (both avoided)
    const dimImpression = coverage.dimensions.find(
      (d) => d.dimensionId === 'observed_impression_counterexample',
    )!;
    expect(dimImpression.state).toBe('cautious');

    // Plan for next witness
    const plan = planQuestions(coverage, '同事', WITNESS_V2_COLLEAGUE);
    expect(plan.length).toBeGreaterThanOrEqual(5);

    // The first questions should not be from the already-covered dimensions
    const firstQ = plan[0]!;
    expect(firstQ.reason).not.toBe('saturated');
  });
});
