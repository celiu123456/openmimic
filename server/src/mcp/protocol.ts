import { z } from 'zod';
import { assemblePersonaContext, type Store } from '@openmimic/kernel';
import {
  SubmitTestimonyInputSchema,
  submitTestimony,
} from '@openmimic/engine-witness';
import { runBehindRoom, type LLMClient } from '@openmimic/engine-room';
import { DEMO_SUBJECT_ID } from '../../../fixtures/limo';
import { redactForExternal, withholdSynthesisOnly } from '../external';
import { runImportedRoom } from '../imported-room';
import { isImportedSubject } from '../persona-package';
import { SERVER_VERSION, type ChatUpstream } from '../server';

/**
 * Hand-rolled MCP (Model Context Protocol) stdio server for OpenMimic.
 *
 * No SDK: the protocol surface this project needs is three methods plus
 * notifications, and a JSON-RPC 2.0 line protocol is small enough to own. The
 * dispatch below is a pure function of a `Store` (plus optional model
 * clients), so the wire format is testable without spawning a process; the
 * real stdio transport lives in `main.ts`.
 */

/** Protocol version echoed when the client does not declare one. */
export const MCP_PROTOCOL_FALLBACK_VERSION = '2024-11-05';

export const MCP_SERVER_NAME = 'openmimic';

export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

/** One MCP tool advertisement (`tools/list`). */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: false,
});

/** The five tools this server exposes. */
export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'persona_list',
    description: '列出有 surviving claims 的人格(id、displayName、claim 数)。',
    inputSchema: objectSchema({}),
  },
  {
    name: 'persona_context',
    description: '返回某个人格的系统提示词(external 纪律已内建)。',
    inputSchema: objectSchema(
      { subjectId: { type: 'string', description: '当事人 id' } },
      ['subjectId'],
    ),
  },
  {
    name: 'persona_speak',
    description: '装配人格并调用上游模型做单轮回答。',
    inputSchema: objectSchema(
      {
        subjectId: { type: 'string', description: '当事人 id' },
        message: { type: 'string', description: '用户这一轮说的话' },
      },
      ['subjectId', 'message'],
    ),
  },
  {
    name: 'testimony_submit',
    description: '用邀请 token 提交一份证言,写入 append-only 账本。',
    inputSchema: objectSchema(
      {
        token: { type: 'string', description: '邀请 token' },
        relation: { type: 'string', description: '与当事人的关系' },
        stance: { type: 'string', description: '自报立场(可选)' },
        consentLevel: { type: 'string', enum: ['quotable', 'synthesis_only'] },
        answers: {
          type: 'array',
          minItems: 1,
          items: objectSchema(
            {
              qid: { type: 'string' },
              behindText: { type: 'string' },
              frontText: { type: 'string' },
              followupText: { type: 'string' },
            },
            ['qid', 'behindText'],
          ),
        },
        freeText: { type: 'string' },
        avoidedQids: { type: 'array', items: { type: 'string' } },
      },
      ['token', 'relation', 'consentLevel', 'answers'],
    ),
  },
  {
    name: 'room_run',
    description: '跑一次「背后房间」并返回转写(导入人格由 claims 驱动)。',
    inputSchema: objectSchema(
      {
        subjectId: { type: 'string', description: '当事人 id' },
        topicSeed: { type: 'string', description: '话题种子(可选)' },
      },
      ['subjectId'],
    ),
  },
];

/** Everything dispatch needs; all model clients are injectable for tests. */
export interface McpSessionOptions {
  store: Store;
  /** Room/court model used by `room_run`; absent means no model. */
  llm?: LLMClient;
  /** Chat upstream used by `persona_speak`; absent/without key means no model. */
  chat?: ChatUpstream;
  /** Injectable clock. */
  now?: () => Date;
  /** Id factory. */
  newId?: () => string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNotification = (message: Record<string, unknown>): boolean => !('id' in message);

const idOf = (message: unknown): string | number | null => {
  if (isRecord(message) && (typeof message.id === 'string' || typeof message.id === 'number')) {
    return message.id;
  }
  return null;
};

const errorResponse = (
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });

const describeZodError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
    .join('; ');

