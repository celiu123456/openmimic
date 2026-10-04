import type { Plugin, Store } from '@openmimic/kernel';
import type { Room } from '@openmimic/shared';
import type { LLMClient } from './llm';
import { openDoor, runBehindRoom, type RunBehindRoomOptions } from './room';

/** The RoomEngine as exposed to embedders once assembled. */
export interface RoomEngine {
  runBehindRoom(subjectId: string, options?: RunBehindRoomOptions): Promise<Room>;
  openDoor(roomId: string): Promise<Room>;
}

/**
 * Standard Plugin object for the official RoomEngine.
 *
 * Registered through the same plugin path as any third-party plugin; there
 * is no privileged engine backdoor.
 */
export const roomPlugin: Plugin = {
  name: 'room',
  kind: 'engine',
  version: '0.0.1',
  inject: ['store', 'llm'],
  apply(ctx) {
    const store = ctx.get<Store>('store');
    const llm = ctx.get<LLMClient>('llm');
    const engine: RoomEngine = {
      runBehindRoom: (subjectId, options = {}) =>
        runBehindRoom(subjectId, store, llm, options),
      openDoor: (roomId) => openDoor(roomId, store, llm),
    };
    ctx.provide('room', engine);
  },
};

/* ------------------------------------------------------------------ */
/* Legacy compat — kept so old code paths continue to compile          */
/* ------------------------------------------------------------------ */

/** @deprecated Use {@link roomPlugin} instead. */
export const ROOM_ENGINE_MANIFEST = {
  name: 'room',
  kind: 'engine',
  version: '0.0.1',
  description: 'Behind-the-back and face-to-face witness room simulation',
} as const;

/** @deprecated */
export interface RoomEngineContext {
  store: Store;
  llm: LLMClient;
  engines: Record<string, unknown>;
}

/** @deprecated Use {@link roomPlugin} instead. */
export async function registerRoomEngine(
  host: { register: (manifest: unknown, setup: (ctx: unknown) => void | Promise<void>) => Promise<void> },
): Promise<void> {
  await host.register(ROOM_ENGINE_MANIFEST, (context: unknown) => {
    const ctx = context as RoomEngineContext;
    const engine: RoomEngine = {
      runBehindRoom: (subjectId, options = {}) =>
        runBehindRoom(subjectId, ctx.store, ctx.llm, options),
      openDoor: (roomId) => openDoor(roomId, ctx.store, ctx.llm),
    };
    ctx.engines[ROOM_ENGINE_MANIFEST.name] = engine;
  });
}
