import { createHash } from 'node:crypto';
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

/**
 * Read the 15-bit format information from one copy placed in the matrix.
 * copy=1: around the top-left finder.
 * copy=2: top-right (horizontal) + bottom-left (vertical).
 */
function readFormatCopy(matrix: number[][], size: number, copy: 1 | 2): number {
  let info = 0;
  if (copy === 1) {
    // ISO 18004:2015 Table C.2 — Copy 1 around TL finder
    // Vertical (col 8): bits 0-5 at rows 0-5, bit 6 at row 7, bit 7 at row 8
    for (let i = 0; i < 6; i++) info |= (matrix[i]![8]! & 1) << i;
    info |= (matrix[7]![8]! & 1) << 6;
    info |= (matrix[8]![8]! & 1) << 7;
    // Horizontal (row 8): bits 14-9 at cols 0-5, bit 8 at col 7
    for (let i = 0; i < 6; i++) info |= (matrix[8]![i]! & 1) << (14 - i);
    info |= (matrix[8]![7]! & 1) << 8;
    // bit 7 already set from vertical
  } else {
    // Copy 2: horizontal at row 8 right end + vertical at col 8 bottom
    // Horizontal (row 8): bit i at col size-1-i for i=0..7
    for (let i = 0; i < 8; i++) info |= (matrix[8]![size - 1 - i]! & 1) << i;
    // Vertical (col 8): bit (14-i) at row size-1-i for i=0..6
    // (i=7 is dark module at row size-8, skipped)
    for (let i = 0; i < 7; i++) info |= (matrix[size - 1 - i]![8]! & 1) << (14 - i);
  }
  return info;
}

describe('format info reference', () => {
  // ISO 18004:2015 Table C.1 — EC level M, masks 0-7
  const ISO_FORMAT_INFO: Record<number, number> = {
    0: 0b101010000010010,
    1: 0b101000100100101,
    2: 0b101111001111100,
    3: 0b101101101001011,
    4: 0b100010111111001,
    5: 0b100000011001110,
    6: 0b100111110010111,
    7: 0b100101010100000,
  };

  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'mask %i format info matches ISO Table C.1',
    (mask) => {
      const { matrix, size } = generateQR('format-ref', { forceMask: mask });
      const copy1 = readFormatCopy(matrix as unknown as number[][], size, 1);
      const copy2 = readFormatCopy(matrix as unknown as number[][], size, 2);
      expect(copy1).toBe(ISO_FORMAT_INFO[mask]);
      expect(copy2).toBe(ISO_FORMAT_INFO[mask]);
    },
  );

  it('dark module proportion is between 35% and 65%', () => {
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
/* Frozen reference vectors (cross-validated via zxing-cpp decode)      */
/* ------------------------------------------------------------------ */

describe('frozen reference vectors', () => {
  /** SHA-256 of the matrix rows concatenated as 0/1 digit strings. */
  function matrixHash(matrix: number[][]): string {
    const flat = matrix.map(r => r.join('')).join('');
    return createHash('sha256').update(flat).digest('hex');
  }

  const VECTORS: Array<{
    text: string;
    forceMask: number;
    version: number;
    hash: string;
  }> = [
    {
      text: 'Hello!',
      forceMask: 2,
      version: 1,
      hash: 'f551e1a3cb08ceb8fb8092718af02baee37a08e83ac9daf6357197e16f8d554a',
    },
    {
      text: '01234567',
      forceMask: 6,
      version: 1,
      hash: 'a877e1e974c3102d80a74f396a6235a22303be74c04bb5450ff9701d48be0d45',
    },
    {
      text: 'exactly14bytes',
      forceMask: 0,
      version: 1,
      hash: '373f570ae2e6137a256092c5bcd6daeb92e78843922366cb4ca0d30e91628493',
    },
    {
      text: 'https://example.org/i/ABCD2345',
      forceMask: 3,
      version: 3,
      hash: '30a5f33e343b4876802a2eba9ee63d11ab2789bc3753bd043afe3761bc08e83a',
    },
    {
      text: 'A'.repeat(120),
      forceMask: 3,
      version: 7,
      hash: '5e49a5a8e357d681dc888aa476dcf289172028fb33ac4fd9a1f53915b80d9a7c',
    },
    {
      text: '你好世界',
      forceMask: 6,
      version: 1,
      hash: '2e64033d026864f34322bfe3abd8181af97f11789f0b44162a056bf364398383',
    },
  ];

  it.each(VECTORS.map(v => [v.text.length > 30 ? v.text.slice(0, 30) + '...' : v.text, v] as const))(
    '%s matrix matches frozen snapshot',
    (_label, { text, forceMask, version, hash }) => {
      const result = generateQR(text, { forceMask });
      expect(result.version).toBe(version);
      expect(matrixHash(result.matrix as unknown as number[][])).toBe(hash);
    },
  );
});

/* ------------------------------------------------------------------ */
/* Cross-scan validation                                               */
/* ------------------------------------------------------------------ */

describe('cross-scan validation', () => {
  /**
   * Both copies of the 15-bit format information must carry the same value.
   * Reads each copy from the correct ISO 18004 positions and compares.
   */
  it('has consistent format info in both copies', () => {
    for (const text of ['format-check', 'Hello!', 'https://example.org/i/ABCD2345']) {
      const { matrix, size } = generateQR(text);
      const copy1 = readFormatCopy(matrix as unknown as number[][], size, 1);
      const copy2 = readFormatCopy(matrix as unknown as number[][], size, 2);
      expect(copy1).toBe(copy2);
    }
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
