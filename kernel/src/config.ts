/**
 * Configuration tree: read, validate and merge plugin lists from YAML files.
 *
 * Layers (later overrides earlier, merged by `use` key):
 *   1. openmimic.yml (default, committed)
 *   2. openmimic.local.yml (gitignored, optional)
 *   3. OPENMIMIC_CONFIG env var → file path (optional)
 *
 * An entry with `enabled: false` removes that plugin from the final list.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface PluginEntry {
  /** Module specifier or relative path, e.g. "@openmimic/engine-court" */
  use: string;
  /** Plugin-specific configuration. */
  config?: Record<string, unknown>;
  /** Set to false to disable this plugin in a higher-priority layer. */
  enabled?: boolean;
}

export interface OpenMimicConfig {
  plugins: PluginEntry[];
}

function readYaml(filePath: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) return undefined;
  const raw = readFileSync(filePath, 'utf8');
  const parsed = parseYaml(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

function parsePluginEntries(raw: unknown): PluginEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is PluginEntry =>
      typeof entry === 'object' && entry !== null && typeof (entry as PluginEntry).use === 'string',
  );
}

/**
 * Merge plugin lists: later entries override earlier entries by `use` key.
 * An entry with `enabled: false` removes the plugin.
 */
function mergePluginLists(...lists: PluginEntry[][]): PluginEntry[] {
  const byUse = new Map<string, PluginEntry>();
  const order: string[] = [];

  for (const list of lists) {
    for (const entry of list) {
      if (!byUse.has(entry.use)) {
        order.push(entry.use);
      }
      byUse.set(entry.use, entry);
    }
  }

  const result: PluginEntry[] = [];
  for (const use of order) {
    const entry = byUse.get(use)!;
    if (entry.enabled === false) continue;
    result.push(entry);
  }
  return result;
}

/**
 * Load and merge the configuration tree from the working directory.
 *
 * @param basedir The directory containing `openmimic.yml` (default: cwd).
 */
export function loadConfig(basedir?: string): OpenMimicConfig {
  const dir = basedir ?? process.cwd();

  const layers: PluginEntry[][] = [];

  // Layer 1: openmimic.yml
  const mainPath = resolve(dir, 'openmimic.yml');
  const mainDoc = readYaml(mainPath);
  if (mainDoc) layers.push(parsePluginEntries(mainDoc.plugins));

  // Layer 2: openmimic.local.yml
  const localPath = resolve(dir, 'openmimic.local.yml');
  const localDoc = readYaml(localPath);
  if (localDoc) layers.push(parsePluginEntries(localDoc.plugins));

  // Layer 3: OPENMIMIC_CONFIG env var
  const envPath = process.env.OPENMIMIC_CONFIG;
  if (envPath) {
    const absPath = resolve(dir, envPath);
    const envDoc = readYaml(absPath);
    if (envDoc) layers.push(parsePluginEntries(envDoc.plugins));
  }

  return {
    plugins: mergePluginLists(...layers),
  };
}

/**
 * Dump the merged config as YAML text (for `npm run config:dump`).
 */
export function dumpConfig(config: OpenMimicConfig): string {
  const { stringify } = require('yaml') as typeof import('yaml');
  return stringify(config, { indent: 2 });
}
