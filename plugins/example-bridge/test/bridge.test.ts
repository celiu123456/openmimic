import { describe, expect, it, afterEach } from 'vitest';
import { EventBus, PluginHost, Store } from '@openmimic/kernel';
import type { CourtSession } from '@openmimic/shared';
import { exampleBridgePlugin, type BridgeConfig } from '@openmimic/example-bridge';

describe('example-bridge plugin', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  it('posts persona context to the webhook on court.finished', async () => {
    store = new Store();
    store.putSubject({ id: 's1', displayName: 'Test' });
    store.putWitness({ id: 'w1', subjectId: 's1', relation: 'friend', consentLevel: 'quotable' });

    const events = new EventBus();
    const host = new PluginHost(events);
    host.providePreset('store', store);

    const posted: unknown[] = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      posted.push({ url: String(url), body: JSON.parse(init?.body as string) });
      return new Response('ok', { status: 200 });
    };

    const config: BridgeConfig = {
      webhookUrl: 'http://localhost:9999/hook',
      fetchImpl: fakeFetch as typeof fetch,
    };
    await host.load(exampleBridgePlugin, config);

    // Emit a court.finished event
    const session: CourtSession = {
      id: 'cs1',
      subjectId: 's1',
      startedAt: '2026-01-01T00:00:00Z',
      transcript: [],
    };
    events.emit('court.finished', session);

    // Wait for the async fire-and-forget
    await new Promise((r) => setTimeout(r, 50));

    expect(posted).toHaveLength(1);
    expect((posted[0] as Record<string, unknown>).url).toBe('http://localhost:9999/hook');
    const body = (posted[0] as Record<string, unknown>).body as Record<string, unknown>;
    expect(body.event).toBe('court.finished');
    expect(body.subjectId).toBe('s1');
  });

  it('unloading removes the event listener', async () => {
    store = new Store();
    const events = new EventBus();
    const host = new PluginHost(events);
    host.providePreset('store', store);

    const config: BridgeConfig = {
      webhookUrl: 'http://localhost:9999/hook',
      fetchImpl: async () => new Response('ok'),
    };
    await host.load(exampleBridgePlugin, config);
    expect(events.listenerCount('court.finished')).toBe(1);

    await host.unload('example-bridge');
    expect(events.listenerCount('court.finished')).toBe(0);
  });
});
