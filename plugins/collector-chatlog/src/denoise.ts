/**
 * Denoising and normalization for parsed chat messages.
 *
 * Responsibilities:
 * - Filter out non-text messages (system, media placeholders, etc.)
 * - Normalize whitespace and full-width characters
 * - Detect "burst" sequences (consecutive messages from the same sender)
 * - Count each noise category for transparency
 */
import type { ChatMessage, MessageType } from './parsers';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface DenoisedMessage {
  /** Cleaned text content. */
  text: string;
  /** Original sender name. */
  sender: string;
  /** Original timestamp string. */
  time: string;
  /** Parsed time if available. */
  parsedTime?: Date;
  /** Whether this is part of a burst (consecutive messages from same sender). */
  inBurst: boolean;
  /** Position within a burst (0-based). */
  burstIndex: number;
  /** Original line number for traceability. */
  lineNumber: number;
}

export interface DenoiseStats {
  /** Total messages before denoising. */
  totalInput: number;
  /** Messages retained as text. */
  retained: number;
  /** Breakdown of filtered messages by type. */
  filtered: Record<string, number>;
  /** Number of burst sequences detected. */
  burstCount: number;
}

export interface DenoiseResult {
  messages: DenoisedMessage[];
  stats: DenoiseStats;
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

/**
 * Normalize text: full-width to half-width for ASCII-range characters,
 * collapse whitespace, trim.
 */
export function normalizeText(text: string): string {
  let result = text;

  // Full-width ASCII to half-width (U+FF01..U+FF5E → U+0021..U+007E)
  // But keep full-width punctuation that is standard in Chinese text
  result = result.replace(/[！-～]/g, (ch) => {
    const code = ch.charCodeAt(0) - 0xFF00 + 0x20;
    // Keep certain characters full-width: Chinese quotation marks etc.
    // are in a different range, so this is fine
    return String.fromCharCode(code);
  });

  // Collapse whitespace (but preserve intentional newlines within multi-line messages)
  result = result.replace(/[ \t]+/g, ' ');
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

/* ------------------------------------------------------------------ */
/* Non-text type filter                                                */
/* ------------------------------------------------------------------ */

/** Message types that should be excluded from the corpus. */
const NON_TEXT_TYPES: Set<MessageType> = new Set([
  'image',
  'voice',
  'video',
  'file',
  'sticker',
  'link',
  'system',
  'recalled',
  'redpacket',
  'call',
  'forward',
  'unknown',
]);

/**
 * Additional content patterns that indicate non-text even when type is 'text'.
 * These are placeholder strings that WeChat and other apps insert.
 */
const NOISE_CONTENT_PATTERNS = [
  /^\[.*\]$/, // Pure bracket placeholder like [图片]
  /^<.*>$/,   // XML-style placeholder
  /^https?:\/\/\S+$/, // Pure URL with no other text
];

function isNoise(msg: ChatMessage): boolean {
  if (NON_TEXT_TYPES.has(msg.type)) return true;

  const trimmed = msg.content.trim();
  if (!trimmed) return true;

  for (const pattern of NOISE_CONTENT_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* Denoise pipeline                                                    */
/* ------------------------------------------------------------------ */

export function denoise(messages: ChatMessage[]): DenoiseResult {
  const filtered: Record<string, number> = {};
  const retained: DenoisedMessage[] = [];

  // First pass: filter noise and normalize
  for (const msg of messages) {
    if (isNoise(msg)) {
      const key = msg.type === 'text' ? 'empty_or_placeholder' : msg.type;
      filtered[key] = (filtered[key] ?? 0) + 1;
      continue;
    }

    const text = normalizeText(msg.content);
    if (!text) {
      filtered['empty_after_normalize'] = (filtered['empty_after_normalize'] ?? 0) + 1;
      continue;
    }

    retained.push({
      text,
      sender: msg.sender,
      time: msg.time,
      parsedTime: msg.parsedTime,
      inBurst: false,
      burstIndex: 0,
      lineNumber: msg.lineNumber,
    });
  }

  // Second pass: detect bursts
  let burstCount = 0;
  let burstStart = 0;
  for (let i = 0; i < retained.length; i++) {
    const current = retained[i]!;
    const prev = i > 0 ? retained[i - 1] : undefined;

    if (prev && prev.sender === current.sender) {
      if (!prev.inBurst) {
        // Start of a new burst
        prev.inBurst = true;
        prev.burstIndex = 0;
        burstStart = i - 1;
        burstCount++;
      }
      current.inBurst = true;
      current.burstIndex = i - burstStart;
    } else {
      burstStart = i;
    }
  }

  return {
    messages: retained,
    stats: {
      totalInput: messages.length,
      retained: retained.length,
      filtered,
      burstCount,
    },
  };
}
