/**
 * GraphEngine: event-driven incremental recompute engine.
 *
 * Listens to testimony.added, claim.contested, claim.uncontested, and
 * court.finished events. Maintains a dependency graph so that when new
 * testimony arrives, only the affected parts of the persona graph are
 * recomputed.
 *
 * Trigger strategies:
 * - manual (default): marks dirty, does not auto-recompute. The initiator
 *   clicks "recompute" to trigger incremental court re-run.
 * - auto: after a configurable quiet period with no new events, triggers
 *   incremental recompute (up to a daily limit).
 *
 * Default is manual because:
 * 1. Court runs cost LLM tokens (real money).
 * 2. Court output is non-deterministic (~47% overlap). Auto-triggering
 *    on every testimony would churn the persona unnecessarily.
 * 3. The initiator should review what changed before recomputing.
 */
import { randomUUID } from 'node:crypto';
import type { Store } from '@openmimic/kernel';
import type { Claim, CourtSession, Testimony } from '@openmimic/shared';
import type { CourtEngine } from '@openmimic/engine-court';
import type { DependencyTracker } from './deps';
import type { DirtyTracker } from './dirty';
import { matchClaims, type ClaimMatchResult, type SemanticMatcher } from './matcher';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export interface GraphEngineConfig {
  /**
   * Trigger strategy: 'manual' (default) or 'auto'.
   *
   * manual: only marks dirty; recompute must be triggered via API.
   * auto: triggers recompute after quietPeriodMs of no new events,
   *        subject to dailyLimit.
   */
  triggerMode?: 'manual' | 'auto';

  /**
   * Quiet period before auto-trigger fires (ms). Default 30_000 (30s).
   * Events arriving during this window reset the timer.
   */
  quietPeriodMs?: number;

  /**
   * Maximum auto-triggered recomputes per subject per day. Default 5.
   */
  dailyLimit?: number;
}

export const DEFAULT_CONFIG: Required<GraphEngineConfig> = {
  triggerMode: 'manual',
  quietPeriodMs: 30_000,
  dailyLimit: 5,
};

/* ------------------------------------------------------------------ */
/* Recompute report                                                    */
/* ------------------------------------------------------------------ */

export interface RecomputeReport {
  subjectId: string;
  previousSessionId: string | null;
  newSessionId: string;
  dirtyMarksResolved: number;
  dirtyWitnessIds: string[];
  claimMatch: ClaimMatchResult;
  outputsMarkedStale: number;
  startedAt: string;
  finishedAt: string;
  incremental: boolean;
}

/* ------------------------------------------------------------------ */
/* GraphEngine service                                                 */
/* ------------------------------------------------------------------ */

export class GraphEngine {
  readonly config: Required<GraphEngineConfig>;
  private autoTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private dailyCounts = new Map<string, { date: string; count: number }>();

