# OpenMimic Plugin Guide

## Plugin protocol

Every capability in OpenMimic is a plugin. A plugin implements this interface:

```ts
interface Plugin<Config = unknown> {
  name: string;
  kind: 'engine' | 'collector' | 'scenario' | 'bridge' | 'mount';
  version?: string;
  inject?: string[];
  apply(ctx: Context, config: Config): void | Dispose | Promise<void | Dispose>;
}
```

- **name**: unique identifier; the topo sort uses it to resolve dependencies.
- **kind**: one of five roles (see below).
- **inject**: service names this plugin requires. PluginHost checks all are provided before calling `apply`.
- **apply**: called once at load time. Receives a `Context` and optional config. May return a dispose callback.

## Five kinds

| Kind | Purpose | Example |
|------|---------|---------|
| `engine` | Core processing pipeline | court, room |
| `collector` | Gathers evidence | witness (questionnaire), collector-freetext |
| `scenario` | Room scenario (topic + hints) | scenario-review |
| `bridge` | Syncs data to external systems | example-bridge (webhook) |
| `mount` | Exposes an external surface | mount-rest (HTTP), mount-openai (/v1), mount-mcp |

## Context

The `Context` object is the plugin's view of the kernel:

```ts
interface Context {
  provide<T>(name: string, service: T): void;  // register a service
  get<T>(name: string): T;                     // retrieve a service (throws if missing)
  has(name: string): boolean;                  // check availability
  on(event, handler): Unsubscribe;             // listen to kernel events
  emit(event, payload): void;                  // fire a kernel event
  collectors: Registry<Collector>;             // collector extension point
  scenarios: Registry<Scenario>;               // scenario extension point
}
```

## Extension points

### Collectors

Register with `ctx.collectors.register(id, collector)`:

```ts
interface Collector {
  id: string;
  label: string;
  describe(): string;
  submit(input: unknown, ctx: unknown): Promise<unknown>;
}
```

### Scenarios

Register with `ctx.scenarios.register(id, scenario)`:

```ts
interface Scenario {
  id: string;
  label: string;
  topicSeed: string;
  behindHints?: string;
  frontHints?: string;
}
```

Room creation accepts an optional `scenarioId`; mount-rest resolves it to a topicSeed.

## Writing a scenario plugin from scratch

Here is a complete scenario plugin:

```ts
// plugins/scenario-debate/src/index.ts
import type { Plugin } from '@openmimic/kernel';

export const scenarioDebatePlugin: Plugin = {
  name: 'scenario-debate',
  kind: 'scenario',
  version: '0.0.1',
  apply(ctx) {
    ctx.scenarios.register('debate', {
      id: 'debate',
      label: 'Friendly Debate',
      topicSeed: 'If you had to argue TA is wrong about something, what would it be?',
      behindHints: 'You are in a friendly debate. Challenge one thing about TA with a specific example.',
    });
  },
};
```

Create a `package.json`:

```json
{
  "name": "@yourorg/scenario-debate",
  "version": "0.0.1",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@openmimic/kernel": "*" }
}
```

Add it to `openmimic.yml`:

```yaml
plugins:
  - use: "./plugins/scenario-debate"
```

## Dependency injection

Plugins declare dependencies via `inject`. The kernel resolves them before calling `apply`:

```ts
export const myPlugin: Plugin = {
  name: 'my-analyzer',
  kind: 'engine',
  inject: ['store', 'court'],
  apply(ctx) {
    const store = ctx.get<Store>('store');
    const court = ctx.get<CourtEngine>('court');
    // Use store and court...
  },
};
```

If `court` is not loaded, `PluginHost.load` throws `MissingServiceError` with a message naming the missing service. `loadAll` performs a topological sort so order in the config does not matter.

## Configuration

Each plugin entry in `openmimic.yml` may carry a `config` object:

```yaml
plugins:
  - use: "@openmimic/engine-court"
    config: { pairThreshold: 0.55 }
```

The `config` is passed as the second argument to `apply`. Disable a plugin in a local overlay:

```yaml
# openmimic.local.yml
plugins:
  - use: "@openmimic/mount-mcp"
    enabled: false
```

## Plugin storage

Plugins can persist their own data using sandboxed SQLite tables. The kernel
provides `store.registerPluginTable()` which creates a table with a forced
prefix (`plugin_<pluginName>_<suffix>`) and returns a `PluginTableHandle`:

```ts
const table = store.registerPluginTable(
  'my-plugin', 'records',
  `CREATE TABLE IF NOT EXISTS plugin_my-plugin_records (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  { appendOnly: true },  // optional; disables update/delete
);

