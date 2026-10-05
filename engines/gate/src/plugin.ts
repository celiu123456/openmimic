/**
 * GateEngine plugin: self-registers routes and listens to court.finished.
 *
 * Routes:
 *   POST /api/claims/:id/contest     — contest (veto) a claim
 *   POST /api/claims/:id/uncontest   — withdraw a contest
 *   GET  /api/subjects/:id/contested — list contested claims
 */
import type { Plugin } from '@openmimic/kernel';
import type { Store } from '@openmimic/kernel';
import type { Router } from '@openmimic/server';
import {
  createGateState,
  contestClaim,
  uncontestClaim,
  filterSessionClaims,
  checkReraiseAfterCourt,
  type GateState,
  type ContestRecord,
} from './gate';

export const gatePlugin: Plugin = {
  name: 'gate',
  kind: 'engine',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx) {
    const store = ctx.get<Store>('store');
    const gateState = createGateState();

    // Persistent table for contest records
    const contestTable = store.registerPluginTable(
      'gate', 'contest_records',
      `CREATE TABLE IF NOT EXISTS plugin_gate_contest_records (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL,
        at TEXT NOT NULL,
        evidence_snapshot TEXT NOT NULL
      )`,
      { appendOnly: true },
    );

    const wallTable = store.registerPluginTable(
      'gate', 'wall_transcript',
      `CREATE TABLE IF NOT EXISTS plugin_gate_wall_transcript (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL,
        text TEXT NOT NULL,
        blocked_word TEXT NOT NULL,
        at TEXT NOT NULL
      )`,
      { appendOnly: true },
    );

    // Hydrate from DB
    for (const row of contestTable.query('1=1 ORDER BY rowid ASC')) {
      const claimId = row.claim_id as string;
      const record: ContestRecord = {
        claimId,
        at: row.at as string,
        evidenceSnapshot: JSON.parse(row.evidence_snapshot as string) as string[],
      };
      const existing = gateState.contestRecords.get(claimId) ?? [];
      existing.push(record);
      gateState.contestRecords.set(claimId, existing);
    }
    for (const row of wallTable.query('1=1 ORDER BY rowid ASC')) {
      gateState.wallTranscript.push({
        claimId: row.claim_id as string,
        text: row.text as string,
        blockedWord: row.blocked_word as string,
        at: row.at as string,
      });
    }

    // Provide gate state for testing
    ctx.provide('gate', gateState);

    // Persistence helpers
    const persistContest = (record: ContestRecord): void => {
      contestTable.insert({
        id: `${record.claimId}-${Date.now()}`,
        claim_id: record.claimId,
        at: record.at,
        evidence_snapshot: JSON.stringify(record.evidenceSnapshot),
      });
    };
    const persistWallEntry = (entry: { claimId: string; text: string; blockedWord: string; at: string }): void => {
      wallTable.insert({
        id: `wall-${entry.claimId}-${Date.now()}`,
        claim_id: entry.claimId,
        text: entry.text,
        blocked_word: entry.blockedWord,
        at: entry.at,
      });
    };

    /* --- Event listener: court.finished -------------------------------- */
    ctx.on('court.finished', (session) => {
      const wallLenBefore = gateState.wallTranscript.length;

      // 1. Permission wall: filter claims with diagnostic vocabulary
      filterSessionClaims(session, store, gateState);

      // Persist new wall entries
      for (let i = wallLenBefore; i < gateState.wallTranscript.length; i++) {
        persistWallEntry(gateState.wallTranscript[i]!);
      }

      // 2. Check re-raise for previously contested claims
      checkReraiseAfterCourt(session, store, gateState);
    });

    /* --- Routes -------------------------------------------------------- */
    if (!ctx.has('router')) return;
    const router = ctx.get<Router>('router');

    /* POST /api/claims/:id/contest — subject denies a claim (admin) */
    router.post('/api/claims/:id/contest', (context) => {
      const claimId = context.params.id ?? '';
      const claim = store.getClaim(claimId);
      if (!claim) {
        return { status: 404, body: { error: { code: 'not_found', message: '论断不存在' } } };
      }
      if (claim.status === 'contested') {
        return { status: 409, body: { error: { code: 'already_contested', message: '该论断已被否决' } } };
      }
      if (claim.status === 'retired') {
        return { status: 409, body: { error: { code: 'retired', message: '该论断已退出' } } };
      }

      const record = contestClaim(claimId, store, gateState);
      if (!record) {
        return { status: 500, body: { error: { code: 'internal_error', message: '否决失败' } } };
      }
      persistContest(record);

      return {
        status: 200,
        body: {
          claimId,
          status: 'contested',
          contestedAt: record.at,
          evidenceSnapshot: record.evidenceSnapshot,
        },
      };
    }, { scope: 'admin' });

    /* POST /api/claims/:id/uncontest — withdraw a denial (admin) */
    router.post('/api/claims/:id/uncontest', (context) => {
      const claimId = context.params.id ?? '';
      const claim = store.getClaim(claimId);
      if (!claim) {
        return { status: 404, body: { error: { code: 'not_found', message: '论断不存在' } } };
      }
      if (claim.status !== 'contested') {
        return { status: 409, body: { error: { code: 'not_contested', message: '该论断未被否决' } } };
      }

      const success = uncontestClaim(claimId, store, gateState);
      if (!success) {
        return { status: 500, body: { error: { code: 'internal_error', message: '撤回失败' } } };
      }

      return {
        status: 200,
        body: { claimId, status: 'surviving' },
      };
    }, { scope: 'admin' });

    /* GET /api/subjects/:id/contested — list contested claims (testimony.read) */
    router.get('/api/subjects/:id/contested', (context) => {
      const subjectId = context.params.id ?? '';
      const claims = store.listClaimsBySubject(subjectId)
        .filter((c) => c.status === 'contested');

      return {
        status: 200,
        body: {
          subjectId,
          contested: claims.map((c) => ({
            id: c.id,
            text: c.text,
            conviction: c.conviction,
            records: gateState.contestRecords.get(c.id) ?? [],
          })),
        },
      };
    }, { scope: 'testimony.read' });
  },
};
