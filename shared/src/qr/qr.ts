/**
 * Zero-dependency QR code generator.
 *
 * - Byte mode (mode indicator 0100)
 * - Error correction level M (15% recovery)
 * - Auto version selection (1..40)
 * - Reed-Solomon error correction (GF(2^8) with primitive polynomial 0x11d)
 * - Eight mask patterns; selects lowest penalty
 * - Outputs SVG string
 *
 * Reference: ISO/IEC 18004:2015
 */

/* ================================================================== */
/* GF(2^8) arithmetic for Reed-Solomon                                */
/* ================================================================== */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
  // Duplicate for wrap-around
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]!;
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/** Multiply two polynomials over GF(2^8). Coefficients from high to low degree. */
function polyMul(a: number[], b: number[]): number[] {
  const result = new Array(a.length + b.length - 1).fill(0) as number[];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      result[i + j] ^= gfMul(a[i]!, b[j]!);
    }
  }
  return result;
}

/** Compute RS generator polynomial for `n` error-correction codewords. */
function rsGeneratorPoly(n: number): number[] {
  let gen = [1];
  for (let i = 0; i < n; i++) {
    gen = polyMul(gen, [1, GF_EXP[i]!]);
  }
  return gen;
}

/** Compute Reed-Solomon error correction codewords. */
function rsEncode(data: number[], ecCount: number): number[] {
  const gen = rsGeneratorPoly(ecCount);
  const padded = [...data, ...new Array(ecCount).fill(0) as number[]];
  for (let i = 0; i < data.length; i++) {
    const coeff = padded[i]!;
    if (coeff !== 0) {
      for (let j = 0; j < gen.length; j++) {
        padded[i + j] ^= gfMul(gen[j]!, coeff);
      }
    }
  }
  return padded.slice(data.length);
}

/* ================================================================== */
/* QR version/capacity tables (EC level M only)                       */
/* ================================================================== */

/**
 * For each version (1..40), the total data codewords at EC level M,
 * number of EC codewords per block, and block structure [count1, dataPerBlock1, count2?, dataPerBlock2?].
 *
 * Source: ISO 18004 Table 9 (EC level M entries).
 */
interface VersionInfo {
  totalDataCodewords: number;
  ecPerBlock: number;
  /** [count1, data1] or [count1, data1, count2, data2] */
  blocks: number[];
}

