# DEPLOY-FOR-AI: OpenMimic Self-Hosted Setup

> Format inspired by [Twig](https://github.com/withwig/twig)'s DEPLOY-FOR-AI.md.
> Hand this file to your AI agent and say: "Follow this to get OpenMimic running."

## What this is

OpenMimic is a persona simulation engine. You feed it testimony from people
who know someone, and it builds a persona you can talk to. It runs as a local
Node.js server with a SQLite database -- no cloud account, no Docker, no
external services required.

Two interfaces: an HTTP API (with an OpenAI-compatible `/v1/chat/completions`
endpoint) and an MCP stdio server (for AI coding agents).

## Prerequisites

| Requirement | Check command | Minimum |
|-------------|---------------|---------|
| Node.js | `node --version` | >= 22 |
| npm | `npm --version` | >= 10 |
| git | `git --version` | any |

## Install

```bash
# 1. Clone
git clone https://github.com/anthropics/openmimic.git
cd openmimic

# 2. Install dependencies
npm install

# 3. Approve native modules (better-sqlite3, esbuild)
npm approve-scripts better-sqlite3
npm approve-scripts esbuild
```

Expected: no errors. If `better-sqlite3` fails to build, you need a C++
toolchain (`build-essential` on Debian/Ubuntu, Xcode CLT on macOS).

## Start the HTTP server

```bash
npx tsx server/src/main.ts
```

Expected output:
```
openmimic collection API listening on http://127.0.0.1:7860
```

Verify:
```bash
curl http://127.0.0.1:7860/api/health
# {"ok":true,"version":"0.0.1"}
```

The database auto-creates at `data/openmimic.db`. Override with:
```bash
OPENMIMIC_DB=/path/to/your.db npx tsx server/src/main.ts
```

Override the port with:
```bash
PORT=3000 npx tsx server/src/main.ts
```

## Experience without an API key

The MCP server auto-seeds an empty database with a demo persona: Lin Mo
(林默), built from pre-written testimony. You can:

1. **List personas** -- no key needed
2. **Read a persona's system prompt** -- no key needed
3. **Run a behind-the-scenes room** -- returns pre-computed demo transcript
4. **Use the OpenAI-compatible endpoint** -- needs an API key (see below)

Test the MCP server directly:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"persona_list","arguments":{}}}' \
  | OPENMIMIC_DB=/tmp/openmimic-test.db npx tsx server/src/mcp/main.ts
```

Expected: JSON responses including `{"personas":[{"id":"limo","displayName":"林默","claimCount":5}]}`.

## Configure an API key (for persona_speak and chat)

Create `.env` in the repo root (it is gitignored):

```bash
cat > .env << 'EOF'
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-your-key-here
LLM_MODEL=deepseek-chat
EOF
```

Any OpenAI-compatible endpoint works (OpenAI, DeepSeek, Groq, local Ollama,
etc.). Restart the server after creating `.env`.

Now `persona_speak` and `/v1/chat/completions` will work.

## Connect to your AI agent

### Option A: MCP (for Claude Code, dsh, OpenClaw, Cursor, etc.)

See `integrations/mcp/README.md` for the generic MCP host config, or
`integrations/dsh/` / `integrations/openclaw/` for agent-specific setup.

The MCP server command is:
```
npx tsx server/src/mcp/main.ts
```

### Option B: OpenAI-compatible endpoint

Point any OpenAI SDK client at `http://127.0.0.1:7860/v1`. The model name
in the request selects a persona by subject id:

```bash
curl http://127.0.0.1:7860/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "limo",
    "messages": [{"role": "user", "content": "Hey, what have you been up to?"}]
  }'
```

No API key is required for the local endpoint itself; it calls the upstream
LLM configured in `.env`.

## Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `better-sqlite3` build fails | Missing C++ toolchain | Install `build-essential` (Linux) or Xcode CLT (macOS) |
| `EADDRINUSE` on startup | Port 7860 already in use | Set `PORT=7861` or kill the other process |
| `persona_speak` returns "服务器未配置语言模型" | No `.env` or missing `LLM_API_KEY` | Create `.env` with LLM variables (see above) |
| MCP server exits immediately | stdin closed | MCP server reads from stdin; pipe input or use an MCP host |
| `tsx: not found` | `npx` cannot find tsx | Run `npm install` first; tsx is a devDependency |

## File layout

```
openmimic/
  server/src/main.ts          HTTP server entry point
  server/src/mcp/main.ts      MCP stdio server entry point
  data/openmimic.db            SQLite database (auto-created)
  fixtures/limo.ts             Demo persona seed data
  integrations/                Agent-specific setup guides
  .env                         Your LLM credentials (gitignored)
```

## Type check and test

```bash
npm run typecheck    # TypeScript compiler, no emit
npm test             # vitest
```

Both should pass on a clean install with no configuration.
