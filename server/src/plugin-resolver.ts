/**
 * Plugin resolver: the single location that maps `use` names from
 * openmimic.yml to concrete Plugin objects.
 *
 * This is the only file in the server that imports engine plugin objects
 * at the module level. Everything else accesses engines through the
 * plugin context (`ctx.get('court')`, etc.).
 */

import type { Plugin } from '@openmimic/kernel';
import { witnessPlugin, chatPlugin } from '@openmimic/engine-witness';
import { courtPlugin } from '@openmimic/engine-court';
import { roomPlugin } from '@openmimic/engine-room';
import { gatePlugin } from '@openmimic/engine-gate';
import { metaPerceptionPlugin } from '@openmimic/meta-perception';
import { silenceSignalPlugin } from '@openmimic/silence-signal';
import { mountRestPlugin } from './mount-rest';
import { mountOpenaiPlugin } from './mount-openai';
import { mountMcpPlugin } from './mount-mcp';

// Lazily load optional community plugins to avoid hard failures when
// the directory structure changes.
function tryRequirePlugin(relativePath: string): Plugin | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(relativePath);
    return (mod.default ?? mod.plugin ?? Object.values(mod).find(
      (v: unknown) => typeof v === 'object' && v !== null && 'name' in v && 'kind' in v,
    )) as Plugin | undefined;
  } catch {
    return undefined;
  }
}

const BUILTIN_PLUGINS: ReadonlyMap<string, Plugin> = new Map<string, Plugin>([
  ['@openmimic/engine-witness', witnessPlugin],
  ['@openmimic/engine-chat', chatPlugin],
  ['@openmimic/engine-court', courtPlugin],
  ['@openmimic/engine-room', roomPlugin],
  ['@openmimic/engine-gate', gatePlugin],
  ['@openmimic/meta-perception', metaPerceptionPlugin],
  ['@openmimic/silence-signal', silenceSignalPlugin],
  ['@openmimic/mount-rest', mountRestPlugin],
  ['@openmimic/mount-openai', mountOpenaiPlugin],
  ['@openmimic/mount-mcp', mountMcpPlugin],
]);

/**
 * Resolve a `use` specifier from the config to a Plugin object.
 *
 * Known built-in names are resolved from the static map; relative paths
 * (starting with `.`) are dynamically loaded. Returns `undefined` if the
 * plugin cannot be resolved.
 */
export function resolvePlugin(use: string): Plugin | undefined {
  const builtin = BUILTIN_PLUGINS.get(use);
  if (builtin) return builtin;

  // Relative path: try dynamic require
  if (use.startsWith('.')) {
    return tryRequirePlugin(use);
  }

  return undefined;
}
