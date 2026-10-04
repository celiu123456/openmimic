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
const DATABASE_PATH = 'data/openmimic.db';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
mkdirSync(dirname(DATABASE_PATH), { recursive: true });

const store = new Store({ path: DATABASE_PATH });
const server = await startServer({ port, store });

console.log(`openmimic collection API listening on ${server.url}`);

const shutdown = (): void => {
  void server.close().finally(() => {
    store.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
