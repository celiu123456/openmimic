---
name: openmimic
description: Connect to an OpenMimic persona engine via MCP. List personas, read assembled system prompts, run behind-the-scenes rooms, submit testimony, and have a persona speak — all through five MCP tools.
version: 0.0.1
metadata:
  openclaw:
    requires:
      bins:
        - node
        - npx
      env: []
    primaryEnv: OPENMIMIC_DB
    homepage: https://github.com/anthropics/openmimic
---

# OpenMimic Persona Engine

OpenMimic is a general-purpose persona simulation engine. This skill connects
to its MCP stdio server, giving you five tools:

| Tool | What it does |
|------|-------------|
| `persona_list` | List personas with surviving claims (id, displayName, claimCount) |
| `persona_context` | Return a persona's assembled system prompt |
| `persona_speak` | Have a persona answer a message (requires upstream LLM) |
| `testimony_submit` | Submit testimony to the append-only ledger |
| `room_run` | Run a behind-the-scenes room and return the transcript |

## Setup

1. Clone and install OpenMimic:

```bash
git clone https://github.com/anthropics/openmimic.git
cd openmimic && npm install
```

2. Add the MCP server to your OpenClaw configuration
   (`~/.openclaw/openclaw.json`):

```json
{
  "mcpServers": {
    "openmimic": {
      "command": "npx",
      "args": ["tsx", "server/src/mcp/main.ts"],
      "transport": "stdio",
      "env": {
        "OPENMIMIC_DB": "/absolute/path/to/openmimic/data/openmimic.db"
      }
    }
  }
}
```

Set `OPENMIMIC_DB` to any writable path. The database auto-seeds with the
demo persona (Lin Mo / 林默) on first run.

3. (Optional) To enable `persona_speak`, add LLM configuration:

```json
{
  "mcpServers": {
    "openmimic": {
      "command": "npx",
      "args": ["tsx", "server/src/mcp/main.ts"],
      "transport": "stdio",
      "env": {
        "OPENMIMIC_DB": "/absolute/path/to/openmimic/data/openmimic.db",
        "LLM_BASE_URL": "https://api.deepseek.com/v1",
        "LLM_API_KEY": "${LLM_API_KEY}",
        "LLM_MODEL": "deepseek-chat"
      }
    }
  }
}
```

## Usage

Ask the agent to use the OpenMimic tools:

- "List available personas" -> calls `persona_list`
- "Show me Lin Mo's system prompt" -> calls `persona_context`
- "Ask Lin Mo what she's been up to" -> calls `persona_speak`
- "Run a behind-the-scenes room for Lin Mo" -> calls `room_run`

## Working directory

The MCP server must be launched from the OpenMimic repo root (where
`package.json` lives), because it resolves `tsx` and internal imports
relative to that directory.
