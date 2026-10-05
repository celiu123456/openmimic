/**
 * Dirty marking: tracks which parts of a subject's persona graph need
 * recomputation after new testimony, corrections, or claim contests.
 *
 * Dirty marks are scoped: only the witnesses/claims directly affected by
 * a change are marked dirty, not the entire subject.
 */
import type { PluginTableHandle } from '@openmimic/kernel';
import type { Testimony } from '@openmimic/shared';
import type { DependencyTracker } from './deps';

/* ------------------------------------------------------------------ */
/* Dirty mark types                                                    */
/* ------------------------------------------------------------------ */

export type DirtyReason =
  | 'testimony_added'
  | 'testimony_correction'
  | 'claim_contested'
  | 'claim_uncontested'
  | 'corpus_changed';

export interface DirtyMark {
  id: string;
  subjectId: string;
  reason: DirtyReason;
  /** The witness whose testimony triggered the dirty mark (if applicable). */
  witnessId: string | null;
  /** The testimony that triggered the dirty mark (if applicable). */
  testimonyId: string | null;
  /** The claim that was contested/uncontested (if applicable). */
  claimId: string | null;
  /** Affected claim IDs (claims that depend on the changed testimony). */
  affectedClaimIds: string[];
  createdAt: string;
  /** Whether this dirty mark has been resolved by a recompute. */
  resolved: number; // 0 or 1
  resolvedAt: string | null;
  resolvedBySessionId: string | null;
}

/* ------------------------------------------------------------------ */
/* DirtyTracker                                                        */
/* ------------------------------------------------------------------ */

export class DirtyTracker {
  constructor(
    private readonly table: PluginTableHandle,
    private readonly depTracker: DependencyTracker,
    private readonly newId: () => string,
  ) {}

  /**
   * Mark parts of a subject as dirty when new testimony arrives.
   *
   * Precision: only claims that depend on testimony from the same witness
   * are marked dirty, not all claims for the subject.
   */
  markTestimonyAdded(testimony: Testimony): DirtyMark {
    const affectedClaims = this.findAffectedClaimIds(
      testimony.subjectId,
      testimony.witnessId,
    );

    const mark: DirtyMark = {
      id: this.newId(),
      subjectId: testimony.subjectId,
      reason: testimony.correctionOf ? 'testimony_correction' : 'testimony_added',
      witnessId: testimony.witnessId,
      testimonyId: testimony.id,
      claimId: null,
      affectedClaimIds: affectedClaims,
      createdAt: new Date().toISOString(),
      resolved: 0,
      resolvedAt: null,
      resolvedBySessionId: null,
    };

    this.insertMark(mark);
    return mark;
  }

  /**
   * Mark a contested claim as dirty.
   *
   * When a claim is contested, the persona needs recalculation because
   * the claim no longer participates in assembly.
   */
  markClaimContested(subjectId: string, claimId: string): DirtyMark {
    const mark: DirtyMark = {
      id: this.newId(),
      subjectId,
      reason: 'claim_contested',
      witnessId: null,
      testimonyId: null,
      claimId,
      affectedClaimIds: [claimId],
      createdAt: new Date().toISOString(),
      resolved: 0,
      resolvedAt: null,
      resolvedBySessionId: null,
    };

    this.insertMark(mark);
    return mark;
  }

  /**
   * Mark an uncontested claim as dirty (withdrawn veto).
   */
  markClaimUncontested(subjectId: string, claimId: string): DirtyMark {
    const mark: DirtyMark = {
      id: this.newId(),
      subjectId,
      reason: 'claim_uncontested',
      witnessId: null,
      testimonyId: null,
      claimId,
      affectedClaimIds: [claimId],
      createdAt: new Date().toISOString(),
      resolved: 0,
      resolvedAt: null,
      resolvedBySessionId: null,
    };

    this.insertMark(mark);
    return mark;
  }

