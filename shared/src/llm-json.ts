/**
 * Unified JSON extraction from LLM responses.
 *
 * Tolerates markdown fences, surrounding prose, and common LLM formatting
 * quirks. This is the single canonical implementation — all engines import
 * from here instead of maintaining local copies.
 */

/**
 * Extract a JSON value from a possibly chatty LLM response.
 *
 * Strategy (in order):
 * 1. Direct JSON.parse of the trimmed response
 * 2. Extract from markdown code fence (```json ... ```)
 * 3. Find the outermost JSON structure ([...] or {...})
 *
 * Throws if no parseable JSON is found.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // 1. Direct parse
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    /* fall through */
  }

  // 2. Fenced code block
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim()) as unknown;
    } catch {
      /* fall through */
    }
  }

  // 3. Find outermost JSON structure
  const start = trimmed.search(/[[{]/);
  if (start >= 0) {
    const candidate = trimmed.slice(start);
    for (const closing of [']', '}'] as const) {
      const end = candidate.lastIndexOf(closing);
      if (end > 0) {
        try {
          return JSON.parse(candidate.slice(0, end + 1)) as unknown;
        } catch {
          /* try the other bracket */
        }
      }
    }
  }

  throw new Error('LLM response did not contain parseable JSON');
}

/**
 * Try to extract JSON without throwing. Returns undefined on failure.
 */
export function tryExtractJson(text: string): unknown {
  try {
    return extractJson(text);
  } catch {
    return undefined;
  }
}
