/**
 * Plugin integration tests covering:
 * - No-backdoor: a third-party engine can replace the official court
 * - Config overlay: disabling mount-mcp makes MCP unavailable
 * - Default config smoke: all existing routes still work
 * - createOpenMimic: no port, dispose closes the store
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  EventBus,
  MissingServiceError,
  PluginHost,
  Store,
  assemblePersonaContext,
  type Plugin,
} from '@openmimic/kernel';
import type { CourtSession } from '@openmimic/shared';
import { FakeLLM, type CourtEngine } from '@openmimic/engine-court';
import { witnessPlugin } from '@openmimic/engine-witness';
import { courtPlugin } from '@openmimic/engine-court';
import { roomPlugin } from '@openmimic/engine-room';
import { mountRestPlugin } from '@openmimic/server';
import { mountOpenaiPlugin } from '@openmimic/server';
import { mountMcpPlugin, type McpDispatch } from '@openmimic/server';
import { Router } from '@openmimic/server';
import { createOpenMimic } from '@openmimic/core';
import { startServer } from '@openmimic/server';

/* ------------------------------------------------------------------ */
/* §2.9.3 No backdoor: third-party engine replaces official court      */
/* ------------------------------------------------------------------ */

describe('no-backdoor: third-party engine replaces official court', () => {
  it('a fake court plugin providing the same service name is used by mount-rest', async () => {
    const store = new Store();
    try {
      store.putSubject({ id: 's1', displayName: 'Test' });
      store.putWitness({ id: 'w1', subjectId: 's1', relation: 'friend', consentLevel: 'quotable' });
      store.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'She is great.' }],
      });

      const events = new EventBus();
      const host = new PluginHost(events);
      const router = new Router();
      host.providePreset('store', store);
      host.providePreset('router', router);
      host.providePreset('llm', new FakeLLM([]));

      await host.load(witnessPlugin);

      // A third-party "fake court" plugin that provides the same service
      let fakeCourtCalled = false;
      const fakeCourt: Plugin = {
        name: 'court',
        kind: 'engine',
        inject: ['store'],
        apply(ctx) {
          const fakeEngine: CourtEngine = {
            runCourt: async (subjectId) => {
              fakeCourtCalled = true;
              const session: CourtSession = {
                id: 'fake-session',
                subjectId,
                startedAt: new Date().toISOString(),
                transcript: [],
                report: { total: 0, surviving: 0, retired: 0, divergences: 0, episodes: 0 },
              };
              return session;
            },
          };
          ctx.provide('court', fakeEngine);
        },
      };

      // Load the fake court instead of the official one
      await host.load(fakeCourt);
      await host.load(mountRestPlugin);

      // Call POST /api/subjects/s1/court through the router
      const match = router.match('POST', '/api/subjects/s1/court');
      expect(match).toBeDefined();
      const result = await match!.handler({
        params: { id: 's1' },
        query: new URLSearchParams(),
        body: {},
      });
      expect('status' in result && result.status).toBe(200);
      expect(fakeCourtCalled).toBe(true);
    } finally {
      store.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* §2.9.4 Config overlay: disabling mount-mcp                         */
/* ------------------------------------------------------------------ */

describe('config overlay: mount-mcp can be disabled', () => {
  it('when mount-mcp is not loaded, mcp-dispatch is unavailable', async () => {
    const store = new Store();
    try {
      const events = new EventBus();
      const host = new PluginHost(events);
      const router = new Router();
      host.providePreset('store', store);
      host.providePreset('router', router);

      await host.load(witnessPlugin);
      // Load mount-rest and mount-openai but NOT mount-mcp
      await host.load(mountRestPlugin);
      await host.load(mountOpenaiPlugin);

      // mcp-dispatch should not be available
      expect(host.hasService('mcp-dispatch')).toBe(false);
      expect(() => host.getService('mcp-dispatch')).toThrow(MissingServiceError);
    } finally {
      store.close();
    }
  });

  it('when mount-mcp is loaded, mcp-dispatch is available', async () => {
    const store = new Store();
    try {
      const events = new EventBus();
      const host = new PluginHost(events);
      host.providePreset('store', store);

      await host.load(mountMcpPlugin);
      expect(host.hasService('mcp-dispatch')).toBe(true);

      const dispatch = host.getService<McpDispatch>('mcp-dispatch');
      expect(typeof dispatch).toBe('function');

      // Call the dispatch to verify it works
      const response = await dispatch({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      });
      expect(response).toBeDefined();
      expect(response?.result).toBeDefined();
    } finally {
      store.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* §2.9.4 Config: unknown plugin fails startup                         */
/* ------------------------------------------------------------------ */

describe('config: unknown plugin fails startup', () => {
  it('loadAll throws when a plugin depends on a service no one provides', async () => {
    const host = new PluginHost(new EventBus());
    const bogus: Plugin = {
      name: 'bogus',
      kind: 'engine',
      inject: ['nonexistent_service'],
      apply() {},
    };
    await expect(
      host.loadAll([{ plugin: bogus }]),
    ).rejects.toThrow(MissingServiceError);
  });
});

/* ------------------------------------------------------------------ */
/* §2.9.6 createOpenMimic: no port, dispose closes store               */
/* ------------------------------------------------------------------ */

describe('createOpenMimic', () => {
  it('does not listen on any port', async () => {
    const om = await createOpenMimic({
      dbPath: ':memory:',
      llm: new FakeLLM([]),
      plugins: [witnessPlugin],
    });

    // The instance should have no server/port
    expect(om.has('witness')).toBe(true);
    expect(om.has('router')).toBe(false); // no mount plugins loaded
    await om.dispose();
  });

  it('dispose closes the store (db handle)', async () => {
    const om = await createOpenMimic({ dbPath: ':memory:' });
    om.store.putSubject({ id: 's1', displayName: 'Test' });
    expect(om.store.getSubject('s1')).toBeDefined();

    await om.dispose();
    // After dispose, the store should be closed
    expect(() => om.store.getSubject('s1')).toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* §2.9.7 Default config smoke: existing routes work                   */
/* ------------------------------------------------------------------ */

describe('default config smoke', () => {
  let store: Store;
  let server: Awaited<ReturnType<typeof startServer>>;

  afterEach(async () => {
    await server?.close();
    store?.close();
  });

  it('health, subject CRUD, and invite all work through mount plugins', async () => {
    store = new Store();
    server = await startServer({ port: 0, store, skipDemo: true });

    // Health
    const health = await fetch(`${server.url}/api/health`);
    expect(health.status).toBe(200);
    const healthBody = await health.json() as Record<string, unknown>;
    expect(healthBody.ok).toBe(true);

    // Create subject
    const subjectRes = await fetch(`${server.url}/api/subjects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'TestSubject' }),
    });
    expect(subjectRes.status).toBe(201);
    const subject = await subjectRes.json() as Record<string, unknown>;
    expect(subject.displayName).toBe('TestSubject');

    // Create invite
    const inviteRes = await fetch(`${server.url}/api/subjects/${subject.id}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(inviteRes.status).toBe(201);
  });
});
