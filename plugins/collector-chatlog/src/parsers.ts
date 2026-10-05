/**
 * Chat log parsers: text, CSV, and JSON.
 *
 * Each parser is a pure function that takes raw string content and returns
 * a normalized array of ChatMessage objects. Format detection is automatic
 * but can be overridden.
 *
 * All data stays in memory; nothing is written to disk.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type MessageType =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'file'
  | 'sticker'
  | 'link'
  | 'system'
  | 'recalled'
  | 'redpacket'
  | 'call'
  | 'forward'
  | 'unknown';

export interface ChatMessage {
  /** Original timestamp string from the source. */
  time: string;
  /** Parsed Date object, or undefined if time could not be parsed. */
  parsedTime?: Date;
  /** Sender display name as it appears in the export. */
  sender: string;
  /** Message content after whitespace normalization. */
  content: string;
  /** Detected message type. */
  type: MessageType;
  /** Original line number(s) in the source for diagnostics. */
  lineNumber: number;
}

export interface ParseResult {
  messages: ChatMessage[];
  format: 'text' | 'csv' | 'json';
  /** Lines/entries that could not be parsed. */
  failedLines: Array<{ line: number; text: string }>;
  /** Total lines/entries in the input. */
  totalLines: number;
}

export interface ParseOptions {
  /** Force a specific format instead of auto-detecting. */
  format?: 'text' | 'csv' | 'json';
  /** Maximum file size in bytes. Default 5MB. */
  maxSizeBytes?: number;
  /** Maximum number of messages. Default 10000. */
  maxMessages?: number;
  /** CSV column mapping override. */
  csvColumns?: {
    time?: string;
    sender?: string;
    content?: string;
    type?: string;
  };
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const DEFAULT_MAX_MESSAGES = 10_000;

/* ------------------------------------------------------------------ */
/* Date/time parsing                                                   */
/* ------------------------------------------------------------------ */

/**
 * Regex patterns for various date/time formats found in chat exports.
 * Captures: year, month, day, hour, minute, second (optional).
 */
const DATE_PATTERNS: RegExp[] = [
  // 2024-03-15 14:30:25 or 2024/03/15 14:30:25
  /(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  // 2024年3月15日 14:30:25 or 2024年3月15日 下午2:30
  /(\d{4})年(\d{1,2})月(\d{1,2})日\s*(?:上午|下午|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  // 03/15/2024 14:30 (US format — month first)
  /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/,
];

export function parseDateTime(text: string): Date | undefined {
  const trimmed = text.trim();

  for (const pattern of DATE_PATTERNS) {
    const m = pattern.exec(trimmed);
    if (!m) continue;

    // US format: groups are month/day/year
    if (pattern === DATE_PATTERNS[2]) {
      const month = parseInt(m[1]!, 10);
      const day = parseInt(m[2]!, 10);
      const year = parseInt(m[3]!, 10);
      const hour = parseInt(m[4]!, 10);
      const minute = parseInt(m[5]!, 10);
      const second = m[6] ? parseInt(m[6], 10) : 0;
      const d = new Date(year, month - 1, day, hour, minute, second);
      if (!isNaN(d.getTime())) return d;
      continue;
    }

    const year = parseInt(m[1]!, 10);
    const month = parseInt(m[2]!, 10);
    const day = parseInt(m[3]!, 10);
    let hour = parseInt(m[4]!, 10);
    const minute = parseInt(m[5]!, 10);
    const second = m[6] ? parseInt(m[6], 10) : 0;

    // Handle 下午/PM
    if (/下午|PM/i.test(trimmed) && hour < 12) hour += 12;

    const d = new Date(year, month - 1, day, hour, minute, second);
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback: ISO 8601
  const iso = new Date(trimmed);
  if (!isNaN(iso.getTime())) return iso;

  return undefined;
}

/* ------------------------------------------------------------------ */
/* Message type detection                                              */
/* ------------------------------------------------------------------ */

const SYSTEM_PATTERNS = [
  /撤回了?一条消息/,
  /withdrew a message/i,
  /recalled a message/i,
  /邀请.*加入了?群聊/,
  /invited .* to the group/i,
  /移出了?群聊/,
  /修改群名为/,
  /加入了?群聊/,
  /已成为新群主/,
  /拍了拍/,
  /开启了朋友验证/,
  /你已添加了/,
  /以上是打招呼的内容/,
  /群公告/,
  /有人@我/,
];

const RECALLED_PATTERNS = [
  /撤回了?一条消息/,
  /withdrew a message/i,
  /recalled a message/i,
];

const REDPACKET_PATTERNS = [
  /\[微信红包\]/,
  /收到红包/,
  /领取了.*红包/,
  /\[Red Packet\]/i,
];

const CALL_PATTERNS = [
  /通话时长\s*\d/,
  /语音通话/,
  /视频通话/,
  /\[语音通话\]/,
  /\[视频通话\]/,
  /Voice Call/i,
  /Video Call/i,
  /通话已取消/,
  /对方已取消/,
  /已拒绝/,
];

const MEDIA_PATTERNS: Array<{ pattern: RegExp; type: MessageType }> = [
  { pattern: /^\[图片\]$|^\[Image\]$/i, type: 'image' },
  { pattern: /^\[语音\]$|^\[Voice\]$/i, type: 'voice' },
  { pattern: /^\[视频\]$|^\[Video\]$/i, type: 'video' },
  { pattern: /^\[文件\]$|^\[File\]$/i, type: 'file' },
  { pattern: /^\[动画表情\]$|^\[Sticker\]$/i, type: 'sticker' },
  { pattern: /^\[表情\]$|^\[Emoji\]$/i, type: 'sticker' },
  { pattern: /^\[链接\]$|^\[Link\]$/i, type: 'link' },
  { pattern: /^\[转发\]$|^\[Forward\]$/i, type: 'forward' },
  { pattern: /^\[位置\]$|^\[Location\]$/i, type: 'unknown' },
  { pattern: /^\[名片\]$|^\[Contact\]$/i, type: 'unknown' },
];

export function detectMessageType(content: string): MessageType {
  const trimmed = content.trim();
  if (!trimmed) return 'unknown';

  // System messages
  for (const p of SYSTEM_PATTERNS) {
    if (p.test(trimmed)) return 'system';
  }
  for (const p of RECALLED_PATTERNS) {
    if (p.test(trimmed)) return 'recalled';
  }
  for (const p of REDPACKET_PATTERNS) {
    if (p.test(trimmed)) return 'redpacket';
  }
  for (const p of CALL_PATTERNS) {
    if (p.test(trimmed)) return 'call';
  }
  for (const { pattern, type } of MEDIA_PATTERNS) {
    if (pattern.test(trimmed)) return type;
  }

  return 'text';
}

/* ------------------------------------------------------------------ */
/* Format detection                                                    */
/* ------------------------------------------------------------------ */

export function detectFormat(content: string): 'text' | 'csv' | 'json' {
  const trimmed = content.trimStart();

  // JSON: starts with [ or {
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null)) {
        return 'json';
      }
    } catch {
      // Not valid JSON, fall through
    }
  }