// prettier-ignore
const VERSION_TABLE: VersionInfo[] = [
  /* dummy v0 */ { totalDataCodewords: 0, ecPerBlock: 0, blocks: [] },
  /* v1  */ { totalDataCodewords: 16,  ecPerBlock: 10, blocks: [1, 16] },
  /* v2  */ { totalDataCodewords: 28,  ecPerBlock: 16, blocks: [1, 28] },
  /* v3  */ { totalDataCodewords: 44,  ecPerBlock: 26, blocks: [1, 44] },
  /* v4  */ { totalDataCodewords: 64,  ecPerBlock: 18, blocks: [2, 32] },
  /* v5  */ { totalDataCodewords: 86,  ecPerBlock: 24, blocks: [2, 43] },
  /* v6  */ { totalDataCodewords: 108, ecPerBlock: 16, blocks: [4, 27] },
  /* v7  */ { totalDataCodewords: 124, ecPerBlock: 18, blocks: [4, 31] },
  /* v8  */ { totalDataCodewords: 154, ecPerBlock: 22, blocks: [2, 38, 2, 39] },
  /* v9  */ { totalDataCodewords: 182, ecPerBlock: 22, blocks: [3, 36, 2, 37] },
  /* v10 */ { totalDataCodewords: 216, ecPerBlock: 26, blocks: [4, 43, 1, 44] },
  /* v11 */ { totalDataCodewords: 254, ecPerBlock: 30, blocks: [1, 50, 4, 51] },
  /* v12 */ { totalDataCodewords: 290, ecPerBlock: 22, blocks: [6, 36, 2, 37] },
  /* v13 */ { totalDataCodewords: 334, ecPerBlock: 22, blocks: [8, 37, 1, 38] },
  /* v14 */ { totalDataCodewords: 365, ecPerBlock: 24, blocks: [4, 40, 5, 41] },
  /* v15 */ { totalDataCodewords: 415, ecPerBlock: 24, blocks: [5, 41, 5, 42] },
  /* v16 */ { totalDataCodewords: 453, ecPerBlock: 28, blocks: [7, 45, 3, 46] },
  /* v17 */ { totalDataCodewords: 507, ecPerBlock: 28, blocks: [10, 46, 1, 47] },
  /* v18 */ { totalDataCodewords: 563, ecPerBlock: 26, blocks: [9, 43, 4, 44] },
  /* v19 */ { totalDataCodewords: 627, ecPerBlock: 26, blocks: [3, 44, 11, 45] },
  /* v20 */ { totalDataCodewords: 669, ecPerBlock: 28, blocks: [3, 41, 13, 42] },
  /* v21 */ { totalDataCodewords: 714, ecPerBlock: 28, blocks: [17, 42] },
  /* v22 */ { totalDataCodewords: 782, ecPerBlock: 28, blocks: [17, 46] },
  /* v23 */ { totalDataCodewords: 860, ecPerBlock: 28, blocks: [4, 47, 14, 48] },
  /* v24 */ { totalDataCodewords: 914, ecPerBlock: 28, blocks: [6, 45, 14, 46] },
  /* v25 */ { totalDataCodewords: 1000, ecPerBlock: 28, blocks: [8, 47, 13, 48] },
  /* v26 */ { totalDataCodewords: 1062, ecPerBlock: 28, blocks: [10, 46, 15, 47] },
  /* v27 */ { totalDataCodewords: 1128, ecPerBlock: 28, blocks: [19, 45, 10, 46] },
  /* v28 */ { totalDataCodewords: 1193, ecPerBlock: 28, blocks: [15, 47, 10, 48] },
  /* v29 */ { totalDataCodewords: 1267, ecPerBlock: 28, blocks: [23, 45, 7, 46] },
  /* v30 */ { totalDataCodewords: 1373, ecPerBlock: 28, blocks: [19, 47, 10, 48] },
  /* v31 */ { totalDataCodewords: 1455, ecPerBlock: 28, blocks: [23, 46, 6, 47] },
  /* v32 */ { totalDataCodewords: 1541, ecPerBlock: 28, blocks: [23, 45, 14, 46] },
  /* v33 */ { totalDataCodewords: 1631, ecPerBlock: 28, blocks: [21, 45, 16, 46] },
  /* v34 */ { totalDataCodewords: 1725, ecPerBlock: 28, blocks: [19, 47, 14, 48] },
  /* v35 */ { totalDataCodewords: 1812, ecPerBlock: 28, blocks: [11, 46, 21, 47] },
  /* v36 */ { totalDataCodewords: 1914, ecPerBlock: 28, blocks: [23, 47, 11, 48] },
  /* v37 */ { totalDataCodewords: 1992, ecPerBlock: 28, blocks: [30, 46, 2, 47] },
  /* v38 */ { totalDataCodewords: 2102, ecPerBlock: 28, blocks: [21, 47, 15, 48] },
  /* v39 */ { totalDataCodewords: 2216, ecPerBlock: 28, blocks: [24, 47, 12, 48] },
  /* v40 */ { totalDataCodewords: 2334, ecPerBlock: 28, blocks: [30, 46, 16, 47] },
];

/** Byte-mode capacity at EC level M for versions 1..40. */
function byteCapacity(version: number): number {
  const info = VERSION_TABLE[version]!;
  // Byte mode header: 4 bits mode + character count indicator bits
  const cciBits = version <= 9 ? 8 : 16;
  const headerBits = 4 + cciBits;
  const availableBits = info.totalDataCodewords * 8 - headerBits;
  return Math.floor(availableBits / 8);
}

/** Select the smallest version that fits the data. */
function selectVersion(dataLength: number): number {
  for (let v = 1; v <= 40; v++) {
    if (byteCapacity(v) >= dataLength) return v;
  }
  throw new Error(`Data too long for QR code: ${dataLength} bytes`);
}

/** Module count (side length) for a version. */
function moduleCount(version: number): number {
  return version * 4 + 17;
}

/* ================================================================== */
/* Alignment pattern positions                                        */
/* ================================================================== */

// prettier-ignore
const ALIGNMENT_POSITIONS: number[][] = [
  [], // v0
  [], // v1 (no alignment)
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170],
];

/* ================================================================== */
/* Format information (EC level M)                                     */
/* ================================================================== */

