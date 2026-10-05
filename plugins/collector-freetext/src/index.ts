/**
 * collector-freetext: accept a plain text paragraph as a testimony.
 *
 * Registered as a `collector` plugin, this adds:
 * - `POST /api/invites/:token/freetext` (via the shared router)
 * - A collector entry in the registry (id: `freetext`)
 *
 * The freetext is submitted as a single answer with `qid='freetext'`.
 */
import { z } from 'zod';
import type { Plugin, Store, Context } from '@openmimic/kernel';
import type { WitnessCollector } from '@openmimic/engine-witness';
import type { Router } from '@openmimic/server';

const FreetextBodySchema = z.object({
  text: z.string().min(1),
  relation: z.string().min(1),
  consentLevel: z.enum(['quotable', 'synthesis_only']).default('quotable'),
  stance: z.string().optional(),
});

export const collectorFreetextPlugin: Plugin = {
  name: 'collector-freetext',
  kind: 'collector',
  version: '0.0.1',
  inject: ['store', 'witness'],
  apply(ctx) {
    const store = ctx.get<Store>('store');
    const collector = ctx.get<WitnessCollector>('witness');

    // Register HTTP route if router is available
    if (ctx.has('router')) {
      const router = ctx.get<Router>('router');
      router.post('/api/invites/:token/freetext', (context) => {
        const body = FreetextBodySchema.parse(context.body);
        const result = collector.submitTestimony(context.params.token ?? '', {
          relation: body.relation,
          consentLevel: body.consentLevel,
          ...(body.stance ? { stance: body.stance } : {}),
          answers: [{ qid: 'freetext', behindText: body.text }],
        });
        return { status: 201, body: result };
      }, { open: true });
    }

    // Register in collectors registry
    ctx.collectors.register('freetext', {
      id: 'freetext',
      label: 'Freetext',
      describe: () => 'Submit a plain text paragraph as testimony.',
      submit: async (input) => {
        const parsed = FreetextBodySchema.parse(input);
        // This is a simplified path; in practice, the caller would
        // need to provide a valid token.
        return parsed;
      },
    });
  },
};
