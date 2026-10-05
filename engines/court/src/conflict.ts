import { tryExtractJson, wrapUntrusted, appendGuardInstruction, type Claim, type Testimony } from '@openmimic/shared';
import { cosine, type EmbeddingClient } from '@openmimic/kernel';
import type { LLMClient } from './llm';

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

/* ------------------------------------------------------------------ */
/* LLM-based claim pair finder                                         */
/* ------------------------------------------------------------------ */

const LLM_PAIR_SYSTEM = [
  '你是人格法庭的论断配对智能体。',
  '输入是一组编号论断,每条标注了所属证人。',
  '请找出来自不同证人、谈的是同一行为主题的论断对。',
  '输出 JSON 数组,每个元素形如 {"a": 编号, "b": 编号}。',
  '只配对来自不同证人的论断。如果没有可配对的,输出空数组 []。',
  '只输出 JSON 数组,不要输出任何解释或 markdown 代码块。',
].join('\n');

interface LLMPairItem {
  a: number;
  b: number;
}

/**
 * LLM-based claim pair finder: uses a single LLM call to identify
 * semantically related claim pairs from different witnesses.
 * Default pair finder when no embedding is available (keyword version
 * becomes the last-resort fallback when LLM is also unavailable).
 */
export class LLMClaimPairFinder implements ClaimPairFinder {
  constructor(
    private readonly llm: LLMClient,
    /** Maximum number of claims to send in one batch. */
    private readonly batchSize: number = 60,
  ) {}

