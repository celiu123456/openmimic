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
} from './gate';

export const gatePlugin: Plugin = {
  name: 'gate',
  kind: 'engine',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx) {
    const store = ctx.get<Store>('store');
    const gateState = createGateState();

    // Provide gate state for testing
    ctx.provide('gate', gateState);

    /* --- Event listener: court.finished -------------------------------- */
    ctx.on('court.finished', (session) => {
      // 1. Permission wall: filter claims with diagnostic vocabulary
      filterSessionClaims(session, store, gateState);

      // 2. Check re-raise for previously contested claims
      checkReraiseAfterCourt(session, store, gateState);
    });

    /* --- Routes -------------------------------------------------------- */
    if (!ctx.has('router')) return;
    const router = ctx.get<Router>('router');

    /* POST /api/claims/:id/contest */
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

      return {
        status: 200,
        body: {
          claimId,
          status: 'contested',
          contestedAt: record.at,
          evidenceSnapshot: record.evidenceSnapshot,
        },
      };
    });

    /* POST /api/claims/:id/uncontest */
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
    });

    /* GET /api/subjects/:id/contested */
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
    });
  },
};
