/**
 * Shared types for process evaluation.
 */

/**
 * Three-element evidence coverage result for a single claim.
 */
export interface ClaimCoverageResult {
  claimId: string;
  claimText: string;
  /** Does the claim have >= 1 supporting episode? */
  hasSupport: boolean;
  /** Is there divergent material from another witness (divergence record,
   *  qualifier, or a claim from a different witness on the same topic)? */
  hasCounterEvidence: boolean;
  /** Does the claim have situational context (period, audience, situation)? */
  hasContext: boolean;
  /** 0..3 count of elements present */
  score: number;
}

/**
 * Aggregated evidence coverage report.
 */
export interface EvidenceCoverageReport {
  totalClaims: number;
  /** Claims with all three elements */
  fullCoverage: number;
  /** Claims with >= 1 supporting episode */
  withSupport: number;
  /** Claims with counter-evidence */
  withCounterEvidence: number;
  /** Claims with situational context */
  withContext: number;
  /** Average score (0..3) */
  averageScore: number;
  /** Per-claim details */
  details: ClaimCoverageResult[];
}

/**
 * Behavior types for contradiction responsiveness.
 * These classify what the court DID, not whether it was "right".
 */
export type ContradictionBehavior =
  | 'new_claim_created'      // A new claim appeared from the conflicting testimony
  | 'old_claim_limited'       // Old claim got a qualifier or context restriction
  | 'old_claim_contested'     // Old claim status changed to contested
  | 'old_claim_retired'       // Old claim status changed to retired
  | 'divergence_created'      // A divergence record was created
  | 'conviction_decreased'    // Old claim's conviction score decreased
  | 'no_change'               // Nothing happened (the system missed the conflict)
  | 'supersedes_relation';    // A supersedes relation was recorded

/**
 * One contradiction scenario and its observed behaviors.
 */
export interface ContradictionScenarioResult {
  id: string;
  description: string;
  type: 'factual_conflict' | 'perspective_difference' | 'temporal_evolution';
  /** The claim text that should be challenged */
  targetClaimText: string;
  /** The contradicting testimony text */
  contradictingText: string;
  /** Observed behaviors after running court */
  behaviors: ContradictionBehavior[];
  /** Whether any conflict was recognized at all */
  conflictRecognized: boolean;
}

/**
 * Aggregated contradiction responsiveness report.
 */
export interface ContradictionReport {
  totalScenarios: number;
  conflictsRecognized: number;
  behaviorCounts: Record<ContradictionBehavior, number>;
  scenarios: ContradictionScenarioResult[];
}

/**
 * One memory repair scenario and its result.
 */
export interface MemoryRepairScenarioResult {
  id: string;
  description: string;
  /** The old claim that should be superseded */
  oldClaimText: string;
  /** The new testimony that supersedes it */
  newTestimonyText: string;
  /** Was the old claim marked with a supersedes relation? */
  oldClaimSuperseded: boolean;
  /** Was a new claim created to replace it? */
  newClaimCreated: boolean;
  /** Were the old and new claims left as parallel conflicting truths? */
  leftAsParallel: boolean;
}

/**
 * Aggregated memory repair report.
 */
export interface MemoryRepairReport {
  totalScenarios: number;
  properlySuperseded: number;
  leftAsParallel: number;
  scenarios: MemoryRepairScenarioResult[];
}
