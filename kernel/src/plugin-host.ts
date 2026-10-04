import { z } from 'zod';
import {
  CyclicDependencyError,
  MissingServiceError,
  PluginRegistrationError,
} from './errors';
import type { EventBus, KernelEventName, KernelEventHandler, Unsubscribe } from './events';

/* ------------------------------------------------------------------ */
/* Public protocol types                                               */
/* ------------------------------------------------------------------ */

export const PluginKindSchema = z.enum(['engine', 'collector', 'scenario', 'bridge', 'mount']);
export type PluginKind = z.infer<typeof PluginKindSchema>;

/**
 * The return value of {@link Plugin.apply}. When non-void it is called once on
 * {@link PluginHost.unload} to let the plugin clean up.
 */
export type Dispose = () => void | Promise<void>;

/**
 * A plugin is the unit of assembly. Every capability — official engines, mount
 * points, community extensions — is loaded through this one interface.
 */
export interface Plugin<Config = unknown> {
  name: string;
  kind: PluginKind;
  version?: string;
  /** Service names this plugin requires (must be `provide`d before apply). */
  inject?: string[];
  /** Called once at load time. May return a dispose callback. */
  apply(ctx: Context, config: Config): void | Dispose | Promise<void | Dispose>;
}

/* ------------------------------------------------------------------ */
/* Registry: the extension point for collectors and scenarios           */
/* ------------------------------------------------------------------ */

export interface Registry<T> {
  register(id: string, item: T): void;
  get(id: string): T | undefined;
  list(): T[];
  /** @internal — used by unload to remove items registered by a plugin. */
  remove(id: string): boolean;
}

