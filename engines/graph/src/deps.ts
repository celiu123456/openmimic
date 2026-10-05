/**
 * Dependency table: tracks which court outputs depend on which testimonies.
 *
 * Every claim, episode, and divergence produced by a court session references
 * the testimonies that were used as evidence. This module records those
 * relationships in a plugin table so the graph engine can determine which
 * parts become dirty when new testimony arrives or a claim is contested.
 *
 * Persona versions record which court session they were assembled from,
 * and downstream outputs (rooms, biographies, meta-perception) record
 * which persona version they were based on.
 */
import { randomUUID } from 'node:crypto';
import type { PluginTableHandle } from '@openmimic/kernel';
import type { Claim, Episode, Divergence, CourtSession } from '@openmimic/shared';

/* ------------------------------------------------------------------ */
/* Dependency record types                                             */
/* ------------------------------------------------------------------ */

export interface DependencyRecord {
  id: string;
  subjectId: string;
  /** What depends on the testimony. */
  targetType: 'claim' | 'episode' | 'divergence';
  targetId: string;
  /** The testimony this target depends on. */
  testimonyId: string;
  /** The witness who gave the testimony. */
  witnessId: string;
  /** The court session that produced this target. */
  courtSessionId: string;
  createdAt: string;
}

export interface PersonaVersionRecord {
  id: string;
  subjectId: string;
  courtSessionId: string;
  /** Comma-separated claim ids included in this persona version. */
  claimIds: string;
  createdAt: string;
}

export interface OutputVersionRecord {
  id: string;
  subjectId: string;
  outputType: 'room' | 'biography' | 'meta_perception' | 'witness_set';
  outputId: string;
  personaVersionId: string | null;
  courtSessionId: string;
  createdAt: string;
  stale: number; // 0 or 1
}

/* ------------------------------------------------------------------ */
/* DependencyTracker                                                   */
/* ------------------------------------------------------------------ */

export class DependencyTracker {
  constructor(
    private readonly depsTable: PluginTableHandle,
    private readonly personaTable: PluginTableHandle,
    private readonly outputTable: PluginTableHandle,
  ) {}

  /* ---- Dependency records ----------------------------------------- */

  /**
   * Record dependencies from a completed court session.
   *
   * Extracts testimony references from claims (evidence array, witnessIds),
   * episodes (testimonyId), and divergences (position claim → evidence).
   */
  recordCourtDeps(
    session: CourtSession,
    claims: Claim[],
    episodes: Episode[],
    divergences: Divergence[],
  ): DependencyRecord[] {
    const now = new Date().toISOString();
    const records: DependencyRecord[] = [];

    // Claims → testimony (via evidence array)
    for (const claim of claims) {
      for (const tid of claim.evidence) {
        const rec: DependencyRecord = {
          id: randomUUID(),
          subjectId: session.subjectId,
          targetType: 'claim',
          targetId: claim.id,
          testimonyId: tid,
          witnessId: claim.witnessIds?.[0] ?? '',
          courtSessionId: session.id,
          createdAt: now,
        };
        this.depsTable.insert({
          id: rec.id,
          subject_id: rec.subjectId,
          target_type: rec.targetType,
          target_id: rec.targetId,
          testimony_id: rec.testimonyId,
          witness_id: rec.witnessId,
          court_session_id: rec.courtSessionId,
          created_at: rec.createdAt,
        });
        records.push(rec);
      }
    }

    // Episodes → testimony
    for (const ep of episodes) {
      const rec: DependencyRecord = {
        id: randomUUID(),
        subjectId: session.subjectId,
        targetType: 'episode',
        targetId: ep.id,
        testimonyId: ep.testimonyId,
        witnessId: ep.witnessId,
        courtSessionId: session.id,
        createdAt: now,
      };
      this.depsTable.insert({
        id: rec.id,
        subject_id: rec.subjectId,
        target_type: rec.targetType,
        target_id: rec.targetId,
        testimony_id: rec.testimonyId,
        witness_id: rec.witnessId,
        court_session_id: rec.courtSessionId,
        created_at: rec.createdAt,
      });
      records.push(rec);
    }

    // Divergences → testimony (through their position claims)
    for (const div of divergences) {
      for (const pos of div.positions) {
        const claim = claims.find((c) => c.id === pos.claimId);
        if (!claim) continue;
        for (const tid of claim.evidence) {
          const rec: DependencyRecord = {
            id: randomUUID(),
            subjectId: session.subjectId,
            targetType: 'divergence',
            targetId: div.id,
            testimonyId: tid,
            witnessId: pos.witnessId,
            courtSessionId: session.id,
            createdAt: now,
          };
          this.depsTable.insert({
            id: rec.id,
            subject_id: rec.subjectId,
            target_type: rec.targetType,
            target_id: rec.targetId,
            testimony_id: rec.testimonyId,
            witness_id: rec.witnessId,
            court_session_id: rec.courtSessionId,
            created_at: rec.createdAt,
          });
          records.push(rec);
        }
      }
    }

    return records;
  }

