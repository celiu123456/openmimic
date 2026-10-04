/**
 * example-bridge: minimal bridge plugin template.
 *
 * Listens for `court.finished` events and POSTs the assembled persona context
 * to a configured webhook URL. This is the starting point for community bridge
 * plugins that sync persona data to external systems.
 */
import { assemblePersonaContext, type Store, type Plugin } from '@openmimic/kernel';

export interface BridgeConfig {
  /** URL to POST the persona context to. */
  webhookUrl: string;
  /** Optional fetch implementation for testing. */
  fetchImpl?: typeof fetch;
}

export const exampleBridgePlugin: Plugin<BridgeConfig> = {
  name: 'example-bridge',
  kind: 'bridge',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx, config) {
    if (!config?.webhookUrl) return;

    const store = ctx.get<Store>('store');
    const doFetch = config.fetchImpl ?? fetch;

    const unsub = ctx.on('court.finished', (session) => {
      // Fire and forget: bridge errors must not break the main pipeline.
      void (async () => {
        try {
          const persona = await assemblePersonaContext(session.subjectId, store);
          await doFetch(config.webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              event: 'court.finished',
              subjectId: session.subjectId,
              sessionId: session.id,
              systemPrompt: persona.systemPrompt,
              meta: persona.meta,
            }),
          });
        } catch {
          // Bridge errors are swallowed: a downstream failure must never
          // break the court pipeline.
        }
      })();
    });

    return unsub;
  },
};
