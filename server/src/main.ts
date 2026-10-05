import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from '@openmimic/kernel';
import { startServer } from './server';

/**
 * Single-user, self-hosted entry point.
 *
 * W2 deliberately has no accounts: this process assumes one operator on
 * localhost and stores everything in one SQLite file. Multi-tenancy — per-user
 * subjects, isolation and auth — belongs to the official site (W5) and is not
 * faked in this layer.
 */
const DEFAULT_PORT = 7860;
/**
 * Shared SQLite path. `OPENMIMIC_DB` lets the HTTP server and the MCP server
 * (`server/src/mcp/main.ts`) point at the same file; both default to
 * `data/openmimic.db`.
 */
const DATABASE_PATH = process.env.OPENMIMIC_DB ?? 'data/openmimic.db';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
mkdirSync(dirname(DATABASE_PATH), { recursive: true });

const store = new Store({ path: DATABASE_PATH });
const adminToken = process.env.OPENMIMIC_ADMIN_TOKEN;
const server = await startServer({ port, store });

if (!adminToken) {
  console.log(
    `openmimic collection API listening on ${server.url} (loopback only -- set OPENMIMIC_ADMIN_TOKEN to bind 0.0.0.0)`,
  );
} else {
  console.log(`openmimic collection API listening on http://0.0.0.0:${server.port}`);
}

const shutdown = (): void => {
  void server.close().finally(() => {
    store.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
