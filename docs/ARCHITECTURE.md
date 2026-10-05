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

## Security layer

### Untrusted content isolation (shared/src/prompt/)

All user text (testimony, corpus, episodes, self-report) is wrapped in sanitized data blocks before insertion into LLM prompts:

- `sanitizeDelimiters()` neutralizes forged delimiter tokens in user text
- `wrapUntrusted(label, text)` wraps content in `[EXTERNAL_CONTENT_BEGIN:label]...[EXTERNAL_CONTENT_END:label]` delimiters
- `appendGuardInstruction()` appends a model-level instruction to treat delimited blocks as data, not instructions
- `detectInjection()` scans for prompt injection patterns (Chinese/English instruction overrides, system impersonation, delimiter forgery)

Every prompt constructor across all engines (court, room, witness, persona, meta-perception) wraps user text. A guard test (`shared/test/prompt-guard.test.ts`) scans all prompt-constructing source files to ensure new code follows this pattern.

### AI product reflux detection (kernel/src/reflux.ts)

Detects when testimony copies or paraphrases AI-generated output (room narratives, court claims):

- 3-character shingle MinHash fingerprinting (128 dimensions)
- AI artifacts are fingerprinted at generation time (room behind-transcript, court claims)
- Incoming testimony is screened against registered fingerprints
- High suspicion (verbatim claim match) or low (MinHash >= 0.5) flagged on the testimony record
- Court filing phase skips medium/high reflux testimony

### PII sanitization (shared/src/sanitize.ts)

- `anonymize()` strips phone/email/ID card/bank card/credential patterns
- `maskSensitiveFields()` deep-masks password/token/key fields in objects
- `stableStringify()` + `shortHash()` for deterministic serialization

### Provider error classification (shared/src/provider-error.ts)

Nine error classes (RATE_LIMIT, AUTH_FAILED, QUOTA_EXHAUSTED, TIMEOUT, etc.) with:

- Automatic classification from HTTP status codes and error messages
- Retry-after header parsing
- `isRetryable()` prevents blind retry of non-retryable errors (402/quota, 401/auth)

### Evidence basis classification (engines/witness/src/basis.ts)

Rule-based epistemic basis classifier with fixes for:

- Numeric approximation: "大概/差不多" before numbers is not epistemic hedging
- First-person event narratives: "记得有一次我搬家" classified as witnessed
- Unknown ceiling raised to 0.85 (was 0.6, punished factual statements)

## Directory layout

```
kernel/           microkernel (store, persona, plugin-host, gate, config, reflux)
engines/
  court/          CourtEngine plugin (filing, pairing, relation, conviction)
  room/           RoomEngine plugin (behind/front dual-mode rooms)
  witness/        WitnessEngine plugin (testimony collection, invites, interview, basis,
                  coverage scheduling, short invite codes)
                  Interview strategy migrated from the author's earlier platform project.
  graph/          (planned) GraphEngine
  gate/           (planned) GateEngine as independent engine
server/           HTTP server, mount-rest, mount-openai, mount-mcp
web/              browser client
shared/           Zod schemas, types, prompt isolation, sanitization, provider errors, JSON extraction
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

## Interview subsystem

### Coverage-aware scheduling (engines/witness/src/coverage.ts)

Cross-witness topic coverage tracking, migrated from the author's earlier
elder-life-topic platform and rewritten as "one subject x ten observer
dimensions x multiple witnesses".

- **computeCoverage()**: pure function. Scans all testimonies for one subject,
  classifies each observer dimension as `untouched | shallow | covered | cautious`.
  - `untouched`: no witness has answered any question in this dimension.
  - `shallow`: at least one answer exists but none contains concrete detail
    (measured by `hasConcreteDetail()`, 40-character threshold).
  - `covered`: at least one answer with concrete first-hand detail.
  - `cautious`: dimension where avoidance exceeds actual answers
    (`avoidCount >= 2 && avoidCount > witnessCount`).
- **planQuestions()**: given a coverage snapshot, a witness's relation type,
  and a questionnaire, outputs `PlannedQuestion[]` sorted by priority:
  priority (untouched/shallow) > normal > saturated (covered with >= 3
  witnesses) > cautious. A `minQuestions` floor (default 5) prevents
  over-trimming. When `respectCautious` is true (default), cautious
  dimensions are placed last rather than removed.
- **adviseRelationGaps()**: recommends which relation types (friend/family/
  colleague) are underrepresented in the current witness pool.

### Session fixation

When `InterviewOptions.adaptiveCoverage` is true, `startInterview()` calls
the planner and stores the resulting qid order in `state.questionOrder`.
All subsequent steps (answer, followup, finish) follow this fixed order.
When the option is false (default), the questionnaire's natural order is
used and existing behaviour is unchanged.

### Short invite codes (engines/witness/src/short-code.ts)

8-character case-insensitive codes from a 30-character unambiguous alphabet
(excludes 0/O/1/I/L). Generated with `crypto.randomInt` for uniform
distribution. Stored in the `invites` table (`short_code` column, unique
index). A stricter in-memory rate limiter (10 requests per minute per code)
protects `GET /api/i/:code` against guessing.

### API routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/i/:code` | open | Resolve short code to invite |
| GET | `/api/subjects/:id/coverage` | admin | Coverage overview for inviter page |
| POST | `/api/subjects/:id/invites` | admin | Create invite (now returns `shortCode` + `shortUrl`) |