/** Compute the 15-bit format information with BCH code. */
function computeFormatInfo(maskPattern: number): number {
  // EC level M = 00 binary, bits 13-14 of the 15-bit value
  const data = (0b00 << 3) | maskPattern;  // 5 data bits
  // BCH(15,5) error correction
  let remainder = data << 10;
  const generator = 0b10100110111; // x^10+x^8+x^5+x^4+x^2+x+1
  for (let i = 4; i >= 0; i--) {
    if (remainder & (1 << (i + 10))) {
      remainder ^= generator << i;
    }
  }
  const result = (data << 10) | remainder;
  return result ^ 0x5412; // XOR mask
}

/* ================================================================== */
/* Version information (versions 7..40)                               */
/* ================================================================== */

/** Compute 18-bit version information with BCH(18,6) code. */
function computeVersionInfo(version: number): number {
  const data = version; // 6 bits
  let remainder = data << 12;
  const generator = 0b1111100100101; // x^12+x^11+x^10+x^9+x^8+x^5+x^2+1
  for (let i = 5; i >= 0; i--) {
    if (remainder & (1 << (i + 12))) {
      remainder ^= generator << i;
    }
  }
  return (data << 12) | remainder;
}

/* ================================================================== */
/* Data encoding (byte mode)                                          */
/* ================================================================== */

function encodeData(data: Uint8Array, version: number): Uint8Array {
  const info = VERSION_TABLE[version]!;
  const cciBits = version <= 9 ? 8 : 16;

  // Build a bit stream
  const bits: number[] = [];
  const pushBits = (value: number, count: number): void => {
    for (let i = count - 1; i >= 0; i--) {
      bits.push((value >> i) & 1);
    }
  };

  // Mode indicator: byte mode = 0100
  pushBits(0b0100, 4);
  // Character count
  pushBits(data.length, cciBits);
  // Data bytes
  for (const byte of data) {
    pushBits(byte, 8);
  }
  // Terminator (up to 4 zero bits)
  const totalBits = info.totalDataCodewords * 8;
  const terminatorLen = Math.min(4, totalBits - bits.length);
  pushBits(0, terminatorLen);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Convert to codewords
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | (bits[i + j] ?? 0);
    }
    codewords.push(byte);
  }

  // Pad codewords
  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < info.totalDataCodewords) {
    codewords.push(padBytes[padIndex % 2]!);
    padIndex++;
  }

  return new Uint8Array(codewords);
}

/* ================================================================== */
/* Block splitting and interleaving                                   */
/* ================================================================== */

function interleaveCodewords(
  dataCodewords: Uint8Array,
  version: number,
): Uint8Array {
  const info = VERSION_TABLE[version]!;
  const blocks: { data: number[]; ec: number[] }[] = [];

  let offset = 0;
  const blockDefs = info.blocks;
  for (let g = 0; g < blockDefs.length; g += 2) {
    const count = blockDefs[g]!;
    const dataPerBlock = blockDefs[g + 1]!;
    for (let b = 0; b < count; b++) {
      const data = Array.from(dataCodewords.slice(offset, offset + dataPerBlock));
      offset += dataPerBlock;
      const ec = rsEncode(data, info.ecPerBlock);
      blocks.push({ data, ec });
    }
  }

  // Interleave data codewords
  const result: number[] = [];
  const maxDataLen = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of blocks) {
      if (i < block.data.length) result.push(block.data[i]!);
    }
  }

  // Interleave EC codewords
  for (let i = 0; i < info.ecPerBlock; i++) {
    for (const block of blocks) {
      if (i < block.ec.length) result.push(block.ec[i]!);
    }
  }

  return new Uint8Array(result);
}

/* ================================================================== */
/* Matrix construction                                                */
/* ================================================================== */

/** Create an empty matrix. Values: -1 = unset, 0 = white, 1 = black. */
function createMatrix(size: number): Int8Array[] {
  const matrix: Int8Array[] = [];
  for (let i = 0; i < size; i++) {
    const row = new Int8Array(size);
    row.fill(-1);
    matrix.push(row);
  }
  return matrix;
}

/** Set a module, clamping out-of-bounds access. */
function setModule(matrix: Int8Array[], row: number, col: number, value: number): void {
  if (row >= 0 && row < matrix.length && col >= 0 && col < matrix[0]!.length) {
    matrix[row]![col] = value;
  }
}

