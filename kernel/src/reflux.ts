/**
 * AI product reflux detection.
 *
 * Detects when a witness testimony copies or paraphrases AI-generated output
 * (room narratives, court claims, biography chapters). Uses 3-char shingle
 * MinHash fingerprinting (128 dimensions) to compare incoming human text
 * against registered AI artifacts.
 *
 * Migrated from personality_structure_server/narrative-fingerprint.service.ts,
 * stripped of Midway/TypeORM — pure functions + Store integration.
 */
import { createHash } from 'node:crypto';
import type { RefluxSuspicion } from '@openmimic/shared';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const MINHASH_SIZE = 128;
export const REFLUX_THRESHOLD = 0.5;

/* ------------------------------------------------------------------ */
/* Core types                                                          */
/* ------------------------------------------------------------------ */

export interface AiFingerprint {
  /** Artifact identifier, e.g. "room:session-abc" or "court:claim-xyz". */
  artifactId: string;
  /** Subject the artifact was generated for. */
  subjectId: string;
  /** MinHash signature (128 uint32 values). */
  minhashSig: number[];
  /** SHA-256 hashes of normalized synthetic claims. */
  syntheticClaimHashes: string[];
  /** SHA-256 of the full canonical text. */
  textDigest: string;
}

export interface RefluxMatch {
  suspicion: RefluxSuspicion;
  matchedArtifactId?: string;
  signal?: 'synthetic_claim' | 'minhash';
  similarity?: number;
}

/* ------------------------------------------------------------------ */
/* Text normalization                                                  */
/* ------------------------------------------------------------------ */

/**
 * Canonical form: NFKC, lowercase, collapse whitespace, normalize quotes and
 * punctuation. Identical to the old platform's canonicalText.
 */
export function canonicalText(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[“”‘’""'']/g, '"')
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.');
}

/**
 * Normalize a claim for hash comparison: canonical text with dates and numbers
 * replaced by placeholders, so "2024年3月" and "2025年1月" produce the same hash.
 */
export function normalizeClaim(text: string): string {
  return canonicalText(text)
    .replace(/\b\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?\b/g, '<date>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<number>');
}

/** Split text into sentence-level claim candidates. */
export function extractClaims(text: string): string[] {
  return String(text || '')
    .split(/[。！？!?；;\n]+/)
    .map((v) => v.trim())
    .filter((v) => v.length >= 4);
}

/* ------------------------------------------------------------------ */
/* MinHash                                                             */
/* ------------------------------------------------------------------ */

/**
 * 3-char shingle MinHash with 128 hash functions.
 * Each hash function = SHA-256(seed + ":" + shingle), take first 4 bytes as uint32.
 */
export function minhash(text: string): number[] {
  const chars = [...canonicalText(text)];
  const shingles = new Set<string>();
  if (chars.length < 3) {
    shingles.add(chars.join(''));
  } else {
    for (let i = 0; i <= chars.length - 3; i++) {
      shingles.add(chars.slice(i, i + 3).join(''));
    }
  }
  if (!shingles.size) return Array(MINHASH_SIZE).fill(0);

  return Array.from({ length: MINHASH_SIZE }, (_, seed) => {
    let min = 0xffffffff;
    for (const shingle of shingles) {
      const hash = createHash('sha256')
        .update(`${seed}:${shingle}`)
        .digest()
        .readUInt32BE(0);
      if (hash < min) min = hash;
    }
    return min;
  });
}

/** Jaccard estimate from two MinHash signatures. */
export function minhashSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let equal = 0;
  for (let i = 0; i < left.length; i++) {
    if (left[i] === right[i]) equal++;
  }
  return equal / left.length;
}

/* ------------------------------------------------------------------ */
/* Fingerprint computation                                             */
/* ------------------------------------------------------------------ */

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Compute a fingerprint for an AI-generated artifact.
 *
 * @param artifactId  Unique artifact key, e.g. "room:session-abc"
 * @param subjectId   The subject this artifact belongs to
 * @param text        Full text of the AI artifact
 * @param claims      Optional pre-extracted claims; auto-extracted if absent
 */
export function computeFingerprint(
  artifactId: string,
  subjectId: string,
  text: string,
  claims?: string[],
): AiFingerprint {
  const resolvedClaims = (claims ?? extractClaims(text)).map(normalizeClaim).filter(Boolean);
  return {
    artifactId,
    subjectId,
    minhashSig: minhash(text),
    syntheticClaimHashes: [...new Set(resolvedClaims.map(sha256))],
    textDigest: sha256(canonicalText(text)),
  };
}

/* ------------------------------------------------------------------ */
/* Reflux screening                                                    */
/* ------------------------------------------------------------------ */

/**
 * Screen incoming text against a set of registered AI fingerprints.
 *
 * Decision levels:
 * - **high**: a normalized claim in the incoming text exactly matches a
 *   synthetic claim hash → the witness likely copied an AI sentence verbatim.
 * - **low**: MinHash similarity >= threshold (default 0.5) → structural
 *   resemblance suggesting paraphrase.
 * - **none**: no significant overlap detected.
 */
export function screenReflux(
  text: string,
  candidates: readonly AiFingerprint[],
): RefluxMatch {
  if (!candidates.length || !String(text || '').trim()) {
    return { suspicion: 'none' };
  }

  const incoming = computeFingerprint('__screen__', '', text);

  // Always compute best minhash similarity (needed for all return paths)
  let bestSimilarity: number | undefined;
  let bestArtifactId: string | undefined;
  for (const candidate of candidates) {
    const sim = minhashSimilarity(incoming.minhashSig, candidate.minhashSig);
    if (bestSimilarity === undefined || sim > bestSimilarity) {
      bestSimilarity = sim;
      bestArtifactId = candidate.artifactId;
    }
  }

  // Pass 1: exact synthetic claim hash match
  for (const candidate of candidates) {
    const tainted = new Set(candidate.syntheticClaimHashes);
    if (incoming.syntheticClaimHashes.some((hash) => tainted.has(hash))) {
      return {
        suspicion: 'high',
        matchedArtifactId: candidate.artifactId,
        signal: 'synthetic_claim',
        similarity: bestSimilarity,
      };
    }
  }

  // Pass 2: MinHash similarity threshold
  if (bestSimilarity !== undefined && bestSimilarity >= REFLUX_THRESHOLD) {
    return {
      suspicion: 'low',
      matchedArtifactId: bestArtifactId,
      signal: 'minhash',
      similarity: bestSimilarity,
    };
  }

  return { suspicion: 'none', similarity: bestSimilarity };
}