## Expression and disclosure discipline

### Implemented

- **Three-tier expression** (`engines/room/src/tier.ts`): `deriveExpressionTier` determines
  the maximum tier a claim may reach before generation (quote / paraphrase / extrapolate).
  Contested, retired, or subject-denied claims cap at extrapolate. `synthesis_only` witnesses
  cap at paraphrase. Subject-visible rooms with `doNotRaiseToSubject` cap at extrapolate.
  Post-generation classification (`classifyUtterance`) then verifies actual output.
- **Four-level disclosure** (`kernel/src/disclosure.ts`): speakable → reference_only →
  presence_only → excluded. `holdUntilRaised` is orthogonal: the persona must not raise a
  topic proactively when set. `deriveDisclosure` is a pure function.
- **Knowledge boundary** (`engines/room/src/tier.ts`): `filterByKnowledgeBoundary` removes
  claims whose period postdates a witness's `knownToYear`.
- **Conflict pre-judgment** (`engines/court/src/conflict.ts`): `classifyPair` applies
  deterministic rules (perspective_differs, supersedes, refines, contradicts) before the LLM
  relation judgment call, saving tokens when the relation is obvious.
- **Re-raise wording gate** (`engines/gate/src/gate.ts`): `hasInvitingTone` rejects
  commanding/accusatory wording on re-raised claims. Failed claims get their text pushed to
  `Claim.versions` for audit trail.
- **Single witness weight cap** (`engines/court/src/court.ts`): `computeConviction` caps
  single-witness claims at 0.55, stricter than the unpaired cap (0.6).
- **Prompt guard rules** (`shared/src/prompt/guards.ts`): SOURCE_GUARD,
  CONTRADICTION_CHECK_RULES, OBSERVER_GUARD — constant guardrail strings injected into
  court and observer prompts.
- **Silence signal raise→retreat** (`plugins/silence-signal/src/index.ts`): `analyzeAvoidedQids`
  now requires at least one skipper to have also answered a sibling qid (raise→retreat paired
  evidence), not just passively skipped.

### Wired (2026-10-06)

All previously deferred items are now wired:

- **Disclosure wiring into persona assembly**: `deriveDisclosure` called per-claim during
  `assemblePersonaContext`. Excluded claims filtered; reference_only / presence_only annotated
  in the prompt facet list. `holdUntilRaised` tagged `[不主动提起]`.
- **Expression tier enforcement in room generation**: `deriveExpressionTier` caps tier
  post-classification in `runSchedule`. synthesis_only witnesses capped at paraphrase; front
  rooms enforce doNotRaiseToSubject.
- **Knowledge boundary wiring into room**: `filterByKnowledgeBoundary` applied per-witness
  during draft assembly, filtering memory entries mentioning years beyond `knownToYear`.
- **classifyPair pre-judgment wiring into court**: `classifyPair` called before LLM relation
  judgment; deterministic results skip the LLM call. Only `contradicts` and `supersedes`
  pre-judgments create divergence entries; `refines` and `perspective_differs` are logged
  but do not produce divergences (only the LLM can determine true perspective differences
  between third-party witnesses). `preJudgedPairs`/`llmJudgedPairs` stats in CourtReport.
  The `isPerspectiveDifference` function fires only on self-report vs witness (not on
  differing audience contexts alone).
- **Persona discipline**: `PERSONA_DISCIPLINE` includes a human-appropriate no-diagnosis
  rule ("不给人下诊断,不替人做重大决定") and a no-fabrication rule ("被问到的事不在上面的
  素材里,就按本人口吻说记不清或不接"). `OBSERVER_GUARD` (AI observer language) is NOT
  used in persona discipline; court filing uses a simplified extraction discipline instead.
- **Quota-based truncation**: `assemblePersonaContext` allocates the variable portion of
  `PERSONA_PROMPT_BUDGET` (default 6000 chars) proportionally: episodes 50%, claims 25%,
  corpus 10%, style 10%, self-report 5%. Each section keeps a minimum item count (episodes
  >= 5, claims >= 3, corpus >= 3) to prevent total section zeroing. `PersonaContextMeta`
  includes `sectionBudgets` for per-section diagnostics.
- **Full Claim.versions lifecycle**: CourtReportView displays wording history as a collapsible
  trail on each claim (surviving and contested).
- **Structured JSON repair loop**: All LLM JSON call sites (court filing/relation/confrontation,
  biography, meta-perception) migrated to `generateStructuredJson` from `shared/src/llm-json.ts`.
- **Biography plugin consolidation**: Duplicate confidentiality markers, sentence splitter, and
  private sentence extractor replaced by imports from room engine. LLM calls use
  `generateStructuredJson`. Quality gate: `qualityPass` (boolean) alongside deprecated
  `qualityScore` (number).
