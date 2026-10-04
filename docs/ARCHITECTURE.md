# Architecture

## Microkernel: everything is a plugin

The kernel (`kernel/src/`) owns four things and nothing else:

1. **Testimony ledger** (`store.ts`) -- append-only SQLite. Triggers block UPDATE/DELETE on the testimonies table.
2. **Persona assembly** (`persona.ts`) -- reads surviving claims, episodes, divergences, and corpus from the store; outputs a system prompt.
3. **Plugin host** (`plugin-host.ts`) -- loads/unloads plugins, resolves inject dependencies via topological sort, provides the `Context` wiring.
4. **Consent gate** (`gate.ts`) -- `synthesis_only` witnesses' raw text replaced with `[withheld]` in external scope.

Official engines (court, room, witness) are standard `Plugin` objects. They go through the same `PluginHost.load()` path as any third-party plugin. There is no privileged backdoor -- a third-party plugin providing a service named `court` replaces the official court engine.

## Plugin protocol

```ts
interface Plugin<Config = unknown> {
  name: string;
  kind: 'engine' | 'collector' | 'scenario' | 'bridge' | 'mount';
  version?: string;
  inject?: string[];   // service names this plugin requires
  apply(ctx: Context, config: Config): void | Dispose | Promise<void | Dispose>;
}
```

`apply` is called once. The plugin receives a `Context` with:

- `provide(name, service)` / `get(name)` / `has(name)` -- service registry
- `on(event, handler)` / `emit(event, payload)` -- event bus
- `collectors` / `scenarios` -- typed `Registry<T>` extension points

## Dependency resolution

`PluginHost.loadAll()` performs a topological sort (Kahn's algorithm) on the inject graph. A cycle raises `CyclicDependencyError`. A missing dependency raises `MissingServiceError` with the missing service name.

Preset services (store, events, router, llm) are provided before plugins load and satisfy inject requirements without appearing in the sort.

## Plugin kinds

### Engines (kind: 'engine')

Core processing pipelines. Each provides a named service:

| Plugin | Provides | Inject |
|--------|----------|--------|
| `witnessPlugin` | `witness` (WitnessCollector) | store |
| `courtPlugin` | `court` (CourtEngine) | store, llm |
| `roomPlugin` | `room` (RoomEngine) | store, llm |

### Collectors (kind: 'collector')

Extend evidence gathering. Register in `ctx.collectors`:

- **collector-freetext**: adds `POST /api/invites/:token/freetext` for free-form text testimony

### Scenarios (kind: 'scenario')

Room topic presets. Register in `ctx.scenarios`:

- **scenario-review**: "review meeting" scenario with topic seed and hints

### Bridges (kind: 'bridge')

Sync data to external systems via events:

- **example-bridge**: listens `court.finished`, POSTs persona context to a webhook URL

### Mounts (kind: 'mount')

Expose capabilities through external surfaces:

| Plugin | Surface |
|--------|---------|
| `mountRestPlugin` | `/api/*` HTTP routes |
| `mountOpenaiPlugin` | `/v1/models`, `/v1/chat/completions` |
| `mountMcpPlugin` | MCP JSON-RPC dispatch over stdio |

Mount plugins inject `router` and register route handlers. The server's HTTP listener dispatches to the Router.

## Configuration

Three layers, merged in order:

1. `openmimic.yml` (committed defaults)
2. `openmimic.local.yml` (gitignored, per-developer overrides)
3. `OPENMIMIC_CONFIG` environment variable (JSON string)

Plugin entries are merged by their `use` key. Setting `enabled: false` removes a plugin from the active set. Each entry may carry a `config` object passed to `apply`.

## Embeddable usage

`@openmimic/core` provides `createOpenMimic()`:

```ts
const om = await createOpenMimic({
  dbPath: ':memory:',
  llm: myLLMClient,
  plugins: [witnessPlugin, courtPlugin],
});
// Use services directly -- no HTTP server started
const court = om.get<CourtEngine>('court');
await court.runCourt(subjectId);
await om.dispose(); // reverse-order teardown, closes DB
```

## Directory layout

```
kernel/           microkernel (store, persona, plugin-host, gate, config)
engines/
  court/          CourtEngine plugin (filing, pairing, relation, conviction)
  room/           RoomEngine plugin (behind/front dual-mode rooms)
  witness/        WitnessEngine plugin (testimony collection, invites, interview)
  graph/          (planned) GraphEngine
  gate/           (planned) GateEngine as independent engine
server/           HTTP server, mount-rest, mount-openai, mount-mcp
web/              browser client
shared/           Zod schemas, types
plugins/
  collector-freetext/   freetext testimony collector
  scenario-review/      review meeting scenario
  example-bridge/       webhook bridge (court.finished → POST)
packages/
  core/           @openmimic/core (createOpenMimic, embeddable entry point)
examples/
  embed-as-library/     30-line example using @openmimic/core
fixtures/         demo data (limo.ts)
scripts/          CLI tools (real-smoke, config-dump)
docs/             documentation
```

## Event flow

```
testimony submitted
  → WitnessEngine stores in ledger
  → events.emit('testimony.added', { witnessId, subjectId })

court requested
  → CourtEngine runs 4-stage pipeline
    filing → pairing → relation judgment → conviction
  → events.emit('court.finished', session)
  → bridges react (e.g. example-bridge POSTs to webhook)

room opened
  → RoomEngine assembles persona prompts
  → behind mode: witnesses discuss subject
  → openDoor: subject enters, tone shifts
```
