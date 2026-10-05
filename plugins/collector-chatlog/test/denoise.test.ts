/**
 * Tests for denoising and normalization.
 *
 * All test data is fabricated.
 */
import { describe, it, expect } from 'vitest';
import { denoise, normalizeText } from '../src/denoise';
import type { ChatMessage } from '../src/parsers';

function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    time: '2024-03-15 14:30:00',
    sender: '张三',
    content: '你好',
    type: 'text',
    lineNumber: 1,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* normalizeText                                                       */
/* ------------------------------------------------------------------ */

describe('normalizeText', () => {
  it('converts full-width ASCII to half-width', () => {
    expect(normalizeText('ＡＢＣ')).toBe('ABC');
    expect(normalizeText('１２３')).toBe('123');
  });

  it('collapses whitespace', () => {
    expect(normalizeText('你好   世界')).toBe('你好 世界');
    expect(normalizeText('  前后空格  ')).toBe('前后空格');
  });

  it('preserves single newlines', () => {
    expect(normalizeText('第一行\n第二行')).toBe('第一行\n第二行');
  });

  it('collapses excessive newlines', () => {
    expect(normalizeText('a\n\n\n\nb')).toBe('a\n\nb');
  });
});

/* ------------------------------------------------------------------ */
/* denoise                                                             */
/* ------------------------------------------------------------------ */

describe('denoise', () => {
  it('retains text messages', () => {
    const result = denoise([msg({ content: '你好' }), msg({ content: '再见' })]);
    expect(result.messages).toHaveLength(2);
    expect(result.stats.retained).toBe(2);
  });

  it('filters system messages', () => {
    const result = denoise([
      msg({ content: '"小明"撤回了一条消息', type: 'system' }),
      msg({ content: '你好', type: 'text' }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.stats.filtered.system).toBe(1);
  });

  it('filters image placeholders', () => {
    const result = denoise([msg({ content: '[图片]', type: 'image' })]);
    expect(result.messages).toHaveLength(0);
    expect(result.stats.filtered.image).toBe(1);
  });

  it('filters voice placeholders', () => {
    const result = denoise([msg({ content: '[语音]', type: 'voice' })]);
    expect(result.messages).toHaveLength(0);
  });

  it('filters video placeholders', () => {
    const result = denoise([msg({ content: '[视频]', type: 'video' })]);
    expect(result.messages).toHaveLength(0);
  });

  it('filters sticker placeholders', () => {
    const result = denoise([msg({ content: '[动画表情]', type: 'sticker' })]);
    expect(result.messages).toHaveLength(0);
  });

  it('filters link placeholders', () => {
    const result = denoise([msg({ content: '[链接]', type: 'link' })]);
    expect(result.messages).toHaveLength(0);
  });

  it('filters red packets', () => {
    const result = denoise([msg({ content: '[微信红包]请查收', type: 'redpacket' })]);
    expect(result.messages).toHaveLength(0);
  });

  it('filters call records', () => {
    const result = denoise([msg({ content: '语音通话', type: 'call' })]);
    expect(result.messages).toHaveLength(0);
  });

  it('filters forward messages', () => {
    const result = denoise([msg({ content: '[转发]', type: 'forward' })]);
    expect(result.messages).toHaveLength(0);
  });

  it('filters pure bracket placeholders even with type text', () => {
    const result = denoise([msg({ content: '[某种占位符]', type: 'text' })]);
    expect(result.messages).toHaveLength(0);
  });

  it('filters pure URLs', () => {
    const result = denoise([msg({ content: 'https://example.com/path', type: 'text' })]);
    expect(result.messages).toHaveLength(0);
  });

  it('filters empty content', () => {
    const result = denoise([msg({ content: '', type: 'text' })]);
    expect(result.messages).toHaveLength(0);
  });

  it('normalizes text during denoise', () => {
    const result = denoise([msg({ content: '你好   世界' })]);
    expect(result.messages[0]!.text).toBe('你好 世界');
  });

  it('detects burst sequences', () => {
    const result = denoise([
      msg({ sender: '张三', content: '第一条' }),
      msg({ sender: '张三', content: '第二条' }),
      msg({ sender: '张三', content: '第三条' }),
      msg({ sender: '李四', content: '回复' }),
    ]);
    expect(result.messages[0]!.inBurst).toBe(true);
    expect(result.messages[1]!.inBurst).toBe(true);
    expect(result.messages[2]!.inBurst).toBe(true);
    expect(result.messages[3]!.inBurst).toBe(false);
    expect(result.stats.burstCount).toBe(1);
  });

  it('detects multiple bursts', () => {
    const result = denoise([
      msg({ sender: '张三', content: '你好' }),
      msg({ sender: '张三', content: '在吗' }),
      msg({ sender: '李四', content: '在' }),
      msg({ sender: '李四', content: '怎么了' }),
    ]);
    expect(result.stats.burstCount).toBe(2);
  });

  it('provides accurate stats', () => {
    const result = denoise([
      msg({ type: 'text', content: '你好' }),
      msg({ type: 'image', content: '[图片]' }),
      msg({ type: 'system', content: '拍了拍' }),
      msg({ type: 'text', content: '再见' }),
    ]);
    expect(result.stats.totalInput).toBe(4);
    expect(result.stats.retained).toBe(2);
    expect(result.stats.filtered.image).toBe(1);
    expect(result.stats.filtered.system).toBe(1);
  });
});
