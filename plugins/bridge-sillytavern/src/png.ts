/**
 * PNG tEXt chunk read/write for Character Card embedding.
 *
 * Zero dependencies: CRC32 is computed from a lookup table, PNG chunk
 * parsing uses only Node built-in Buffer.
 *
 * The PNG spec (RFC 2083 §11.3.4.2) defines tEXt as:
 *   keyword (1-79 bytes Latin-1) + NUL separator + text (Latin-1).
 *
 * SillyTavern stores the character JSON as base64-encoded text in a
 * tEXt chunk with keyword "chara".
 */

/* ------------------------------------------------------------------ */
/* CRC32 (ISO 3309 / PNG spec Annex D)                                 */
/* ------------------------------------------------------------------ */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

/** Compute CRC32 over a buffer (PNG uses this on type + data). */
export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/* PNG constants                                                       */
/* ------------------------------------------------------------------ */

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHUNK_TYPE_TEXT = Buffer.from('tEXt');
const CHUNK_TYPE_IEND = Buffer.from('IEND');
const CHARA_KEYWORD = 'chara';

/* ------------------------------------------------------------------ */
/* Read tEXt chunk                                                     */
/* ------------------------------------------------------------------ */

/**
 * Extract the base64 character card JSON from a PNG buffer.
 *
 * Scans all tEXt chunks for one whose keyword is "chara", decodes the
 * base64 text, and returns the parsed JSON. Returns `undefined` if no
 * such chunk exists.
 *
 * Throws on:
 * - Not a valid PNG (bad signature)
 * - CRC mismatch on the chara tEXt chunk
 * - Invalid base64 or JSON in the chunk
 */
export function readCharaFromPng(png: Buffer): unknown | undefined {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a valid PNG file');
  }

  let offset = 8; // past signature
  while (offset < png.length) {
    if (offset + 8 > png.length) break;

    const length = png.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const crcStart = dataStart + length;

    if (crcStart + 4 > png.length) break;

    const type = png.subarray(typeStart, dataStart);
    const data = png.subarray(dataStart, crcStart);
    const storedCrc = png.readUInt32BE(crcStart);

    // Verify CRC (computed over type + data)
    if (type.toString('ascii') === 'tEXt') {
      const crcInput = Buffer.concat([type, data]);
      const computed = crc32(crcInput);
      if (computed !== storedCrc) {
        // Only fail if this is the chara chunk
        const nullIdx = data.indexOf(0);
        if (nullIdx > 0 && data.subarray(0, nullIdx).toString('latin1') === CHARA_KEYWORD) {
          throw new Error(`CRC mismatch on chara tEXt chunk: expected ${storedCrc.toString(16)}, got ${computed.toString(16)}`);
        }
      }

      const nullIdx = data.indexOf(0);
      if (nullIdx > 0) {
        const keyword = data.subarray(0, nullIdx).toString('latin1');
        if (keyword === CHARA_KEYWORD) {
          const text = data.subarray(nullIdx + 1).toString('latin1');
          const json = Buffer.from(text, 'base64').toString('utf8');
          return JSON.parse(json) as unknown;
        }
      }
    }

    offset = crcStart + 4;
  }

  return undefined;
}

/* ------------------------------------------------------------------ */
/* Write tEXt chunk                                                    */
/* ------------------------------------------------------------------ */

/**
 * Build a tEXt chunk with keyword "chara" and base64-encoded JSON.
 */
function buildCharaChunk(json: string): Buffer {
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  const keyword = Buffer.from(CHARA_KEYWORD, 'latin1');
  const nul = Buffer.from([0]);
  const text = Buffer.from(b64, 'latin1');
  const chunkData = Buffer.concat([keyword, nul, text]);

  const length = Buffer.alloc(4);
  length.writeUInt32BE(chunkData.length, 0);

  const crcInput = Buffer.concat([CHUNK_TYPE_TEXT, chunkData]);
  const crcValue = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcValue, 0);

  return Buffer.concat([length, CHUNK_TYPE_TEXT, chunkData, crcBuf]);
}