function createRegistry<T>(): Registry<T> {
  const items = new Map<string, T>();
  return {
    register(id, item) {
      if (items.has(id)) {
        throw new PluginRegistrationError(`registry entry already registered: ${id}`);
      }
      items.set(id, item);
    },
    get(id) {
      return items.get(id);
    },
    list() {
      return [...items.values()];
    },
    remove(id) {
      return items.delete(id);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Collector / Scenario value types                                    */
/* ------------------------------------------------------------------ */

export interface Collector {
  id: string;
  label: string;
  describe(): string;
  submit(input: unknown, ctx: unknown): Promise<unknown>;
}

export interface Scenario {
  id: string;
  label: string;
  topicSeed: string;
  behindHints?: string;
  frontHints?: string;
}

/* ------------------------------------------------------------------ */
/* Context: the surface plugins see                                    */
/* ------------------------------------------------------------------ */

export interface Context {
  provide<T>(name: string, service: T): void;
  get<T>(name: string): T;
  has(name: string): boolean;
  on<K extends KernelEventName>(event: K, handler: KernelEventHandler<K>): Unsubscribe;
  emit<K extends KernelEventName>(event: K, payload: Parameters<KernelEventHandler<K>>[0]): void;
  collectors: Registry<Collector>;
  scenarios: Registry<Scenario>;
}

/* ------------------------------------------------------------------ */
/* Legacy manifest (kept for register() compat layer)                  */
/* ------------------------------------------------------------------ */

export const PluginManifestSchema = z.object({
  name: z.string().min(1),
  kind: PluginKindSchema,
  version: z.string().min(1).optional(),
  description: z.string().optional(),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/** Legacy setup callback for the old register() API. */
export type PluginSetup<Ctx extends object> = (
  context: Ctx,
) => void | Promise<void>;

/* ------------------------------------------------------------------ */
/* Internal bookkeeping per loaded plugin                              */
/* ------------------------------------------------------------------ */

interface PluginRecord {
  plugin: Plugin;
  dispose?: Dispose;
  /** Services this plugin provided. */
  providedServices: string[];
  /** Collector IDs this plugin registered. */
  collectorIds: string[];
  /** Scenario IDs this plugin registered. */
  scenarioIds: string[];
  /** Unsub handles for event listeners this plugin installed. */
  eventUnsubs: Unsubscribe[];
}

/* ------------------------------------------------------------------ */
/* PluginHost                                                          */
/* ------------------------------------------------------------------ */

/**
 * Plugin host with service injection, topological loading and unload.
 *
 * Every capability in OpenMimic — including the official engines — is
 * assembled through this one path. There is no privileged registration route,
 * which is what makes "official engines are plugins too" more than a slogan.
 */
export class PluginHost {
  private readonly plugins = new Map<string, PluginRecord>();
  private readonly services = new Map<string, unknown>();
  private readonly events: EventBus;

  readonly collectors: Registry<Collector> = createRegistry();
  readonly scenarios: Registry<Scenario> = createRegistry();

  constructor(events: EventBus) {
    this.events = events;
  }

  /* ---------------------------------------------------------------- */
  /* Service registry                                                  */
  /* ---------------------------------------------------------------- */

  /** Provide a kernel-preset service before any plugin is loaded. */
  providePreset<T>(name: string, service: T): void {
    if (this.services.has(name)) {
      throw new PluginRegistrationError(`service already provided: ${name}`);
    }
    this.services.set(name, service);
  }

  /** Read a service. Throws if not provided. */
  getService<T>(name: string): T {
    if (!this.services.has(name)) {
      throw new MissingServiceError(`service not found: ${name}`);
    }
    return this.services.get(name) as T;
  }

  hasService(name: string): boolean {
    return this.services.has(name);
  }

  /* ---------------------------------------------------------------- */
  /* Context factory — one per plugin load                             */
  /* ---------------------------------------------------------------- */

  private createContext(record: PluginRecord): Context {
    const host = this;

    return {
      provide<T>(name: string, service: T): void {
        if (host.services.has(name)) {
          throw new PluginRegistrationError(
            `service already provided: ${name} (by plugin "${record.plugin.name}")`,
          );
        }
        host.services.set(name, service);
        record.providedServices.push(name);
      },
      get<T>(name: string): T {
        return host.getService<T>(name);
      },
      has(name: string): boolean {
        return host.hasService(name);
      },
      on<K extends KernelEventName>(event: K, handler: KernelEventHandler<K>): Unsubscribe {
        const unsub = host.events.on(event, handler);
        record.eventUnsubs.push(unsub);
        return unsub;
      },
      emit<K extends KernelEventName>(
        event: K,
        payload: Parameters<KernelEventHandler<K>>[0],
      ): void {
        host.events.emit(event, payload);
      },
      collectors: {
        register(id, item) {
          host.collectors.register(id, item);
          record.collectorIds.push(id);
        },
        get: (id) => host.collectors.get(id),
        list: () => host.collectors.list(),
        remove: (id) => host.collectors.remove(id),
      },
      scenarios: {
        register(id, item) {
          host.scenarios.register(id, item);
          record.scenarioIds.push(id);
        },
        get: (id) => host.scenarios.get(id),
        list: () => host.scenarios.list(),
        remove: (id) => host.scenarios.remove(id),
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Load / loadAll / unload                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Load a single plugin. All services in its `inject` list must already be
   * provided or a {@link MissingServiceError} is thrown.
   */
  async load<C>(plugin: Plugin<C>, config?: C): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new PluginRegistrationError(`plugin already loaded: ${plugin.name}`);
    }
    // Validate kind
    PluginKindSchema.parse(plugin.kind);
    if (!plugin.name || plugin.name.length === 0) {
      throw new PluginRegistrationError('plugin name must not be empty');
    }

    // Check inject dependencies
    for (const dep of plugin.inject ?? []) {
      if (!this.services.has(dep)) {
        throw new MissingServiceError(
          `plugin "${plugin.name}" requires service "${dep}" which is not provided`,
        );
      }
    }

    const record: PluginRecord = {
      plugin,
      providedServices: [],
      collectorIds: [],
      scenarioIds: [],
      eventUnsubs: [],
    };
    const ctx = this.createContext(record);
    const result = await plugin.apply(ctx, config as C);
    if (typeof result === 'function') {
      record.dispose = result;
    }
    this.plugins.set(plugin.name, record);
  }

  /**
   * Load an array of plugins in dependency order. Plugins are topologically
   * sorted by their `inject` lists; cycles throw {@link CyclicDependencyError}.
   *
   * Each entry is `{ plugin, config? }`.
   */
  async loadAll(
    list: Array<{ plugin: Plugin; config?: unknown }>,
  ): Promise<void> {
    const sorted = topoSort(list.map((e) => e.plugin), this.services);
    const configMap = new Map(list.map((e) => [e.plugin.name, e.config]));
    for (const plugin of sorted) {
      await this.load(plugin, configMap.get(plugin.name));
    }
  }

  /**
   * Unload a plugin: run its dispose, remove its services, registrations and
   * event listeners. Refuses if another loaded plugin depends on one of its
   * services.
   */
  async unload(name: string): Promise<void> {
    const record = this.plugins.get(name);
    if (!record) {
      throw new PluginRegistrationError(`plugin not loaded: ${name}`);
    }

    // Check: no other loaded plugin depends on services this one provides
    for (const [otherName, otherRecord] of this.plugins) {
      if (otherName === name) continue;
      for (const dep of otherRecord.plugin.inject ?? []) {
        if (record.providedServices.includes(dep)) {
          throw new PluginRegistrationError(
            `cannot unload "${name}": plugin "${otherName}" depends on service "${dep}"`,
          );
        }
      }
    }

    // Run dispose
    if (record.dispose) {
      await record.dispose();
    }

    // Remove services
    for (const svc of record.providedServices) {
      this.services.delete(svc);
    }

    // Remove collector registrations
    for (const id of record.collectorIds) {
      this.collectors.remove(id);
    }

    // Remove scenario registrations
    for (const id of record.scenarioIds) {
      this.scenarios.remove(id);
    }

    // Unsubscribe events
    for (const unsub of record.eventUnsubs) {
      unsub();
    }

    this.plugins.delete(name);
  }

  /* ---------------------------------------------------------------- */
  /* Inspect                                                           */
  /* ---------------------------------------------------------------- */

  list(): PluginManifest[] {
    return [...this.plugins.values()].map((r) => ({
      name: r.plugin.name,
      kind: r.plugin.kind,
      version: r.plugin.version,
    }));
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  get(name: string): PluginManifest | undefined {
    const record = this.plugins.get(name);
    if (!record) return undefined;
    return { name: record.plugin.name, kind: record.plugin.kind, version: record.plugin.version };
  }

  /** Reverse-order dispose of all loaded plugins. */
  async disposeAll(): Promise<void> {
    const names = [...this.plugins.keys()].reverse();
    for (const name of names) {
      const record = this.plugins.get(name);
      if (record?.dispose) {
        await record.dispose();
      }
      // Clean up without dependency checks (full teardown)
      if (record) {
        for (const svc of record.providedServices) this.services.delete(svc);
        for (const id of record.collectorIds) this.collectors.remove(id);
        for (const id of record.scenarioIds) this.scenarios.remove(id);
        for (const unsub of record.eventUnsubs) unsub();
      }
      this.plugins.delete(name);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Backward-compatible register()                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Legacy registration path. Wraps the old (manifest, setup) pair into a
   * Plugin object and loads it.
   *
   * @deprecated Use {@link load} with a proper Plugin object instead.
   */
  async register(
    manifest: PluginManifest,
    setup: (context: Record<string, unknown>) => void | Promise<void>,
  ): Promise<void> {
    const parsed = PluginManifestSchema.parse(manifest);
    const compat: Plugin = {
      name: parsed.name,
      kind: parsed.kind,
      version: parsed.version,
      apply: (ctx) => {
        // Build a flat object from all current services for the legacy callback
        const flat: Record<string, unknown> = {};
        for (const key of ['store', 'events', 'gate', 'llm', 'embedding']) {
          if (ctx.has(key)) flat[key] = ctx.get(key);
        }
        if (!flat.engines) flat.engines = {};
        if (!flat.collectors) flat.collectors = {};
        // When legacy setup does `ctx.engines[name] = engine`, intercept and
        // track the service via provide().
        const engineProxy = new Proxy(flat.engines as Record<string, unknown>, {
          set(_target, prop, value) {
            if (typeof prop === 'string') {
              ctx.provide(prop, value);
              _target[prop] = value;
            }
            return true;
          },
        });
        flat.engines = engineProxy;
        const collectorProxy = new Proxy(flat.collectors as Record<string, unknown>, {
          set(_target, prop, value) {
            if (typeof prop === 'string') {
              ctx.provide(prop, value);
              _target[prop] = value;
            }
            return true;
          },
        });
        flat.collectors = collectorProxy;
        return setup(flat);
      },
    };
    await this.load(compat);
  }
}

/* ------------------------------------------------------------------ */
/* Topological sort                                                    */
/* ------------------------------------------------------------------ */

/**
 * Kahn's algorithm for topological sort. Nodes with all dependencies satisfied
 * by `preExisting` services have no in-edges.
 */
function topoSort(
  plugins: readonly Plugin[],
  preExisting: ReadonlyMap<string, unknown>,
): Plugin[] {
  const byName = new Map<string, Plugin>();
  for (const p of plugins) {
    if (byName.has(p.name)) {
      throw new PluginRegistrationError(`duplicate plugin in loadAll: ${p.name}`);
    }
    byName.set(p.name, p);
  }

  // Build adjacency: for each plugin, which other plugins must come before it?
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // provider → [dependents]

  for (const p of plugins) {
    if (!inDegree.has(p.name)) inDegree.set(p.name, 0);
    for (const dep of p.inject ?? []) {
      if (preExisting.has(dep)) continue; // already available
      if (!byName.has(dep)) {
        throw new MissingServiceError(
          `plugin "${p.name}" requires service "${dep}" which no plugin in the list provides`,
        );
      }
      inDegree.set(p.name, (inDegree.get(p.name) ?? 0) + 1);
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(p.name);
    }
  }

  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }

  const sorted: Plugin[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    sorted.push(byName.get(name)!);
    for (const dependent of dependents.get(name) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (sorted.length < plugins.length) {
    const remaining = plugins
      .filter((p) => !sorted.some((s) => s.name === p.name))
      .map((p) => p.name);
    throw new CyclicDependencyError(
      `cyclic dependency among plugins: ${remaining.join(', ')}`,
    );
  }

  return sorted;
}
