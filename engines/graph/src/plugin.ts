/**
 * GraphEngine plugin: event-driven incremental recompute.
 *
 * Provides the 'graph' service and registers routes:
 *   GET  /api/subjects/:id/graph           — dependency & version overview
 *   POST /api/subjects/:id/graph/recompute — trigger manual recompute
 *
 * Events listened:
 *   testimony.added    → marks dirty
 *   court.finished     → records dependencies
 *   claim.contested    → marks dirty (via gate contest route interception)
 *   claim.uncontested  → marks dirty (via gate uncontest route interception)
 *
 * Events emitted:
 *   graph.dirty       — when a dirty mark is created
 *   graph.recomputed  — when a recompute finishes
 */
import { randomUUID } from 'node:crypto';
import type { Plugin, Store } from '@openmimic/kernel';
import type { Router } from '@openmimic/server';
import type { CourtEngine } from '@openmimic/engine-court';
import { DependencyTracker } from './deps';
import { DirtyTracker } from './dirty';
import { GraphEngine, type GraphEngineConfig, type RecomputeReport } from './graph';

export interface GraphPluginConfig extends GraphEngineConfig {}

export const graphPlugin: Plugin<GraphPluginConfig> = {
  name: 'graph',
  kind: 'engine',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx, config) {
    const store = ctx.get<Store>('store');

    /* ---- Plugin tables -------------------------------------------- */

    const depsTable = store.registerPluginTable(
      'graph', 'deps',
      `CREATE TABLE IF NOT EXISTS plugin_graph_deps (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        testimony_id TEXT NOT NULL,
        witness_id TEXT NOT NULL,
        court_session_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      { appendOnly: true },
    );

    const personaTable = store.registerPluginTable(
      'graph', 'persona_versions',
      `CREATE TABLE IF NOT EXISTS plugin_graph_persona_versions (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        court_session_id TEXT NOT NULL,
        claim_ids TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      { appendOnly: true },
    );

    const outputTable = store.registerPluginTable(
      'graph', 'output_versions',
      `CREATE TABLE IF NOT EXISTS plugin_graph_output_versions (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        output_type TEXT NOT NULL,
        output_id TEXT NOT NULL,
        persona_version_id TEXT NOT NULL,
        court_session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        stale INTEGER NOT NULL DEFAULT 0
      )`,
      { appendOnly: false },
    );

    const dirtyTable = store.registerPluginTable(
      'graph', 'dirty_marks',
      `CREATE TABLE IF NOT EXISTS plugin_graph_dirty_marks (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        witness_id TEXT NOT NULL,
        testimony_id TEXT NOT NULL,
        claim_id TEXT NOT NULL,
        affected_claim_ids TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolved_at TEXT NOT NULL DEFAULT '',
        resolved_by_session_id TEXT NOT NULL DEFAULT ''
      )`,
      { appendOnly: false },
    );

    /* ---- Engine construction -------------------------------------- */

    const depTracker = new DependencyTracker(depsTable, personaTable, outputTable);
    const dirtyTracker = new DirtyTracker(dirtyTable, depTracker, () => randomUUID());
    const engine = new GraphEngine(store, depTracker, dirtyTracker, config);

    /* ---- Event listeners ------------------------------------------ */

    // testimony.added → mark dirty
    ctx.on('testimony.added', (testimony) => {
      engine.onTestimonyAdded(testimony);
    });

    // court.finished → record dependencies
    ctx.on('court.finished', (session) => {
      engine.onCourtFinished(session);
    });

    /* ---- Provide service ------------------------------------------ */

    ctx.provide('graph', engine);

    /* ---- Routes --------------------------------------------------- */

    if (!ctx.has('router')) return;
    const router = ctx.get<Router>('router');

    /* GET /api/subjects/:id/graph — dependency & version overview */
    router.get('/api/subjects/:id/graph', (context) => {
      const subjectId = context.params.id ?? '';
      const subject = store.getSubject(subjectId);
      if (!subject) {
        return { status: 404, body: { error: { code: 'not_found', message: 'Subject not found' } } };
      }
      const status = engine.getGraphStatus(subjectId);
      return { status: 200, body: status };
    }, { scope: 'testimony.read' });

    /* POST /api/subjects/:id/graph/recompute — manual trigger */
    router.post('/api/subjects/:id/graph/recompute', async (context) => {
      const subjectId = context.params.id ?? '';
      const subject = store.getSubject(subjectId);
      if (!subject) {
        return { status: 404, body: { error: { code: 'not_found', message: 'Subject not found' } } };
      }

      if (!ctx.has('court')) {
        return { status: 501, body: { error: { code: 'court_unavailable', message: 'Court engine not loaded' } } };
      }
      const court = ctx.get<CourtEngine>('court');

      const report = await engine.recompute(subjectId, court);
      return { status: 200, body: report };
    }, { scope: 'court.run' });

    /* ---- Dispose -------------------------------------------------- */

    return () => {
      engine.dispose();
    };
  },
};
