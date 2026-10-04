import type { Plugin, Store } from '@openmimic/kernel';
import type { CourtSession } from '@openmimic/shared';
import type { ConflictFinder } from './conflict';
import { runCourt, type RunCourtOptions } from './court';
import type { LLMClient } from './llm';

/** The CourtEngine as exposed to embedders once assembled. */
export interface CourtEngine {
  runCourt(subjectId: string, options?: RunCourtOptions): Promise<CourtSession>;
}

/** Court plugin config. */
export interface CourtPluginConfig {
  pairThreshold?: number;
  conflictFinder?: ConflictFinder;
}

/**
 * Standard Plugin object for the official CourtEngine.
 *
 * Registered through the same plugin path third-party plugins use — there
 * is no privileged engine backdoor.
 */
export const courtPlugin: Plugin<CourtPluginConfig> = {
  name: 'court',
  kind: 'engine',
  version: '0.0.1',
  inject: ['store', 'llm'],
  apply(ctx, config) {
    const store = ctx.get<Store>('store');
    const llm = ctx.get<LLMClient>('llm');
    const engine: CourtEngine = {
      runCourt: (subjectId, options = {}) =>
        runCourt(subjectId, store, llm, {
          conflictFinder: config?.conflictFinder,
          ...options,
        }),
    };
    ctx.provide('court', engine);
  },
};

/* ------------------------------------------------------------------ */
/* Legacy compat — kept so old code paths continue to compile          */
/* ------------------------------------------------------------------ */

/** @deprecated Use {@link courtPlugin} instead. */
export const COURT_ENGINE_MANIFEST = {
  name: 'court',
  kind: 'engine',
  version: '0.0.1',
  description: 'Adversarial cross-examination court',
} as const;

/** @deprecated */
export interface CourtEngineContext {
  store: Store;
  llm: LLMClient;
  engines: Record<string, unknown>;
  conflictFinder?: ConflictFinder;
}

/** @deprecated Use {@link courtPlugin} instead. */
export async function registerCourtEngine(
  host: { register: (manifest: unknown, setup: (ctx: unknown) => void | Promise<void>) => Promise<void> },
): Promise<void> {
  await host.register(COURT_ENGINE_MANIFEST, (context: unknown) => {
    const ctx = context as CourtEngineContext;
    const engine: CourtEngine = {
      runCourt: (subjectId, options = {}) =>
        runCourt(subjectId, ctx.store, ctx.llm, {
          conflictFinder: ctx.conflictFinder,
          ...options,
        }),
    };
    ctx.engines[COURT_ENGINE_MANIFEST.name] = engine;
  });
}
