# OpenMimic MCP Server — Generic Host Integration

OpenMimic ships a hand-rolled MCP (Model Context Protocol) server that speaks
JSON-RPC 2.0 over stdio. Any MCP-compatible host (Claude Desktop, Cursor,
Windsurf, Cline, dsh, OpenClaw, etc.) can mount it.

## Stdio command

```
npx tsx server/src/mcp/main.ts
```

Run from the OpenMimic repo root. The server reads one JSON-RPC message per
line on stdin and writes one response per line on stdout.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENMIMIC_DB` | no | `data/openmimic.db` | SQLite database path. An empty database is auto-seeded with the Lin Mo demo. Use `:memory:` for ephemeral sessions. |
| `LLM_BASE_URL` | no | — | OpenAI-compatible chat endpoint (e.g. `https://api.deepseek.com/v1`) |
| `LLM_API_KEY` | no | — | API key for the upstream model |
| `LLM_MODEL` | no | — | Model name (e.g. `deepseek-chat`) |

Without the LLM variables the server still starts. Four of the five tools work
without a model; only `persona_speak` returns an error.

## Tools

| Tool | Description | Needs LLM? |
|------|-------------|------------|
| `persona_list` | List personas with surviving claims (id, displayName, claimCount) | No |
| `persona_context` | Return a persona's assembled system prompt with external discipline built in | No |
| `persona_speak` | Assemble persona and call the upstream model for a single-turn reply | Yes |
| `testimony_submit` | Submit testimony via an invitation token to the append-only ledger | No |
| `room_run` | Run a behind-the-scenes room session and return the transcript | No (demo data) / Yes (live) |

## MCP host configuration example

For hosts that use a JSON config file (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "openmimic": {
      "command": "npx",
      "args": ["tsx", "server/src/mcp/main.ts"],
      "cwd": "/absolute/path/to/openmimic",
      "env": {
        "OPENMIMIC_DB": "/absolute/path/to/openmimic/data/openmimic.db"
      }
    }
  }
}
```

## JSON-RPC round-trip example

The following is a real session captured against the demo database on
2026-10-05. The server was started with:

```
OPENMIMIC_DB=/tmp/test/openmimic.db npx tsx server/src/mcp/main.ts
```

### 1. Initialize

**Request:**
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example-client","version":"1.0.0"}}}
```

**Response:**
```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"openmimic","version":"0.0.1"}}}
```

### 2. Notify initialized

**Request (notification, no response):**
```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

### 3. List tools

**Request:**
```json
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
```

**Response (5 tools):**
```json
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"persona_list","description":"列出有 surviving claims 的人格(id、displayName、claim 数)。","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},{"name":"persona_context","description":"返回某个人格的系统提示词(external 纪律已内建)。","inputSchema":{"type":"object","properties":{"subjectId":{"type":"string","description":"当事人 id"}},"required":["subjectId"],"additionalProperties":false}},{"name":"persona_speak","description":"装配人格并调用上游模型做单轮回答。","inputSchema":{"type":"object","properties":{"subjectId":{"type":"string","description":"当事人 id"},"message":{"type":"string","description":"用户这一轮说的话"}},"required":["subjectId","message"],"additionalProperties":false}},{"name":"testimony_submit","description":"用邀请 token 提交一份证言,写入 append-only 账本。","inputSchema":{"type":"object","properties":{"token":{"type":"string","description":"邀请 token"},"relation":{"type":"string","description":"与当事人的关系"},"stance":{"type":"string","description":"自报立场(可选)"},"consentLevel":{"type":"string","enum":["quotable","synthesis_only"]},"answers":{"type":"array","minItems":1,"items":{"type":"object","properties":{"qid":{"type":"string"},"behindText":{"type":"string"},"frontText":{"type":"string"},"followupText":{"type":"string"}},"required":["qid","behindText"],"additionalProperties":false}},"freeText":{"type":"string"},"avoidedQids":{"type":"array","items":{"type":"string"}}},"required":["token","relation","consentLevel","answers"],"additionalProperties":false}},{"name":"room_run","description":"跑一次「背后房间」并返回转写(导入人格由 claims 驱动)。","inputSchema":{"type":"object","properties":{"subjectId":{"type":"string","description":"当事人 id"},"topicSeed":{"type":"string","description":"话题种子(可选)"}},"required":["subjectId"],"additionalProperties":false}}]}}
```

### 4. Call persona_list

**Request:**
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"persona_list","arguments":{}}}
```

**Response:**
```json
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"personas\":[{\"id\":\"limo\",\"displayName\":\"林默\",\"claimCount\":5}]}"}]}}
```

### 5. Call persona_context

**Request:**
```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"persona_context","arguments":{"subjectId":"limo"}}}
```

**Response (truncated for readability):**
```json
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"{\"subjectId\":\"limo\",\"systemPrompt\":\"你正在扮演基于他人证言构建的林默。这是人格模拟,不是本人。\\n\\n## 人格侧面\\n- 林默在压力大的时候习惯自己扛...（置信 0.80）\\n...\\n## 行为纪律\\n- 说话像真人:短句、克制、口语。...\",\"meta\":{\"subjectId\":\"limo\",\"displayName\":\"林默\",\"includedClaimIds\":[\"c-limo-1\",\"c-limo-2\",\"c-limo-6\",\"c-limo-3\",\"c-limo-4\"],\"excludedClaimIds\":[],\"truncated\":false,\"charCount\":921,\"sampleCount\":12,\"selfReportIncluded\":true}}"}]}}
```

## Protocol notes

- **Protocol version**: `2024-11-05`
- **Capabilities**: `tools` only (no resources, no prompts)
- **Notifications**: `notifications/initialized` and any `notifications/*` are
  silently accepted
- **Unknown methods**: return JSON-RPC `methodNotFound` (-32601)
- **Unknown tools**: return a tool-level `isError` result (not a protocol error)
- **No pagination**: `tools/list` returns all five tools in one response
