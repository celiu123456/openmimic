import { describe, expect, it } from 'vitest';
import { PluginHost, PluginRegistrationError } from '@openmimic/kernel';

interface TestContext {
  engines: Record<string, unknown>;
}

describe('PluginHost', () => {
  it('runs plugin setup with the shared context and records the manifest', async () => {
    const context: TestContext = { engines: {} };
    const host = new PluginHost<TestContext>(context);

    await host.register({ name: 'demo', kind: 'collector' }, (ctx) => {
      ctx.engines.demo = { ready: true };
    });

    expect(host.has('demo')).toBe(true);
    expect(host.get('demo')?.kind).toBe('collector');
    expect(context.engines.demo).toEqual({ ready: true });
    expect(host.list()).toHaveLength(1);
  });

  it('rejects duplicate registration', async () => {
    const host = new PluginHost<TestContext>({ engines: {} });
    await host.register({ name: 'demo', kind: 'engine' }, () => {});

    await expect(host.register({ name: 'demo', kind: 'engine' }, () => {})).rejects.toThrow(
      PluginRegistrationError,
    );
  });

  it('rejects a manifest with an empty name', async () => {
    const host = new PluginHost<TestContext>({ engines: {} });
    await expect(host.register({ name: '', kind: 'engine' }, () => {})).rejects.toThrow();
    expect(host.list()).toEqual([]);
  });
});
