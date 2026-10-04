import type { PluginHost, Store } from '@openmimic/kernel';
import type { Room } from '@openmimic/shared';
import type { LLMClient } from './llm';
import { openDoor, runBehindRoom, type RunBehindRoomOptions } from './room';

/**
 * Official RoomEngine manifest. It is registered through the same
 * {@link PluginHost} path as any third-party plugin; there is no privileged
 * engine backdoor.
 */
export const ROOM_ENGINE_MANIFEST = {
  name: 'room',
  kind: 'engine',
  version: '0.0.1',
  description: 'Behind-the-back and face-to-face witness room simulation',
} as const;

/** Shared context the kernel hands to every plugin. */
export interface RoomEngineContext {
  store: Store;
  llm: LLMClient;
  engines: Record<string, unknown>;
}

/** The RoomEngine as exposed to embedders once assembled. */
export interface RoomEngine {
  runBehindRoom(subjectId: string, options?: RunBehindRoomOptions): Promise<Room>;
  openDoor(roomId: string): Promise<Room>;
}

/** Register the official RoomEngine with a plugin host. */
export async function registerRoomEngine(host: PluginHost<RoomEngineContext>): Promise<void> {
  await host.register(ROOM_ENGINE_MANIFEST, (context) => {
    const engine: RoomEngine = {
      runBehindRoom: (subjectId, options = {}) =>
        runBehindRoom(subjectId, context.store, context.llm, options),
      openDoor: (roomId) => openDoor(roomId, context.store, context.llm),
    };
    context.engines[ROOM_ENGINE_MANIFEST.name] = engine;
  });
}
