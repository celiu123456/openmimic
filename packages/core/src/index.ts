/**
 * @openmimic/core — embeddable entry point.
 *
 * ```ts
 * const om = await createOpenMimic({
 *   dbPath: ':memory:',
 *   llm,
 *   plugins: [witnessPlugin, courtPlugin],
 * });
 * om.get('court').runCourt(subjectId);
 * await om.dispose();
 * ```
 *
 * No port is opened. No mount plugin is loaded. The caller decides what
 * capabilities to assemble.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  EventBus,
  PluginHost,
  Store,
  type Plugin,
  type EmbeddingClient,
} from '@openmimic/kernel';
import type { LLMClient } from '@openmimic/engine-court';

export interface CreateOpenMimicOptions {
  /** SQLite path. Defaults to ':memory:'. */
  dbPath?: string;
  /** LLM client. When omitted, engines that need an LLM cannot be loaded. */
  llm?: LLMClient;
  /** Embedding client (optional). */
  embedding?: EmbeddingClient;
  /** Plugins to load. Order is resolved by inject dependencies. */
  plugins?: Plugin[];
}

export interface OpenMimicInstance {
  /** Retrieve a service by name. */
  get<T>(name: string): T;
  /** Check whether a service is available. */
  has(name: string): boolean;
  /** The underlying store. */
  readonly store: Store;
  /** The plugin host. */
  readonly host: PluginHost;
  /** Reverse-order dispose of all plugins and close the store. */
  dispose(): Promise<void>;
}

/**
 * Create an embeddable OpenMimic instance. No HTTP server is started; no
 * port is bound. The caller passes only the plugins they need.
 */
export async function createOpenMimic(
  options: CreateOpenMimicOptions = {},
): Promise<OpenMimicInstance> {
  const dbPath = options.dbPath ?? ':memory:';
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const store = new Store({ path: dbPath });
  const events = new EventBus();
  const host = new PluginHost(events);

  // Kernel preset services
  host.providePreset('store', store);
  host.providePreset('events', events);
  if (options.llm) host.providePreset('llm', options.llm);
  if (options.embedding) host.providePreset('embedding', options.embedding);

  // Load plugins in dependency order
  if (options.plugins && options.plugins.length > 0) {
    await host.loadAll(options.plugins.map((plugin) => ({ plugin })));
  }

  return {
    get<T>(name: string): T {
      return host.getService<T>(name);
    },
    has(name: string): boolean {
      return host.hasService(name);
    },
    store,
    host,
    async dispose() {
      await host.disposeAll();
      store.close();
    },
  };
}

// Re-export commonly used types for convenience
export { witnessPlugin } from '@openmimic/engine-witness';
export { courtPlugin } from '@openmimic/engine-court';
export { roomPlugin } from '@openmimic/engine-room';
export type { LLMClient } from '@openmimic/engine-court';
export type { Store, Plugin, EmbeddingClient } from '@openmimic/kernel';
