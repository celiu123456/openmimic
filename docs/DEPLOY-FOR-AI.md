# DEPLOY-FOR-AI: OpenMimic Self-Hosted Setup

> Format inspired by [Twig](https://github.com/withwig/twig)'s DEPLOY-FOR-AI.md.
> Hand this file to your AI agent and say: "Follow this to get OpenMimic running."

## What this is

OpenMimic is a persona simulation engine. You feed it testimony from people
who know someone, and it builds a persona you can talk to. It runs as a local
Node.js server with a SQLite database -- no cloud account, no external
services required. Docker and systemd deployment are both supported.

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
git clone https://github.com/celiu123456/openmimic.git
cd openmimic

# 2. Install dependencies
npm install
```

Expected: no errors. If `better-sqlite3` fails to build, you need a C++
toolchain (`build-essential` on Debian/Ubuntu, Xcode CLT on macOS).

## Start the HTTP server

```bash
npx tsx server/src/main.ts
```

Expected output:
```
openmimic collection API listening on http://127.0.0.1:7860 (loopback only -- set OPENMIMIC_ADMIN_TOKEN to bind 0.0.0.0)
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

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENMIMIC_ADMIN_TOKEN` | For public deploy | Protects management routes. Without it, server binds 127.0.0.1 only |
| `LLM_BASE_URL` | For court/room | Any OpenAI-compatible API base URL |
| `LLM_API_KEY` | For court/room | API key for the LLM provider |
| `LLM_MODEL` | For court/room | Model name (e.g. `deepseek-chat`) |
| `OPENMIMIC_PUBLIC_URL` | For public deploy | Full URL for invite links (e.g. `https://your.domain`) |
| `OPENMIMIC_DB` | No | SQLite path (default: `data/openmimic.db`) |
| `PORT` | No | Listen port (default: 7860) |

## Access control

When `OPENMIMIC_ADMIN_TOKEN` is set:
- The server binds to `0.0.0.0` (all interfaces)
- Management routes (create subject, view testimonies, run court, rooms, export, etc.) require `Authorization: Bearer <token>` header, `_token=<token>` cookie, or `?_token=<token>` query parameter
- Invite/interview routes (friend path) are open -- the invite token is the auth
- The `/v1/*` OpenAI-compatible endpoint requires the admin token
- The MCP stdio server has no HTTP surface; protect it at the host level

When `OPENMIMIC_ADMIN_TOKEN` is NOT set:
- The server binds to `127.0.0.1` only (loopback)
- All routes are open (safe for local use)

## Experience without an API key

An empty database auto-seeds a demo persona (Lin Mo / 林默). Open
`http://localhost:7860` in a browser to:

1. Walk into Lin Mo's room (pre-generated transcript)
2. Create a new subject and share the invite link
3. Submit testimony through the interview form

Court, room generation, and meta-perception scoring need an LLM.
Those endpoints return 501 with a clear message when unconfigured.

## Configure an LLM

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

## Deploy with Docker

```bash
# Build
docker build -t openmimic .

# Run
docker run -d --name openmimic \
  -p 7860:7860 \
  -v openmimic-data:/app/data \
  -e OPENMIMIC_ADMIN_TOKEN=your-secret \
  -e LLM_BASE_URL=https://api.example.com/v1 \
  -e LLM_API_KEY=sk-xxx \
  -e LLM_MODEL=your-model \
  -e OPENMIMIC_PUBLIC_URL=https://your.domain \
  openmimic

# Or with docker compose
docker compose up -d
```

## Deploy without Docker (systemd)

```bash
# 1. Install Node.js 22+, clone repo, npm install
# 2. Build the web frontend
npm run build:web

# 3. Create systemd unit
sudo tee /etc/systemd/system/openmimic.service << 'EOF'
[Unit]
Description=OpenMimic Persona Engine
After=network.target

[Service]
Type=simple
User=openmimic
WorkingDirectory=/opt/openmimic
Environment=PORT=7860
Environment=OPENMIMIC_DB=/opt/openmimic/data/openmimic.db
Environment=OPENMIMIC_ADMIN_TOKEN=your-secret
Environment=LLM_BASE_URL=https://api.example.com/v1
Environment=LLM_API_KEY=sk-xxx
Environment=LLM_MODEL=your-model
Environment=OPENMIMIC_PUBLIC_URL=https://your.domain
ExecStart=/usr/bin/npx tsx server/src/main.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now openmimic
```

### Reverse proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name your.domain;

    ssl_certificate     /etc/letsencrypt/live/your.domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your.domain/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:7860;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

HTTPS is required for production: invite links are shared via messaging apps,
and browsers block clipboard access on non-HTTPS pages.

## Connect to your AI agent

### Option A: MCP (for Claude Code, dsh, OpenClaw, Cursor, etc.)

The MCP server command is:
```
npx tsx server/src/mcp/main.ts
```

See `integrations/mcp/README.md` for the generic MCP host config.

### Option B: OpenAI-compatible endpoint

Point any OpenAI SDK client at `http://127.0.0.1:7860/v1`. When
`OPENMIMIC_ADMIN_TOKEN` is set, pass it as the API key:

```bash
curl http://127.0.0.1:7860/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-admin-token" \
  -d '{
    "model": "limo",
    "messages": [{"role": "user", "content": "Hey, what have you been up to?"}]
  }'
```

## Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `better-sqlite3` build fails | Missing C++ toolchain | Install `build-essential` (Linux) or Xcode CLT (macOS) |
| `EADDRINUSE` on startup | Port 7860 already in use | Set `PORT=7861` or kill the other process |
| 501 on court/room | No LLM configured | Create `.env` with LLM variables |
| 401 on management routes | Missing admin token | Add `Authorization: Bearer <token>` header |
| Invite link is relative | `OPENMIMIC_PUBLIC_URL` not set | Set it to the full public URL |
| `tsx: not found` | `npx` cannot find tsx | Run `npm install` first; tsx is a devDependency |

## Type check and test

```bash
npm run typecheck    # TypeScript compiler, no emit
npm test             # vitest
```

Both should pass on a clean install with no configuration.
