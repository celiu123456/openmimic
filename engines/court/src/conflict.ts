import type { Claim, Testimony } from '@openmimic/shared';
import { cosine, type EmbeddingClient } from '@openmimic/kernel';

/** A candidate claim under examination. */
export interface CandidateClaim {
  id: string;
  text: string;
  witnessId: string;
  evidenceTestimonyIds: string[];
}

/** A pair of claims from different witnesses that may be related. */
export interface ClaimPair {
  claimA: Claim;
  claimB: Claim;
}

/** A piece of material from another witness that appears to contradict a claim. */
export interface ConflictMaterial {
  witnessId: string;
  testimonyId: string;
  snippet: string;
  matchedKeywords: string[];
}

/**
 * Finds material that warrants cross-examination.
 *
 * W1 ships a deliberately crude keyword-overlap implementation; W2 replaces it
 * with an embedding-based finder behind this same interface.
 */
export interface ConflictFinder {
  findConflicts(
    claim: CandidateClaim,
    testimonies: readonly Testimony[],
  ): ConflictMaterial[];
}

/**
 * Finds pairs of claims from different witnesses that are semantically
 * related and should undergo relation judgment.
 */
export interface ClaimPairFinder {
  findPairs(claims: readonly Claim[]): Promise<ClaimPair[]>;
}

const CJK_CHARACTER = /[\u3400-\u9fff]/;
const LATIN_WORD = /[a-z0-9]+/g;

/**
 * Words that carry no probative signal. Without this list, "she is" would make
 * every English claim conflict with every English testimony.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from',
  'had', 'has', 'have', 'he', 'her', 'hers', 'him', 'his', 'i', 'in', 'is', 'it',
  'its', 'me', 'my', 'of', 'on', 'or', 'our', 'ours', 'she', 'so', 'than', 'that',
  'the', 'their', 'theirs', 'them', 'then', 'there', 'they', 'this', 'to', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'who', 'with', 'you', 'your',
  'always', 'never', 'only', 'very', 'extremely', 'really', 'just', 'also',
]);

/** Tokenize into latin words plus CJK character bigrams. */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();

  for (const match of lower.matchAll(LATIN_WORD)) {
    const token = match[0];
    if (token.length >= 2 && !STOPWORDS.has(token)) tokens.add(token);
  }

  const cjk = [...lower].filter((character) => CJK_CHARACTER.test(character));
  for (let index = 0; index + 1 < cjk.length; index += 1) {
    tokens.add(`${cjk[index]}${cjk[index + 1]}`);
  }

  return tokens;
}

/** Flatten every readable surface of a testimony into one comparison string. */
function testimonyText(testimony: Testimony): string {
  const parts: string[] = [];
  for (const answer of testimony.answers) {
    parts.push(answer.behindText);
    if (answer.frontText) parts.push(answer.frontText);
  }
  if (testimony.freeText) parts.push(testimony.freeText);
  return parts.join(' ').trim();
}

/**
 * W1 placeholder conflict finder: keyword intersection between the candidate
 * claim text and other witnesses' testimony. The claim's own witness and its
 * own evidence are excluded — you cannot cross-examine a witness with their
 * own words.
 */
export class KeywordConflictFinder implements ConflictFinder {
  /** Minimum shared keywords before material counts as a conflict. */
  constructor(private readonly minimumOverlap = 1) {}

  findConflicts(
    claim: CandidateClaim,
    testimonies: readonly Testimony[],
  ): ConflictMaterial[] {
    const claimTokens = tokenize(claim.text);
    if (claimTokens.size === 0) return [];

    const conflicts: ConflictMaterial[] = [];
    for (const testimony of testimonies) {
      if (testimony.witnessId === claim.witnessId) continue;
      if (claim.evidenceTestimonyIds.includes(testimony.id)) continue;

      const text = testimonyText(testimony);
      const tokens = tokenize(text);
      const matchedKeywords = [...claimTokens].filter((token) => tokens.has(token)).sort();
      if (matchedKeywords.length < this.minimumOverlap) continue;

      conflicts.push({
        witnessId: testimony.witnessId,
        testimonyId: testimony.id,
        snippet: text,
        matchedKeywords,
      });
    }
    return conflicts;
  }
}

/**
 * Embedding-based claim pair finder: uses cosine similarity between
 * claim text embeddings to find related claims from different witnesses.
 */
export class EmbeddingClaimPairFinder implements ClaimPairFinder {
  constructor(
    private readonly embedding: EmbeddingClient,
    private readonly threshold: number = 0.55,
  ) {}

  async findPairs(claims: readonly Claim[]): Promise<ClaimPair[]> {
    if (claims.length < 2) return [];
    const texts = claims.map((c) => c.text);
    const vectors = await this.embedding.embed(texts);
    const pairs: ClaimPair[] = [];

    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const a = claims[i]!;
        const b = claims[j]!;
        // Only pair claims from different witnesses
        if (a.witnessIds?.[0] === b.witnessIds?.[0] && a.witnessIds?.[0] !== undefined) continue;
        // Use evidence to infer witness origin for claims without witnessIds
        const evidenceOverlap = a.evidence.some((e) => b.evidence.includes(e));
        if (evidenceOverlap) continue;

        const sim = cosine(vectors[i]!, vectors[j]!);
        if (sim >= this.threshold) {
          pairs.push({ claimA: a, claimB: b });
        }
      }
    }
    return pairs;
  }
}

/**
 * Keyword-based claim pair finder: fallback when no embedding is available.
 * Pairs claims from different witnesses that share keyword overlap.
 */
export class KeywordClaimPairFinder implements ClaimPairFinder {
  constructor(private readonly minimumOverlap: number = 2) {}

  async findPairs(claims: readonly Claim[]): Promise<ClaimPair[]> {
    if (claims.length < 2) return [];
    const pairs: ClaimPair[] = [];
    const tokenSets = claims.map((c) => tokenize(c.text));

    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const a = claims[i]!;
        const b = claims[j]!;
        if (a.witnessIds?.[0] === b.witnessIds?.[0] && a.witnessIds?.[0] !== undefined) continue;
        const evidenceOverlap = a.evidence.some((e) => b.evidence.includes(e));
        if (evidenceOverlap) continue;

        const shared = [...tokenSets[i]!].filter((t) => tokenSets[j]!.has(t));
        if (shared.length >= this.minimumOverlap) {
          pairs.push({ claimA: a, claimB: b });
        }
      }
    }
    return pairs;
  }
}