interface ToolContent {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * A successful tool result.
 *
 * Every payload crosses the `external` scope twice: the structural redactor
 * (which knows testimonies and court sessions) and the general string walk
 * (which withholds `synthesis_only` runs anywhere). A later tool cannot leak
 * raw words by accident.
 */
function toolOk(
  store: Store,
  subjectIds: readonly string[],
  payload: unknown,
): ToolContent {
  const structural = redactForExternal(store, payload);
  return {
    content: [
      { type: 'text', text: JSON.stringify(withholdSynthesisOnly(store, subjectIds, structural)) },
    ],
  };
}

function toolError(message: string): ToolContent {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

const SubjectArgsSchema = z.object({ subjectId: z.string().min(1) });
const SpeakArgsSchema = z.object({
  subjectId: z.string().min(1),
  message: z.string().min(1),
});
const RoomArgsSchema = z.object({
  subjectId: z.string().min(1),
  topicSeed: z.string().min(1).optional(),
});
const TestimonyArgsSchema = z.object({
  token: z.string().min(1),
  relation: z.string().min(1),
  stance: z.string().min(1).optional(),
  consentLevel: z.enum(['quotable', 'synthesis_only']),
  answers: z.array(z.unknown()).min(1),
  freeText: z.string().min(1).optional(),
  avoidedQids: z.array(z.string().min(1)).optional(),
});
const ChatCompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable().optional() }) }))
    .min(1),
});

async function callPersonaList(options: McpSessionOptions): Promise<ToolContent> {
  const served = options.store
    .listSubjects()
    .map((subject) => ({
      subject,
      claims: options.store
        .listClaimsBySubject(subject.id)
        .filter((claim) => claim.status === 'surviving'),
    }))
    .filter((entry) => entry.claims.length > 0);

  return toolOk(
    options.store,
    served.map((entry) => entry.subject.id),
    {
      personas: served.map((entry) => ({
        id: entry.subject.id,
        displayName: entry.subject.displayName,
        claimCount: entry.claims.length,
      })),
    },
  );
}

function callPersonaContext(options: McpSessionOptions, args: unknown): ToolContent {
  const { subjectId } = SubjectArgsSchema.parse(args);
  if (!options.store.getSubject(subjectId)) {
    return toolError(`当事人不存在:${subjectId}`);
  }
  const context = assemblePersonaContext(subjectId, options.store);
  return toolOk(options.store, [subjectId], {
    subjectId,
    systemPrompt: context.systemPrompt,
    meta: context.meta,
  });
}

async function callPersonaSpeak(
  options: McpSessionOptions,
  args: unknown,
): Promise<ToolContent> {
  const { subjectId, message } = SpeakArgsSchema.parse(args);
  if (!options.store.getSubject(subjectId)) {
    return toolError(`当事人不存在:${subjectId}`);
  }
  const { chat } = options;
  if (!chat || !chat.configured || !chat.hasApiKey) {
    return toolError('服务器未配置语言模型(缺 LLM_API_KEY),无法让人格开口');
  }

  const { systemPrompt } = assemblePersonaContext(subjectId, options.store);
  let upstream: Response;
  try {
    upstream = await chat.chatRaw([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ]);
  } catch {
    return toolError('上游模型服务不可用');
  }
  if (!upstream.ok) {
    return toolError(`上游模型返回 ${upstream.status}`);
  }
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return toolError('上游返回了无法解析的响应');
  }
  const parsed = ChatCompletionSchema.safeParse(payload);
  if (!parsed.success) return toolError('上游返回了无法解析的响应');
  const reply = parsed.data.choices[0]?.message.content ?? '';
  if (reply === '') return toolError('上游没有返回任何内容');
  return toolOk(options.store, [subjectId], { subjectId, reply });
}

function callTestimonySubmit(options: McpSessionOptions, args: unknown): ToolContent {
  const envelope = TestimonyArgsSchema.parse(args);
  const input = SubmitTestimonyInputSchema.parse({
    relation: envelope.relation,
    ...(envelope.stance !== undefined ? { stance: envelope.stance } : {}),
    consentLevel: envelope.consentLevel,
    answers: envelope.answers,
    ...(envelope.freeText !== undefined ? { freeText: envelope.freeText } : {}),
    ...(envelope.avoidedQids !== undefined ? { avoidedQids: envelope.avoidedQids } : {}),
  });
  try {
    const result = submitTestimony(options.store, envelope.token, input, {
      ...(options.now ? { now: options.now() } : {}),
      ...(options.newId ? { newId: options.newId } : {}),
    });
    return toolOk(options.store, [], result);
  } catch (caught) {
    return toolError(caught instanceof Error ? caught.message : '证言提交失败');
  }
}

