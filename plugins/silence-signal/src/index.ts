/**
 * silence-signal: collective silence detection.
 *
 * When a question is skipped (avoidedQids) by >= half of witnesses AND
 * >= 3 witnesses, it produces a SilenceSignal.  These are stored in a
 * separate plugin table (not claims) and are excluded from the persona
 * assertion zone.
 *
 * Routes:
 *   GET  /api/subjects/:id/silence-signals   — list signals for a subject
 *   POST /api/subjects/:id/silence-signals/scan — re-scan testimonies
 */
import { randomUUID } from 'node:crypto';
import type { Plugin } from '@openmimic/kernel';
import type { Store, PluginTableHandle } from '@openmimic/kernel';
import type { Router, RouteContext } from '@openmimic/server';
import type { SilenceSignal } from '@openmimic/shared';

/* ------------------------------------------------------------------ */
/* Pure analysis function                                              */
/* ------------------------------------------------------------------ */

export interface AvoidedQidSummary {
  qid: string;
  skipperIds: string[];
  totalWitnesses: number;
  skipRatio: number;
}

/**
 * Analyze testimonies for collectively avoided questions.
 *
 * Returns one entry per question that meets the threshold:
 *   - skipped by >= `minFraction` of witnesses (default 0.5)
 *   - skipped by >= `minCount` witnesses (default 3)
 *
 * Strengthened rule (raise→retreat paired evidence):
 * A question only counts as a silence signal if at least one witness
 * *engaged* with the question (answered at least one related qid in the
 * same testimony) and then also skipped it. Pure passive skips (the
 * witness never engaged with any related question) are weaker evidence
 * and contribute to the tally but cannot be the *only* evidence.
 * When `requireRaiseRetreat` is true (the default), at least one of the
 * skippers must also have an answer touching the same topic group.
 */
