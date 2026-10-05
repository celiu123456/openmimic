/**
 * Memory Repair scenarios (Twig §6.2 ③).
 *
 * Tests whether the system properly marks old claims as superseded when
 * new evidence contradicts them temporally (not just conflicting — the new
 * state has replaced the old one).
 *
 * The key distinction from contradiction: in contradiction, both views may
 * be valid (perspective difference). In memory repair, the old state has
 * objectively changed — "wanted to rest" is no longer true because they
 * "got a new job".
 *
 * Minimum 6 scenarios.
 */
import type { MemoryRepairScenarioResult, MemoryRepairReport } from './types';

/**
 * A memory repair scenario definition (input).
 */
export interface MemoryRepairScenario {
  id: string;
  description: string;
  /** The old claim text (should be superseded) */
  oldClaimText: string;
  /** The new testimony that supersedes it */
  newTestimonyText: string;
  /** Question ID for the new testimony */
  qid: string;
}

/**
 * 6+ pre-built memory repair scenarios.
 */
export const MEMORY_REPAIR_SCENARIOS: readonly MemoryRepairScenario[] = [
  {
    id: 'mr-1',
    description: 'Career: resting → started new job',
    oldClaimText: '想歇一段时间,暂时不想上班',
    newTestimonyText: '他已经入职新公司三个月了,是做产品经理,干得很有劲',
    qid: 'q-career',
  },
  {
    id: 'mr-2',
    description: 'Living: alone → moved in with partner',
    oldClaimText: '一个人住在出租屋里',
    newTestimonyText: '他搬进女朋友家了,两个人一起住快半年了',
    qid: 'q-living',
  },
  {
    id: 'mr-3',
    description: 'Hobby: gaming every day → quit gaming',
    oldClaimText: '每天下班回家就打游戏,一打就到深夜',
    newTestimonyText: '他已经戒游戏好几个月了,说是影响视力,现在改成看书了',
    qid: 'q-hobby',
  },
  {
    id: 'mr-4',
    description: 'Health: smoking → quit smoking',
    oldClaimText: '烟瘾很大,一天一包',
    newTestimonyText: '他戒烟成功了,已经半年没抽了,用的是电子烟过渡法',
    qid: 'q-health',
  },
  {
    id: 'mr-5',
    description: 'Pet: no pets → adopted a dog',
    oldClaimText: '不养宠物,觉得麻烦',
    newTestimonyText: '他上个月领养了一只柴犬,每天遛狗特别开心,逢人就介绍',
    qid: 'q-pet',
  },
  {
    id: 'mr-6',
    description: 'Transport: takes bus → bought a car',
    oldClaimText: '每天坐公交上班,没有车',
    newTestimonyText: '他刚提了一辆新车,是攒了两年钱买的,天天自己开车上班了',
    qid: 'q-transport',
  },
];

/**
 * Analyze whether the old claim was properly superseded.
 *
 * A proper supersede means:
 * - The old claim has a supersedes divergence relation pointing to it, OR
 * - The old claim's status changed to retired/contested, AND
 * - A new claim was created from the new testimony
 *
 * Left as parallel means:
 * - Both the old and new claims exist as surviving, without any
 *   supersedes relation or divergence linking them
 */
export function classifyMemoryRepair(opts: {
  /** Claims before the new testimony */
  claimsBefore: Array<{ id: string; text: string; status: string }>;
  /** Claims after running court with the new testimony */
  claimsAfter: Array<{ id: string; text: string; status: string }>;
  /** Divergences after, with type information */
  divergencesAfter: Array<{ type: string }>;
  /** The target old claim text */
  oldClaimText: string;
}): Pick<MemoryRepairScenarioResult, 'oldClaimSuperseded' | 'newClaimCreated' | 'leftAsParallel'> {
  const targetBefore = opts.claimsBefore.find((c) =>
    c.text.includes(opts.oldClaimText) || opts.oldClaimText.includes(c.text),
  );

  if (!targetBefore) {
    return { oldClaimSuperseded: false, newClaimCreated: false, leftAsParallel: false };
  }

  const targetAfter = opts.claimsAfter.find((c) => c.id === targetBefore.id);
  const beforeIds = new Set(opts.claimsBefore.map((c) => c.id));
  const newClaims = opts.claimsAfter.filter((c) => !beforeIds.has(c.id));
  const newClaimCreated = newClaims.length > 0;

  // Check for supersedes divergence
  const hasSupersedes = opts.divergencesAfter.some((d) => d.type === 'supersedes');

  // Check if old claim was limited/retired/contested
  const oldClaimChanged = !targetAfter ||
    targetAfter.status === 'retired' ||
    targetAfter.status === 'contested';

  const oldClaimSuperseded = hasSupersedes || oldClaimChanged;

  // Left as parallel: both survive without supersedes
  const leftAsParallel = !oldClaimSuperseded && newClaimCreated &&
    (targetAfter?.status === 'surviving');

  return { oldClaimSuperseded, newClaimCreated, leftAsParallel };
}

/**
 * Build a memory repair report from scenario results.
 */
export function buildMemoryRepairReport(
  results: MemoryRepairScenarioResult[],
): MemoryRepairReport {
  return {
    totalScenarios: results.length,
    properlySuperseded: results.filter((r) => r.oldClaimSuperseded).length,
    leftAsParallel: results.filter((r) => r.leftAsParallel).length,
    scenarios: results,
  };
}