  // CSV: first line looks like a header with commas
  const firstLine = trimmed.split('\n')[0]?.trim() ?? '';
  const csvHeaderPatterns = [
    /(?:time|日期|时间|date|timestamp),/i,
    /(?:sender|发送者|发送人|昵称|name),/i,
    /(?:content|内容|消息|message|text),/i,
  ];
  const commaCount = (firstLine.match(/,/g) || []).length;
  if (commaCount >= 2 && csvHeaderPatterns.some((p) => p.test(firstLine))) {
    return 'csv';
  }

  // Default: text
  return 'text';
}

/* ------------------------------------------------------------------ */
/* Text parser                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse line-based chat exports. Supports two common layouts:
 *
 * Layout A (WeChat PC copy, most export tools):
 *   2024-03-15 14:30:25 张三
 *   你好啊
 *
 * Layout B (some tools swap name and time):
 *   张三 2024-03-15 14:30:25
 *   你好啊
 */

// Layout A: time first, then name
const TEXT_HEADER_A = /^(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s+(?:上午|下午|AM|PM)?\s*\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/;

// Layout B: name first, then time
const TEXT_HEADER_B = /^(.+?)\s+(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s+(?:上午|下午|AM|PM)?\s*\d{1,2}:\d{2}(?::\d{2})?)$/;

// US date layout A: 03/15/2024 14:30 Name
const TEXT_HEADER_US_A = /^(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/;

interface TextHeaderMatch {
  time: string;
  sender: string;
}

function matchTextHeader(line: string): TextHeaderMatch | null {
  let m = TEXT_HEADER_A.exec(line);
  if (m) return { time: m[1]!, sender: m[2]!.trim() };

  m = TEXT_HEADER_US_A.exec(line);
  if (m) return { time: m[1]!, sender: m[2]!.trim() };

  m = TEXT_HEADER_B.exec(line);
  if (m) {
    // Verify the second capture is actually a date
    if (parseDateTime(m[2]!)) {
      return { time: m[2]!, sender: m[1]!.trim() };
    }
  }

  return null;
}

export function parseText(content: string, maxMessages: number): ParseResult {
  const lines = content.split('\n');
  const messages: ChatMessage[] = [];
  const failedLines: ParseResult['failedLines'] = [];
  let current: { time: string; sender: string; contentLines: string[]; startLine: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Skip empty lines between messages
    if (!trimmed) {
      continue;
    }

    const header = matchTextHeader(trimmed);
    if (header) {
      // Flush previous message
      if (current) {
        const text = current.contentLines.join('\n').trim();
        if (text) {
          messages.push({
            time: current.time,
            parsedTime: parseDateTime(current.time),
            sender: current.sender,
            content: text,
            type: detectMessageType(text),
            lineNumber: current.startLine + 1,
          });
          if (messages.length >= maxMessages) break;
        }
      }
      current = {
        time: header.time,
        sender: header.sender,
        contentLines: [],
        startLine: i,
      };
    } else if (current) {
      // Content line for the current message
      current.contentLines.push(trimmed);
    } else {
      // Line before first header — unparseable
      failedLines.push({ line: i + 1, text: trimmed.slice(0, 120) });
    }
  }

  // Flush last message
  if (current && messages.length < maxMessages) {
    const text = current.contentLines.join('\n').trim();
    if (text) {
      messages.push({
        time: current.time,
        parsedTime: parseDateTime(current.time),
        sender: current.sender,
        content: text,
        type: detectMessageType(text),
        lineNumber: current.startLine + 1,
      });
    }
  }

  return {
    messages,
    format: 'text',
    failedLines: failedLines.slice(0, 20),
    totalLines: lines.length,
  };
}

/* ------------------------------------------------------------------ */
/* CSV parser                                                          */
/* ------------------------------------------------------------------ */

/**
 * Common CSV column names (case-insensitive) for auto-detection.
 */
const TIME_COLUMNS = ['time', 'date', 'datetime', 'timestamp', '时间', '日期', '发送时间'];
const SENDER_COLUMNS = ['sender', 'name', 'from', 'user', '发送者', '发送人', '昵称', '用户'];
const CONTENT_COLUMNS = ['content', 'message', 'text', 'body', 'msg', '内容', '消息', '文本'];
const TYPE_COLUMNS = ['type', 'msgtype', 'message_type', '类型', '消息类型'];

/**
 * Parse a single CSV line, handling quoted fields with embedded newlines
 * and commas. Returns null for incomplete lines (unclosed quote).
 */
export function parseCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }

  if (inQuotes) return null; // Unclosed quote
  fields.push(current);
  return fields;
}

