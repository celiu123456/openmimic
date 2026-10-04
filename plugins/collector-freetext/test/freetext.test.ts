import { describe, expect, it, afterEach } from 'vitest';
import { EventBus, PluginHost, Store } from '@openmimic/kernel';
import { witnessPlugin } from '@openmimic/engine-witness';
import { Router } from '@openmimic/server';
import { collectorFreetextPlugin } from '@openmimic/collector-freetext';

describe('collector-freetext plugin', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  it('registers a freetext collector and adds the /freetext route', async () => {
    store = new Store();
    store.putSubject({ id: 's1', displayName: 'Test' });

    const events = new EventBus();
    const host = new PluginHost(events);
    const router = new Router();
    host.providePreset('store', store);
    host.providePreset('router', router);

    await host.load(witnessPlugin);
    await host.load(collectorFreetextPlugin);

    // The collector should be registered
    expect(host.collectors.get('freetext')).toBeDefined();
    expect(host.collectors.get('freetext')!.label).toBe('Freetext');

    // The route should be registered
    const match = router.match('POST', '/api/invites/abc/freetext');
    expect(match).toBeDefined();
  });

  it('submits freetext testimony through the route', async () => {
    store = new Store();
    store.putSubject({ id: 's1', displayName: 'Test' });

    const events = new EventBus();
    const host = new PluginHost(events);
    const router = new Router();
    host.providePreset('store', store);
    host.providePreset('router', router);

    await host.load(witnessPlugin);
    await host.load(collectorFreetextPlugin);

    // Create an invite
    const witness = host.getService<import('@openmimic/engine-witness').WitnessCollector>('witness');
    const invite = witness.createInvite('s1');

    // Find and call the route handler
    const match = router.match('POST', `/api/invites/${invite.token}/freetext`);
    expect(match).toBeDefined();

    const result = await match!.handler({
      params: { token: invite.token },
      query: new URLSearchParams(),
      body: {
        text: 'She is very generous and always pays for everyone.',
        relation: 'friend',
        consentLevel: 'quotable',
      },
    });
    expect('status' in result && result.status).toBe(201);

    // Verify testimony was recorded
    const testimonies = store.listBySubject('s1');
    expect(testimonies).toHaveLength(1);
    expect(testimonies[0]!.answers[0]!.qid).toBe('freetext');
    expect(testimonies[0]!.answers[0]!.behindText).toContain('generous');
  });
});
