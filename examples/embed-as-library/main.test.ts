import { describe, expect, it } from 'vitest';
import { run } from './main';

describe('embed-as-library example', () => {
  it('produces a persona prompt without starting any server', async () => {
    const prompt = await run();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
    // The prompt should mention the subject or contain assembled claims
    expect(prompt).toContain('Alice');
  });
});