  /** All deps for a subject. */
  listDeps(subjectId: string): DependencyRecord[] {
    return this.depsTable
      .query('subject_id = ?', [subjectId])
      .map((r) => ({
        id: r.id as string,
        subjectId: r.subject_id as string,
        targetType: r.target_type as DependencyRecord['targetType'],
        targetId: r.target_id as string,
        testimonyId: r.testimony_id as string,
        witnessId: r.witness_id as string,
        courtSessionId: r.court_session_id as string,
        createdAt: r.created_at as string,
      }));
  }

  /** Find all court outputs that depend on a specific testimony. */
  findByTestimony(subjectId: string, testimonyId: string): DependencyRecord[] {
    return this.depsTable
      .query('subject_id = ? AND testimony_id = ?', [subjectId, testimonyId])
      .map((r) => ({
        id: r.id as string,
        subjectId: r.subject_id as string,
        targetType: r.target_type as DependencyRecord['targetType'],
        targetId: r.target_id as string,
        testimonyId: r.testimony_id as string,
        witnessId: r.witness_id as string,
        courtSessionId: r.court_session_id as string,
        createdAt: r.created_at as string,
      }));
  }

  /** Find all deps involving a specific witness. */
  findByWitness(subjectId: string, witnessId: string): DependencyRecord[] {
    return this.depsTable
      .query('subject_id = ? AND witness_id = ?', [subjectId, witnessId])
      .map((r) => ({
        id: r.id as string,
        subjectId: r.subject_id as string,
        targetType: r.target_type as DependencyRecord['targetType'],
        targetId: r.target_id as string,
        testimonyId: r.testimony_id as string,
        witnessId: r.witness_id as string,
        courtSessionId: r.court_session_id as string,
        createdAt: r.created_at as string,
      }));
  }

  /* ---- Persona versions ------------------------------------------- */

  recordPersonaVersion(
    subjectId: string,
    courtSessionId: string,
    claimIds: string[],
  ): PersonaVersionRecord {
    const rec: PersonaVersionRecord = {
      id: randomUUID(),
      subjectId,
      courtSessionId,
      claimIds: claimIds.join(','),
      createdAt: new Date().toISOString(),
    };
    this.personaTable.insert({
      id: rec.id,
      subject_id: rec.subjectId,
      court_session_id: rec.courtSessionId,
      claim_ids: rec.claimIds,
      created_at: rec.createdAt,
    });
    return rec;
  }

  getLatestPersonaVersion(subjectId: string): PersonaVersionRecord | null {
    const rows = this.personaTable.query(
      'subject_id = ? ORDER BY created_at DESC LIMIT 1',
      [subjectId],
    );
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return {
      id: r.id as string,
      subjectId: r.subject_id as string,
      courtSessionId: r.court_session_id as string,
      claimIds: r.claim_ids as string,
      createdAt: r.created_at as string,
    };
  }

  listPersonaVersions(subjectId: string): PersonaVersionRecord[] {
    return this.personaTable
      .query('subject_id = ? ORDER BY created_at ASC', [subjectId])
      .map((r) => ({
        id: r.id as string,
        subjectId: r.subject_id as string,
        courtSessionId: r.court_session_id as string,
        claimIds: r.claim_ids as string,
        createdAt: r.created_at as string,
      }));
  }

  /* ---- Output versions -------------------------------------------- */

  recordOutputVersion(
    subjectId: string,
    outputType: OutputVersionRecord['outputType'],
    outputId: string,
    personaVersionId: string | null,
    courtSessionId: string,
  ): OutputVersionRecord {
    const rec: OutputVersionRecord = {
      id: randomUUID(),
      subjectId,
      outputType,
      outputId,
      personaVersionId,
      courtSessionId,
      createdAt: new Date().toISOString(),
      stale: 0,
    };
    this.outputTable.insert({
      id: rec.id,
      subject_id: rec.subjectId,
      output_type: rec.outputType,
      output_id: rec.outputId,
      persona_version_id: rec.personaVersionId ?? '',
      court_session_id: rec.courtSessionId,
      created_at: rec.createdAt,
      stale: rec.stale,
    });
    return rec;
  }

  markOutputsStale(subjectId: string): number {
    return this.outputTable.update(
      { stale: 1 },
      'subject_id = ? AND stale = 0',
      [subjectId],
    );
  }

  listOutputVersions(subjectId: string): OutputVersionRecord[] {
    return this.outputTable
      .query('subject_id = ? ORDER BY created_at ASC', [subjectId])
      .map((r) => ({
        id: r.id as string,
        subjectId: r.subject_id as string,
        outputType: r.output_type as OutputVersionRecord['outputType'],
        outputId: r.output_id as string,
        personaVersionId: (r.persona_version_id as string) || null,
        courtSessionId: r.court_session_id as string,
        createdAt: r.created_at as string,
        stale: r.stale as number,
      }));
  }

  getStaleOutputs(subjectId: string): OutputVersionRecord[] {
    return this.outputTable
      .query('subject_id = ? AND stale = 1', [subjectId])
      .map((r) => ({
        id: r.id as string,
        subjectId: r.subject_id as string,
        outputType: r.output_type as OutputVersionRecord['outputType'],
        outputId: r.output_id as string,
        personaVersionId: (r.persona_version_id as string) || null,
        courtSessionId: r.court_session_id as string,
        createdAt: r.created_at as string,
        stale: r.stale as number,
      }));
  }
}
