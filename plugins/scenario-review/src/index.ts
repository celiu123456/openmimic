/**
 * scenario-review: a "review meeting" room scenario.
 *
 * Witnesses discuss the subject as if in a performance review or retrospective.
 * The topic seed and hints guide the LLM to adopt a review tone.
 */
import type { Plugin } from '@openmimic/kernel';

export const scenarioReviewPlugin: Plugin = {
  name: 'scenario-review',
  kind: 'scenario',
  version: '0.0.1',
  apply(ctx) {
    ctx.scenarios.register('review', {
      id: 'review',
      label: 'Review Meeting',
      topicSeed: 'If you had to give TA a performance review, what would you say?',
      behindHints: 'You are in a private review meeting about TA. Be candid and specific, mention concrete examples. Focus on growth areas and strengths you have directly observed.',
      frontHints: 'TA just walked into the review meeting. Deliver your feedback directly to them, staying honest but constructive.',
    });
  },
};