  constructor(
    private readonly store: Store,
    private readonly depTracker: DependencyTracker,
    private readonly dirtyTracker: DirtyTracker,
    config: GraphEngineConfig = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /* ---- Event handlers ---------------------------------------------- */

  onTestimonyAdded(testimony: Testimony): void {
    this.dirtyTracker.markTestimonyAdded(testimony);
    this.depTracker.markOutputsStale(testimony.subjectId);
    this.maybeScheduleAuto(testimony.subjectId);
  }

  onClaimContested(subjectId: string, claimId: string): void {
    this.dirtyTracker.markClaimContested(subjectId, claimId);
    this.depTracker.markOutputsStale(subjectId);
    this.maybeScheduleAuto(subjectId);
  }

  onClaimUncontested(subjectId: string, claimId: string): void {
    this.dirtyTracker.markClaimUncontested(subjectId, claimId);
    this.depTracker.markOutputsStale(subjectId);
    this.maybeScheduleAuto(subjectId);
  }

  onCorpusChanged(subjectId: string): void {
    this.dirtyTracker.markCorpusChanged(subjectId);
    this.depTracker.markOutputsStale(subjectId);
  }

  /**
   * Called after court.finished to record dependencies from the session.
   */
  onCourtFinished(session: CourtSession): void {
    const claims = this.store.listClaimsBySubject(session.subjectId)
      .filter((c) => c.courtSessionId === session.id);
    const episodes = this.store.listEpisodesBySubject(session.subjectId);
    const divergences = this.store.listDivergencesBySubject(session.subjectId)
      .filter((d) => d.courtSessionId === session.id);

    this.depTracker.recordCourtDeps(session, claims, episodes, divergences);

    // Record a new persona version
    const survivingClaims = claims.filter((c) => c.status === 'surviving');
    this.depTracker.recordPersonaVersion(
      session.subjectId,
      session.id,
      survivingClaims.map((c) => c.id),
    );
  }

  /* ---- Query interface --------------------------------------------- */

  /**
   * Get the dependency and version overview for a subject.
   */
  getGraphStatus(subjectId: string): {
    dirtyCount: number;
    dirtyMarks: ReturnType<DirtyTracker['getUnresolved']>;
    latestPersonaVersion: ReturnType<DependencyTracker['getLatestPersonaVersion']>;
    staleOutputs: ReturnType<DependencyTracker['getStaleOutputs']>;
    personaVersions: ReturnType<DependencyTracker['listPersonaVersions']>;
    config: Required<GraphEngineConfig>;
    /** How many new testimonies since last court session. */
    newTestimonySinceLastCourt: number;
  } {
    const dirtyMarks = this.dirtyTracker.getUnresolved(subjectId);
    const latestVersion = this.depTracker.getLatestPersonaVersion(subjectId);

    // Count testimonies added since last court session
    let newTestimonySinceLastCourt = 0;
    if (latestVersion) {
      const sessions = this.store.listCourtSessionsBySubject(subjectId);
      const lastSession = sessions.find((s) => s.id === latestVersion.courtSessionId);
      if (lastSession?.finishedAt) {
        const testimonies = this.store.listBySubject(subjectId);
        newTestimonySinceLastCourt = testimonies.filter(
          (t) => t.createdAt > lastSession.finishedAt!,
        ).length;
      }
    } else {
      // No court session yet — all testimonies are "new"
      newTestimonySinceLastCourt = this.store.listBySubject(subjectId).length;
    }

    return {
      dirtyCount: dirtyMarks.length,
      dirtyMarks,
      latestPersonaVersion: latestVersion,
      staleOutputs: this.depTracker.getStaleOutputs(subjectId),
      personaVersions: this.depTracker.listPersonaVersions(subjectId),
      config: this.config,
      newTestimonySinceLastCourt,
    };
  }

  /* ---- Recompute --------------------------------------------------- */

  /**
   * Run incremental recompute for a subject.
   *
   * Steps:
   * 1. Identify dirty witnesses and affected claims
   * 2. Run court (full run — court does not yet support partial re-filing)
   * 3. Match old claims against new claims (handle non-determinism)
   * 4. Mark dirty marks as resolved
   * 5. Mark downstream outputs as stale
   * 6. Return report
   */
  async recompute(
    subjectId: string,
    court: CourtEngine,
    options?: { semanticMatcher?: SemanticMatcher },
  ): Promise<RecomputeReport> {
    const startedAt = new Date().toISOString();
    const dirtyMarks = this.dirtyTracker.getUnresolved(subjectId);
    const dirtyWitnessIds = this.dirtyTracker.getDirtyWitnessIds(subjectId);

    // Snapshot old claims before re-running court
    const oldClaims = this.store.listClaimsBySubject(subjectId);
    const previousVersion = this.depTracker.getLatestPersonaVersion(subjectId);

    // Run court (full pipeline — incremental filing not yet supported)
    const session = await court.runCourt(subjectId);

    // Get new claims from this session
    const newClaims = this.store.listClaimsBySubject(subjectId)
      .filter((c) => c.courtSessionId === session.id);

    // Match old surviving claims against new surviving claims
    const claimMatch = await matchClaims(
      oldClaims,
      newClaims,
      options?.semanticMatcher,
    );

    // Record dependencies from new session
    this.onCourtFinished(session);

    // Resolve dirty marks
    const dirtyMarksResolved = this.dirtyTracker.resolveAll(subjectId, session.id);

    // Mark downstream outputs as stale
    const outputsMarkedStale = this.depTracker.markOutputsStale(subjectId);

    const finishedAt = new Date().toISOString();

    // Increment daily count
    this.incrementDailyCount(subjectId);

    return {
      subjectId,
      previousSessionId: previousVersion?.courtSessionId ?? null,
      newSessionId: session.id,
      dirtyMarksResolved,
      dirtyWitnessIds,
      claimMatch,
      outputsMarkedStale,
      startedAt,
      finishedAt,
      incremental: dirtyWitnessIds.length > 0,
    };
  }

  /* ---- Auto-trigger logic ----------------------------------------- */

  private maybeScheduleAuto(subjectId: string): void {
    if (this.config.triggerMode !== 'auto') return;

    // Cancel existing timer
    const existing = this.autoTimers.get(subjectId);
    if (existing) clearTimeout(existing);

    // Check daily limit
    if (this.isOverDailyLimit(subjectId)) return;

    // Schedule new timer
    const timer = setTimeout(() => {
      this.autoTimers.delete(subjectId);
      // Auto-trigger emits an event; actual recompute needs court engine
      // which is not available here. The plugin wires this up.
      this.store.events.emit('graph.auto_trigger' as any, { subjectId });
    }, this.config.quietPeriodMs);

    this.autoTimers.set(subjectId, timer);
  }

  private isOverDailyLimit(subjectId: string): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.dailyCounts.get(subjectId);
    if (!entry || entry.date !== today) return false;
    return entry.count >= this.config.dailyLimit;
  }

  private incrementDailyCount(subjectId: string): void {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.dailyCounts.get(subjectId);
    if (!entry || entry.date !== today) {
      this.dailyCounts.set(subjectId, { date: today, count: 1 });
    } else {
      entry.count++;
    }
  }

  getDailyCount(subjectId: string): number {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.dailyCounts.get(subjectId);
    if (!entry || entry.date !== today) return 0;
    return entry.count;
  }

  /** Clear all auto-trigger timers (for cleanup). */
  dispose(): void {
    for (const timer of this.autoTimers.values()) {
      clearTimeout(timer);
    }
    this.autoTimers.clear();
  }
}