export function analyzeAvoidedQids(
  testimonies: Array<{
    witnessId: string;
    avoidedQids?: string[];
    /**
     * Answered qids in this testimony (for raise→retreat detection).
     * When absent, falls back to extracting qids from `answers`.
     */
    answeredQids?: string[];
    /** Testimony answers — qids extracted for raise→retreat when answeredQids is absent. */
    answers?: Array<{ qid: string }>;
  }>,
  options: {
    minFraction?: number;
    minCount?: number;
    /**
     * When true (default), at least one skipper must also have answered
     * a related question — i.e. they raised the topic and then retreated.
     * Set to false for backward-compatible behavior.
     */
    requireRaiseRetreat?: boolean;
  } = {},
): AvoidedQidSummary[] {
  const minFraction = options.minFraction ?? 0.5;
  const minCount = options.minCount ?? 3;
  const requireRaiseRetreat = options.requireRaiseRetreat ?? true;

  // Collect all distinct witnesses who submitted testimonies
  const witnessIds = new Set(testimonies.map((t) => t.witnessId));
  const totalWitnesses = witnessIds.size;

  if (totalWitnesses < minCount) return [];

  // Tally skips per qid
  const skipsByQid = new Map<string, Set<string>>();
  for (const t of testimonies) {
    if (!t.avoidedQids) continue;
    for (const qid of t.avoidedQids) {
      if (!skipsByQid.has(qid)) skipsByQid.set(qid, new Set());
      skipsByQid.get(qid)!.add(t.witnessId);
    }
  }

  // Build per-witness answered-qid sets for raise→retreat check.
  // Sources: explicit answeredQids, or fall back to qids from answers[].
  const answeredByWitness = new Map<string, Set<string>>();
  for (const t of testimonies) {
    const qids = t.answeredQids ?? t.answers?.map((a) => a.qid);
    if (!qids || qids.length === 0) continue;
    if (!answeredByWitness.has(t.witnessId)) {
      answeredByWitness.set(t.witnessId, new Set());
    }
    for (const qid of qids) {
      answeredByWitness.get(t.witnessId)!.add(qid);
    }
  }

  /**
   * Extract the topic prefix from a qid.
   *
   * Grouping strategy: strip the last `_suffix` segment to get the topic
   * family. E.g. "family_01" → "family", "q_family" → "q",
   * "career_path_03" → "career_path". If no underscore, the whole qid
   * is its own group.
   */
  function topicGroup(qid: string): string {
    const lastUnderscore = qid.lastIndexOf('_');
    return lastUnderscore > 0 ? qid.slice(0, lastUnderscore) : qid;
  }

  const results: AvoidedQidSummary[] = [];
  for (const [qid, skippers] of skipsByQid) {
    const skipRatio = skippers.size / totalWitnesses;
    if (skippers.size < minCount || skipRatio < minFraction) continue;

    // Raise→retreat check: at least one skipper answered a sibling qid
    if (requireRaiseRetreat) {
      const group = topicGroup(qid);
      let hasRaiseRetreat = false;
      for (const skipperId of skippers) {
        const answered = answeredByWitness.get(skipperId);
        if (!answered) continue;
        for (const aQid of answered) {
          if (aQid !== qid && topicGroup(aQid) === group) {
            hasRaiseRetreat = true;
            break;
          }
        }
        if (hasRaiseRetreat) break;
      }
      if (!hasRaiseRetreat) continue; // no raise→retreat evidence → skip
    }

    results.push({
      qid,
      skipperIds: [...skippers],
      totalWitnesses,
      skipRatio,
    });
  }

  // Sort by skip ratio descending
  results.sort((a, b) => b.skipRatio - a.skipRatio);
  return results;
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

export const silenceSignalPlugin: Plugin = {
  name: 'silence-signal',
  kind: 'engine',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx) {
    const store = ctx.get<Store>('store');

    // Register plugin table for silence signals
    const table = store.registerPluginTable(
      'silence_signal', 'signals',
      `CREATE TABLE IF NOT EXISTS plugin_silence_signal_signals (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        qid TEXT NOT NULL,
        skipper_ids TEXT NOT NULL,
        total_witnesses INTEGER NOT NULL,
        skip_ratio REAL NOT NULL,
        created_at TEXT NOT NULL
      )`,
      { appendOnly: false },
    );

    // Provide service for testing
    ctx.provide('silence-signal', { table, scan });

    function scan(subjectId: string): SilenceSignal[] {
      const testimonies = store.listBySubject(subjectId);
      const avoided = analyzeAvoidedQids(testimonies);

      if (avoided.length === 0) return [];

      // Clear previous signals for this subject
      table.delete('subject_id = ?', [subjectId]);

      const now = new Date().toISOString();
      const signals: SilenceSignal[] = [];
      for (const item of avoided) {
        const signal: SilenceSignal = {
          id: randomUUID(),
          subjectId,
          qid: item.qid,
          skipperIds: item.skipperIds,
          totalWitnesses: item.totalWitnesses,
          skipRatio: item.skipRatio,
          createdAt: now,
        };
        table.insert({
          id: signal.id,
          subject_id: signal.subjectId,
          qid: signal.qid,
          skipper_ids: JSON.stringify(signal.skipperIds),
          total_witnesses: signal.totalWitnesses,
          skip_ratio: signal.skipRatio,
          created_at: signal.createdAt,
        });
        signals.push(signal);
      }
      return signals;
    }

    function listSignals(subjectId: string): SilenceSignal[] {
      const rows = table.query('subject_id = ?', [subjectId]);
      return rows.map((row) => ({
        id: row.id as string,
        subjectId: row.subject_id as string,
        qid: row.qid as string,
        skipperIds: JSON.parse(row.skipper_ids as string) as string[],
        totalWitnesses: row.total_witnesses as number,
        skipRatio: row.skip_ratio as number,
        createdAt: row.created_at as string,
      }));
    }

    // Listen for court.finished to auto-scan
    ctx.on('court.finished', (session) => {
      scan(session.subjectId);
    });

    // Routes
    if (!ctx.has('router')) return;
    const router = ctx.get<Router>('router');

    /* GET /api/subjects/:id/silence-signals */
    router.get('/api/subjects/:id/silence-signals', (context) => {
      const subjectId = context.params.id ?? '';
      const subject = store.getSubject(subjectId);
      if (!subject) {
        return { status: 404, body: { error: { code: 'not_found', message: '对象不存在' } } };
      }
      const signals = listSignals(subjectId);
      return { status: 200, body: { subjectId, signals } };
    });

    /* POST /api/subjects/:id/silence-signals/scan */
    router.post('/api/subjects/:id/silence-signals/scan', (context) => {
      const subjectId = context.params.id ?? '';
      const subject = store.getSubject(subjectId);
      if (!subject) {
        return { status: 404, body: { error: { code: 'not_found', message: '对象不存在' } } };
      }
      const signals = scan(subjectId);
      return { status: 200, body: { subjectId, signals, count: signals.length } };
    });
  },
};

export default silenceSignalPlugin;