// Insert (always available)
table.insert({ id: 'r1', data: '...', created_at: new Date().toISOString() });

// Query
const rows = table.query('id = ?', ['r1']);

// Update / delete (only when appendOnly is false)
table.update({ data: 'new' }, 'id = ?', ['r1']);
table.delete('id = ?', ['r1']);
```

Guardrails:
- Table names are forced to `plugin_<name>_<suffix>` — a plugin cannot reach
  the testimony ledger or any core table.
- The DDL must reference the correct prefixed table name, or registration throws.
- `appendOnly: true` disables `update()` and `delete()` at the API level,
  guaranteeing immutability (used by meta-perception predictions).

## Output biography plugin

The `output-biography` plugin generates a short biography of the subject
written from friends' testimonies. It draws material from testimony answers
and episodes, groups them into chapters, and validates every quoted sentence
against a whitelist of verbatim excerpts.

**Routes:**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/subjects/:id/biography` | Generate biography (requires LLM) |
| `GET` | `/api/subjects/:id/biography` | Retrieve generated biography |
| `POST` | `/api/biography/:id/sections/:sid/remove` | Subject vetoes a section |

**Key rules:**

- Quotation marks may only contain verbatim text from `quotable` witnesses.
  The plugin validates every quoted string against the quotable index and
  rejects the chapter if any quote cannot be traced.
- `synthesis_only` witnesses' raw text (8+ consecutive characters) must not
  appear in the output. A leakage check runs after generation.
- Contested or retired claims' testimony evidence is excluded from material.
- The subject can remove any section; the data is not deleted, only flagged,
  and a fixed note replaces the content in the API output.
- When the `silence-signal` plugin is active and signals exist, a deterministic
  silence paragraph is appended (fixed text, no model involved).
- The final chapter contains only the subject's own words from the corpus.
  If no corpus exists, a fixed placeholder is shown.

**Writing approach (v0.2.0):**

- **Narrative weaving**: chapters use third-person observer narration that
  summarizes, juxtaposes, and organizes testimony. Direct quotes are used
  sparingly (target 15-35% of text), embedded naturally in narrative paragraphs.
- **S1 arc profile**: before chapter generation, one LLM call extracts
  character threads and speech patterns as a unified reference.
- **S4 polish**: after all chapters, one LLM call produces local find/replace
  patches (unified phrasing, de-duplicated sentence patterns).
- **Three styles**: third-person observer (default), letter to subject
  (second person, requires authorization), interview transcript (quotes primary).

**Quality review** checks guard-rail dimensions (omniscient narrator, speculative
language, sensitive terms, over-praise, duplication, language match, material
overlap) plus structural metrics with pass/fail + issue list:
- Quote ratio (target 15-35%)
- Consecutive "X said" pattern runs (max 2 consecutive)
- Witness coverage per chapter
- Juxtaposition count (side-by-side differing views)
- Unsupported detail count (must be 0, checked for narrative sentences too)

**Config (in `openmimic.yml`):**

```yaml
plugins:
  - use: "./plugins/output-biography"
    config:
      minWitnesses: 3       # minimum witnesses to generate
      qualityThreshold: 75  # below this score => requires rewrite
```

## Chat log import plugin

The `collector-chatlog` plugin imports chat exports (WeChat text, CSV, JSON)
into the subject's corpus. It parses messages, identifies senders, and stores
only the designated person's own words.

**Routes:**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/subjects/:id/chatlog/preview` | Parse and preview (no DB writes) |
| `POST` | `/api/subjects/:id/chatlog/import` | Import to corpus with sender attribution |
| `GET` | `/api/subjects/:id/chatlog/imports` | List past imports |
| `DELETE` | `/api/subjects/:id/chatlog/imports/:importId` | Undo an import |

**Key rules:**

- The raw file never touches disk; all parsing happens in memory.
- Only the subject's own words enter the corpus (source='imported').
- PII is anonymized, injection is flagged, reflux is excluded.
- Imported records are used for mimicking speech style only, not as facts.
- Consecutive short messages stay as separate items (rhythm is style data).
- Deduplication collapses identical text, counting occurrences as catchphrase signals.
- When over the item limit (default 500), uniform time-based sampling keeps
  temporal diversity instead of recency bias.

**Config:**

```yaml
plugins:
  - use: "./plugins/collector-chatlog"
    config:
      maxSizeBytes: 5242880   # 5 MB default
      maxItems: 500           # per-import corpus item cap
      maxLength: 120          # max chars per item
```

See `docs/chatlog-import.md` for format details and examples.

## Route scope declarations

When a plugin registers HTTP routes via the `router`, it should declare
the required scope for each route:

```ts
import type { Router } from '@openmimic/server';