/** Place finder patterns (3 corners). */
function placeFinders(matrix: Int8Array[]): void {
  const size = matrix.length;
  const positions = [
    [0, 0],           // top-left
    [0, size - 7],    // top-right
    [size - 7, 0],    // bottom-left
  ];
  for (const [baseRow, baseCol] of positions) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isEdge = r === 0 || r === 6 || c === 0 || c === 6;
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const value = isEdge || isInner ? 1 : 0;
        setModule(matrix, baseRow! + r, baseCol! + c, value);
      }
    }
  }
  // Separators (white border around finders)
  // Top-left
  for (let i = 0; i < 8; i++) {
    setModule(matrix, 7, i, 0);
    setModule(matrix, i, 7, 0);
  }
  // Top-right
  for (let i = 0; i < 8; i++) {
    setModule(matrix, 7, size - 8 + i, 0);
    setModule(matrix, i, size - 8, 0);
  }
  // Bottom-left
  for (let i = 0; i < 8; i++) {
    setModule(matrix, size - 8, i, 0);
    setModule(matrix, size - 8 + i, 7, 0);
  }
}

/** Place alignment patterns. */
function placeAlignment(matrix: Int8Array[], version: number): void {
  if (version < 2) return;
  const positions = ALIGNMENT_POSITIONS[version]!;
  for (const row of positions) {
    for (const col of positions) {
      // Skip if overlapping a finder pattern
      if (matrix[row]![col] !== -1) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const isEdge = Math.abs(r) === 2 || Math.abs(c) === 2;
          const isCenter = r === 0 && c === 0;
          setModule(matrix, row + r, col + c, isEdge || isCenter ? 1 : 0);
        }
      }
    }
  }
}

/** Place timing patterns. */
function placeTiming(matrix: Int8Array[]): void {
  const size = matrix.length;
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6]![i] === -1) matrix[6]![i] = i % 2 === 0 ? 1 : 0;
    if (matrix[i]![6] === -1) matrix[i]![6] = i % 2 === 0 ? 1 : 0;
  }
}

/** Place the dark module and reserve format/version areas. */
function placeReserved(matrix: Int8Array[], version: number): void {
  const size = matrix.length;
  // Dark module
  matrix[size - 8]![8] = 1;

  // Reserve format info areas (set to 0, will be overwritten later)
  // Around top-left finder
  for (let i = 0; i < 9; i++) {
    if (matrix[8]![i] === -1) matrix[8]![i] = 0;
    if (matrix[i]![8] === -1) matrix[i]![8] = 0;
  }
  // Below top-right finder
  for (let i = 0; i < 8; i++) {
    if (matrix[8]![size - 1 - i] === -1) matrix[8]![size - 1 - i] = 0;
  }
  // Right of bottom-left finder
  for (let i = 0; i < 7; i++) {
    if (matrix[size - 1 - i]![8] === -1) matrix[size - 1 - i]![8] = 0;
  }

  // Reserve version info (versions >= 7)
  if (version >= 7) {
    // Bottom-left of top-right finder
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        if (matrix[i]![size - 11 + j] === -1) matrix[i]![size - 11 + j] = 0;
        if (matrix[size - 11 + j]![i] === -1) matrix[size - 11 + j]![i] = 0;
      }
    }
  }
}

/** Place data bits in the matrix following the zigzag path. */
function placeData(matrix: Int8Array[], encoded: Uint8Array): void {
  const size = matrix.length;
  let bitIndex = 0;
  const totalBits = encoded.length * 8;

  // The data path goes right-to-left in column pairs, bottom-to-top then
  // top-to-bottom alternately.
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern; skip it
    if (right === 6) right = 5;

    for (let count = 0; count < size; count++) {
      const row = upward ? size - 1 - count : count;
      for (const colOffset of [0, -1]) {
        const col = right + colOffset;
        if (col < 0 || col >= size) continue;
        if (matrix[row]![col] !== -1) continue;
        if (bitIndex < totalBits) {
          const byteIdx = Math.floor(bitIndex / 8);
          const bitPos = 7 - (bitIndex % 8);
          matrix[row]![col] = (encoded[byteIdx]! >> bitPos) & 1;
          bitIndex++;
        } else {
          matrix[row]![col] = 0;
        }
      }
    }
    upward = !upward;
  }
}

/* ================================================================== */
/* Masking                                                            */
/* ================================================================== */

type MaskFn = (row: number, col: number) => boolean;

