/**
 * Corpus builder: filter, deduplicate, sample, and prepare messages
 * for insertion into the corpus.
 *
 * This module is a pure function pipeline — it takes denoised messages
 * and produces corpus-ready items with full statistics.
 */
import { anonymize } from '@openmimic/shared';
import { detectInjection } from '@openmimic/shared';
import { screenReflux, type AiFingerprint } from '@openmimic/kernel';
import type { DenoisedMessage } from './denoise';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface CorpusCandidate {
  /** The cleaned, anonymized text. */
  text: string;
  /** Original timestamp. */
  time: string;
  /** Parsed time, if available. */
  parsedTime?: Date;
  /** Number of duplicate occurrences (>1 = potential catchphrase). */
  occurrences: number;
  /** Whether this was part of a burst sequence. */
  inBurst: boolean;
  /** Original line number for traceability. */
  lineNumber: number;
}

export interface BuildOptions {
  /** Sender names to treat as the subject (the person being modeled). */
  selfNames: string[];
  /** Maximum text length to include. Default 120 characters. */
  maxLength?: number;
  /** Whether to keep low-content messages (single punctuation, pure particles). Default true. */
  keepLowContent?: boolean;
  /** Maximum number of corpus items. Default 500. */
  maxItems?: number;
  /** AI fingerprints for reflux detection. */
  fingerprints?: AiFingerprint[];
}

export interface BuildStats {
  /** Total messages from the subject. */
  selfTotal: number;
  /** Total messages from others. */
  othersTotal: number;
  /** Messages excluded for being too long. */
  tooLong: number;
  /** Exact duplicates collapsed (total occurrences - unique count). */
  duplicatesRemoved: number;
  /** Messages flagged for suspected injection. */
  injectionFlagged: number;
  /** Messages excluded for reflux suspicion. */
  refluxExcluded: number;
  /** Messages after all filtering. */
  afterFilter: number;
  /** Messages after sampling to maxItems. */
  afterSampling: number;
  /** Catchphrases detected (text appearing 3+ times). */
  catchphrases: Array<{ text: string; count: number }>;
}

export interface BuildResult {
  candidates: CorpusCandidate[];
  stats: BuildStats;
}

/* ------------------------------------------------------------------ */
/* Pure particle / low-content detection                               */
/* ------------------------------------------------------------------ */

const PURE_PARTICLE_PATTERN = /^[。，！？、…～~·.!?,;；：:""''「」『』【】（）()\s]+$/;
const PURE_INTERJECTION_PATTERN = /^(嗯|哦|啊|哈|呵|嘿|唔|噢|啧|呃|额|哎|嗨|喂|嘻|吼|咳|嗷|呜|诶)+[。！？!?~～…]*$/;

function isLowContent(text: string): boolean {
  return PURE_PARTICLE_PATTERN.test(text) || PURE_INTERJECTION_PATTERN.test(text);
}

/* ------------------------------------------------------------------ */
/* Uniform time-based sampling                                         */
/* ------------------------------------------------------------------ */

/**
 * Sample items uniformly across time, preferring temporal diversity
 * over recency bias.
 */
function uniformSample<T extends { parsedTime?: Date }>(
  items: T[],
  maxCount: number,
): T[] {
  if (items.length <= maxCount) return items;

  // Sort by time (items without parsed time go to the end)
  const sorted = [...items].sort((a, b) => {
    const ta = a.parsedTime?.getTime() ?? Infinity;
    const tb = b.parsedTime?.getTime() ?? Infinity;
    return ta - tb;
  });

  // Pick evenly spaced indices
  const step = sorted.length / maxCount;
  const result: T[] = [];
  for (let i = 0; i < maxCount; i++) {
    const idx = Math.min(Math.floor(i * step), sorted.length - 1);
    result.push(sorted[idx]!);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Build corpus                                                        */
/* ------------------------------------------------------------------ */

export function buildCorpus(
  messages: DenoisedMessage[],
  options: BuildOptions,
): BuildResult {
  const selfNamesLower = new Set(options.selfNames.map((n) => n.toLowerCase().trim()));
  const maxLength = options.maxLength ?? 120;
  const keepLowContent = options.keepLowContent ?? true;
  const maxItems = options.maxItems ?? 500;
  const fingerprints = options.fingerprints ?? [];

  const stats: BuildStats = {
    selfTotal: 0,
    othersTotal: 0,
    tooLong: 0,
    duplicatesRemoved: 0,
    injectionFlagged: 0,
    refluxExcluded: 0,
    afterFilter: 0,
    afterSampling: 0,
    catchphrases: [],
  };

  // Step 1: Split by sender
  const selfMessages: DenoisedMessage[] = [];

  for (const msg of messages) {
    if (selfNamesLower.has(msg.sender.toLowerCase().trim())) {
      selfMessages.push(msg);
      stats.selfTotal++;
    } else {
      stats.othersTotal++;
    }
  }

  // Step 2: Filter by length and low-content
  const lengthFiltered: DenoisedMessage[] = [];
  for (const msg of selfMessages) {
    const charCount = Array.from(msg.text).length;
    if (charCount > maxLength) {
      stats.tooLong++;
      continue;
    }
    if (!keepLowContent && isLowContent(msg.text)) {
      continue;
    }
    lengthFiltered.push(msg);
  }

  // Step 3: Anonymize
  const anonymized = lengthFiltered.map((msg) => ({
    ...msg,
    text: anonymize(msg.text),
  }));

  // Step 4: Injection detection (flag, don't exclude)
  const withInjectionCheck = anonymized.map((msg) => {
    const injection = detectInjection(msg.text);
    if (injection) stats.injectionFlagged++;
    return { ...msg, injectionMatch: injection };
  });

  // Step 5: Reflux screening (exclude high/low suspicion)
  const afterReflux = withInjectionCheck.filter((msg) => {
    if (fingerprints.length === 0) return true;
    const match = screenReflux(msg.text, fingerprints);
    if (match.suspicion !== 'none') {
      stats.refluxExcluded++;
      return false;
    }
    return true;
  });

  // Step 6: Deduplication with occurrence counting
  const dedup = new Map<string, { msg: DenoisedMessage; count: number }>();
  for (const msg of afterReflux) {
    const key = msg.text.trim();
    const existing = dedup.get(key);
    if (existing) {
      existing.count++;
      stats.duplicatesRemoved++;
    } else {
      dedup.set(key, { msg, count: 1 });
    }
  }

  // Extract catchphrases (3+ occurrences)
  stats.catchphrases = Array.from(dedup.entries())
    .filter(([, v]) => v.count >= 3)
    .map(([text, v]) => ({ text, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Step 7: Build candidates
  const candidates: CorpusCandidate[] = Array.from(dedup.values()).map(({ msg, count }) => ({
    text: msg.text,
    time: msg.time,
    parsedTime: msg.parsedTime,
    occurrences: count,
    inBurst: msg.inBurst,
    lineNumber: msg.lineNumber,
  }));

  stats.afterFilter = candidates.length;

  // Step 8: Uniform time sampling if over limit
  const sampled = uniformSample(candidates, maxItems);
  stats.afterSampling = sampled.length;

  return { candidates: sampled, stats };
}
