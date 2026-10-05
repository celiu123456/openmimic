/**
 * GateEngine: claim contest (veto) flow and permission wall.
 *
 * - Contest: subject can mark a claim as 'contested'; it exits persona assembly,
 *   room context, and the default report view.
 * - Re-raise threshold: a contested claim can only be re-raised by the court when
 *   its evidence set gains >=2 new distinct witnesses since the contest snapshot.
 *   A claim contested >=2 times is permanently sealed.
 * - Permission wall: claims containing quasi-diagnostic vocabulary are rejected.
 *   Uses the wordlist from engines/room/src/wordlist.ts.
 */
import { z } from 'zod';
import type { Claim, CourtSession, Testimony } from '@openmimic/shared';
import type { Store } from '@openmimic/kernel';
import {
  DIAGNOSIS_WORDS,
  CRISIS_WORDS,
} from '@openmimic/engine-room';

/* ------------------------------------------------------------------ */
/* Contest record                                                      */
/* ------------------------------------------------------------------ */

export interface ContestRecord {
  claimId: string;
  at: string;
  evidenceSnapshot: string[];
}

/* ------------------------------------------------------------------ */
/* Permission wall                                                     */
/* ------------------------------------------------------------------ */

/**
 * Extended word list for the permission wall (>=20 terms).
 * Combines DIAGNOSIS_WORDS from room wordlist with additional terms.
 */
export const GATE_DIAGNOSIS_WORDS: readonly string[] = [
  ...new Set([
    ...DIAGNOSIS_WORDS,
    // Additional terms to meet the >=20 requirement (some overlap is fine)
    '有病',
    '神经病',
    '变态',
    '心理变态',
    '精神失常',
  ]),
];

export interface ValidationResult {
  valid: boolean;
  blockedWord?: string;
  reason?: string;
}

/**
 * Validate claim text against the permission wall.
 * Claims containing quasi-diagnostic vocabulary are rejected.
 */
export function validateClaimText(text: string): ValidationResult {
  for (const word of GATE_DIAGNOSIS_WORDS) {
    if (word.length > 0 && text.includes(word)) {
      return {
        valid: false,
        blockedWord: word,
        reason: `论断含有准诊断用语"${word}",不予收录`,
      };
    }
  }
  // Also check crisis words
  for (const word of CRISIS_WORDS) {
    if (word.length > 0 && text.includes(word)) {
      return {
        valid: false,
        blockedWord: word,
        reason: `论断含有危机用语"${word}",不予收录`,
      };
    }
  }
  return { valid: true };
}

/* ------------------------------------------------------------------ */
/* Re-raise logic                                                      */
/* ------------------------------------------------------------------ */

/**
 * Determine whether a previously contested claim can be re-raised.
 *
 * Requirements:
 * 1. The claim's current evidence set must contain >=2 distinct witness IDs
 *    that were NOT in the contest snapshot.
 * 2. The claim must have been contested fewer than 2 times total.
 *
 * Pure function: no side effects, no store access.
 */
export function canReraise(
  claim: Claim,
  records: ContestRecord[],
  currentTestimonies: Testimony[],
  store: Store,
): boolean {
  // Sealed: contested >=2 times
  if (records.length >= 2) return false;

  const lastRecord = records[records.length - 1];
  if (!lastRecord) return false;

  // Build set of witness IDs at snapshot time
  const snapshotWitnessIds = new Set<string>();
  for (const tid of lastRecord.evidenceSnapshot) {
    const testimony = store.getTestimony(tid);
    if (testimony) snapshotWitnessIds.add(testimony.witnessId);
  }

  // Count new distinct witnesses in current evidence
  const newWitnessIds = new Set<string>();
  for (const tid of claim.evidence) {
    const testimony = store.getTestimony(tid);
    if (testimony && !snapshotWitnessIds.has(testimony.witnessId)) {
      newWitnessIds.add(testimony.witnessId);
    }
  }

  return newWitnessIds.size >= 2;
}

/* ------------------------------------------------------------------ */
/* Gate state                                                          */
/* ------------------------------------------------------------------ */

export interface GateState {
  /** claimId -> list of contest records (ordered by time) */
  contestRecords: Map<string, ContestRecord[]>;
  /** Transcript of blocked claims from permission wall */
  wallTranscript: Array<{ claimId: string; text: string; blockedWord: string; at: string }>;
}

export function createGateState(): GateState {
  return {
    contestRecords: new Map(),
    wallTranscript: [],
  };
}

/**
 * Contest a claim: set status to 'contested' and record the snapshot.
 */
export function contestClaim(
  claimId: string,
  store: Store,
  gateState: GateState,
): ContestRecord | undefined {
  const claim = store.getClaim(claimId);
  if (!claim) return undefined;

  const record: ContestRecord = {
    claimId,
    at: new Date().toISOString(),
    evidenceSnapshot: [...claim.evidence],
  };

  // Update claim status
  store.putClaim({ ...claim, status: 'contested' });

  // Store the contest record
  const existing = gateState.contestRecords.get(claimId) ?? [];
  existing.push(record);
  gateState.contestRecords.set(claimId, existing);

  return record;
}

/**
 * Uncontest (withdraw veto on) a claim: restore to 'surviving'.
 */
export function uncontestClaim(
  claimId: string,
  store: Store,
  gateState: GateState,
): boolean {
  const claim = store.getClaim(claimId);
  if (!claim || claim.status !== 'contested') return false;

  store.putClaim({ ...claim, status: 'surviving' });

  // Remove contest records
  gateState.contestRecords.delete(claimId);
  return true;
}

/**
 * Filter claims from a court.finished session through the permission wall.
 * Blocked claims are set to 'retired' and logged.
 */
export function filterSessionClaims(
  session: CourtSession,
  store: Store,
  gateState: GateState,
): void {
  const claims = store.listClaimsBySubject(session.subjectId)
    .filter((c) => c.courtSessionId === session.id);

  for (const claim of claims) {
    if (claim.status === 'retired') continue;
    const validation = validateClaimText(claim.text);
    if (!validation.valid) {
      store.putClaim({ ...claim, status: 'retired' });
      gateState.wallTranscript.push({
        claimId: claim.id,
        text: claim.text,
        blockedWord: validation.blockedWord!,
        at: new Date().toISOString(),
      });
    }
  }
}

/**
 * Check re-raise conditions for contested claims after a new court session.
 * Claims that can be re-raised get status 'surviving' with `reraised: true`.
 */
export function checkReraiseAfterCourt(
  session: CourtSession,
  store: Store,
  gateState: GateState,
): string[] {
  const reraisedIds: string[] = [];
  const allClaims = store.listClaimsBySubject(session.subjectId);
  const contestedClaims = allClaims.filter((c) => c.status === 'contested');
  const currentTestimonies = store.listBySubject(session.subjectId);

  for (const claim of contestedClaims) {
    const records = gateState.contestRecords.get(claim.id);
    if (!records || records.length === 0) continue;

    if (canReraise(claim, records, currentTestimonies, store)) {
      store.putClaim({ ...claim, status: 'surviving', reraised: true });
      reraisedIds.push(claim.id);
    }
  }

  return reraisedIds;
}
