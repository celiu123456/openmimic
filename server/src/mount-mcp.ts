/**
 * mount-mcp: MCP tool dispatch as a plugin.
 *
 * Provides the 'mcp-dispatch' service, which is the `dispatchMcpMessage`
 * function used by `server/src/mcp/main.ts`. The MCP entry point uses this
 * service to handle JSON-RPC messages over stdio.
 */
import type { Plugin } from '@openmimic/kernel';
import type { McpSessionOptions } from './mcp/protocol';
import { dispatchMcpMessage, type JsonRpcResponse } from './mcp/protocol';
import type { ChatUpstream } from './server';
import type { Store } from '@openmimic/kernel';
import type { LLMClient } from '@openmimic/engine-room';

export type McpDispatch = (message: unknown) => Promise<JsonRpcResponse | undefined>;

export interface MountMcpConfig {
  chat?: ChatUpstream;
}

export const mountMcpPlugin: Plugin<MountMcpConfig> = {
  name: 'mount-mcp',
  kind: 'mount',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx, config) {
    const store = ctx.get<Store>('store');
    const llm = ctx.has('llm') ? ctx.get<LLMClient>('llm') : undefined;
    const chat = config?.chat;

    const options: McpSessionOptions = {
      store,
      ...(llm ? { llm } : {}),
      ...(chat ? { chat } : {}),
    };

    const dispatch: McpDispatch = (message) => dispatchMcpMessage(options, message);
    ctx.provide('mcp-dispatch', dispatch);
  },
};