// In your plugin's apply():
const router = ctx.get<Router>('router');

// Declare the required scope as the third argument
router.get('/api/my-data', handler, { scope: 'persona.read' });
router.post('/api/my-action', handler, { scope: 'admin' });

// Open routes (no auth required)
router.get('/api/my-public', handler, { open: true });
```

**Fail-closed default**: routes without a scope declaration require `admin`.
This means your plugin's routes are safe by default -- they will only be
accessible to the admin token until you explicitly declare a more permissive
scope.

Available scopes: `persona.chat`, `persona.read`, `testimony.read`,
`testimony.write`, `court.run`, `room.run`, `room.read`, `export`, `admin`.
See `docs/AUTH.md` for the full scope table.

## Capability declarations

Plugins may declare capabilities in their manifest for the capability
directory (`GET /api/capabilities`). This is optional but recommended for
plugins that add user-facing features:

```ts
import type { CapabilityDeclaration } from '@openmimic/server';

// Declare capabilities alongside your routes
const MY_CAPABILITIES: CapabilityDeclaration[] = [
  {
    id: 'my-plugin.analyze',
    description: 'Run analysis on a subject.',
    requiredScope: 'admin',
    route: 'POST /api/subjects/:id/analyze',
    idempotent: false,
    errorCodes: ['unauthorized', 'forbidden_scope'],
  },
];
```

The capability directory is publicly readable and contains only the catalog
(no data). It helps API consumers discover what an instance can do.
## SillyTavern bridge plugin

The `bridge-sillytavern` plugin converts between OpenMimic personas and
SillyTavern Character Card V2. It is a standard `bridge` plugin.

**Routes (admin-gated):**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/subjects/:id/export/character-card?format=json\|png` | Export persona as V2 card |
| `POST` | `/api/import/character-card` | Import V2 card (JSON or PNG body) |

**Key design decisions:**

- **Privacy**: synthesis_only text is withheld; private-marker content is
  filtered; witness names travel as relation labels only (no name hints).
- **Real-person gate**: exporting a native (non-imported) subject requires
  `acknowledgeRealPerson=true`.
- **Import safety**: all imported text passes through `detectInjection()`
  and `sanitizeDelimiters()`. Nothing enters the testimony ledger; claims
  use a synthetic court session with conviction 0.5.
- **Round-trip**: `extensions.openmimic` carries structured data so an
  exported card re-imports without loss.
- **Zero new dependencies**: PNG tEXt chunk I/O and CRC32 are implemented
  from scratch using `node:zlib` and `Buffer`.

See `integrations/sillytavern/README.md` for usage instructions.

## Graph engine plugin

The `graph` plugin (`engines/graph/`) is an event-driven incremental recompute
engine. It tracks which court outputs (claims, episodes, divergences) depend on
which testimonies, and marks affected parts as dirty when input changes.

**Service provided**: `graph` (GraphEngine)

**Events listened**:

| Event | Handler |
|-------|---------|
| `testimony.added` | Marks dirty (scoped to affected witness's claims) |
| `court.finished` | Records dependency edges and persona version snapshot |

The plugin also reacts to claim.contested / claim.uncontested when wired
through the gate engine's contest/uncontest routes.

**Events emitted**:

| Event | When |
|-------|------|
| `graph.dirty` | A dirty mark is created |
| `graph.recomputed` | A recompute finishes |
| `graph.auto_trigger` | Auto-trigger timer fires (auto mode only) |

**Routes**:

| Method | Path | Scope | Purpose |
|--------|------|-------|---------|
| `GET` | `/api/subjects/:id/graph` | `testimony.read` | Dependency and version overview |
| `POST` | `/api/subjects/:id/graph/recompute` | `court.run` | Trigger manual recompute |

**Config (in `openmimic.yml`)**:

```yaml
plugins:
  - use: "./engines/graph"
    config:
      triggerMode: manual    # 'manual' (default) or 'auto'
      quietPeriodMs: 30000   # quiet period before auto-trigger (ms)
      dailyLimit: 5          # max auto-recomputes per subject per day
```

**Non-determinism**: court output has ~47% overlap between identical runs.
The graph engine handles this via 3-pass claim matching (exact text, bigram
Jaccard >= 0.5, optional LLM semantic). Claims are classified as retained,
merged (similar text), added (new), or retired (gone).

## Unloading

`PluginHost.unload(name)` runs the dispose callback, removes provided services, collector/scenario registrations, and event listeners. It refuses to unload a plugin if another loaded plugin depends on one of its services.