/**
 * Parse CSV content with multi-line field support.
 * Returns an array of string arrays, one per record.
 */
function parseCsvRecords(content: string): string[][] {
  const records: string[][] = [];
  const lines = content.split('\n');
  let pending = '';

  for (const line of lines) {
    const combined = pending ? pending + '\n' + line : line;
    const fields = parseCsvLine(combined);
    if (fields === null) {
      // Unclosed quote — accumulate
      pending = combined;
    } else {
      records.push(fields.map((f) => f.trim()));
      pending = '';
    }
  }

  // If there's still pending content, try parsing what we have
  if (pending) {
    const fields = parseCsvLine(pending + '"');
    if (fields) {
      records.push(fields.map((f) => f.trim()));
    }
  }

  return records;
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h.toLowerCase() === candidate.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseCsv(
  content: string,
  maxMessages: number,
  columnOverrides?: ParseOptions['csvColumns'],
): ParseResult {
  const records = parseCsvRecords(content);
  if (records.length < 2) {
    return { messages: [], format: 'csv', failedLines: [], totalLines: records.length };
  }

  const headers = records[0]!;
  const timeIdx = columnOverrides?.time
    ? headers.findIndex((h) => h.toLowerCase() === columnOverrides.time!.toLowerCase())
    : findColumnIndex(headers, TIME_COLUMNS);
  const senderIdx = columnOverrides?.sender
    ? headers.findIndex((h) => h.toLowerCase() === columnOverrides.sender!.toLowerCase())
    : findColumnIndex(headers, SENDER_COLUMNS);
  const contentIdx = columnOverrides?.content
    ? headers.findIndex((h) => h.toLowerCase() === columnOverrides.content!.toLowerCase())
    : findColumnIndex(headers, CONTENT_COLUMNS);
  const typeIdx = columnOverrides?.type
    ? headers.findIndex((h) => h.toLowerCase() === columnOverrides.type!.toLowerCase())
    : findColumnIndex(headers, TYPE_COLUMNS);

  if (timeIdx < 0 || senderIdx < 0 || contentIdx < 0) {
    return {
      messages: [],
      format: 'csv',
      failedLines: [{ line: 1, text: `Could not map columns. Headers: ${headers.join(', ')}` }],
      totalLines: records.length,
    };
  }

  const messages: ChatMessage[] = [];
  const failedLines: ParseResult['failedLines'] = [];

  for (let i = 1; i < records.length && messages.length < maxMessages; i++) {
    const row = records[i]!;
    const time = row[timeIdx] ?? '';
    const sender = row[senderIdx] ?? '';
    const text = row[contentIdx] ?? '';

    if (!sender || !text) {
      failedLines.push({ line: i + 1, text: row.join(',').slice(0, 120) });
      continue;
    }

    const explicitType = typeIdx >= 0 ? (row[typeIdx] ?? '') : '';
    const detectedType = explicitType ? mapExplicitType(explicitType) : detectMessageType(text);

    messages.push({
      time,
      parsedTime: parseDateTime(time),
      sender,
      content: text,
      type: detectedType,
      lineNumber: i + 1,
    });
  }

  return {
    messages,
    format: 'csv',
    failedLines: failedLines.slice(0, 20),
    totalLines: records.length,
  };
}

function mapExplicitType(raw: string): MessageType {
  const lower = raw.toLowerCase().trim();
  const map: Record<string, MessageType> = {
    text: 'text',
    image: 'image',
    voice: 'voice',
    video: 'video',
    file: 'file',
    sticker: 'sticker',
    link: 'link',
    system: 'system',
    recalled: 'recalled',
    redpacket: 'redpacket',
    call: 'call',
    forward: 'forward',
    '文本': 'text',
    '图片': 'image',
    '语音': 'voice',
    '视频': 'video',
    '文件': 'file',
    '表情': 'sticker',
    '链接': 'link',
    '系统': 'system',
    '撤回': 'recalled',
    '红包': 'redpacket',
    '通话': 'call',
    '转发': 'forward',
  };
  return map[lower] ?? 'text';
}

/* ------------------------------------------------------------------ */
/* JSON parser                                                         */
/* ------------------------------------------------------------------ */

export function parseJson(content: string, maxMessages: number): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return {
      messages: [],
      format: 'json',
      failedLines: [{ line: 1, text: 'Invalid JSON' }],
      totalLines: 0,
    };
  }

  const items = Array.isArray(data) ? data : [data];
  const messages: ChatMessage[] = [];
  const failedLines: ParseResult['failedLines'] = [];

  for (let i = 0; i < items.length && messages.length < maxMessages; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') {
      failedLines.push({ line: i + 1, text: JSON.stringify(item).slice(0, 120) });
      continue;
    }

    const obj = item as Record<string, unknown>;
    const time = String(obj.time ?? obj.timestamp ?? obj.date ?? obj['时间'] ?? '');
    const sender = String(obj.sender ?? obj.name ?? obj.from ?? obj['发送者'] ?? obj['昵称'] ?? '');
    const text = String(obj.content ?? obj.message ?? obj.text ?? obj.msg ?? obj['内容'] ?? obj['消息'] ?? '');
    const rawType = String(obj.type ?? obj.msgType ?? obj['类型'] ?? '');

    if (!sender || !text) {
      failedLines.push({ line: i + 1, text: JSON.stringify(item).slice(0, 120) });
      continue;
    }

    const detectedType = rawType ? mapExplicitType(rawType) : detectMessageType(text);

    messages.push({
      time,
      parsedTime: parseDateTime(time),
      sender,
      content: text,
      type: detectedType,
      lineNumber: i + 1,
    });
  }

  return {
    messages,
    format: 'json',
    failedLines: failedLines.slice(0, 20),
    totalLines: items.length,
  };
}

/* ------------------------------------------------------------------ */
/* Unified parse entry point                                           */
/* ------------------------------------------------------------------ */

export function parse(content: string, options: ParseOptions = {}): ParseResult {
  const maxSize = options.maxSizeBytes ?? DEFAULT_MAX_SIZE;
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;

  // Size check
  const byteSize = new TextEncoder().encode(content).length;
  if (byteSize > maxSize) {
    return {
      messages: [],
      format: 'text',
      failedLines: [{
        line: 0,
        text: `File too large: ${Math.round(byteSize / 1024)}KB exceeds limit of ${Math.round(maxSize / 1024)}KB`,
      }],
      totalLines: 0,
    };
  }

  const format = options.format ?? detectFormat(content);

  switch (format) {
    case 'json':
      return parseJson(content, maxMessages);
    case 'csv':
      return parseCsv(content, maxMessages, options.csvColumns);
    case 'text':
      return parseText(content, maxMessages);
  }
}
