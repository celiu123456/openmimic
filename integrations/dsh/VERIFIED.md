# dsh + OpenMimic MCP: Verification Log

- **Date**: 2026-10-05
- **dsh version**: 0.1.0-rc.6 (`@deepseek-ai/dsh`)
- **Node**: v24.18.1 (linux arm64)
- **Model**: deepseek-flash (via deepseek-official provider)
- **Temporary profile used**: Yes (`DSH_HOME=/tmp/openmimic-dsh-test`, profile name `openmimic-test`)
- **No user global config was modified**: See pre/post comparison below.

## Method

Used a temporary `DSH_HOME` at `/tmp/openmimic-dsh-test` with a fresh profile
`openmimic-test`. Credentials were copied (not symlinked) from the user's real
`~/.dsh/.credentials.yaml` into the temp home. The user's `~/.dsh/` was never
written to.

The profile's `cordis.patch.yml` uses `- insert:` to add an
`@deepseek-ai/dsh-mcp-client` instance pointing at OpenMimic's MCP stdio
server in the worktree.

## Test 1: Config resolution

```
$ DSH_HOME=/tmp/openmimic-dsh-test dsh --dump-config --profile openmimic-test | grep -A 15 'mcp-openmimic'
- id: mcp-openmimic
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: openmimic
    transport: stdio
    command: npx
    args:
      - tsx
      - server/src/mcp/main.ts
    cwd: /home/liuce/code/openmimic-wt/e-shells
    env:
      OPENMIMIC_DB: /tmp/openmimic-dsh-test/openmimic.db
```

## Test 2: persona_list via dsh headless

```
$ cd /home/liuce/code/openmimic-wt/e-shells && \
  DSH_HOME=/tmp/openmimic-dsh-test DSH_PERMISSION_MODE=danger-full-access \
  dsh --profile openmimic-test \
  "Use the mcp__openmimic__persona_list tool to list available personas. Report the result."

There is **1** available persona:

| id | displayName | claims |
|---|---|---|
| `limo` | 林默 | 5 |
```

## Test 3: persona_speak (no LLM key in MCP server env)

```
$ cd /home/liuce/code/openmimic-wt/e-shells && \
  DSH_HOME=/tmp/openmimic-dsh-test DSH_PERMISSION_MODE=danger-full-access \
  dsh --profile openmimic-test \
  "Use mcp__openmimic__persona_speak with subjectId 'limo' and message '最近什么打算'. Report the persona's reply."

[dsh agent response, summarized:]
mcp__openmimic__persona_speak returned error:
  "服务器未配置语言模型(缺 LLM_API_KEY),无法让人格开口"

The agent confirmed persona_list and persona_context work.
Only persona_speak requires LLM_API_KEY in the MCP server's env block.
```

**Expected**: The MCP server's `env` block in `cordis.patch.yml` did not
include `LLM_API_KEY`, so `persona_speak` correctly returns an error. The dsh
credentials service stores the key for dsh's own LLM calls, not for child
process env vars. To enable `persona_speak`, users must add
`LLM_API_KEY: !!js process.env.LLM_API_KEY` to the env block and export the
key in their shell, or hardcode it.

## Test 4: persona_speak with LLM env vars (PASSED)

The `!!js process.env.VAR` approach works -- the key is that the env vars
must be exported in the launching shell before calling dsh. The previous
failure (Test 3) was because the env vars were not set.

```
$ cd /home/liuce/code/openmimic-wt/e-shells && \
  export $(grep -E '^(LLM_BASE_URL|LLM_API_KEY|LLM_MODEL)=' /path/to/.env | xargs) && \
  DSH_HOME=/tmp/openmimic-dsh-test DSH_PERMISSION_MODE=danger-full-access \
  dsh --profile openmimic-test \
  "Use the mcp__openmimic__persona_speak tool with subjectId 'limo' and message '最近什么打算'. Report the persona's reply verbatim."

The persona `limo` replied verbatim:

> 先歇着。没想那么远。
```

**Config used** (`cordis.patch.yml` env block):
```yaml
env:
  OPENMIMIC_DB: /tmp/openmimic-dsh-test/openmimic.db
  LLM_BASE_URL: !!js process.env.LLM_BASE_URL
  LLM_API_KEY: !!js process.env.LLM_API_KEY
  LLM_MODEL: !!js process.env.LLM_MODEL
```

