/**
 * AI product reflux detection.
 *
 * Detects when a witness testimony copies or paraphrases AI-generated output
 * (room narratives, court claims, biography chapters). Uses 3-char shingle
 * MinHash fingerprinting (128 dimensions) to compare incoming human text
 * against registered AI artifacts.
 *
 * v2 (2026-10-06): Two-layer screening for improved paraphrase detection:
 *   Layer 1: MinHash similarity (structural overlap) — catches verbatim/near-
 *            verbatim copying. Threshold lowered to configurable MINHASH_MEDIUM
 *            for "maybe" zone.
 *   Layer 2: Rare phrase/number/proper-noun matching — catches light rewrites
 *            that preserve distinctive content (specific numbers, proper names,
 *            uncommon phrases) even when surface text changes enough to defeat
 *            MinHash. When medium-similarity minhash OR rare-phrase match,
 *            an optional LLM confirmation call determines final suspicion.
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

/**
 * Medium-similarity threshold for the "maybe" zone. When minhash similarity
 * is between MINHASH_MEDIUM_THRESHOLD and REFLUX_THRESHOLD, the text is a
 * candidate for LLM confirmation. Configurable.
 */
export const MINHASH_MEDIUM_THRESHOLD = 0.3;

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

/* ------------------------------------------------------------------ */
/* Rare phrase extraction (Layer 2)                                    */
/* ------------------------------------------------------------------ */

/**
 * Extract "rare phrases" from text: proper nouns, specific numbers, and
 * uncommon multi-character phrases that serve as fingerprints for content
 * identity even across paraphrase.
 *
 * A phrase is "rare" if it is:
 * - A number with 3+ digits (specific amounts, dates, IDs)
 * - A sequence of 2+ CJK characters that looks like a proper noun
 *   (preceded by common title/role markers or capitalized)
 * - A multi-word proper noun in Latin script (2+ consecutive capitalized words)
 * - A quoted phrase of 4+ chars
 */
export function extractRarePhrases(text: string): string[] {
  const phrases = new Set<string>();
  const canonical = canonicalText(text);

  // Specific numbers (3+ digits, possibly with decimal)
  for (const m of canonical.matchAll(/\d{3,}(?:\.\d+)?/g)) {
    phrases.add(m[0]);
  }

  // Quoted content (4+ chars between quotes)
  for (const m of canonical.matchAll(/"([^"]{4,})"/g)) {
    phrases.add(m[1]!);
  }

  // CJK proper nouns: 2-4 char sequences after role/relationship markers
  // or standalone at sentence boundaries (e.g. 叫张三, 帮老王, 找李明, etc.)
  const originalNfkc = String(text || '').normalize('NFKC');
  for (const m of originalNfkc.matchAll(/(?:叫|是|跟|和|给|被|让|对|与|找|帮|助|问|见|约|陪|老|小)([^\s,，。.!！?？;；:：\n]{2,4})/g)) {
    const name = m[1]!.trim();
    if (name.length >= 2 && name.length <= 4) {
      phrases.add(name.toLowerCase());
    }
  }

  // CJK names at sentence start (2-3 chars followed by a verb or particle)
  for (const m of originalNfkc.matchAll(/(?:^|[。！？!?\n;；,，])[\s]*([^\s,，。.!！?？;；\n]{2,3})(?:是|在|的|说|做|去|来|有|会|能|想|要|给|跟|和|叫)/g)) {
    const name = m[1]!.trim();
    if (name.length >= 2) {
      phrases.add(name.toLowerCase());
    }
  }

  // Latin proper nouns: consecutive capitalized words
  for (const m of String(text || '').matchAll(/(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g)) {
    phrases.add(m[0].toLowerCase());
  }

  return [...phrases];
}

/**
 * Compute rare phrase overlap between incoming text and an AI artifact's text.
 * Returns the fraction of the artifact's rare phrases found in the incoming text.
 */
export function rarePhraseOverlap(
  incomingPhrases: readonly string[],
  artifactPhrases: readonly string[],
): number {
  if (!artifactPhrases.length) return 0;
  const incoming = new Set(incomingPhrases);
  let matches = 0;
  for (const phrase of artifactPhrases) {
    if (incoming.has(phrase)) matches++;
  }
  return matches / artifactPhrases.length;
}

/* ------------------------------------------------------------------ */
/* Enhanced reflux screening (v2: two-layer)                           */
/* ------------------------------------------------------------------ */

/**
 * LLM interface for reflux confirmation. Kept minimal — only needs a
 * single string-in, string-out call. The caller is responsible for rate
 * limiting and error handling.
 */
export interface RefluxLLM {
  complete(opts: { system: string; user: string }): Promise<string>;
}

/**
 * Maximum number of LLM confirmation calls per screening batch.
 * Prevents runaway costs when many candidates trigger the medium zone.
 */
export const MAX_REFLUX_LLM_CALLS = 3;

export interface EnhancedRefluxMatch extends RefluxMatch {
  /** Rare phrases found in both the incoming text and the matched artifact. */
  sharedRarePhrases?: string[];
  /** Whether LLM confirmation was used. */
  llmConfirmed?: boolean;
}

