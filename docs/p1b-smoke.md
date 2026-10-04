# p1b Plugin Kernel v1 Verification

> Generated: 2026-10-05
> Updated: 2026-10-05 (post-merge engine isolation)

## Test results

257 tests, 29 files, 0 failures.

```
 Test Files  29 passed (29)
      Tests  257 passed (257)
```

## New test count (target: >= 18)

| File | New tests | Notes |
|------|-----------|-------|
| kernel/test/plugin-host.test.ts | 15 | Rewritten: 3 legacy compat + 4 load/inject + 3 topo sort + 3 unload + 1 disposeAll + 1 extension points |
| plugins/collector-freetext/test/freetext.test.ts | 2 | Registration + submit |
| plugins/scenario-review/test/scenario-review.test.ts | 2 | Registration + scenario fields |
| plugins/example-bridge/test/bridge.test.ts | 2 | Webhook post + unload cleanup |
| examples/embed-as-library/main.test.ts | 1 | End-to-end: FakeLLM -> court -> persona prompt |
| server/test/plugin-integration.test.ts | 7 | No-backdoor + config overlay (3) + createOpenMimic (2) + smoke |
| engines/court/test/court.test.ts | +3 | mergedText, displayName, agreement-without-mergedText (court fix) |

**Total new: 32** (target was >= 18)

## Engine function isolation (post-merge)

Runtime engine functions (`runBehindRoom`, `findCrisisWord`, `courtPlugin`,
`roomPlugin`, `witnessPlugin`, `submitTestimony`, `runCourt`) are no longer
imported directly in server source code. All engine access goes through the
plugin context (`ctx.get('court')`, `ctx.get('room')`, `ctx.get('witness')`).

Plugin object assembly is centralized in `server/src/plugin-resolver.ts`,
the single file that maps `use` names from `openmimic.yml` to concrete
Plugin objects.

`findCrisisWord` was moved to `kernel/src/gate.ts` (its conceptual home)
and re-exported from `engines/room/src/wordlist.ts` for backward compat.

### Remaining engine imports (non-function)

```
$ grep -rn 'from.*@openmimic/engine' server/src/ --include='*.ts' \
    | grep -v 'import type' | grep -v 'plugin-resolver.ts'

server/src/imported-room.ts:10:} from '@openmimic/engine-room';
server/src/mount-rest.ts:22:} from '@openmimic/engine-witness';
server/src/server.ts:12:} from '@openmimic/engine-court';
server/src/server.ts:13:import { RoomRefusedError, type LLMClient } from '@openmimic/engine-room';
server/src/server.ts:18:} from '@openmimic/engine-witness';
server/src/mcp/main.ts:5:import { OpenAICompatClient } from '@openmimic/engine-court';
server/src/mcp/protocol.ts:4:import { SubmitTestimonyInputSchema } from '@openmimic/engine-witness';
```

These are:
- **Error classes** (`RoomRefusedError`, `InviteInvalidError`, etc.) -- used for
  `instanceof` in the server error handler, cannot be `import type`
- **Zod validation schemas** (`SubmitTestimonyInputSchema`, etc.) -- structural
  validators for HTTP/MCP request bodies, not engine pipeline execution
- **`OpenAICompatClient`** -- LLM client constructor (infrastructure)
- **Utility constants** (`DEFAULT_TOPIC_SEED`, `parseRoomText`) in
  `imported-room.ts` -- room text formatting, not engine pipeline functions

### MCP standalone entry

`npx tsx server/src/mcp/main.ts` assembles a `PluginHost`, loads engines via
the same resolver, and passes `witness` / `room` services into
`McpSessionOptions`. The entry remains functional (spawned-process
handshake test passes).

## Checklist

- [x] Plugin protocol: Plugin<Config> with name/kind/inject/apply
- [x] Official engines as Plugin objects: witness, court, room
- [x] Legacy compat: old register(manifest, setup) still works
- [x] Dependency injection: inject declares required services, provide registers them
- [x] Topo sort: loadAll resolves order via Kahn's algorithm
- [x] Unload: reverse dispose, refuses if dependents still loaded
- [x] disposeAll: reverse order teardown
- [x] Collector registry: register/get/list/remove
- [x] Scenario registry: same API
- [x] Mount plugins: mount-rest, mount-openai, mount-mcp
- [x] Config tree: openmimic.yml + .local.yml + env var, merge by `use` key
- [x] Three real plugins: collector-freetext, scenario-review, example-bridge
- [x] packages/core: createOpenMimic() embeddable entry, no port
- [x] embed-as-library example with test
- [x] No-backdoor test: fake court replaces official
- [x] Config overlay test: mount-mcp disabled -> unavailable
- [x] createOpenMimic test: no port, dispose closes DB
- [x] Default config smoke: health/subject/invite routes work
- [x] Error types: MissingServiceError, CyclicDependencyError
- [x] Server engine function isolation: all via ctx.get() or plugin-resolver
- [x] docs/PLUGIN-GUIDE.md
- [x] docs/ARCHITECTURE.md
- [x] README updated (plugin status, roadmap)
- [x] claims-audit.md updated (plugin assembly -> implemented)

## External behavior unchanged

All pre-existing HTTP/MCP/OpenAI routes preserved:
- GET/POST /api/subjects, /api/subjects/:id
- POST /api/subjects/:id/invites, /api/invites/:token
- POST /api/subjects/:id/court
- POST /api/subjects/:id/rooms, GET/POST /api/rooms/:id
- GET /api/subjects/:id/persona, /api/subjects/:id/divergences
- POST/GET /api/subjects/:id/corpus
- POST/GET /api/subjects/:id/persona-package
- GET /v1/models, POST /v1/chat/completions
- MCP stdio (npx tsx server/src/mcp/main.ts)
- GET /api/health, GET /api/asr/config
