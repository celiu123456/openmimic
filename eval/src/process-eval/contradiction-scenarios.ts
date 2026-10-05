/**
 * Contradiction Responsiveness scenarios (Twig §6.2 ②).
 *
 * Constructs conflict scenarios by adding a contradicting testimony to an
 * existing subject, running the court, and observing what behaviors occur.
 *
 * The scenarios test the system's behavior typology — not whether it gets
 * the "right answer", but whether it recognizes conflict, limits old claims,
 * creates divergences, etc.
 *
 * Minimum 12 scenarios: 4 factual conflicts, 4 perspective differences,
 * 4 temporal evolutions.
 */
import type {
  ContradictionScenarioResult,
  ContradictionBehavior,
  ContradictionReport,
} from './types';

/**
 * A contradiction scenario definition (input).
 */
export interface ContradictionScenario {
  id: string;
  description: string;
  type: 'factual_conflict' | 'perspective_difference' | 'temporal_evolution';
  /** The existing claim text (already in the store from a prior court run). */
  existingClaimText: string;
  /** The new testimony answer that contradicts it. */
  contradictingAnswer: string;
  /** Question ID for the new testimony. */
  qid: string;
}

/**
 * 12+ pre-built contradiction scenarios for the demo subject (林默).
 * These reference the kinds of claims the court would produce from the
 * fixture data.
 */
export const CONTRADICTION_SCENARIOS: readonly ContradictionScenario[] = [
  // --- Factual conflicts (4) ---
  {
    id: 'fc-1',
    description: 'Work status: employed vs. freelance',
    type: 'factual_conflict',
    existingClaimText: '在一家设计公司上班',
    contradictingAnswer: '他其实早就辞职了,现在是自由职业,接各种散活',
    qid: 'q-work',
  },
  {
    id: 'fc-2',
    description: 'Living situation: alone vs. with partner',
    type: 'factual_conflict',
    existingClaimText: '一个人住',
    contradictingAnswer: '他和女朋友同居快两年了,两个人一起养了一只猫',
    qid: 'q-living',
  },
  {
    id: 'fc-3',
    description: 'Education: graduated vs. dropped out',
    type: 'factual_conflict',
    existingClaimText: '大学毕业',
    contradictingAnswer: '他大三就退学了,学历一直是个心结,不太愿意提这事',
    qid: 'q-edu',
  },
  {
    id: 'fc-4',
    description: 'Financial: generous vs. stingy',
    type: 'factual_conflict',
    existingClaimText: '花钱大方,请客不犹豫',
    contradictingAnswer: '他其实挺抠的,AA制的时候算得很清楚,请客从来不主动',
    qid: 'q-money',
  },
  // --- Perspective differences (4) ---
  {
    id: 'pd-1',
    description: 'Temperament: calm vs. hot-tempered (perspective)',
    type: 'perspective_difference',
    existingClaimText: '脾气温和,很少发火',
    contradictingAnswer: '他在家里脾气可大了,摔过东西,就是在外面装得好',
    qid: 'q-temper',
  },
  {
    id: 'pd-2',
    description: 'Social: outgoing vs. introverted (perspective)',
    type: 'perspective_difference',
    existingClaimText: '很会社交,朋友很多',
    contradictingAnswer: '他其实很宅,就那么几个固定的朋友,社交场合能躲就躲',
    qid: 'q-social',
  },
  {
    id: 'pd-3',
    description: 'Work ethic: hardworking vs. lazy (perspective)',
    type: 'perspective_difference',
    existingClaimText: '工作很努力,经常加班',
    contradictingAnswer: '他就是在老板面前装勤快,实际上经常偷懒,能划水就划水',
    qid: 'q-work-ethic',
  },
  {
    id: 'pd-4',
    description: 'Parenting: caring vs. absent (perspective)',
    type: 'perspective_difference',
    existingClaimText: '很疼孩子,周末都陪孩子玩',
    contradictingAnswer: '他根本不怎么管孩子,都是妈妈在带,他就偶尔拍张照发朋友圈',
    qid: 'q-parent',
  },
  // --- Temporal evolution (4) ---
  {
    id: 'te-1',
    description: 'Hobby change: gaming → hiking',
    type: 'temporal_evolution',
    existingClaimText: '最大的爱好是打游戏,每天都玩',
    contradictingAnswer: '他去年开始就不怎么打游戏了,迷上了户外徒步,几乎每周都去爬山',
    qid: 'q-hobby',
  },
  {
    id: 'te-2',
    description: 'Diet change: meat lover → vegetarian',
    type: 'temporal_evolution',
    existingClaimText: '无肉不欢,最爱吃烤肉',
    contradictingAnswer: '他今年开始吃素了,说是为了健康,已经坚持好几个月了',
    qid: 'q-diet',
  },
  {
    id: 'te-3',
    description: 'Relationship: single → married',
    type: 'temporal_evolution',
    existingClaimText: '单身,不急着找对象',
    contradictingAnswer: '他上个月刚结婚了,对象是他大学同学,认识很久了',
    qid: 'q-relationship',
  },
  {
    id: 'te-4',
    description: 'Career: wants to rest → got new job',
    type: 'temporal_evolution',
    existingClaimText: '想歇一段时间,暂时不想上班',
    contradictingAnswer: '他已经入职新公司两个月了,干得挺起劲的',
    qid: 'q-career',
  },
];