const MASK_FUNCTIONS: MaskFn[] = [
  (r, c) => (r + c) % 2 === 0,
  (r, _c) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Create a boolean grid marking which modules are "reserved" (not data). */
function buildReservedMask(version: number): boolean[][] {
  const size = moduleCount(version);
  const mask: boolean[][] = [];
  for (let i = 0; i < size; i++) {
    mask.push(new Array(size).fill(false) as boolean[]);
  }

  // Finder patterns + separators
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) mask[r]![c] = true;
    for (let c = size - 8; c < size; c++) if (r < 9) mask[r]![c] = true;
  }
  for (let r = size - 8; r < size; r++) {
    for (let c = 0; c < 9; c++) mask[r]![c] = true;
  }

  // Timing patterns
  for (let i = 0; i < size; i++) {
    mask[6]![i] = true;
    mask[i]![6] = true;
  }

  // Alignment patterns
  if (version >= 2) {
    const positions = ALIGNMENT_POSITIONS[version]!;
    for (const row of positions) {
      for (const col of positions) {
        // Skip if overlapping with finder
        if (mask[row]![col]) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            mask[row + r]![col + c] = true;
          }
        }
      }
    }
  }

  // Version info areas
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        mask[i]![size - 11 + j] = true;
        mask[size - 11 + j]![i] = true;
      }
    }
  }

  return mask;
}

/** Apply a mask pattern to the data modules (toggle in place). */
function applyMask(matrix: Int8Array[], reserved: boolean[][], maskIndex: number): void {
  const size = matrix.length;
  const fn = MASK_FUNCTIONS[maskIndex]!;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r]![c] && fn(r, c)) {
        matrix[r]![c] ^= 1;
      }
    }
  }
}

/** Compute penalty score for a masked matrix. */
function penaltyScore(matrix: Int8Array[]): number {
  const size = matrix.length;
  let score = 0;

  // Rule 1: runs of same color (horizontal and vertical)
  for (let r = 0; r < size; r++) {
    let runLength = 1;
    for (let c = 1; c < size; c++) {
      if (matrix[r]![c] === matrix[r]![c - 1]) {
        runLength++;
      } else {
        if (runLength >= 5) score += runLength - 2;
        runLength = 1;
      }
    }
    if (runLength >= 5) score += runLength - 2;
  }
  for (let c = 0; c < size; c++) {
    let runLength = 1;
    for (let r = 1; r < size; r++) {
      if (matrix[r]![c] === matrix[r - 1]![c]) {
        runLength++;
      } else {
        if (runLength >= 5) score += runLength - 2;
        runLength = 1;
      }
    }
    if (runLength >= 5) score += runLength - 2;
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const val = matrix[r]![c];
      if (val === matrix[r]![c + 1] && val === matrix[r + 1]![c] && val === matrix[r + 1]![c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3: finder-like patterns (1:1:3:1:1 dark patterns)
  const finderA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]; // dark:light:dark:dark:dark:light:dark:light:light:light:light
  const finderB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]; // reverse
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      let matchA = true;
      let matchB = true;
      for (let i = 0; i < 11; i++) {
        if (matrix[r]![c + i] !== finderA[i]) matchA = false;
        if (matrix[r]![c + i] !== finderB[i]) matchB = false;
      }
      if (matchA || matchB) score += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      let matchA = true;
      let matchB = true;
      for (let i = 0; i < 11; i++) {
        if (matrix[r + i]![c] !== finderA[i]) matchA = false;
        if (matrix[r + i]![c] !== finderB[i]) matchB = false;
      }
      if (matchA || matchB) score += 40;
    }
  }

  // Rule 4: proportion of dark modules
  let dark = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r]![c] === 1) dark++;
    }
  }
  const total = size * size;
  const pct = (dark / total) * 100;
  const prevMultiple = Math.floor(pct / 5) * 5;
  const nextMultiple = prevMultiple + 5;
  score += Math.min(Math.abs(prevMultiple - 50) / 5, Math.abs(nextMultiple - 50) / 5) * 10;

  return score;
}

/* ================================================================== */
/* High-level: generate QR matrix                                     */
/* ================================================================== */

function deepCopy(matrix: Int8Array[]): Int8Array[] {
  return matrix.map((row) => new Int8Array(row));
}

/**
 * Write the 15 format-info bits into the two L-shaped strips.
 *
 * Positions per ISO 18004:2015 Table C.2 (Annex C).
 */