async function callRoomRun(options: McpSessionOptions, args: unknown): Promise<ToolContent> {
  const { subjectId, topicSeed } = RoomArgsSchema.parse(args);
  if (!options.store.getSubject(subjectId)) {
    return toolError(`当事人不存在:${subjectId}`);
  }
  const roomOptions = topicSeed !== undefined ? { topicSeed } : {};
  try {
    if (isImportedSubject(options.store, subjectId)) {
      const room = await runImportedRoom(subjectId, options.store, options.llm, roomOptions);
      return toolOk(options.store, [subjectId], { room });
    }
    if (options.llm) {
      const room = await runBehindRoom(subjectId, options.store, options.llm, roomOptions);
      return toolOk(options.store, [subjectId], { room });
    }
    if (subjectId === DEMO_SUBJECT_ID) {
      const rooms = options.store.listRoomsBySubject(subjectId);
      const room = rooms[rooms.length - 1];
      if (!room) return toolError('演示数据未初始化');
      return toolOk(options.store, [subjectId], { room });
    }
    return toolError('服务器未配置语言模型');
  } catch (caught) {
    return toolError(caught instanceof Error ? caught.message : '房间运行失败');
  }
}

async function handleToolsCall(
  options: McpSessionOptions,
  id: string | number | null,
  params: unknown,
): Promise<JsonRpcResponse> {
  if (!isRecord(params) || typeof params.name !== 'string') {
    return errorResponse(id, JSON_RPC_ERRORS.invalidParams, 'tools/call 缺少工具名');
  }
  const args = isRecord(params.arguments) ? params.arguments : {};
  try {
    let result: ToolContent;
    switch (params.name) {
      case 'persona_list':
        result = await callPersonaList(options);
        break;
      case 'persona_context':
        result = callPersonaContext(options, args);
        break;
      case 'persona_speak':
        result = await callPersonaSpeak(options, args);
        break;
      case 'testimony_submit':
        result = callTestimonySubmit(options, args);
        break;
      case 'room_run':
        result = await callRoomRun(options, args);
        break;
      default:
        return { jsonrpc: '2.0', id, result: toolError(`未知工具:${params.name}`) };
    }
    return { jsonrpc: '2.0', id, result };
  } catch (caught) {
    if (caught instanceof z.ZodError) {
      return { jsonrpc: '2.0', id, result: toolError(describeZodError(caught)) };
    }
    return {
      jsonrpc: '2.0',
      id,
      result: toolError(caught instanceof Error ? caught.message : '工具执行失败'),
    };
  }
}

/**
 * Dispatch one decoded JSON-RPC message.
 *
 * Returns the response to write, or `undefined` for a notification (no `id`),
 * which is silently accepted. Unknown methods answer JSON-RPC method-not-found;
 * unknown tools are a tool-level `isError` result.
 */
export async function dispatchMcpMessage(
  options: McpSessionOptions,
  message: unknown,
): Promise<JsonRpcResponse | undefined> {
  if (
    !isRecord(message) ||
    message.jsonrpc !== '2.0' ||
    typeof message.method !== 'string'
  ) {
    return errorResponse(idOf(message), JSON_RPC_ERRORS.invalidRequest, 'Invalid Request');
  }
  // Notifications (e.g. `notifications/initialized`) carry no id and are
  // accepted without a reply.
  if (isNotification(message)) return undefined;
  const id = idOf(message);

  if (message.method === 'initialize') {
    const params = isRecord(message.params) ? message.params : {};
    const protocolVersion =
      typeof params.protocolVersion === 'string'
        ? params.protocolVersion
        : MCP_PROTOCOL_FALLBACK_VERSION;
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: MCP_SERVER_NAME, version: SERVER_VERSION },
      },
    };
  }

  if (message.method.startsWith('notifications/')) return undefined;

  if (message.method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };
  }

  if (message.method === 'tools/call') {
    return handleToolsCall(options, id, message.params);
  }

  return errorResponse(id, JSON_RPC_ERRORS.methodNotFound, `Method not found: ${message.method}`);
}
