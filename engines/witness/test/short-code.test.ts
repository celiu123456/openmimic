import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import {
  SHORT_CODE_ALPHABET,
  SHORT_CODE_LENGTH,
  generateShortCode,
  normalizeShortCode,
  isValidShortCode,
} from '../src/short-code';
import {
  createInvite,
  resolveInvite,
  resolveShortCode,
} from '../src/invite';
import { InviteInvalidError } from '../src/errors';

/* ------------------------------------------------------------------ */
/* Alphabet                                                            */
/* ------------------------------------------------------------------ */

describe('short code alphabet', () => {
  it('excludes ambiguous characters 0, O, 1, I, L', () => {
    expect(SHORT_CODE_ALPHABET).not.toContain('0');
    expect(SHORT_CODE_ALPHABET).not.toContain('O');
    expect(SHORT_CODE_ALPHABET).not.toContain('1');
    expect(SHORT_CODE_ALPHABET).not.toContain('I');
    expect(SHORT_CODE_ALPHABET).not.toContain('L');
  });

  it('contains only uppercase letters and digits', () => {
    for (const ch of SHORT_CODE_ALPHABET) {
      expect(ch).toMatch(/[A-Z0-9]/);
    }
  });

  it('has no duplicate characters', () => {
    const chars = new Set(SHORT_CODE_ALPHABET);
    expect(chars.size).toBe(SHORT_CODE_ALPHABET.length);
  });
});

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

describe('generateShortCode', () => {
  it('produces exactly 8 characters from the alphabet', () => {
    const code = generateShortCode();
    expect(code).toHaveLength(SHORT_CODE_LENGTH);
    for (const ch of code) {
      expect(SHORT_CODE_ALPHABET).toContain(ch);
    }
  });

  it('produces different codes on successive calls', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateShortCode());
    }
    // With 29^8 = ~21 billion possibilities, 100 codes should all be unique
    expect(codes.size).toBe(100);
  });
});

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

describe('normalizeShortCode', () => {
  it('converts to uppercase', () => {
    const code = generateShortCode();
    const lower = code.toLowerCase();
    expect(normalizeShortCode(lower)).toBe(code);
  });

  it('trims whitespace', () => {
    const code = generateShortCode();
    expect(normalizeShortCode(`  ${code}  `)).toBe(code);
  });

  it('rejects wrong length', () => {
    expect(normalizeShortCode('ABC')).toBeUndefined();
    expect(normalizeShortCode('ABCDEFGHJK')).toBeUndefined();
  });

  it('rejects ambiguous characters', () => {
    expect(normalizeShortCode('ABCDEFGO')).toBeUndefined(); // O
    expect(normalizeShortCode('ABCDEFG0')).toBeUndefined(); // 0
    expect(normalizeShortCode('ABCDEFG1')).toBeUndefined(); // 1
    expect(normalizeShortCode('IABCDEFG')).toBeUndefined(); // I
    expect(normalizeShortCode('LABCDEFG')).toBeUndefined(); // L
  });

  it('accepts valid codes', () => {
    expect(isValidShortCode('ABCDEFGH')).toBe(true);
    expect(isValidShortCode('23456789')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Integration with invite system                                      */
/* ------------------------------------------------------------------ */

describe('short code invite integration', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
    store.putSubject({
      id: 's1',
      displayName: 'Test Subject',
    });
  });

  afterEach(() => {
    store.close();
  });

  it('createInvite generates both token and short code', () => {
    const invite = createInvite(store, 's1');
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(invite.shortCode).toBeDefined();
    expect(invite.shortCode).toHaveLength(SHORT_CODE_LENGTH);
  });

  it('resolveShortCode returns the same subject as resolveInvite', () => {
    const invite = createInvite(store, 's1');
    const byToken = resolveInvite(store, invite.token);
    const byCode = resolveShortCode(store, invite.shortCode!);
    expect(byCode.subjectId).toBe(byToken.subjectId);
    expect(byCode.questionnaire.id).toBe(byToken.questionnaire.id);
  });

  it('short code is case-insensitive', () => {
    const invite = createInvite(store, 's1');
    const code = invite.shortCode!;
    const lower = resolveShortCode(store, code.toLowerCase());
    const upper = resolveShortCode(store, code.toUpperCase());
    expect(lower.subjectId).toBe(upper.subjectId);
  });

  it('rejects invalid short code format', () => {
    expect(() => resolveShortCode(store, 'too-short')).toThrow(InviteInvalidError);
  });

  it('rejects unknown short code', () => {
    expect(() => resolveShortCode(store, 'ZZZZZZZZ')).toThrow(InviteInvalidError);
  });

  it('rejects expired short code', () => {
    const pastDate = new Date('2020-01-01T00:00:00.000Z');
    const invite = createInvite(store, 's1', { now: pastDate, ttlMs: 1000 });
    // The invite expired 1 second after creation in 2020
    expect(() =>
      resolveShortCode(store, invite.shortCode!, {
        now: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).toThrow(InviteInvalidError);
  });

  it('uniqueness: multiple invites get different short codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const invite = createInvite(store, 's1');
      expect(invite.shortCode).toBeDefined();
      codes.add(invite.shortCode!);
    }
    expect(codes.size).toBe(20);
  });

  it('does not affect existing long token behavior', () => {
    const invite = createInvite(store, 's1');
    // Long token still works
    const resolved = resolveInvite(store, invite.token);
    expect(resolved.subjectId).toBe('s1');
  });
});
