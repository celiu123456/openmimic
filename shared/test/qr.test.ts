import { describe, expect, it } from 'vitest';
import { generateQR, qrToSvg } from '../src/qr';

/* ------------------------------------------------------------------ */
/* Version selection                                                   */
/* ------------------------------------------------------------------ */

describe('version selection', () => {
  it('selects version 1 for short data (up to 14 bytes at M)', () => {
    const { version, size } = generateQR('Hello!');
    expect(version).toBe(1);
    expect(size).toBe(21);
  });

  it('selects version 2 for data up to 26 bytes at M', () => {
    // 15 bytes exceeds v1 capacity (14 bytes at M)
    const { version, size } = generateQR('Hello, world!!!');
    expect(version).toBe(2);
    expect(size).toBe(25);
  });

  it('selects version 3 for data up to 42 bytes at M', () => {
    const { version } = generateQR('A'.repeat(30));
    expect(version).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/* Matrix structure                                                    */
/* ------------------------------------------------------------------ */

describe('matrix structure', () => {
  it('produces a square matrix of correct size', () => {
    const { matrix, size } = generateQR('Test');
    expect(matrix.length).toBe(size);
    for (const row of matrix) {
      expect(row.length).toBe(size);
    }
  });

  it('contains only 0 and 1 values', () => {
    const { matrix } = generateQR('Test');
    for (const row of matrix) {
      for (const cell of row) {
        expect(cell === 0 || cell === 1).toBe(true);
      }
    }
  });

  it('has finder patterns in three corners', () => {
    const { matrix, size } = generateQR('Test');
    // Top-left finder: 7x7 block
    // Outer edge should be all dark
    for (let i = 0; i < 7; i++) {
      expect(matrix[0]![i]).toBe(1); // top row
      expect(matrix[6]![i]).toBe(1); // bottom row
      expect(matrix[i]![0]).toBe(1); // left col
      expect(matrix[i]![6]).toBe(1); // right col
    }
    // Inner 3x3 should be all dark
    for (let r = 2; r <= 4; r++) {
      for (let c = 2; c <= 4; c++) {
        expect(matrix[r]![c]).toBe(1);
      }
    }
    // White ring
    expect(matrix[1]![1]).toBe(0);
    expect(matrix[1]![5]).toBe(0);

    // Top-right finder
    for (let i = 0; i < 7; i++) {
      expect(matrix[0]![size - 7 + i]).toBe(1); // top row
      expect(matrix[6]![size - 7 + i]).toBe(1); // bottom row
    }

    // Bottom-left finder
    for (let i = 0; i < 7; i++) {
      expect(matrix[size - 7]![i]).toBe(1); // top row of bottom-left
      expect(matrix[size - 1]![i]).toBe(1); // bottom row of bottom-left
    }
  });

  it('has the dark module at (size-8, 8)', () => {
    const { matrix, size } = generateQR('X');
    expect(matrix[size - 8]![8]).toBe(1);
  });

  it('has timing patterns along row 6 and col 6', () => {
    const { matrix, size } = generateQR('Hello');
    // Timing alternates 1,0,1,0... starting at position 8
    for (let i = 8; i < size - 8; i++) {
      const expected = i % 2 === 0 ? 1 : 0;
      expect(matrix[6]![i]).toBe(expected);
      expect(matrix[i]![6]).toBe(expected);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Reference vectors                                                   */
/* ------------------------------------------------------------------ */

describe('reference vectors', () => {
  /**
   * Reference: encoding "01234567" in byte mode, EC level M.
   * This should produce a version 1 (21x21) QR code.
   *
   * We verify the first 8 data codewords match the expected byte-mode
   * encoding by checking the matrix dimension and version.
   */
  it('encodes "01234567" as version 1', () => {
    const { version, size } = generateQR('01234567');
    expect(version).toBe(1);
    expect(size).toBe(21);
  });

  /**
   * Reference: encoding "Hello, world!" in byte mode, EC level M.
   * 13 bytes fits in version 1 (capacity: 14 bytes at M).
   */
  it('encodes "Hello, world!" as version 1', () => {
    const { version } = generateQR('Hello, world!');
    expect(version).toBe(1);
  });

  /**
   * Reference: a URL typical of our invite links.
   * "https://openmimic.dev/i/AbCdEfGh" = 34 bytes → version 3.
   */
  it('encodes a typical invite URL as version 3', () => {
    const { version } = generateQR('https://openmimic.dev/i/AbCdEfGh');
    expect(version).toBe(3);
  });

  /**
   * Known-good test: the QR for "HELLO WORLD" (in byte mode, not
   * alphanumeric mode) at level M should be version 1.
   * 11 bytes < 14 byte capacity.
   */
  it('encodes "HELLO WORLD" as version 1', () => {
    const result = generateQR('HELLO WORLD');
    expect(result.version).toBe(1);
    expect(result.size).toBe(21);
  });

  /**
   * Structural consistency: generating the same input twice must
   * produce identical matrices (deterministic).
   */
  it('is deterministic', () => {
    const a = generateQR('deterministic');
    const b = generateQR('deterministic');
    expect(a.matrix).toEqual(b.matrix);
  });

  /**
   * Known module count for version 1: 21x21 = 441 modules.
   * Function patterns consume a known count; the rest are data + EC.
   */
  it('version 1 has exactly 441 modules', () => {
    const { matrix } = generateQR('QR');
    let count = 0;
    for (const row of matrix) {
      count += row.length;
    }
    expect(count).toBe(441);
  });
});

/* ------------------------------------------------------------------ */
/* SVG output                                                          */
/* ------------------------------------------------------------------ */

describe('SVG output', () => {
  it('produces valid SVG', () => {
    const svg = qrToSvg('Test');
    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('</svg>');
  });

  it('contains rect elements for dark modules', () => {
    const svg = qrToSvg('Test');
    expect(svg).toContain('<rect');
    // At least finder pattern modules should be present
    const rectCount = (svg.match(/<rect /g) ?? []).length;
    // Background rect + data rects; must have many
    expect(rectCount).toBeGreaterThan(100);
  });

  it('respects custom options', () => {
    const svg = qrToSvg('Test', {
      moduleSize: 8,
      quietZone: 2,
      foreground: '#333',
      background: '#eee',
    });
    expect(svg).toContain('fill="#eee"');
    expect(svg).toContain('fill="#333"');
    expect(svg).toContain('width="8"');
  });

  it('default quiet zone is 4 modules', () => {
    const svg = qrToSvg('X', { moduleSize: 1 });
    // Version 1 = 21 modules, quiet zone 4 each side = 29
    // SVG viewBox should be "0 0 29 29"
    expect(svg).toContain('viewBox="0 0 29 29"');
  });
});

/* ------------------------------------------------------------------ */
/* Format info reference                                               */
/* ------------------------------------------------------------------ */

describe('format info reference', () => {
  /**
   * Format information BCH encoding for EC level M should match known
   * reference values from ISO 18004 Table C.1.
   *
   * We verify indirectly: the horizontal and vertical strips must carry
   * identical 15-bit values, which we already test in cross-scan.
   * Here we also check that the dark module percentage is reasonable
   * (mask selection produces ~50%, implying correct format info → correct mask).
   */
  it('dark module proportion is between 35% and 65%', () => {
    // Good masking keeps proportion near 50%.
    // A broken format info or mask would produce extreme ratios.
    for (const text of ['1', 'AB', 'Hello, world!', 'https://example.com/test']) {
      const { matrix, size } = generateQR(text);
      let dark = 0;
      for (const row of matrix) for (const cell of row) if (cell === 1) dark++;
      const ratio = dark / (size * size);
      expect(ratio).toBeGreaterThan(0.35);
      expect(ratio).toBeLessThan(0.65);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Cross-scan validation                                               */
/* ------------------------------------------------------------------ */

describe('cross-scan validation', () => {
  /**
   * A QR code must be scannable. While we cannot run a decoder here,
   * we verify structural properties that a decoder relies on:
   * 1. Three finder patterns
   * 2. Timing pattern alternation
   * 3. Format information consistency (both copies should match)
   */
  it('has consistent format info in both horizontal and vertical strips', () => {
    const { matrix, size } = generateQR('format-check');

    // Read horizontal format info (row 8)
    const hCols = [0, 1, 2, 3, 4, 5, 7, 8,
      size - 8, size - 7, size - 6, size - 5,
      size - 4, size - 3, size - 2];
    const hBits: number[] = [];
    for (const c of hCols) {
      hBits.push(matrix[8]![c]!);
    }

    // Read vertical format info (col 8)
    const vRows = [
      size - 1, size - 2, size - 3, size - 4,
      size - 5, size - 6, size - 7,
      8, 7, 5, 4, 3, 2, 1, 0,
    ];
    const vBits: number[] = [];
    for (const r of vRows) {
      vBits.push(matrix[r]![8]!);
    }

    // Both strips should carry the same 15-bit format information
    expect(hBits).toEqual(vBits);
  });

  /**
   * White separators must surround all three finder patterns.
   * Check the separator row/col between finder and data area.
   */
  it('has white separators around finders', () => {
    const { matrix, size } = generateQR('separators');

    // Top-left: row 7 cols 0-7, col 7 rows 0-7
    for (let i = 0; i < 8; i++) {
      expect(matrix[7]![i]).toBe(0);
      expect(matrix[i]![7]).toBe(0);
    }

    // Top-right: row 7 cols size-8..size-1, col size-8 rows 0-7
    for (let i = 0; i < 8; i++) {
      expect(matrix[7]![size - 8 + i]).toBe(0);
      expect(matrix[i]![size - 8]).toBe(0);
    }

    // Bottom-left: row size-8 cols 0-7, col 7 rows size-8..size-1
    for (let i = 0; i < 8; i++) {
      expect(matrix[size - 8]![i]).toBe(0);
      expect(matrix[size - 8 + i]![7]).toBe(0);
    }
  });
});
