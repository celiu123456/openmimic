import type { Store } from '@openmimic/kernel';
import type { Testimony } from '@openmimic/shared';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Duck-typed check for a kernel testimony, independent of its exact class. */
function looksLikeTestimony(value: Record<string, unknown>): boolean {
  return (
    typeof value.witnessId === 'string' &&
    typeof value.subjectId === 'string' &&
    Array.isArray(value.answers)
  );
}

/**
 * Recursively project a payload through the W1 authorization gate's
 * `external` scope.
 *
 * The collection API in this batch returns counts, display names and the
 * questionnaire — never raw testimony. Routing every outbound body through
 * this function means a future route cannot accidentally serialize a
 * `synthesis_only` answer: the gate replaces it with the withheld placeholder
 * before `JSON.stringify` ever sees it.
 */
export function redactForExternal(store: Store, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactForExternal(store, entry));
  if (!isRecord(value)) return value;
  if (looksLikeTestimony(value)) {
    return store.redact(value as unknown as Testimony, 'external');
  }
  const projected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    projected[key] = redactForExternal(store, entry);
  }
  return projected;
}