**Model**: deepseek-flash (via LLM_MODEL env var, forwarded to OpenMimic's
OpenAI-compatible client which calls `https://api.deepseek.com/v1`).

**Important**: All three `!!js` env vars must resolve to strings at YAML
parse time. If any is undefined (not exported), the config fails schema
validation with `expected { ... env?: { [key: string]: string } ... }`.
Export all three before running dsh.

## Pitfall discovered: `- insert:` is required for new entries

The cordis patch format distinguishes between patching existing entries (bare
`- id: ...`) and adding new ones (`- insert: [...]`). Without `- insert:`, dsh
prints `patch: entry "mcp-openmimic" not found` and ignores the entry silently.
This is documented in the README.

## Pre/post comparison of ~/.dsh

### Before tests
```
$ ls -la ~/.dsh/
total 32
drwxrwxr-x  5 liuce liuce 4096 Oct  3 00:11 .
-rw-rw-r--  1 liuce liuce   37 Aug 16 19:02 .anonymous-user-id
-rw-------  1 liuce liuce   54 Aug 16 19:02 .credentials.yaml
drwxrwxr-x  5 liuce liuce 4096 Aug 18 03:38 profiles
drwx------ 52 liuce liuce 4096 Oct  5 03:29 sessions
-rw-------  1 liuce liuce  154 Oct  3 00:11 settings.yaml
drwx------  2 liuce liuce 4096 Oct  3 00:09 storages

$ ls -la ~/.dsh/profiles/
total 28
drwxrwxr-x  5 liuce liuce  4096 Aug 18 03:38 .
drwxrwxr-x  2 liuce liuce  4096 Oct  3 00:12 headless
drwxrwxr-x 25 liuce liuce 12288 Aug 16 18:57 node_modules
drwxrwxr-x  2 liuce liuce  4096 Aug 18 03:38 web

$ ls -la ~/.dsh/profiles/headless/
total 24
-rw-rw-r-- 1 liuce liuce   94 Oct  3 00:12 cordis.patch.yml
-rw-rw-r-- 1 liuce liuce  223 Oct  5 05:31 cordis.yml
-rw-rw-r-- 1 liuce liuce  213 Aug 16 18:57 package.json
-rw-rw-r-- 1 liuce liuce   61 Aug 16 18:57 pnpm-workspace.yaml
```

### After tests
```
$ ls -la ~/.dsh/
total 32
drwxrwxr-x  5 liuce liuce 4096 Oct  3 00:11 .
-rw-rw-r--  1 liuce liuce   37 Aug 16 19:02 .anonymous-user-id
-rw-------  1 liuce liuce   54 Aug 16 19:02 .credentials.yaml
drwxrwxr-x  5 liuce liuce 4096 Aug 18 03:38 profiles
drwx------ 52 liuce liuce 4096 Oct  5 03:29 sessions
-rw-------  1 liuce liuce  154 Oct  3 00:11 settings.yaml
drwx------  2 liuce liuce 4096 Oct  3 00:09 storages

$ ls -la ~/.dsh/profiles/
total 28
drwxrwxr-x  5 liuce liuce  4096 Aug 18 03:38 .
drwxrwxr-x  2 liuce liuce  4096 Oct  3 00:12 headless
drwxrwxr-x 25 liuce liuce 12288 Aug 16 18:57 node_modules
drwxrwxr-x  2 liuce liuce  4096 Aug 18 03:38 web

$ ls -la ~/.dsh/profiles/headless/
total 24
-rw-rw-r-- 1 liuce liuce   94 Oct  3 00:12 cordis.patch.yml
-rw-rw-r-- 1 liuce liuce  223 Oct  5 05:33 cordis.yml
-rw-rw-r-- 1 liuce liuce  213 Aug 16 18:57 package.json
-rw-rw-r-- 1 liuce liuce   61 Aug 16 18:57 pnpm-workspace.yaml
```

**Diff**: cordis.yml timestamp changed from 05:31 to 05:33 (dsh's
`--dump-default-config` regenerates this auto-generated file on read), but
content and size (223 bytes) are identical. All other files unchanged. No
new files or directories added under ~/.dsh/.

No `openmimic-verify` profile was created under ~/.dsh/profiles/ (the task
allowed creating one if needed; it was not needed because DSH_HOME redirection
was sufficient).
