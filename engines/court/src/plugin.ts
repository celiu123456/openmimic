import type { PluginHost, Store } from '@openmimic/kernel';
import type { CourtSession } from '@openmimic/shared';
import type { ConflictFinder } from './conflict';
import { runCourt, type RunCourtOptions } from './court';
import type { LLMClient } from './llm';

/**
 * Official CourtEngine manifest. It is registered through the very same
 * {@link PluginHost} path third-party plugins use — there is no privileged
 * engine backdoor.
 */
export const COURT_ENGINE_MANIFEST = {
  name: 'court',
  kind: 'engine',
  version: '0.0.1',
  description: 'Adversarial cross-examination court',
} as const;

/** Shared context the kernel hands to every plugin. */
export interface CourtEngineContext {
  store: Store;
  llm: LLMClient;
  engines: Record<string, unknown>;
  conflictFinder?: ConflictFinder;
}

/** The CourtEngine as exposed to embedders once assembled. */
export interface CourtEngine {
  runCourt(subjectId: string, options?: RunCourtOptions): Promise<CourtSession>;
}

/** Register the official CourtEngine with a plugin host. */
export async function registerCourtEngine(
  host: PluginHost<CourtEngineContext>,
): Promise<void> {
  await host.register(COURT_ENGINE_MANIFEST, (context) => {
    const engine: CourtEngine = {
      runCourt: (subjectId, options = {}) =>
        runCourt(subjectId, context.store, context.llm, {
          conflictFinder: context.conflictFinder,
          ...options,
        }),
    };
    context.engines[COURT_ENGINE_MANIFEST.name] = engine;
  });
}