/**
 * Build the LLM confirmation prompt. Sends the candidate artifact fragment
 * and the incoming testimony fragment. Does NOT send other witnesses' text.
 */
export function buildRefluxConfirmPrompt(
  artifactFragment: string,
  testimonyFragment: string,
): { system: string; user: string } {
  return {
    system: `You are a plagiarism detector for an AI system. You will see two text fragments:
- ARTIFACT: a piece of text generated by an AI system.
- TESTIMONY: a piece of text submitted by a human witness.

Determine whether the TESTIMONY is a rephrasing, paraphrase, or close restatement of the ARTIFACT's meaning. Minor wording changes, synonym substitution, or reorganization still count as a match. Completely different content does not.

Answer with exactly one word: YES (the testimony restates the artifact) or NO (they are about different things).`,
    user: `ARTIFACT:\n${artifactFragment.slice(0, 500)}\n\nTESTIMONY:\n${testimonyFragment.slice(0, 500)}`,
  };
}

/**
 * Enhanced reflux screening with two-layer detection.
 *
 * Layer 1: Original MinHash + synthetic claim hash (unchanged).
 * Layer 2: When MinHash similarity is in the medium zone
 *   (MINHASH_MEDIUM_THRESHOLD <= sim < REFLUX_THRESHOLD) OR when rare
 *   phrase overlap is detected, optionally use an LLM to confirm.
 *
 * Without an LLM, the medium zone uses rare phrase overlap as a secondary
 * signal: if >= 2 shared rare phrases, suspicion = 'medium'.
 *
 * @param text       Incoming testimony text
 * @param candidates Registered AI fingerprints
 * @param llm        Optional LLM for confirmation (capped at MAX_REFLUX_LLM_CALLS)
 * @param artifactTexts  Map of artifactId -> original text (for LLM confirmation)
 */
export async function screenRefluxEnhanced(
  text: string,
  candidates: readonly AiFingerprint[],
  llm?: RefluxLLM,
  artifactTexts?: ReadonlyMap<string, string>,
): Promise<EnhancedRefluxMatch> {
  if (!candidates.length || !String(text || '').trim()) {
    return { suspicion: 'none' };
  }

  // Run original screening first
  const baseResult = screenReflux(text, candidates);
  if (baseResult.suspicion === 'high') {
    return { ...baseResult };
  }

  const incoming = computeFingerprint('__screen__', '', text);
  const incomingRare = extractRarePhrases(text);

  // Find the best candidate by combined score
  let bestCandidate: { artifactId: string; similarity: number; sharedPhrases: string[] } | undefined;

  for (const candidate of candidates) {
    const sim = minhashSimilarity(incoming.minhashSig, candidate.minhashSig);
    const artifactText = artifactTexts?.get(candidate.artifactId) ?? '';
    const artifactRare = artifactText ? extractRarePhrases(artifactText) : [];
    const sharedPhrases = incomingRare.filter((p) => artifactRare.includes(p));

    const inMediumZone = sim >= MINHASH_MEDIUM_THRESHOLD && sim < REFLUX_THRESHOLD;
    const hasRareOverlap = sharedPhrases.length >= 2;

    if (inMediumZone || hasRareOverlap) {
      if (
        !bestCandidate ||
        sim > bestCandidate.similarity ||
        (sim === bestCandidate.similarity && sharedPhrases.length > bestCandidate.sharedPhrases.length)
      ) {
        bestCandidate = { artifactId: candidate.artifactId, similarity: sim, sharedPhrases };
      }
    }
  }

  // If we have a medium-zone candidate, try LLM confirmation
  if (bestCandidate) {
    if (llm && artifactTexts) {
      const artifactText = artifactTexts.get(bestCandidate.artifactId);
      if (artifactText) {
        try {
          const prompt = buildRefluxConfirmPrompt(artifactText, text);
          const response = await llm.complete(prompt);
          const isMatch = response.trim().toUpperCase().startsWith('YES');
          if (isMatch) {
            return {
              suspicion: 'medium',
              matchedArtifactId: bestCandidate.artifactId,
              signal: 'minhash',
              similarity: bestCandidate.similarity,
              sharedRarePhrases: bestCandidate.sharedPhrases,
              llmConfirmed: true,
            };
          }
          // LLM says NO — not a reflux
          return {
            suspicion: 'none',
            similarity: bestCandidate.similarity,
            sharedRarePhrases: bestCandidate.sharedPhrases,
            llmConfirmed: false,
          };
        } catch {
          // LLM failed — fall through to heuristic
        }
      }
    }

    // No LLM available: use rare phrase overlap as heuristic
    if (bestCandidate.sharedPhrases.length >= 2) {
      return {
        suspicion: 'medium',
        matchedArtifactId: bestCandidate.artifactId,
        signal: 'minhash',
        similarity: bestCandidate.similarity,
        sharedRarePhrases: bestCandidate.sharedPhrases,
      };
    }
  }

  // Pass through the original result
  if (baseResult.suspicion === 'low') {
    return { ...baseResult };
  }

  return { suspicion: 'none', similarity: baseResult.similarity };
}
