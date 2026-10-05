/**
 * Cross-witness topic coverage and question scheduling.
 *
 * Migrated from the author's earlier platform (topic-coverage.service.ts),
 * rewritten as pure functions over the OpenMimic domain model:
 * one subject x ten observer dimensions x multiple witnesses.
 *
 * No framework dependencies, no DB, no model calls.
 */

import type { Testimony, TestimonyAnswer } from '@openmimic/shared';
import type { Witness } from '@openmimic/shared';
import {
  OBSERVER_DIMENSIONS,
  type WitnessV2Question,
} from './questionnaires/witness-v2';
import type { WitnessQuestion, Questionnaire } from './questionnaires/friend-v1';
import { hasConcreteDetail } from './interview-state';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Coverage state for one dimension, derived from all testimonies.
 *
 * - untouched: no witness answered a question in this dimension
 * - shallow: at least one witness answered but no concrete detail
 * - covered: at least one answer with concrete detail
 * - cautious: multiple witnesses avoided questions in this dimension
 */
export type DimensionCoverageState =
  | 'untouched'
  | 'shallow'
  | 'covered'
  | 'cautious';

/** Coverage entry for a single dimension. */
export interface DimensionCoverage {
  dimensionId: string;
  label: string;
  state: DimensionCoverageState;
  /** Number of distinct witnesses who contributed to this dimension. */
  witnessCount: number;
  /** Whether any answer contains concrete detail (story, numbers, quotes). */
  hasConcreteExample: boolean;
  /**
   * Whether all answers in this dimension are hearsay or inference only
   * (no first-hand observation).
   */
  hearsayOnly: boolean;
}

/** Full coverage snapshot for one subject. */
export interface CoverageSnapshot {
  subjectId: string;
  dimensions: DimensionCoverage[];
  /** Total distinct witnesses across all testimonies. */
  totalWitnesses: number;
  /** Relation types of witnesses who have contributed. */
  relationTypes: string[];
}

/** Configuration for the planner. */
export interface PlanConfig {
  /**
   * If a dimension has been answered by >= this many witnesses,
   * it can be moved to the end or skipped. Default: 3.
   */
  saturatedThreshold?: number;
  /**
   * Minimum number of questions to keep in the plan
   * even after omitting saturated dimensions. Default: 5.
   */
  minQuestions?: number;
  /** When true (default), cautious dimensions are placed last and marked skippable. */
  respectCautious?: boolean;
}

/** One question in the planned sequence, annotated with scheduling metadata. */
export interface PlannedQuestion {
  question: WitnessQuestion;
  dimensionId: string;
  /** Why this question is placed where it is. */
  reason: 'priority' | 'normal' | 'saturated' | 'cautious';
  /** Whether the witness may skip this without being prompted. */
  skippable: boolean;
}

/* ------------------------------------------------------------------ */
/* Helpers: map qids to dimensions                                     */
/* ------------------------------------------------------------------ */

/**
 * Build a map from qid to dimensionId for a v2 questionnaire.
 * Returns empty map for v1 questions (they have no dimensionId).
 */
function buildQidToDimension(questions: readonly WitnessQuestion[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const q of questions) {
    const v2q = q as WitnessV2Question;
    if (v2q.dimensionId) {
      map.set(q.qid, v2q.dimensionId);
    }
  }
  return map;
}

/**
 * Given all questionnaires used across testimonies, build a merged
 * qid->dimensionId map.
 */