/**
 * Embed a character card JSON into a PNG buffer.
 *
 * Inserts the tEXt chunk just before the IEND chunk (per PNG spec,
 * ancillary chunks may appear anywhere after IHDR). If a chara tEXt
 * chunk already exists, it is replaced.
 *
 * @param png - Source PNG buffer (must be valid).
 * @param json - The character card JSON string.
 * @returns A new PNG buffer with the chara chunk embedded.
 */
export function writeCharaToPng(png: Buffer, json: string): Buffer {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a valid PNG file');
  }

  const chunks: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  let iendChunk: Buffer | undefined;

  while (offset < png.length) {
    if (offset + 8 > png.length) break;

    const length = png.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const crcStart = dataStart + length;

    if (crcStart + 4 > png.length) break;

    const type = png.subarray(typeStart, dataStart).toString('ascii');
    const chunkBuf = png.subarray(offset, crcStart + 4);

    if (type === 'IEND') {
      iendChunk = Buffer.from(chunkBuf);
    } else if (type === 'tEXt') {
      // Skip existing chara chunks; keep other tEXt chunks
      const data = png.subarray(dataStart, crcStart);
      const nullIdx = data.indexOf(0);
      const keyword = nullIdx > 0 ? data.subarray(0, nullIdx).toString('latin1') : '';
      if (keyword !== CHARA_KEYWORD) {
        chunks.push(Buffer.from(chunkBuf));
      }
    } else {
      chunks.push(Buffer.from(chunkBuf));
    }

    offset = crcStart + 4;
  }

  // Insert new chara chunk before IEND
  chunks.push(buildCharaChunk(json));
  if (iendChunk) chunks.push(iendChunk);

  return Buffer.concat(chunks);
}

/* ------------------------------------------------------------------ */
/* Minimal PNG generator                                               */
/* ------------------------------------------------------------------ */

/**
 * Generate a minimal valid 1x1 PNG with a solid color.
 *
 * Used as a placeholder image when exporting character cards as PNG.
 * No avatar is embedded — the spec says the PNG is just a carrier for
 * the tEXt metadata.
 *
 * Structure: signature + IHDR + IDAT (zlib-compressed single pixel) + IEND.
 */
export function generateMinimalPng(
  r: number = 128,
  g: number = 128,
  b: number = 128,
): Buffer {
  // IHDR: 1x1, 8-bit RGB, no interlace
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);  // width
  ihdrData.writeUInt32BE(1, 4);  // height
  ihdrData[8] = 8;               // bit depth
  ihdrData[9] = 2;               // color type: RGB
  ihdrData[10] = 0;              // compression
  ihdrData[11] = 0;              // filter
  ihdrData[12] = 0;              // interlace

  const ihdrType = Buffer.from('IHDR');
  const ihdrCrc = crc32(Buffer.concat([ihdrType, ihdrData]));

  const ihdr = Buffer.alloc(4 + 4 + 13 + 4);
  ihdr.writeUInt32BE(13, 0);
  ihdrType.copy(ihdr, 4);
  ihdrData.copy(ihdr, 8);
  ihdr.writeUInt32BE(ihdrCrc, 8 + 13);

  // IDAT: zlib-compressed scanline (filter byte 0 + RGB)
  const { deflateSync } = require('node:zlib') as typeof import('node:zlib');
  const rawScanline = Buffer.from([0, r, g, b]); // filter=None + 1 pixel RGB
  const compressed = deflateSync(rawScanline);

  const idatType = Buffer.from('IDAT');
  const idatCrc = crc32(Buffer.concat([idatType, compressed]));

  const idat = Buffer.alloc(4 + 4 + compressed.length + 4);
  idat.writeUInt32BE(compressed.length, 0);
  idatType.copy(idat, 4);
  compressed.copy(idat, 8);
  idat.writeUInt32BE(idatCrc, 8 + compressed.length);

  // IEND
  const iendType = Buffer.from('IEND');
  const iendCrc = crc32(iendType);
  const iend = Buffer.alloc(4 + 4 + 4);
  iend.writeUInt32BE(0, 0);
  iendType.copy(iend, 4);
  iend.writeUInt32BE(iendCrc, 8);

  return Buffer.concat([PNG_SIGNATURE, ihdr, idat, iend]);
}