  async findPairs(claims: readonly Claim[]): Promise<ClaimPair[]> {
    if (claims.length < 2) return [];

    // Build numbered list for the LLM
    const lines: string[] = [];
    for (let i = 0; i < claims.length; i++) {
      const c = claims[i]!;
      const witnessLabel = c.witnessIds?.[0] ?? '?';
      lines.push(`${i}: [证人 ${witnessLabel}] ${wrapUntrusted(`claim:${c.id}`, c.text)}`);
    }

    const userPrompt = appendGuardInstruction(lines.join('\n'));

    try {
      const response = await this.llm.complete({
        system: LLM_PAIR_SYSTEM,
        user: userPrompt,
        maxTokens: 2048,
        purpose: 'court-pairing',
      });

      const raw = tryExtractJson(response);
      if (!Array.isArray(raw)) {
        // LLM returned unparseable output, fall back to keyword pairing
        return new KeywordClaimPairFinder().findPairs(claims);
      }

      const pairs: ClaimPair[] = [];
      const seen = new Set<string>();

      for (const item of raw) {
        if (typeof item !== 'object' || item === null) continue;
        const { a, b } = item as LLMPairItem;
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        if (a < 0 || a >= claims.length || b < 0 || b >= claims.length) continue;
        if (a === b) continue;

        const claimA = claims[a]!;
        const claimB = claims[b]!;

        // Must be from different witnesses
        if (claimA.witnessIds?.[0] === claimB.witnessIds?.[0] && claimA.witnessIds?.[0] !== undefined) continue;

        // Dedup
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seen.has(key)) continue;
        seen.add(key);

        pairs.push({ claimA, claimB });
      }

      return pairs;
    } catch {
      // If LLM call fails, fall back to keyword pairing
      return new KeywordClaimPairFinder().findPairs(claims);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic pair pre-judgment (classifyPair)                      */
/* ------------------------------------------------------------------ */

/**
 * Deterministic relation classification applied *before* the LLM
 * relation judgment call. If a deterministic rule matches, the court
 * can skip the LLM call entirely for that pair.
 *
 * Migrated from the old platform's `classifyPair` in
 * `memory-contradiction-detector.service.ts`. Adapted to work with
 * OpenMimic's Claim type (no personality entity, no DI).
 *
 * Relations (matching the old platform's taxonomy):
 * - `perspective_differs`:  same subject, different observers → keep both
 * - `retelling_diverges`:   same event retold by different witnesses with
 *                           divergent details → keep both, flag divergence
 * - `supersedes`:           later claim replaces an earlier one (time evolution)
 * - `refines`:              one claim is a compatible detail extension of the other
 * - `contradicts`:          mutually exclusive at the same time → true conflict
 * - `null`:                 no deterministic rule matched → fall through to LLM
 */
export type PairPreJudgment =
  | 'perspective_differs'
  | 'retelling_diverges'
  | 'supersedes'
  | 'refines'
  | 'contradicts';

export interface PairPreJudgmentResult {
  relation: PairPreJudgment;
  confidence: number;
  rule: string;
}

/**
 * Check if two claims represent a self-report vs witness observation
 * perspective difference. The original platform rule applies when one
 * side is the subject's own self-report and the other is a witness
 * observation — not for two witnesses making independent evaluations.
 *
 * Two witnesses from different angles should still go to LLM, which
 * applies the stricter standard: "same behavioral dimension, different
 * observation direction counts; different dimensions are unrelated."
 *
 * @param subjectWitnessId - The witness id that represents the
 *   subject's self-report, if one exists. Without this, the rule
 *   cannot fire (OpenMimic's court does not mix self-report into
 *   testimony by default).
 */
function isPerspectiveDifference(a: Claim, b: Claim, subjectWitnessId?: string): boolean {
  // Different witnesses (already guaranteed by pair finders, but be safe)
  const wA = a.witnessIds?.[0];
  const wB = b.witnessIds?.[0];
  if (!wA || !wB || wA === wB) return false;

  // Rule: one side must be the subject's own self-report witness.
  // Two third-party witnesses with different audiences are NOT pre-judged
  // as perspective differences — only the LLM can determine whether they
  // are observing the same behavioral dimension from different angles.
  if (subjectWitnessId) {
    const oneIsSelf = wA === subjectWitnessId || wB === subjectWitnessId;
    if (oneIsSelf && a.domain === 'evaluative' && b.domain === 'evaluative') return true;
  }

  return false;
}

/**
 * Detect mutual exclusion at the keyword level.
 *
 * Looks for explicit negation patterns: one claim asserts X, the other
 * asserts not-X. Very conservative — only triggers on clear antonym
 * pairs (e.g. "喜欢运动" vs "不喜欢运动").
 */
function hasMutualExclusion(textA: string, textB: string): boolean {
  // Check if one is the negation of the other (Chinese negation patterns)
  const negations = ['不', '没有', '从不', '绝不', '毫不', '并不', '不再'];
  for (const neg of negations) {
    // If B contains neg+phrase that appears in A without neg
    if (textA.includes(neg) !== textB.includes(neg)) {
      // Check if removing the negation makes them overlap
      const stripped = textA.includes(neg)
        ? textA.replace(neg, '')
        : textB.replace(neg, '');
      const other = textA.includes(neg) ? textB : textA;
      const strippedTokens = tokenize(stripped);
      const otherTokens = tokenize(other);
      let overlap = 0;
      for (const t of strippedTokens) {
        if (otherTokens.has(t)) overlap++;
      }
      // High overlap after stripping negation → mutual exclusion
      if (overlap >= 3 && overlap >= strippedTokens.size * 0.4) return true;
    }
  }
  return false;
}

/**
 * Detect if one claim is a strict detail extension (refinement) of the other.
 *
 * Claim A refines Claim B when A's token set is a proper superset of B's
 * content tokens (A says everything B says, plus more).
 */
function isRefinement(textA: string, textB: string): boolean {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  // A must be strictly larger (more detail) and B must be non-trivial.
  // Minimum 5 tokens on the shorter claim avoids false positives from
  // shared CJK bigrams like "林默", "他的", "不是" etc.
  if (tokensA.size <= tokensB.size || tokensB.size < 5) return false;

  let containedCount = 0;
  for (const t of tokensB) {
    if (tokensA.has(t)) containedCount++;
  }
  // B must be almost entirely contained in A (90% for tighter matching)
  return containedCount >= tokensB.size * 0.9;
}

export interface ClassifyPairOptions {
  /**
   * Witness id that represents the subject's own self-report.
   * Required for the perspective-differs rule to fire.
   * When absent the rule is skipped (OpenMimic court does not mix
   * self-report into testimony by default).
   */
  subjectWitnessId?: string;
}

/**
 * Try to classify a claim pair deterministically before the LLM.
 *
 * Returns null when no deterministic rule matches (caller should
 * proceed to LLM relation judgment).
 *
 * **Conservative policy**: every rule must have clear, mechanically
 * verifiable evidence. When in doubt the function returns null so the
 * LLM can apply the full "same behavioral dimension, different
 * observation direction" standard.
 *
 * Time-based rules (`supersedes`, `retelling_diverges`) require the
 * claims to have `context.period` set with comparable temporal
 * information; without it, they cannot fire.
 */
export function classifyPair(
  a: Claim,
  b: Claim,
  opts?: ClassifyPairOptions,
): PairPreJudgmentResult | null {
  // Rule 1: perspective differs — ONLY when one side is self-report
  // Two witnesses making independent evaluations go to LLM.
  if (isPerspectiveDifference(a, b, opts?.subjectWitnessId)) {
    return { relation: 'perspective_differs', confidence: 0.82, rule: 'self_vs_witness_evaluative' };
  }

  const textA = a.text;
  const textB = b.text;

  // Rule 2: mutual exclusion check
  const exclusive = hasMutualExclusion(textA, textB);

  // Time-based rules need period info AND the periods must be
  // syntactically comparable (both contain year-like patterns).
  const periodA = a.context?.period;
  const periodB = b.context?.period;
  const yearPattern = /\d{4}/;
  const hasBothPeriods = !!periodA && !!periodB
    && yearPattern.test(periodA) && yearPattern.test(periodB);

  if (exclusive && hasBothPeriods && periodA === periodB) {
    // Same time + mutual exclusion → true contradiction
    return { relation: 'contradicts', confidence: 0.80, rule: 'same_period_mutual_exclusion' };
  }

  if (exclusive && hasBothPeriods && periodA !== periodB) {
    // Different time + mutual exclusion → time evolution (supersedes)
    return { relation: 'supersedes', confidence: 0.76, rule: 'time_evolution_mutual_exclusion' };
  }

  // Rule 3: refinement — one claim's text must be a strict superset of
  // the other's content tokens. The requirement is deliberately tight:
  // 80% containment of the shorter claim's tokens in the longer one,
  // AND the shorter must have at least 3 tokens (avoid trivial matches).
  if (
    (isRefinement(textA, textB) && tokenize(textB).size >= 3) ||
    (isRefinement(textB, textA) && tokenize(textA).size >= 3)
  ) {
    return { relation: 'refines', confidence: 0.68, rule: 'compatible_detail_extension' };
  }

  // No deterministic rule matched → fall through to LLM
  return null;
}

// tryParseJson was replaced by tryExtractJson from @openmimic/shared