/**
 * Analyze court results to determine what behaviors occurred.
 *
 * This is a pure function that examines the before/after state of claims
 * and divergences to classify the court's response.
 */
export function classifyContradictionBehaviors(opts: {
  /** Claims before the new testimony */
  claimsBefore: Array<{ id: string; text: string; status: string; conviction: number; qualifiers?: string[] }>;
  /** Claims after running court with the new testimony */
  claimsAfter: Array<{ id: string; text: string; status: string; conviction: number; qualifiers?: string[] }>;
  /** Divergences before */
  divergencesBefore: number;
  /** Divergences after */
  divergencesAfter: number;
  /** The target claim text to watch */
  targetClaimText: string;
}): ContradictionBehavior[] {
  const behaviors: ContradictionBehavior[] = [];

  // Find the target claim before and after
  const targetBefore = opts.claimsBefore.find((c) =>
    c.text.includes(opts.targetClaimText) || opts.targetClaimText.includes(c.text),
  );

  if (!targetBefore) {
    // Target claim not found — no change possible
    return ['no_change'];
  }

  const targetAfter = opts.claimsAfter.find((c) => c.id === targetBefore.id);

  // Check for new claims that weren't in before
  const beforeIds = new Set(opts.claimsBefore.map((c) => c.id));
  const newClaims = opts.claimsAfter.filter((c) => !beforeIds.has(c.id));
  if (newClaims.length > 0) {
    behaviors.push('new_claim_created');
  }

  // Check target claim changes
  if (targetAfter) {
    if (targetAfter.status === 'contested' && targetBefore.status !== 'contested') {
      behaviors.push('old_claim_contested');
    }
    if (targetAfter.status === 'retired' && targetBefore.status !== 'retired') {
      behaviors.push('old_claim_retired');
    }
    if (targetAfter.conviction < targetBefore.conviction) {
      behaviors.push('conviction_decreased');
    }
    const newQualifiers = (targetAfter.qualifiers ?? []).filter(
      (q) => !(targetBefore.qualifiers ?? []).includes(q),
    );
    if (newQualifiers.length > 0) {
      behaviors.push('old_claim_limited');
    }
  } else {
    // Target claim disappeared entirely — treated as retired
    behaviors.push('old_claim_retired');
  }

  // Check divergence creation
  if (opts.divergencesAfter > opts.divergencesBefore) {
    behaviors.push('divergence_created');
  }

  if (behaviors.length === 0) {
    behaviors.push('no_change');
  }

  return behaviors;
}

/**
 * Build a contradiction report from scenario results.
 */
export function buildContradictionReport(
  results: ContradictionScenarioResult[],
): ContradictionReport {
  const behaviorCounts: Record<ContradictionBehavior, number> = {
    new_claim_created: 0,
    old_claim_limited: 0,
    old_claim_contested: 0,
    old_claim_retired: 0,
    divergence_created: 0,
    conviction_decreased: 0,
    no_change: 0,
    supersedes_relation: 0,
  };

  for (const r of results) {
    for (const b of r.behaviors) {
      behaviorCounts[b]++;
    }
  }

  return {
    totalScenarios: results.length,
    conflictsRecognized: results.filter((r) => r.conflictRecognized).length,
    behaviorCounts,
    scenarios: results,
  };
}
