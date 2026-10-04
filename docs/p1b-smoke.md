# p1b Plugin Kernel v1 Verification

> Generated: 2026-10-05

## Test results

226 tests, 28 files, 0 failures.

```
 Test Files  28 passed (28)
      Tests  226 passed (226)
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
