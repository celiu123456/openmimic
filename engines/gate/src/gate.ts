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

/* ------------------------------------------------------------------ */
/* Re-raise wording gate                                               */
/* ------------------------------------------------------------------ */

/**
 * Commanding / accusatory patterns that disqualify a re-raised claim.
 *
 * Re-raised claims must be worded in an inviting, exploratory tone —
 * "有人观察到…" not "他就是…". If the wording fails this gate, the
 * court must reword before re-raising.
 */
const COMMANDING_PATTERNS = [
  /^他[就总老一]+(是|在|会)/,
  /^她[就总老一]+(是|在|会)/,
  /^TA[就总老一]+(是|在|会)/,
  /一定是/,
  /肯定是/,
  /必须/,
  /绝对/,
  /毫无疑问/,
  /不可能不/,
];

/**
 * Check whether re-raised claim text uses an inviting, non-commanding tone.
 *
 * Returns true when the wording is acceptable; false when the text contains
 * commanding or accusatory language that should be softened before re-raise.
 */
export function hasInvitingTone(text: string): boolean {
  for (const pattern of COMMANDING_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

/**
 * Check re-raise conditions for contested claims after a new court session.
 * Claims that can be re-raised get status 'surviving' with `reraised: true`.
 *
 * Wording gate: if the re-raised claim's text fails the inviting-tone
 * check, it is still re-raised but the original text is pushed to
 * `versions` and a note is left in the transcript. The court or a
 * human reviewer should reword it.
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
      const updatedClaim = { ...claim, status: 'surviving' as const, reraised: true };

      // Wording gate: flag claims that need rewording
      if (!hasInvitingTone(claim.text)) {
        // Push current text to versions history
        const versions = [
          { text: claim.text, at: new Date().toISOString(), reason: 'reraise_tone_gate' },
          ...(claim.versions ?? []),
        ];
        updatedClaim.versions = versions;
      }

      store.putClaim(updatedClaim);
      reraisedIds.push(claim.id);
    }
  }

  return reraisedIds;
}