function mergedQidToDimension(questionnaires: Questionnaire[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const q of questionnaires) {
    const sub = buildQidToDimension(q.questions);
    for (const [k, v] of sub) map.set(k, v);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* computeCoverage                                                     */
/* ------------------------------------------------------------------ */

/**
 * Compute the coverage snapshot for one subject from all their testimonies.
 *
 * Pure function: no side effects, no DB access.
 *
 * @param subjectId - the subject being described
 * @param testimonies - all testimonies for this subject
 * @param witnesses - all witnesses for this subject (for relation info)
 * @param questionnaires - the questionnaires used (for qid->dimension mapping)
 */
export function computeCoverage(
  subjectId: string,
  testimonies: readonly Testimony[],
  witnesses: readonly Witness[],
  questionnaires: readonly Questionnaire[],
): CoverageSnapshot {
  const qidToDim = mergedQidToDimension([...questionnaires]);
  const witnessMap = new Map(witnesses.map((w) => [w.id, w]));

  // Per-dimension accumulators
  const dimWitnesses = new Map<string, Set<string>>();
  const dimHasDetail = new Map<string, boolean>();
  const dimBasisOnly = new Map<string, { hasFirstHand: boolean }>();
  const dimAvoidCount = new Map<string, number>();

  // Track unique witnesses and their relations
  const allWitnessIds = new Set<string>();
  const allRelations = new Set<string>();

  for (const t of testimonies) {
    allWitnessIds.add(t.witnessId);
    const w = witnessMap.get(t.witnessId);
    if (w) allRelations.add(w.relation);

    // Process answers
    for (const answer of t.answers) {
      const dimId = qidToDim.get(answer.qid);
      if (!dimId) continue;

      if (!dimWitnesses.has(dimId)) dimWitnesses.set(dimId, new Set());
      dimWitnesses.get(dimId)!.add(t.witnessId);

      // Check for concrete detail
      const text = answer.behindText + (answer.followupText ?? '');
      if (text.trim().length > 0 && hasConcreteDetail(text)) {
        dimHasDetail.set(dimId, true);
      }

      // Check epistemic basis
      if (!dimBasisOnly.has(dimId)) {
        dimBasisOnly.set(dimId, { hasFirstHand: false });
      }
      const basis = answer.basis ?? 'unknown';
      if (basis === 'witnessed' || basis === 'unknown') {
        dimBasisOnly.get(dimId)!.hasFirstHand = true;
      }
    }

    // Process avoided qids
    if (t.avoidedQids) {
      for (const qid of t.avoidedQids) {
        const dimId = qidToDim.get(qid);
        if (!dimId) continue;
        dimAvoidCount.set(dimId, (dimAvoidCount.get(dimId) ?? 0) + 1);
      }
    }
  }

  const totalWitnesses = allWitnessIds.size;

  // Build dimension coverage
  const dimensions: DimensionCoverage[] = OBSERVER_DIMENSIONS.map((dim) => {
    const witnesses = dimWitnesses.get(dim.id);
    const witnessCount = witnesses?.size ?? 0;
    const hasDetail = dimHasDetail.get(dim.id) ?? false;
    const basisInfo = dimBasisOnly.get(dim.id);
    const avoidCount = dimAvoidCount.get(dim.id) ?? 0;

    let state: DimensionCoverageState;
    if (witnessCount === 0 && avoidCount === 0) {
      state = 'untouched';
    } else if (avoidCount >= 2 && avoidCount > witnessCount) {
      // Multiple witnesses avoided this -> cautious
      state = 'cautious';
    } else if (hasDetail) {
      state = 'covered';
    } else if (witnessCount > 0) {
      state = 'shallow';
    } else {
      state = 'untouched';
    }

    return {
      dimensionId: dim.id,
      label: dim.label,
      state,
      witnessCount,
      hasConcreteExample: hasDetail,
      hearsayOnly: basisInfo ? !basisInfo.hasFirstHand : false,
    };
  });

  return {
    subjectId,
    dimensions,
    totalWitnesses,
    relationTypes: [...allRelations],
  };
}

/* ------------------------------------------------------------------ */
/* planQuestions                                                        */
/* ------------------------------------------------------------------ */

/** Priority score: lower state score = higher priority for this dimension. */
const STATE_PRIORITY: Record<DimensionCoverageState, number> = {
  untouched: 0,
  shallow: 1,
  covered: 3,
  cautious: 4,
};

/**
 * Plan questions for the next witness, prioritizing thin coverage.
 *
 * @param coverage - current coverage snapshot
 * @param relation - the new witness's relation type (friend/family/colleague)
 * @param questionnaire - the questionnaire to draw from
 * @param config - optional tuning knobs
 */
export function planQuestions(
  coverage: CoverageSnapshot,
  relation: string,
  questionnaire: Questionnaire,
  config: PlanConfig = {},
): PlannedQuestion[] {
  const {
    saturatedThreshold = 3,
    minQuestions = 5,
    respectCautious = true,
  } = config;

  const dimCoverage = new Map(
    coverage.dimensions.map((d) => [d.dimensionId, d]),
  );

  // Build question-to-dimension mapping for this questionnaire
  const qidToDim = buildQidToDimension(questionnaire.questions);

  // Annotate each question
  type Annotated = {
    question: WitnessQuestion;
    dimensionId: string;
    dimState: DimensionCoverageState;
    witnessCount: number;
    sensitivity: 'low' | 'medium' | 'high';
    originalIndex: number;
  };

  const annotated: Annotated[] = questionnaire.questions.map((q, i) => {
    const dimId = qidToDim.get(q.qid) ?? '';
    const dim = dimCoverage.get(dimId);
    const v2q = q as WitnessV2Question;
    return {
      question: q,
      dimensionId: dimId,
      dimState: dim?.state ?? 'untouched',
      witnessCount: dim?.witnessCount ?? 0,
      sensitivity: v2q.sensitivity ?? 'low',
      originalIndex: i,
    };
  });

  // Classify questions into buckets
  const priority: Annotated[] = [];
  const normal: Annotated[] = [];
  const saturated: Annotated[] = [];
  const cautious: Annotated[] = [];

  for (const a of annotated) {
    if (respectCautious && a.dimState === 'cautious') {
      cautious.push(a);
    } else if (a.witnessCount >= saturatedThreshold && a.dimState === 'covered') {
      saturated.push(a);
    } else if (a.dimState === 'untouched' || a.dimState === 'shallow') {
      priority.push(a);
    } else {
      normal.push(a);
    }
  }

  // Sort priority by coverage state (untouched first), then by sensitivity
  const sensOrder = { low: 0, medium: 1, high: 2 };
  priority.sort((a, b) => {
    const sp = STATE_PRIORITY[a.dimState] - STATE_PRIORITY[b.dimState];
    if (sp !== 0) return sp;
    return sensOrder[a.sensitivity] - sensOrder[b.sensitivity];
  });

  // Maintain original order within normal questions
  normal.sort((a, b) => a.originalIndex - b.originalIndex);

  // Saturated: keep original order (they go to the end)
  saturated.sort((a, b) => a.originalIndex - b.originalIndex);

  // Cautious: keep original order (very end, all skippable)
  cautious.sort((a, b) => a.originalIndex - b.originalIndex);

  // Assemble: priority -> normal -> saturated -> cautious
  const ordered = [...priority, ...normal, ...saturated, ...cautious];

  // Determine how many to keep
  const totalAvailable = ordered.length;
  const nonSaturatedCount = priority.length + normal.length + cautious.length;
  // If we have enough non-saturated questions, we can omit some saturated ones
  // but always keep at least minQuestions
  const keepCount = Math.max(minQuestions, Math.min(totalAvailable, nonSaturatedCount));

  // Build the final plan
  const plan: PlannedQuestion[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]!;
    // Determine if this question should be included in the core set
    // or if it's beyond the keep limit
    const isOmitted = i >= keepCount;
    if (isOmitted) continue; // genuinely omit saturated questions beyond the minimum

    let reason: PlannedQuestion['reason'];
    if (priority.includes(a)) {
      reason = 'priority';
    } else if (cautious.includes(a)) {
      reason = 'cautious';
    } else if (saturated.includes(a)) {
      reason = 'saturated';
    } else {
      reason = 'normal';
    }

    plan.push({
      question: a.question,
      dimensionId: a.dimensionId,
      reason,
      skippable: reason === 'cautious' || reason === 'saturated',
    });
  }

  return plan;
}

/* ------------------------------------------------------------------ */
/* Coverage overview for the inviter                                   */
/* ------------------------------------------------------------------ */

/** A human-readable suggestion about which relation types are missing. */
export interface RelationGapAdvice {
  message: string;
  missingTypes: string[];
}

const ALL_RELATION_TYPES = ['friend', 'family', 'colleague'] as const;
const RELATION_LABELS: Record<string, string> = {
  friend: '朋友',
  family: '家人',
  colleague: '同事',
};

/**
 * Given current witnesses, advise on which relation types are underrepresented.
 */
export function adviseRelationGaps(
  witnesses: readonly Witness[],
): RelationGapAdvice | undefined {
  if (witnesses.length === 0) return undefined;

  // Normalize relation strings to our three canonical types
  const presentTypes = new Set<string>();
  for (const w of witnesses) {
    const lower = w.relation.toLowerCase();
    if (/朋友|friend/.test(lower)) presentTypes.add('friend');
    else if (/家人|父|母|兄|弟|姐|妹|爸|妈|family/.test(lower)) presentTypes.add('family');
    else if (/同事|领导|上司|下属|colleague/.test(lower)) presentTypes.add('colleague');
  }

  const missing = ALL_RELATION_TYPES.filter((t) => !presentTypes.has(t));
  if (missing.length === 0) return undefined;

  const labels = missing.map((t) => RELATION_LABELS[t] ?? t);
  const message =
    presentTypes.size === 1
      ? `目前都是${RELATION_LABELS[[...presentTypes][0]!] ?? [...presentTypes][0]!}，可以再邀请一位${labels.join('或')}`
      : `还缺${labels.join('和')}的视角`;

  return { message, missingTypes: missing };
}