function placeFormatBits(matrix: Int8Array[], maskPattern: number): void {
  const size = matrix.length;
  const info = computeFormatInfo(maskPattern);
  const bit = (i: number): number => (info >> i) & 1;

  // Horizontal strip along row 8 (bit 0..14, left to right)
  // Left block: cols 0-5 (bits 0-5), skip col 6 (timing), col 7 (bit 6), col 8 (bit 7)
  // Right block: cols size-8..size-1 (bits 8-14, but mapped via size-8+offset)
  const hCols = [
    0, 1, 2, 3, 4, 5,                                     // bits 0-5
    7, 8,                                                   // bits 6-7 (skip col 6 = timing)
    size - 8, size - 7, size - 6, size - 5,
    size - 4, size - 3, size - 2,                          // bits 8-14
  ];
  for (let i = 0; i < 15; i++) {
    matrix[8]![hCols[i]!] = bit(i);
  }

  // Vertical strip along col 8 (bit 0..14, bottom to top)
  // Bottom block: rows size-1 down to size-7 (bits 0-6)
  // Top block: row 8 (bit 7), row 7 (bit 8), skip row 6 (timing),
  //            rows 5 down to 0 (bits 9-14)
  const vRows = [
    size - 1, size - 2, size - 3, size - 4,
    size - 5, size - 6, size - 7,  // bits 0-6
    8,                               // bit 7
    7,                               // bit 8 (skip row 6 = timing)
    5, 4, 3, 2, 1, 0,               // bits 9-14
  ];
  for (let i = 0; i < 15; i++) {
    matrix[vRows[i]!]![8] = bit(i);
  }
}

/** Write version information into the matrix (versions >= 7). */
function placeVersionInfo(matrix: Int8Array[], version: number): void {
  if (version < 7) return;
  const size = matrix.length;
  const info = computeVersionInfo(version);

  for (let i = 0; i < 18; i++) {
    const bit = (info >> i) & 1;
    const row = Math.floor(i / 3);
    const col = (i % 3) + size - 11;
    // Bottom-left of top-right finder
    matrix[row]![col] = bit;
    // Top-right of bottom-left finder (transposed)
    matrix[col]![row] = bit;
  }
}

/**
 * Generate a complete QR code matrix for the given data.
 * Returns the matrix as a 2D array of 0/1 values.
 */
export function generateQR(text: string): { matrix: number[][]; version: number; size: number } {
  const data = new TextEncoder().encode(text);
  const version = selectVersion(data.length);
  const size = moduleCount(version);

  // Encode and interleave
  const dataCodewords = encodeData(data, version);
  const interleaved = interleaveCodewords(dataCodewords, version);

  // Build the base matrix with function patterns
  const baseMatrix = createMatrix(size);
  placeFinders(baseMatrix);
  placeAlignment(baseMatrix, version);
  placeTiming(baseMatrix);
  placeReserved(baseMatrix, version);

  // Build reserved-module mask
  const reserved = buildReservedMask(version);

  // Place data
  placeData(baseMatrix, interleaved);

  // Try all 8 masks, pick lowest penalty
  let bestMatrix = baseMatrix;
  let bestPenalty = Infinity;
  let bestMask = 0;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = deepCopy(baseMatrix);
    applyMask(candidate, reserved, mask);
    placeFormatBits(candidate, mask);
    placeVersionInfo(candidate, version);
    const penalty = penaltyScore(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestMatrix = candidate;
    }
  }

  // Convert Int8Array to number[][]
  const result: number[][] = [];
  for (const row of bestMatrix) {
    result.push(Array.from(row));
  }

  return { matrix: result, version, size };
}

/* ================================================================== */
/* SVG output                                                         */
/* ================================================================== */

export interface QrSvgOptions {
  /** Module (pixel) size in SVG units. Default: 4. */
  moduleSize?: number;
  /** Quiet zone modules around the code. Default: 4 (spec minimum). */
  quietZone?: number;
  /** Foreground color. Default: '#000'. */
  foreground?: string;
  /** Background color. Default: '#fff'. */
  background?: string;
}

/**
 * Generate a QR code as an SVG string.
 *
 * @param text - The text to encode (UTF-8 byte mode).
 * @param options - Rendering options.
 */
export function qrToSvg(text: string, options: QrSvgOptions = {}): string {
  const {
    moduleSize = 4,
    quietZone = 4,
    foreground = '#000',
    background = '#fff',
  } = options;

  const { matrix, size } = generateQR(text);
  const totalSize = (size + quietZone * 2) * moduleSize;

  const rects: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r]![c] === 1) {
        const x = (c + quietZone) * moduleSize;
        const y = (r + quietZone) * moduleSize;
        rects.push(`<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}"/>`);
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${totalSize}" height="${totalSize}">`,
    `<rect width="${totalSize}" height="${totalSize}" fill="${background}"/>`,
    `<g fill="${foreground}">`,
    ...rects,
    '</g>',
    '</svg>',
  ].join('\n');
}
