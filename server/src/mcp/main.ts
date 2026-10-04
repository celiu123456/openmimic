import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { Store } from '@openmimic/kernel';
import { OpenAICompatClient } from '@openmimic/engine-court';
import { seedDemo } from '../../../fixtures/limo';
import {
  JSON_RPC_ERRORS,
  dispatchMcpMessage,
  type McpSessionOptions,
} from './protocol';

/**
 * OpenMimic MCP server entry point: JSON-RPC 2.0 over stdio, one message per
 * line.
 *
 * Shares the same SQLite file as the HTTP server (`OPENMIMIC_DB`, default
 * `data/openmimic.db`) so the MCP surface and the collection API see one
 * persona store. An empty database is seeded with the 林默 demo, exactly as
 * the HTTP server does. The upstream model is optional: without an API key the
 * tools that need one answer `isError` instead of calling out.
 */

const DEFAULT_DATABASE_PATH = 'data/openmimic.db';

const databasePath = process.env.OPENMIMIC_DB ?? DEFAULT_DATABASE_PATH;
if (databasePath !== ':memory:') {
  mkdirSync(dirname(databasePath), { recursive: true });
}

const store = new Store({ path: databasePath });
if (store.listSubjects().length === 0) {
  seedDemo(store);
}

// One client plays both roles: the room/court `LLMClient` and the raw chat
// upstream used by `persona_speak`. A key-less client is discarded entirely so
// no tool can accidentally attempt a real call.
const client = new OpenAICompatClient();
const ready = client.configured && client.hasApiKey ? client : undefined;
const options: McpSessionOptions = {
  store,
  ...(ready ? { llm: ready, chat: ready } : {}),
};

function writeMessage(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function idOf(message: unknown): string | number | null {
  if (typeof message === 'object' && message !== null && 'id' in message) {
    const id = (message as { id?: unknown }).id;
    if (typeof id === 'string' || typeof id === 'number') return id;
  }
  return null;
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const trimmed = line.trim();
  if (trimmed === '') continue;

  let message: unknown;
  try {
    message = JSON.parse(trimmed) as unknown;
  } catch {
    writeMessage({
      jsonrpc: '2.0',
      id: null,
      error: { code: JSON_RPC_ERRORS.parseError, message: 'Parse error' },
    });
    continue;
  }

  try {
    const response = await dispatchMcpMessage(options, message);
    if (response) writeMessage(response);
  } catch (caught) {
    writeMessage({
      jsonrpc: '2.0',
      id: idOf(message),
      error: {
        code: JSON_RPC_ERRORS.internalError,
        message: caught instanceof Error ? caught.message : 'Internal error',
      },
    });
  }
}

store.close();
