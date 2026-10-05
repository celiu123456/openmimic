/**
 * Tests for chat log parsers.
 *
 * All test data is fabricated. No real chat content is used.
 */
import { describe, it, expect } from 'vitest';
import {
  parse,
  detectFormat,
  parseDateTime,
  detectMessageType,
} from '../src/parsers';
import { parseCsvLine } from '../src/parsers';

/* ------------------------------------------------------------------ */
/* Date/time parsing                                                   */
/* ------------------------------------------------------------------ */

describe('parseDateTime', () => {
  it('parses YYYY-MM-DD HH:mm:ss', () => {
    const d = parseDateTime('2024-03-15 14:30:25');
    expect(d).toBeDefined();
    expect(d!.getFullYear()).toBe(2024);
    expect(d!.getMonth()).toBe(2); // 0-based
    expect(d!.getDate()).toBe(15);
    expect(d!.getHours()).toBe(14);
    expect(d!.getMinutes()).toBe(30);
    expect(d!.getSeconds()).toBe(25);
  });

  it('parses YYYY/MM/DD HH:mm', () => {
    const d = parseDateTime('2024/03/15 09:05');
    expect(d).toBeDefined();
    expect(d!.getHours()).toBe(9);
    expect(d!.getMinutes()).toBe(5);
  });

  it('parses YYYY年M月D日 HH:mm:ss', () => {
    const d = parseDateTime('2024年3月5日 8:05:00');
    expect(d).toBeDefined();
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(5);
  });

  it('parses ISO 8601', () => {
    const d = parseDateTime('2024-03-15T14:30:25.000Z');
    expect(d).toBeDefined();
    expect(d!.getFullYear()).toBe(2024);
  });

  it('returns undefined for garbage', () => {
    expect(parseDateTime('not a date')).toBeUndefined();
    expect(parseDateTime('')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Message type detection                                              */
/* ------------------------------------------------------------------ */

describe('detectMessageType', () => {
  it('detects system messages', () => {
    expect(detectMessageType('"小明"撤回了一条消息')).toBe('system');
    expect(detectMessageType('"张三"邀请"李四"加入了群聊')).toBe('system');
    expect(detectMessageType('你拍了拍"王五"')).toBe('system');
  });

  it('detects media placeholders', () => {
    expect(detectMessageType('[图片]')).toBe('image');
    expect(detectMessageType('[语音]')).toBe('voice');
    expect(detectMessageType('[视频]')).toBe('video');
    expect(detectMessageType('[文件]')).toBe('file');
    expect(detectMessageType('[动画表情]')).toBe('sticker');
    expect(detectMessageType('[链接]')).toBe('link');
  });

  it('detects red packets', () => {
    expect(detectMessageType('[微信红包]请查收')).toBe('redpacket');
  });

  it('detects calls', () => {
    expect(detectMessageType('语音通话')).toBe('call');
    expect(detectMessageType('通话时长 05:23')).toBe('call');
  });

  it('returns text for normal content', () => {
    expect(detectMessageType('今天天气不错')).toBe('text');
    expect(detectMessageType('好的，我知道了')).toBe('text');
  });
});

/* ------------------------------------------------------------------ */
/* Format detection                                                    */
/* ------------------------------------------------------------------ */

describe('detectFormat', () => {
  it('detects JSON array', () => {
    expect(detectFormat('[{"time":"2024-01-01","sender":"A","content":"hi"}]')).toBe('json');
  });

  it('detects JSON object', () => {
    expect(detectFormat('{"time":"2024-01-01","sender":"A","content":"hi"}')).toBe('json');
  });

  it('detects CSV with standard headers', () => {
    expect(detectFormat('time,sender,content\n2024-01-01,A,hello')).toBe('csv');
    expect(detectFormat('时间,发送者,内容\n2024-01-01,张三,你好')).toBe('csv');
  });

  it('defaults to text', () => {
    expect(detectFormat('2024-03-15 14:30 张三\n你好啊')).toBe('text');
    expect(detectFormat('random text')).toBe('text');
  });
});

/* ------------------------------------------------------------------ */
/* Text parser                                                         */
/* ------------------------------------------------------------------ */

describe('parse text format', () => {
  it('parses layout A: time then name', () => {
    const input = [
      '2024-03-15 14:30:25 张三',
      '你好啊，最近怎么样？',
      '',
      '2024-03-15 14:31:02 李四',
      '还行，最近比较忙。',
    ].join('\n');

    const result = parse(input, { format: 'text' });
    expect(result.format).toBe('text');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.sender).toBe('张三');
    expect(result.messages[0]!.content).toBe('你好啊，最近怎么样？');
    expect(result.messages[1]!.sender).toBe('李四');
    expect(result.messages[1]!.content).toBe('还行，最近比较忙。');
  });

  it('parses layout B: name then time', () => {
    const input = [
      '张三 2024-03-15 14:30:25',
      '你好啊',
      '',
      '李四 2024-03-15 14:31:02',
      '你也好',
    ].join('\n');

    const result = parse(input, { format: 'text' });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.sender).toBe('张三');
    expect(result.messages[1]!.sender).toBe('李四');
  });

  it('handles multi-line content', () => {
    const input = [
      '2024-03-15 14:30:25 张三',
      '第一行',
      '第二行',
      '第三行',
      '',
      '2024-03-15 14:31:02 李四',
      '回复',
    ].join('\n');

    const result = parse(input, { format: 'text' });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.content).toBe('第一行\n第二行\n第三行');
  });

  it('records failed lines before first header', () => {
    const input = [
      'some random text before',
      '2024-03-15 14:30:25 张三',
      '你好',
    ].join('\n');

    const result = parse(input, { format: 'text' });
    expect(result.failedLines).toHaveLength(1);
    expect(result.failedLines[0]!.text).toContain('random');
  });

  it('handles Chinese date format', () => {
    const input = [
      '2024年3月15日 14:30 张三',
      '你好',
    ].join('\n');

    const result = parse(input, { format: 'text' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.sender).toBe('张三');
    expect(result.messages[0]!.parsedTime).toBeDefined();
  });

  it('respects maxMessages', () => {
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(`2024-03-15 14:${String(i).padStart(2, '0')}:00 用户${i}`);
      lines.push(`消息${i}`);
      lines.push('');
    }
    const result = parse(lines.join('\n'), { format: 'text', maxMessages: 3 });
    expect(result.messages).toHaveLength(3);
  });

  it('detects system message types in text format', () => {
    const input = [
      '2024-03-15 14:30:25 张三',
      '"小明"撤回了一条消息',
      '',
      '2024-03-15 14:31:02 李四',
      '今天天气真好',
    ].join('\n');

    const result = parse(input, { format: 'text' });
    expect(result.messages[0]!.type).toBe('system');
    expect(result.messages[1]!.type).toBe('text');
  });
});

/* ------------------------------------------------------------------ */
/* CSV parser                                                          */
/* ------------------------------------------------------------------ */

describe('parseCsvLine', () => {
  it('parses simple fields', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields with commas', () => {
    expect(parseCsvLine('"hello, world",b,c')).toEqual(['hello, world', 'b', 'c']);
  });

  it('handles escaped quotes', () => {
    expect(parseCsvLine('"he said ""hi""",b')).toEqual(['he said "hi"', 'b']);
  });

  it('returns null for unclosed quote', () => {
    expect(parseCsvLine('"unclosed')).toBeNull();
  });
});

describe('parse CSV format', () => {
  it('parses standard CSV with auto-detected columns', () => {
    const input = [
      'time,sender,content',
      '2024-03-15 14:30,张三,你好啊',
      '2024-03-15 14:31,李四,你也好',
    ].join('\n');

    const result = parse(input, { format: 'csv' });
    expect(result.format).toBe('csv');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.sender).toBe('张三');
    expect(result.messages[0]!.content).toBe('你好啊');
  });

  it('auto-detects Chinese column names', () => {
    const input = [
      '时间,发送者,内容',
      '2024-03-15 14:30,张三,你好',
    ].join('\n');

    const result = parse(input, { format: 'csv' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.sender).toBe('张三');
  });

  it('handles content with commas in quotes', () => {
    const input = [
      'time,sender,content',
      '2024-03-15 14:30,张三,"你好，最近怎么样？"',
    ].join('\n');

    const result = parse(input, { format: 'csv' });
    expect(result.messages[0]!.content).toBe('你好，最近怎么样？');
  });

  it('uses explicit type column when present', () => {
    const input = [
      'time,sender,content,type',
      '2024-03-15 14:30,张三,[图片],image',
      '2024-03-15 14:31,张三,你好,text',
    ].join('\n');

    const result = parse(input, { format: 'csv' });
    expect(result.messages[0]!.type).toBe('image');
    expect(result.messages[1]!.type).toBe('text');
  });

  it('uses column overrides', () => {
    const input = [
      'ts,who,msg',
      '2024-03-15 14:30,张三,你好',
    ].join('\n');

    const result = parse(input, {
      format: 'csv',
      csvColumns: { time: 'ts', sender: 'who', content: 'msg' },
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.sender).toBe('张三');
  });

  it('reports unmapped columns as failed line', () => {
    const input = [
      'col1,col2,col3',
      'a,b,c',
    ].join('\n');

    const result = parse(input, { format: 'csv' });
    expect(result.messages).toHaveLength(0);
    expect(result.failedLines.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* JSON parser                                                         */
/* ------------------------------------------------------------------ */

describe('parse JSON format', () => {
  it('parses simple JSON array', () => {
    const input = JSON.stringify([
      { time: '2024-03-15 14:30', sender: '张三', content: '你好' },
      { time: '2024-03-15 14:31', sender: '李四', content: '你也好' },
    ]);

    const result = parse(input, { format: 'json' });
    expect(result.format).toBe('json');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.sender).toBe('张三');
  });

  it('accepts alternative field names', () => {
    const input = JSON.stringify([
      { timestamp: '2024-03-15', name: '张三', message: '你好' },
    ]);

    const result = parse(input, { format: 'json' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.sender).toBe('张三');
    expect(result.messages[0]!.content).toBe('你好');
  });

  it('accepts Chinese field names', () => {
    const input = JSON.stringify([
      { '时间': '2024-03-15', '昵称': '张三', '内容': '你好' },
    ]);

    const result = parse(input, { format: 'json' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.sender).toBe('张三');
  });

  it('handles invalid JSON gracefully', () => {
    const result = parse('not json at all {{{', { format: 'json' });
    expect(result.messages).toHaveLength(0);
    expect(result.failedLines).toHaveLength(1);
  });

  it('skips entries missing required fields', () => {
    const input = JSON.stringify([
      { time: '2024-03-15', sender: '张三', content: '你好' },
      { time: '2024-03-15' }, // missing sender and content
      { time: '2024-03-15', sender: '李四', content: '回复' },
    ]);

    const result = parse(input, { format: 'json' });
    expect(result.messages).toHaveLength(2);
    expect(result.failedLines).toHaveLength(1);
  });

  it('uses explicit type field when present', () => {
    const input = JSON.stringify([
      { time: '2024-03-15', sender: '张三', content: '[图片]', type: 'image' },
    ]);

    const result = parse(input, { format: 'json' });
    expect(result.messages[0]!.type).toBe('image');
  });
});

/* ------------------------------------------------------------------ */
/* Format auto-detection                                               */
/* ------------------------------------------------------------------ */

describe('auto-detection', () => {
  it('auto-detects text format', () => {
    const input = '2024-03-15 14:30:25 张三\n你好\n';
    const result = parse(input);
    expect(result.format).toBe('text');
  });

  it('auto-detects CSV format', () => {
    const input = 'time,sender,content\n2024-03-15,张三,你好\n';
    const result = parse(input);
    expect(result.format).toBe('csv');
  });

  it('auto-detects JSON format', () => {
    const input = '[{"time":"2024-03-15","sender":"张三","content":"你好"}]';
    const result = parse(input);
    expect(result.format).toBe('json');
  });
});

/* ------------------------------------------------------------------ */
/* Size limit                                                          */
/* ------------------------------------------------------------------ */

describe('size limit', () => {
  it('rejects content exceeding maxSizeBytes', () => {
    const bigContent = 'x'.repeat(1024);
    const result = parse(bigContent, { maxSizeBytes: 100 });
    expect(result.messages).toHaveLength(0);
    expect(result.failedLines).toHaveLength(1);
    expect(result.failedLines[0]!.text).toContain('too large');
  });
});
