import { describe, expect, it } from 'vitest';
import {
  anonymize,
  maskSensitiveFields,
  stableStringify,
  shortHash,
} from '../src/sanitize';

/* ------------------------------------------------------------------ */
/* anonymize                                                           */
/* ------------------------------------------------------------------ */

describe('anonymize', () => {
  it('replaces Chinese mobile numbers', () => {
    const result = anonymize('他的电话是13912345678,联系方式如上');
    expect(result).toBe('他的电话是[PHONE],联系方式如上');
    expect(result).not.toContain('139');
  });

  it('replaces email addresses', () => {
    const result = anonymize('邮箱 user@example.com 已确认');
    expect(result).toBe('邮箱 [EMAIL] 已确认');
  });

  it('replaces Chinese ID card numbers (18 digits)', () => {
    const result = anonymize('身份证号是110101199003075234');
    expect(result).toContain('[ID_CARD]');
    expect(result).not.toContain('110101199003');
  });

  it('replaces ID card ending in X', () => {
    const result = anonymize('证件号: 11010119900307523X');
    expect(result).toContain('[ID_CARD]');
  });

  it('replaces bank card numbers', () => {
    const result = anonymize('卡号是6222021234567890123');
    expect(result).toContain('[CARD]');
    expect(result).not.toContain('6222');
  });

  it('redacts password leaks', () => {
    const result = anonymize('密码是abc123');
    expect(result).toContain('密码[REDACTED]');
    expect(result).not.toContain('abc123');
  });

  it('redacts token leaks', () => {
    const result = anonymize('token: sk-abcdef12345');
    expect(result).toContain('token[REDACTED]');
  });

  it('redacts api_key leaks', () => {
    const result = anonymize('api_key: some-secret-value');
    expect(result).toContain('api_key[REDACTED]');
  });

  it('replaces named entities', () => {
    const result = anonymize('张三说他认识李四很久了', {
      names: ['张三', '李四'],
    });
    expect(result).toBe('[PERSON]说他认识[PERSON]很久了');
  });

  it('uses custom name replacement', () => {
    const result = anonymize('张三说的', {
      names: ['张三'],
      nameReplacement: '某人',
    });
    expect(result).toBe('某人说的');
  });

  it('skips short names (< 2 chars)', () => {
    const result = anonymize('A is here', { names: ['A'] });
    expect(result).toBe('A is here');
  });

  it('can selectively disable patterns', () => {
    const input = '电话13912345678,邮箱a@b.com';
    const result = anonymize(input, { phone: false });
    expect(result).toContain('13912345678');
    expect(result).not.toContain('a@b.com');
  });

  it('returns empty string for empty input', () => {
    expect(anonymize('')).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* maskSensitiveFields                                                 */
/* ------------------------------------------------------------------ */

describe('maskSensitiveFields', () => {
  it('masks password fields', () => {
    const result = maskSensitiveFields({ user: 'alice', password: 'secret123' });
    expect(result).toEqual({ user: 'alice', password: '******' });
  });

  it('masks nested sensitive fields', () => {
    const result = maskSensitiveFields({
      config: { apiKey: 'key123', url: 'http://test' },
    });
    expect(result).toEqual({
      config: { apiKey: '******', url: 'http://test' },
    });
  });

  it('masks arrays of objects', () => {
    const result = maskSensitiveFields([
      { token: 'abc', name: 'test' },
    ]);
    expect(result).toEqual([{ token: '******', name: 'test' }]);
  });

  it('passes through primitives unchanged', () => {
    expect(maskSensitiveFields('hello')).toBe('hello');
    expect(maskSensitiveFields(42)).toBe(42);
    expect(maskSensitiveFields(null)).toBe(null);
  });

  it('masks common sensitive field names', () => {
    const obj = {
      access_token: 'tok',
      refresh_token: 'ref',
      authorization: 'Bearer xxx',
      cookie: 'session=abc',
      session_id: '123',
    };
    const result = maskSensitiveFields(obj);
    for (const key of Object.keys(obj)) {
      expect(result[key as keyof typeof result]).toBe('******');
    }
  });
});

/* ------------------------------------------------------------------ */
/* stableStringify                                                     */
/* ------------------------------------------------------------------ */

describe('stableStringify', () => {
  it('produces same output regardless of key order', () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('handles nested objects', () => {
    const a = { outer: { z: 1, a: 2 } };
    const b = { outer: { a: 2, z: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('handles arrays (order preserved)', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles null and primitives', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('hello')).toBe('"hello"');
    expect(stableStringify(42)).toBe('42');
  });
});

/* ------------------------------------------------------------------ */
/* shortHash                                                           */
/* ------------------------------------------------------------------ */

describe('shortHash', () => {
  it('returns 8 hex characters', () => {
    const hash = shortHash({ a: 1, b: 2 });
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    expect(shortHash({ a: 1 })).toBe(shortHash({ a: 1 }));
  });

  it('is stable across key order', () => {
    expect(shortHash({ z: 1, a: 2 })).toBe(shortHash({ a: 2, z: 1 }));
  });

  it('differs for different values', () => {
    expect(shortHash({ a: 1 })).not.toBe(shortHash({ a: 2 }));
  });
});
