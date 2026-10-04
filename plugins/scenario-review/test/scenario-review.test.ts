import { describe, expect, it } from 'vitest';
import { EventBus, PluginHost } from '@openmimic/kernel';
import { scenarioReviewPlugin } from '@openmimic/scenario-review';

describe('scenario-review plugin', () => {
  it('registers the review scenario', async () => {
    const host = new PluginHost(new EventBus());
    await host.load(scenarioReviewPlugin);

    const scenario = host.scenarios.get('review');
    expect(scenario).toBeDefined();
    expect(scenario!.id).toBe('review');
    expect(scenario!.label).toBe('Review Meeting');
    expect(scenario!.topicSeed).toContain('performance review');
    expect(scenario!.behindHints).toBeDefined();
    expect(scenario!.frontHints).toBeDefined();
  });

  it('unloading removes the scenario', async () => {
    const host = new PluginHost(new EventBus());
    await host.load(scenarioReviewPlugin);
    expect(host.scenarios.list()).toHaveLength(1);

    await host.unload('scenario-review');
    expect(host.scenarios.list()).toHaveLength(0);
  });
});
