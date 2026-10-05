/**
 * Short invite codes: 8-character, case-insensitive, unambiguous alphabet.
 *
 * Migrated from the author's earlier platform (family-book-book.service.ts:541-551).
 * Pure functions + crypto.randomInt — no framework dependencies.
 *
 * The alphabet excludes visually ambiguous characters: 0/O, 1/I/L.
 * Codes are stored and compared in uppercase; input is normalized before lookup.
 */

import { randomInt } from 'node:crypto';

/**
 * 29-character unambiguous alphabet (uppercase only).
 *
 * Removed: 0, O (zero vs letter O), 1, I, L (one vs I vs L).
 */
export const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Short codes are always exactly this many characters. */
export const SHORT_CODE_LENGTH = 8;

/** Maximum retries when generating a unique code. */
export const SHORT_CODE_MAX_RETRIES = 10;

/**
 * Generate a random short code using crypto.randomInt.
 *
 * Each character is independently sampled from the alphabet using a
 * cryptographically secure random integer, avoiding modulo bias.
 */
export function generateShortCode(): string {
  let code = '';
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    code += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Normalize a short code for lookup: uppercase, trim whitespace.
 * Returns undefined if the input is not a valid short code shape.
 */
export function normalizeShortCode(input: string): string | undefined {
  const trimmed = input.trim().toUpperCase();
  if (trimmed.length !== SHORT_CODE_LENGTH) return undefined;
  // Validate all characters are in the alphabet
  for (const ch of trimmed) {
    if (!SHORT_CODE_ALPHABET.includes(ch)) return undefined;
  }
  return trimmed;
}

/**
 * Validate that a string matches the short code format.
 */
export function isValidShortCode(input: string): boolean {
  return normalizeShortCode(input) !== undefined;
}
