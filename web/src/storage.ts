/**
 * The tiny slice of the Web Storage API this app needs.
 *
 * Depending on this interface (instead of the global `Storage`) keeps the
 * persistence modules free of `window`, so they run in plain Node under
 * vitest with an in-memory fake.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Read and parse a JSON value, returning `undefined` for anything unusable. */
export function readJson<T>(store: KeyValueStore, key: string): T | undefined {
  const raw = store.getItem(key);
  if (raw === null || raw === '') return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Serialize `value`, ignoring quota/serialization failures. */
export function writeJson(store: KeyValueStore, key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // A draft that cannot be persisted is still usable in memory.
  }
}

/** Best-effort remove; never throws when storage is unavailable. */
export function removeKey(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}
