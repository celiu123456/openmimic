import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import { createInvite } from '@openmimic/engine-witness';
import { FakeLLM } from '@openmimic/engine-room';
import { DEMO_SUBJECT_ID, seedDemo } from '@openmimic/fixtures';
import {
  JSON_RPC_ERRORS,
  MCP_TOOLS,
  dispatchMcpMessage,
  type ChatUpstream,
  type JsonRpcResponse,
  type McpSessionOptions,
} from '@openmimic/server';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const NOW = '2026-10-05T00:00:00.000Z';
const SECRET = '紫色大象在凌晨三点独自跳探戈且无人知晓';

async function call(
  options: McpSessionOptions,
  method: string,
  params?: unknown,
): Promise<JsonRpcResponse | undefined> {
  return dispatchMcpMessage(options, {
    jsonrpc: '2.0',
    id: 1,
    method,
    ...(params !== undefined ? { params } : {}),
  });
}

interface ToolResultShape {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function toolResult(response: JsonRpcResponse | undefined): ToolResultShape {
  expect(response?.error).toBeUndefined();
  return response?.result as ToolResultShape;
}

function toolPayload(response: JsonRpcResponse | undefined): Record<string, unknown> {
  const result = toolResult(response);
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

function fakeChat(reply: string): ChatUpstream {
  return {
    configured: true,
    hasApiKey: true,
    chatRaw: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  };
}

/** A subject whose only long answer comes from a `synthesis_only` witness. */
function seedSynthesisOnlyStore(): { store: Store; subjectId: string } {
  const store = new Store();
  const subjectId = 'subj-secret';
  store.putSubject({ id: subjectId, displayName: '密语' });
  store.putWitness({
    id: 'w-quotable',
    subjectId,
    relation: '朋友',
    consentLevel: 'quotable',
  });
  store.putWitness({
    id: 'w-secret',
    subjectId,
    relation: '同事',
    consentLevel: 'synthesis_only',
  });
  store.addTestimony({
    id: 't-quotable',
    witnessId: 'w-quotable',
    subjectId,
    createdAt: NOW,
    answers: [{ qid: 'q1', behindText: '他平时话不多,但答应的事一定办。' }],
  });
  store.addTestimony({
    id: 't-secret',
    witnessId: 'w-secret',
    subjectId,
    createdAt: NOW,
    answers: [{ qid: 'q1', behindText: SECRET }],
  });
  store.putClaim({
    id: 'c-secret-1',
    subjectId,
    text: '他在压力下倾向独自消化情绪。',
    conviction: 0.8,
    evidence: ['t-quotable', 't-secret'],
    status: 'surviving',
    courtSessionId: 'sess-secret',
  });
  return { store, subjectId };
}

describe('MCP stdio protocol (pure dispatch)', () => {
  it('initializes by echoing the client protocol version and advertising tools', async () => {
    const store = new Store();
    const response = await call({ store }, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    const result = response?.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.capabilities).toEqual({ tools: {} });
    expect(result.serverInfo).toMatchObject({ name: 'openmimic' });
    expect(typeof (result.serverInfo as Record<string, unknown>).version).toBe('string');
    store.close();
  });

  it('lists the five tools with JSON schemas', async () => {
    const store = new Store();
    const response = await call({ store }, 'tools/list');
    const payload = response?.result as Record<string, unknown>;
    const tools = payload.tools as Array<Record<string, unknown>>;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'persona_context',
      'persona_list',
      'persona_speak',
      'room_run',
      'testimony_submit',
    ]);
    for (const tool of tools) {
      expect(typeof tool.description).toBe('string');
      expect((tool.inputSchema as Record<string, unknown>).type).toBe('object');
    }
    expect(MCP_TOOLS).toHaveLength(5);
    store.close();
  });

  it('answers method-not-found for unknown methods and stays silent for notifications', async () => {
    const store = new Store();
    const unknown = await dispatchMcpMessage(
      { store },
      { jsonrpc: '2.0', id: 7, method: 'tools/unknown' },
    );
    expect(unknown?.error?.code).toBe(JSON_RPC_ERRORS.methodNotFound);
    expect(unknown?.id).toBe(7);

    const notification = await dispatchMcpMessage(
      { store },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    );
    expect(notification).toBeUndefined();
    store.close();
  });

  it('persona_list filters out subjects with no surviving claim', async () => {
    const store = new Store();
    seedDemo(store);
    store.putSubject({ id: 'empty-subject', displayName: '空对象' });

    const payload = toolPayload(await call({ store }, 'tools/call', { name: 'persona_list' }));
    const personas = payload.personas as Array<Record<string, unknown>>;
    expect(personas.map((persona) => persona.id)).toEqual([DEMO_SUBJECT_ID]);
    expect(personas[0]!.claimCount).toBe(5);
    store.close();
  });

  it('persona_context returns the assembled prompt with the identity declaration', async () => {
    const store = new Store();
    seedDemo(store);
    const payload = toolPayload(
      await call({ store }, 'tools/call', {
        name: 'persona_context',
        arguments: { subjectId: DEMO_SUBJECT_ID },
      }),
    );
    expect(String(payload.systemPrompt)).toContain('这是人格模拟,不是本人。');
    expect(String(payload.systemPrompt)).toContain('林默');
    store.close();
  });

  it('testimony_submit appends through the append-only ledger', async () => {
    const store = new Store();
    store.putSubject({ id: 'subj-mcp', displayName: '受试者' });
    const invite = createInvite(store, 'subj-mcp', { now: new Date(NOW) });

    const payload = toolPayload(
      await call({ store }, 'tools/call', {
        name: 'testimony_submit',
        arguments: {
          token: invite.token,
          relation: '同事',
          consentLevel: 'quotable',
          answers: [{ qid: 'q1', behindText: '他说话很直接。' }],
        },
      }),
    );
    expect(payload.count).toBe(1);
    expect(store.listBySubject('subj-mcp')).toHaveLength(1);
    const witness = store.getWitness(payload.witnessId as string);
    expect(witness?.relation).toBe('同事');
    store.close();
  });

  it('persona_speak and room_run answer isError without a configured model', async () => {
    const store = new Store();
    seedDemo(store);

    const speak = toolResult(
      await call({ store }, 'tools/call', {
        name: 'persona_speak',
        arguments: { subjectId: DEMO_SUBJECT_ID, message: '你好' },
      }),
    );
    expect(speak.isError).toBe(true);
    expect(speak.content[0]!.text).toContain('未配置语言模型');

    const other = new Store();
    seedDemo(other);
    other.putSubject({ id: 'plain', displayName: '普通人' });
    const room = toolResult(
      await call({ store: other }, 'tools/call', {
        name: 'room_run',
        arguments: { subjectId: 'plain' },
      }),
    );
    expect(room.isError).toBe(true);
    expect(room.content[0]!.text).toContain('未配置语言模型');

    // The demo subject still serves its pre-generated room without a key.
    const demoRoom = toolPayload(
      await call({ store }, 'tools/call', {
        name: 'room_run',
        arguments: { subjectId: DEMO_SUBJECT_ID },
      }),
    );
    expect((demoRoom.room as Record<string, unknown>).id).toBe('room-limo-1');
    store.close();
    other.close();
  });

  it('withholds synthesis_only raw words from every tool result', async () => {
    const seeded = seedSynthesisOnlyStore();
    const store = seeded.store;

    const speakOptions: McpSessionOptions = { store, chat: fakeChat(SECRET) };
    const speak = toolPayload(
      await call(speakOptions, 'tools/call', {
        name: 'persona_speak',
        arguments: { subjectId: seeded.subjectId, message: '说说他' },
      }),
    );
    expect(JSON.stringify(speak)).not.toContain(SECRET);
    expect(String(speak.reply)).toContain('[withheld]');

    const context = toolPayload(
      await call({ store }, 'tools/call', {
        name: 'persona_context',
        arguments: { subjectId: seeded.subjectId },
      }),
    );
    expect(JSON.stringify(context)).not.toContain(SECRET);

    const roomOptions: McpSessionOptions = {
      store,
      llm: new FakeLLM(Array.from({ length: 8 }, () => `{"text":"${SECRET}"}`)),
    };
    const room = toolPayload(
      await call(roomOptions, 'tools/call', {
        name: 'room_run',
        arguments: { subjectId: seeded.subjectId },
      }),
    );
    expect(JSON.stringify(room)).not.toContain(SECRET);
    store.close();
  });

  it(
    'completes a real stdio initialize handshake in a spawned process',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'openmimic-mcp-'));
      const child = spawn('npx', ['tsx', 'server/src/mcp/main.ts'], {
        cwd: REPO_ROOT,
        env: { ...process.env, OPENMIMIC_DB: join(dir, 'mcp.db') },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      try {
        const frame = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'spawn-test', version: '1' },
          },
        });
        child.stdin.write(`${frame}\n`);

        const line = await Promise.race([
          firstLine(child.stdout),
          new Promise<string>((_resolve, reject) =>
            setTimeout(() => reject(new Error('spawn handshake timed out')), 60_000),
          ),
        ]);
        const response = JSON.parse(line) as JsonRpcResponse;
        const result = response.result as Record<string, unknown>;
        expect(response.id).toBe(1);
        expect(result.protocolVersion).toBe('2025-06-18');
        expect(result.serverInfo).toMatchObject({ name: 'openmimic' });
        expect(result.capabilities).toEqual({ tools: {} });
      } finally {
        child.kill('SIGKILL');
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

function firstLine(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const index = buffer.indexOf('\n');
      if (index >= 0) resolve(buffer.slice(0, index));
    });
    stream.on('error', reject);
  });
}
