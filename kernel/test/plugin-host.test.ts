import { describe, expect, it } from 'vitest';
import {
  EventBus,
  PluginHost,
  PluginRegistrationError,
  MissingServiceError,
  CyclicDependencyError,
  type Plugin,
} from '@openmimic/kernel';

function createHost(): PluginHost {
  return new PluginHost(new EventBus());
}

describe('PluginHost', () => {
  it('runs plugin setup with the shared context and records the manifest', async () => {
    const host = createHost();

    await host.register({ name: 'demo', kind: 'collector' }, (ctx) => {
      (ctx as Record<string, unknown>).demo = { ready: true };
    });

    expect(host.has('demo')).toBe(true);
    expect(host.get('demo')?.kind).toBe('collector');
    expect(host.list()).toHaveLength(1);
  });

  it('rejects duplicate registration', async () => {
    const host = createHost();
    await host.register({ name: 'demo', kind: 'engine' }, () => {});

    await expect(host.register({ name: 'demo', kind: 'engine' }, () => {})).rejects.toThrow(
      PluginRegistrationError,
    );
  });

  it('rejects a manifest with an empty name', async () => {
    const host = createHost();
    await expect(host.register({ name: '', kind: 'engine' }, () => {})).rejects.toThrow();
    expect(host.list()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* New v1 protocol tests                                               */
/* ------------------------------------------------------------------ */

describe('PluginHost v1: load / inject / provide', () => {
  it('loads a plugin that provides a service', async () => {
    const host = createHost();
    const plugin: Plugin = {
      name: 'adder',
      kind: 'engine',
      apply(ctx) {
        ctx.provide('math', { add: (a: number, b: number) => a + b });
      },
    };
    await host.load(plugin);
    expect(host.has('adder')).toBe(true);
    expect(host.getService<{ add: (a: number, b: number) => number }>('math').add(1, 2)).toBe(3);
  });

  it('loads a plugin that injects a pre-existing service', async () => {
    const host = createHost();
    host.providePreset('store', { name: 'test-store' });
    let captured: unknown;
    const plugin: Plugin = {
      name: 'reader',
      kind: 'engine',
      inject: ['store'],
      apply(ctx) {
        captured = ctx.get('store');
      },
    };
    await host.load(plugin);
    expect(captured).toEqual({ name: 'test-store' });
  });

  it('throws MissingServiceError when inject is unsatisfied', async () => {
    const host = createHost();
    const plugin: Plugin = {
      name: 'needy',
      kind: 'engine',
      inject: ['nonexistent'],
      apply() {},
    };
    await expect(host.load(plugin)).rejects.toThrow(MissingServiceError);
    await expect(host.load(plugin)).rejects.toThrow(/needy.*nonexistent/);
  });

  it('rejects duplicate service provision', async () => {
    const host = createHost();
    host.providePreset('svc', 1);
    const plugin: Plugin = {
      name: 'dup',
      kind: 'engine',
      apply(ctx) {
        ctx.provide('svc', 2); // conflict
      },
    };
    await expect(host.load(plugin)).rejects.toThrow(PluginRegistrationError);
  });
});

describe('PluginHost v1: loadAll with topo sort', () => {
  it('resolves dependency order automatically', async () => {
    const host = createHost();
    host.providePreset('store', {});
    const order: string[] = [];
    const a: Plugin = {
      name: 'a',
      kind: 'engine',
      inject: ['b'],
      apply() { order.push('a'); },
    };
    const b: Plugin = {
      name: 'b',
      kind: 'engine',
      inject: ['store'],
      apply(ctx) {
        ctx.provide('b', true);
        order.push('b');
      },
    };
    // Pass in reverse order — topo sort should fix it
    await host.loadAll([{ plugin: a }, { plugin: b }]);
    expect(order).toEqual(['b', 'a']);
  });

  it('throws CyclicDependencyError on circular inject', async () => {
    const host = createHost();
    const a: Plugin = { name: 'a', kind: 'engine', inject: ['b'], apply() {} };
    const b: Plugin = { name: 'b', kind: 'engine', inject: ['a'], apply() {} };
    await expect(host.loadAll([{ plugin: a }, { plugin: b }])).rejects.toThrow(
      CyclicDependencyError,
    );
  });

  it('throws when a dependency is not provided by any plugin', async () => {
    const host = createHost();
    const p: Plugin = { name: 'lone', kind: 'engine', inject: ['missing'], apply() {} };
    await expect(host.loadAll([{ plugin: p }])).rejects.toThrow(MissingServiceError);
  });
});

describe('PluginHost v1: unload', () => {
  it('removes services, registrations and event listeners', async () => {
    const events = new EventBus();
    const host = new PluginHost(events);
    let disposed = false;
    const plugin: Plugin = {
      name: 'removable',
      kind: 'engine',
      apply(ctx) {
        ctx.provide('temp', 42);
        ctx.on('testimony.added', () => {});
        return () => { disposed = true; };
      },
    };
    await host.load(plugin);
    expect(host.hasService('temp')).toBe(true);
    expect(events.listenerCount('testimony.added')).toBe(1);

    await host.unload('removable');
    expect(disposed).toBe(true);
    expect(host.has('removable')).toBe(false);
    expect(host.hasService('temp')).toBe(false);
    expect(events.listenerCount('testimony.added')).toBe(0);
  });

  it('refuses to unload a plugin depended on by another', async () => {
    const host = createHost();
    const provider: Plugin = {
      name: 'provider',
      kind: 'engine',
      apply(ctx) { ctx.provide('svc', true); },
    };
    const consumer: Plugin = {
      name: 'consumer',
      kind: 'engine',
      inject: ['svc'],
      apply() {},
    };
    await host.load(provider);
    await host.load(consumer);
    await expect(host.unload('provider')).rejects.toThrow(/consumer.*depends/);
  });

  it('allows unloading once the dependent is removed first', async () => {
    const host = createHost();
    const provider: Plugin = {
      name: 'provider',
      kind: 'engine',
      apply(ctx) { ctx.provide('svc', true); },
    };
    const consumer: Plugin = {
      name: 'consumer',
      kind: 'engine',
      inject: ['svc'],
      apply() {},
    };
    await host.load(provider);
    await host.load(consumer);
    await host.unload('consumer');
    await host.unload('provider');
    expect(host.list()).toHaveLength(0);
  });
});

describe('PluginHost v1: disposeAll', () => {
  it('disposes all plugins in reverse order', async () => {
    const host = createHost();
    const order: string[] = [];
    const a: Plugin = {
      name: 'first',
      kind: 'engine',
      apply() { return () => { order.push('first'); }; },
    };
    const b: Plugin = {
      name: 'second',
      kind: 'engine',
      apply() { return () => { order.push('second'); }; },
    };
    await host.load(a);
    await host.load(b);
    await host.disposeAll();
    expect(order).toEqual(['second', 'first']);
    expect(host.list()).toHaveLength(0);
  });
});

describe('PluginHost v1: extension points', () => {
  it('plugins can register and access scenarios', async () => {
    const host = createHost();
    const plugin: Plugin = {
      name: 'scn',
      kind: 'scenario',
      apply(ctx) {
        ctx.scenarios.register('review', {
          id: 'review',
          label: 'Review',
          topicSeed: 'What do you think?',
        });
      },
    };
    await host.load(plugin);
    expect(host.scenarios.get('review')?.label).toBe('Review');
    expect(host.scenarios.list()).toHaveLength(1);

    await host.unload('scn');
    expect(host.scenarios.list()).toHaveLength(0);
  });
});