  /**
   * Mark corpus change as dirty (corpus items added/removed).
   */
  markCorpusChanged(subjectId: string): DirtyMark {
    const mark: DirtyMark = {
      id: this.newId(),
      subjectId,
      reason: 'corpus_changed',
      witnessId: null,
      testimonyId: null,
      claimId: null,
      affectedClaimIds: [],
      createdAt: new Date().toISOString(),
      resolved: 0,
      resolvedAt: null,
      resolvedBySessionId: null,
    };

    this.insertMark(mark);
    return mark;
  }

  /** Get all unresolved dirty marks for a subject. */
  getUnresolved(subjectId: string): DirtyMark[] {
    return this.table
      .query('subject_id = ? AND resolved = 0 ORDER BY created_at ASC', [subjectId])
      .map((r) => this.rowToMark(r));
  }

  /** Get all dirty marks for a subject (including resolved). */
  listAll(subjectId: string): DirtyMark[] {
    return this.table
      .query('subject_id = ? ORDER BY created_at ASC', [subjectId])
      .map((r) => this.rowToMark(r));
  }

  /** Resolve all unresolved dirty marks for a subject (after recompute). */
  resolveAll(subjectId: string, courtSessionId: string): number {
    const now = new Date().toISOString();
    return this.table.update(
      {
        resolved: 1,
        resolved_at: now,
        resolved_by_session_id: courtSessionId,
      },
      'subject_id = ? AND resolved = 0',
      [subjectId],
    );
  }

  /** Count unresolved dirty marks for a subject. */
  countUnresolved(subjectId: string): number {
    return this.getUnresolved(subjectId).length;
  }

  /**
   * Get unique witness IDs from unresolved dirty marks.
   * These are the witnesses whose testimony needs re-examination.
   */
  getDirtyWitnessIds(subjectId: string): string[] {
    const marks = this.getUnresolved(subjectId);
    const witnessIds = new Set<string>();
    for (const mark of marks) {
      if (mark.witnessId) witnessIds.add(mark.witnessId);
    }
    return [...witnessIds];
  }

  /**
   * Get unique affected claim IDs from unresolved dirty marks.
   */
  getDirtyClaimIds(subjectId: string): string[] {
    const marks = this.getUnresolved(subjectId);
    const claimIds = new Set<string>();
    for (const mark of marks) {
      for (const cid of mark.affectedClaimIds) {
        claimIds.add(cid);
      }
    }
    return [...claimIds];
  }

  /* ---- Internal --------------------------------------------------- */

  private findAffectedClaimIds(subjectId: string, witnessId: string): string[] {
    const deps = this.depTracker.findByWitness(subjectId, witnessId);
    const claimIds = new Set<string>();
    for (const dep of deps) {
      if (dep.targetType === 'claim') {
        claimIds.add(dep.targetId);
      }
    }
    return [...claimIds];
  }

  private insertMark(mark: DirtyMark): void {
    this.table.insert({
      id: mark.id,
      subject_id: mark.subjectId,
      reason: mark.reason,
      witness_id: mark.witnessId ?? '',
      testimony_id: mark.testimonyId ?? '',
      claim_id: mark.claimId ?? '',
      affected_claim_ids: JSON.stringify(mark.affectedClaimIds),
      created_at: mark.createdAt,
      resolved: mark.resolved,
      resolved_at: mark.resolvedAt ?? '',
      resolved_by_session_id: mark.resolvedBySessionId ?? '',
    });
  }

  private rowToMark(r: Record<string, unknown>): DirtyMark {
    return {
      id: r.id as string,
      subjectId: r.subject_id as string,
      reason: r.reason as DirtyReason,
      witnessId: (r.witness_id as string) || null,
      testimonyId: (r.testimony_id as string) || null,
      claimId: (r.claim_id as string) || null,
      affectedClaimIds: JSON.parse((r.affected_claim_ids as string) || '[]') as string[],
      createdAt: r.created_at as string,
      resolved: r.resolved as number,
      resolvedAt: (r.resolved_at as string) || null,
      resolvedBySessionId: (r.resolved_by_session_id as string) || null,
    };
  }
}
