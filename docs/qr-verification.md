# QR Code Generator Cross-Validation Report

## Summary

The zero-dependency QR code generator (`shared/src/qr/qr.ts`) has been
cross-validated against two independent tools.  All 31 test cases pass both
the decoder and the structure comparison.

## Tools

| Tool | Version | Role |
|------|---------|------|
| **zxing-cpp** | Python binding (3.1.1) | Decode each generated QR image and verify round-trip content |
| **segno** | 1.6.6 | Reference encoder; structure comparison on non-data modules |
| **Pillow** | 12.3.0 | Render QR matrix to grayscale PNG for the decoder |

All tools installed in a disposable venv (`/tmp/qrvenv`), not added to repo
dependencies.

## Test cases (31 total)

| # | Content | Version | Mask | Category |
|---|---------|---------|------|----------|
| 0 | `Hello!` | 1 | 2 | Short ASCII |
| 1 | `01234567` | 1 | 6 | Digits |
| 2 | `HELLO WORLD` | 1 | 4 | Uppercase |
| 3 | `Hello, world!` | 1 | 2 | Mixed ASCII |
| 4 | `https://example.org/i/ABCD2345` | 3 | 3 | Typical invite link |
| 5 | 90-char URL | 6 | 3 | Long link |
| 6 | 110-char URL | 7 | 3 | Very long link (version >= 7) |
| 7 | `你好世界` | 1 | 6 | UTF-8 Chinese |
| 8 | 30-char Chinese string | 4 | 4 | Multi-byte UTF-8 |
| 9 | `exactly14bytes` | 1 | 2 | V1 capacity boundary (14 bytes) |
| 10 | `15bytes_string!` | 2 | 1 | V1→V2 overflow |
| 11 | 26 lowercase letters | 2 | 3 | V2 capacity boundary |
| 12 | 27 lowercase letters | 3 | 2 | V2→V3 overflow |
| 13 | `A` x 120 | 7 | 3 | Version 7 (version info required) |
| 14 | `B` x 200 | 10 | 2 | Version 10 |
| 15-22 | `mask-test` forced mask 0-7 | 1 | 0-7 | All 8 mask patterns |
| 23-30 | invite URL forced mask 0-7 | 3 | 0-7 | All 8 masks on multi-version |

## Results

- **Decode (zxing-cpp):** 31/31 passed
- **Structure (segno):** 31/31 passed

Structure comparison covers all non-data modules: finder patterns,
separators, timing patterns, alignment patterns, format information
(both copies), and version information.

Data-area modules are not compared against segno because segno's
`write_padding_bits` unconditionally adds 8 zero bits even when the data
stream is already byte-aligned (`8 - (0 % 8) = 8`).  Our implementation
follows ISO 18004:2015 section 7.4.10 literally (zero padding bits when
already at a codeword boundary).  Both produce valid, scannable QR codes;
the zxing-cpp decode test confirms this.

## Bugs found and fixed

### Bug: `placeFormatBits` — incorrect bit ordering and copy layout

The original implementation treated the format information as a single
15-bit sequence laid out linearly across the horizontal and vertical strips.
The ISO 18004 standard (Table C.2, Section 7.9.1) specifies two independent
copies, each carrying all 15 bits:

- **Copy 1** (around the top-left finder): MSB-first in the horizontal strip,
  LSB-first in the vertical strip, meeting at the corner module (8, 8).
- **Copy 2** (top-right + bottom-left): LSB-first in the horizontal strip
  (cols size-1 down to size-8), MSB-first in the vertical strip
  (rows size-1 down to size-7), with the dark module at (size-8, 8).

The old code had:
1. Bit extraction `(info >> i) & 1` — reads bit i from the LSB, but the
   placement positions assumed MSB-first ordering.
2. The second horizontal copy missed column `size-1` entirely (only 7
   entries for 8 bit positions).
3. The vertical copy mapping was inverted relative to the standard.

**Fix:** Rewrote `placeFormatBits` to loop once from 0 to 7, extracting
both `lo = (info >> i) & 1` and `hi = (info >> (14-i)) & 1` per iteration,
placing each into both copies at the correct ISO positions.  The dark module
at `(size-8, 8)` is set unconditionally after the loop.

## Reproducing

```bash
# Set up venv
python3 -m venv /tmp/qrvenv
/tmp/qrvenv/bin/pip install segno==1.6.6 zxing-cpp==3.1.1 Pillow==12.3.0

# Generate matrices
cd <repo-root>
npx tsx scripts/qr-crosscheck.py --dump   # or use the inline dump script

# Run crosscheck
/tmp/qrvenv/bin/python3 scripts/qr-crosscheck.py
```

## Unit tests

The vitest suite (`shared/test/qr.test.ts`) includes:

- **ISO Table C.1 format info verification** — all 8 masks verified against
  the published BCH-encoded values, reading both copies from the matrix.
- **Frozen reference vectors** — SHA-256 hashes of 6 representative matrices
  (short ASCII, digits, exact-capacity, URL, version 7, Chinese) pinned as
  regression snapshots.
- **Cross-scan consistency** — both format info copies yield the same 15-bit
  value across multiple inputs.
- **Structural checks** — finders, timing, dark module, separators.
