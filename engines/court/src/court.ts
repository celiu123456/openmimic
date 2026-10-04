import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CONVICTION_UNCHALLENGED_CAP,
  type Claim,
  type ClaimStatus,
  type CourtEvent,
  type CourtReport,
  type CourtSession,
  type Divergence,
  type Episode,
  type Testimony,
  type Witness,
} from '@openmimic/shared';
import type { EmbeddingClient, Store } from '@openmimic/kernel';
import {
  EmbeddingClaimPairFinder,
  KeywordClaimPairFinder,
  KeywordConflictFinder,
  LLMClaimPairFinder,
  type ClaimPairFinder,
  type ConflictFinder,
} from './conflict';
import type { LLMClient, LLMCompletionRequest } from './llm';

/* ------------------------------------------------------------------ */
/* LLM response contracts                                              */
/* ------------------------------------------------------------------ */

const CandidateEpisodeSchema = z.object({
  qid: z.string().min(1),
  text: z.string().min(1),
  situation: z.string().optional(),
  audience: z.string().optional(),
  timeHint: z.string().optional(),
});

const CandidateClaimSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(['fact', 'observation', 'pattern']).optional(),
  domain: z.enum(['observable', 'internal', 'evaluative']).optional(),
  context: z
    .object({
      audience: z.string().optional(),
      situation: z.string().optional(),
      period: z.string().optional(),
    })
    .optional(),
  evidenceTestimonyIds: z.array(z.string()).default([]),
  episodeTexts: z.array(z.string()).optional(),
});

const FilingResponseSchema = z.object({
  episodes: z.array(CandidateEpisodeSchema).default([]),
  claims: z.array(CandidateClaimSchema).default([]),
});

const RelationSchema = z.object({
  relation: z.enum(['agreement', 'perspective_difference', 'factual_conflict', 'unrelated']),
  topic: z.string().optional(),
  reason: z.string().optional(),
  mergedText: z.string().optional(),
});
export type CourtRelation = z.infer<typeof RelationSchema>;

const ConfrontationVerdictSchema = z.object({
  verdict: z.enum(['qualified', 'unresolved']),
  qualifier: z.string().optional(),
  reason: z.string().optional(),
});

// Legacy export for tests that still reference it
const VerdictSchema = z.object({
  verdict: z.enum(['survive', 'qualify', 'reject']),
  qualifier: z.string().min(1).optional(),
  reason: z.string().optional(),
});
export type CourtVerdict = z.infer<typeof VerdictSchema>;

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

function buildFilingSystem(displayName: string): string {
  return [
    `你是人格法庭的立案书记员。输入是一位证人关于${displayName}的证言。`,
    '你的任务:',
    '1. 从证言中摘录具体事例(episodes):逐字复制原文中描述具体事件/经历的片段。',
    `2. 把证言中关于${displayName}的可对质论断抽成候选论断(claims),写成带情境的观察,不写孤立形容词。`,
    '   kind=fact 只用于可核对的事件。',
    `   ★ 论断的主语必须是${displayName},不是证人自己。证人对自己的评价(如"这是我带人最差的一次")不得立为${displayName}的论断。`,
    `   ★ 论断文本中,称呼被描述者用"${displayName}",称呼证人自己用其与${displayName}的关系名(见下方输入中的关系字段,如"发小""前上司"),不要用"当事人""证人"这类通称。`,
    '只输出 JSON 对象,不要输出任何解释或 markdown 代码块。',
    '形如 {"episodes":[{"qid":"问题id","text":"逐字摘录","situation":"场合","audience":"对谁","timeHint":"时间提示"}],',
    '"claims":[{"text":"论断","kind":"pattern","domain":"observable","context":{"audience":"对谁","situation":"场合","period":"时期"},',
    '"evidenceTestimonyIds":["证言id"],"episodeTexts":["事例原文"]}]}',
    '每个论断必须至少引用一条证言 id。episode.text 必须是证言原文的逐字子串。',
    '请确保 episodes 和 claims 数组都非空(只要证言中有具体事件和可对质的描述)。',
  ].join('\n');
}

const RELATION_SYSTEM = [
  '你是人格法庭的关系判定智能体。',
  '输入是两条来自不同证人的候选论断。',
  '请判定它们的关系:',
  '- agreement:两位证人**各自独立观察到同一种行为模式**,方向一致,可合并。★仅仅话题相近不算;一方只是转述另一方在场的同一件事也不算;只有双方各自有独立的观察才算 agreement。判为 agreement 时,你必须写一句 mergedText:用一句话概括两位证人共同观察到的行为模式,不带任何一方的专属细节(不提具体人名/事件/数字);',
  '- perspective_difference:两人谈的是**同一行为维度**,但观察方向不同(例如同一个人的花钱态度,A说大方B说抠;同一个人的脾气,A说温和B说冷暴力)。★维度必须是一个具体行为(如"花钱""表达情绪""守约""对人态度"),不能是笼统概念;',
  '- factual_conflict:对同一件事实(发生没发生、怎么发生的)的矛盾;',
  '- unrelated:两条论断谈的是**不同的行为维度**,即使它们都在描述同一个人。例如"消防楼梯打电话"和"对外人话多"谈的是不同维度,判 unrelated。',
  '',
  '★判断标准:先确认两条论断是否聚焦同一个具体行为维度。如果不是同一维度,直接判 unrelated。',
  '',
  '正例(perspective_difference): "对朋友花钱大方" vs "对女朋友精确AA" → 同一维度(花钱态度),方向不同 → perspective_difference, topic="消费态度"',
  '反例(unrelated): "在消防楼梯独自打电话" vs "对外人话很多" → 不同维度(压力行为 vs 社交沟通) → unrelated',
  '反例(unrelated): "帮人兜底从不谈条件" vs "冷战十九天" → 不同维度(助人行为 vs 冲突处理) → unrelated',
  '',
  'topic 必须是一个具体维度,如"花钱""表达情绪""接受帮助""守约"等。不要写笼统的描述。',
  '只输出 JSON 对象:{"relation":"...","topic":"...","reason":"...","mergedText":"..."}',
  'mergedText 仅在 agreement 时必须填写。',
].join('\n');

const CONFRONTATION_SYSTEM = [
  '你是人格法庭的对质智能体。',
  '两条论断存在事实性冲突。你不替任何一方判定事实真假。',
  '请给出:',
  '- qualified:两条可以各加一个限定语共存;',
  '- unresolved:无法调和,两条都标记为 contested。',
  '只输出 JSON 对象:{"verdict":"qualified"|"unresolved","qualifier":"限定语","reason":"理由"}',
].join('\n');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Attempt<T> = { ok: true; value: T } | { ok: false; error: Error };

function toError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught));
}

async function attemptJson<T>(
  llm: LLMClient,
  request: LLMCompletionRequest,
  parse: (text: string) => T,
  attempts: number,
): Promise<Attempt<T>> {
  let error: Error = new Error('no attempt was made');
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      const text = await llm.complete(request);
      return { ok: true, value: parse(text) };
    } catch (caught) {
      error = toError(caught);
    }
  }
  return { ok: false, error };
}

/**
 * Extract a JSON value from a possibly chatty LLM response: tolerates
 * markdown fences and surrounding prose.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    /* fall through to more forgiving extraction */
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim()) as unknown;
    } catch {
      /* fall through */
    }
  }

  const start = trimmed.search(/[[{]/);
  if (start >= 0) {
    const candidate = trimmed.slice(start);
    for (const closing of [']', '}'] as const) {
      const end = candidate.lastIndexOf(closing);
      if (end > 0) {
        try {
          return JSON.parse(candidate.slice(0, end + 1)) as unknown;
        } catch {
          /* try the other bracket */
        }
      }
    }
  }

  throw new Error('LLM response did not contain parseable JSON');
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round2 = (value: number): number => Math.round(value * 100) / 100;

/* ------------------------------------------------------------------ */
/* computeConviction — pure function, per §2.3.4                       */
/* ------------------------------------------------------------------ */

export interface ConvictionInput {
  /** Number of independent witness ids backing this claim. */
  witnessCount: number;
  /** Whether the claim has any supporting episode. */
  hasEpisode: boolean;
  /** Whether all supporting episodes are elicited (from followup questions). */
  allEpisodesElicited: boolean;
  /** Whether the claim was ever paired with another claim. */
  wasPaired: boolean;
  /** Whether the claim has status 'contested'. */
  isContested: boolean;
}

/**
 * Compute conviction score for a claim based on evidence quality.
 *
 * Pure function: no side effects, no store access. Designed for unit testing.
 */
export function computeConviction(input: ConvictionInput): number {
  if (input.isContested) return 0;

  // Base 0.5; +0.12 per additional independent witness, cap 0.9
  let score = 0.5 + Math.max(0, input.witnessCount - 1) * 0.12;
  score = Math.min(score, 0.9);

  // No episode support: cap at 0.55
  if (!input.hasEpisode) {
    score = Math.min(score, 0.55);
  }

  // All episodes elicited: multiply by 0.85
  if (input.hasEpisode && input.allEpisodesElicited) {
    score *= 0.85;
  }

  // Never paired: cap at CONVICTION_UNCHALLENGED_CAP
  if (!input.wasPaired) {
    score = Math.min(score, CONVICTION_UNCHALLENGED_CAP);
  }

  return round2(clamp01(score));
}

/* ------------------------------------------------------------------ */
/* No-LLM degradation: sentence splitting for episodes                 */
/* ------------------------------------------------------------------ */

const TIME_WORDS = /那次|有一回|去年|上个月|那天|前年|那会儿|那阵子|有次|上周|上一次|last|once|ago/;

/** Degrade: split by sentence and pick those that look like episodes. */
function degradeToEpisodes(
  text: string,
  qid: string,
): Array<{ qid: string; text: string }> {
  const sentences = text.split(/[。！？!?\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  const episodes: Array<{ qid: string; text: string }> = [];
  for (const sentence of sentences) {
    const hasNumber = /\d/.test(sentence);
    const hasQuote = /["""''「」]/.test(sentence);
    const hasTimeWord = TIME_WORDS.test(sentence);
    if (hasNumber || hasQuote || hasTimeWord) {
      episodes.push({ qid, text: sentence });
    }
  }
  return episodes;
}

/* ------------------------------------------------------------------ */
/* Lenient filing response parser                                      */
/* ------------------------------------------------------------------ */

type FilingResponse = z.infer<typeof FilingResponseSchema>;

/**
 * Parse a filing response leniently: validate each episode and claim
 * individually, keeping the valid ones and discarding invalid items.
 * This prevents a single malformed item (e.g. wrong qid format,
 * missing text) from causing the entire witness to produce zero claims.
 *
 * Throws only if the response is not an object at all.
 */
function lenientParseFilingResponse(raw: unknown): FilingResponse {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('Filing response is not an object');
  }

  const obj = raw as Record<string, unknown>;
  const episodes: z.infer<typeof CandidateEpisodeSchema>[] = [];
  const claims: z.infer<typeof CandidateClaimSchema>[] = [];

  // Parse episodes individually
  const rawEpisodes = Array.isArray(obj.episodes) ? obj.episodes : [];
  for (const ep of rawEpisodes) {
    const result = CandidateEpisodeSchema.safeParse(ep);
    if (result.success) {
      episodes.push(result.data);
    }
  }

  // Parse claims individually
  const rawClaims = Array.isArray(obj.claims) ? obj.claims : [];
  for (const cl of rawClaims) {
    const result = CandidateClaimSchema.safeParse(cl);
    if (result.success) {
      claims.push(result.data);
    }
  }

  // If we got nothing at all, still consider it a failure so degradation kicks in
  if (episodes.length === 0 && claims.length === 0) {
    throw new Error('Filing response contained no valid episodes or claims');
  }

  return { episodes, claims };
}

/* ------------------------------------------------------------------ */
/* Filing prompt                                                       */
/* ------------------------------------------------------------------ */

function buildFilingUser(witness: Witness, testimonies: readonly Testimony[], displayName: string): string {
  const lines: string[] = [
    `${witness.relation}(id: ${witness.id}）`,
    `与${displayName}的关系: ${witness.relation}`,
  ];
  if (witness.stance) lines.push(`立场: ${witness.stance}`);
  lines.push('证言:');
  for (const testimony of testimonies) {
    lines.push(`- 证言 id: ${testimony.id}`);
    testimony.answers.forEach((answer, index) => {
      lines.push(`  [${index + 1}] (qid=${answer.qid}) ${answer.behindText}`);
      if (answer.followupText) {
        lines.push(`  [${index + 1}-追问] (qid=${answer.qid}) ${answer.followupText}`);
      }
    });
    if (testimony.freeText) lines.push(`  自由陈述: ${testimony.freeText}`);
  }
  return lines.join('\n');
}

function buildRelationUser(claimA: Claim, claimB: Claim, witnessRelationMap: Map<string, string>): string {
  const relA = witnessRelationMap.get(claimA.witnessIds?.[0] ?? '') ?? '?';
  const relB = witnessRelationMap.get(claimB.witnessIds?.[0] ?? '') ?? '?';
  return [
    `论断A (${relA}): ${claimA.text}`,
    `论断B (${relB}): ${claimB.text}`,
  ].join('\n');
}

function buildConfrontationUser(claimA: Claim, claimB: Claim, witnessRelationMap: Map<string, string>): string {
  const relA = witnessRelationMap.get(claimA.witnessIds?.[0] ?? '') ?? '?';
  const relB = witnessRelationMap.get(claimB.witnessIds?.[0] ?? '') ?? '?';
  return [
    `论断A (${relA}): ${claimA.text}`,
    `论断B (${relB}): ${claimB.text}`,
    '请判定这两条事实性冲突的结果。',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Pipeline v2                                                         */
/* ------------------------------------------------------------------ */

export interface RunCourtOptions {
  /** Defaults to {@link KeywordConflictFinder} (W1 placeholder). */
  conflictFinder?: ConflictFinder;
  /** Claim pair finder for relation judgment. */
  pairFinder?: ClaimPairFinder;
  /** Embedding client for pair finding. */
  embedding?: EmbeddingClient;
  /** Id factory, injectable for deterministic tests. */
  newId?: () => string;
  /** Clock, injectable for deterministic tests. */
  now?: () => string;
  /** Filing attempts per witness before skipping them (default 2). */
  filingAttempts?: number;
}

interface InternalCandidate {
  id: string;
  text: string;
  witnessId: string;
  evidenceTestimonyIds: string[];
  kind?: 'fact' | 'observation' | 'pattern';
  domain?: 'observable' | 'internal' | 'evaluative';
  context?: { audience?: string; situation?: string; period?: string };
  episodeTexts?: string[];
}

/**
 * Run the v2 adversarial pipeline for one subject:
 *
 * 1. **Filing** — each witness's testimony is handed to the LLM, which
 *    extracts episodes (verbatim excerpts) and proposes claims with context.
 * 2. **Pairing** — claims from different witnesses are compared (by embedding
 *    cosine or keyword overlap) to find potentially related pairs.
 * 3. **Relation judgment** — each pair gets an LLM judgment: agreement,
 *    perspective_difference, factual_conflict, or unrelated.
 * 4. **Conviction** — `computeConviction` calculates scores based on evidence.
 */
export async function runCourt(
  subjectId: string,
  store: Store,
  llm: LLMClient,
  options: RunCourtOptions = {},
): Promise<CourtSession> {
  const newId = options.newId ?? (() => randomUUID());
  const now = options.now ?? (() => new Date().toISOString());

  const sessionId = newId();
  const startedAt = now();
  const transcript: CourtEvent[] = [];

  const subject = store.getSubject(subjectId);
  const displayName = subject?.displayName ?? subjectId;

  store.putCourtSession({
    id: sessionId,
    subjectId,
    startedAt,
    transcript,
  });

  const witnesses = store.listWitnessesBySubject(subjectId);
  const allTestimonies = store.listBySubject(subjectId);
  const pairedClaimIds = new Set<string>();

  const witnessRelationMap = new Map<string, string>();
  for (const w of witnesses) {
    witnessRelationMap.set(w.id, w.relation);
  }

  /* ----------------------------- 1. Filing ----------------------------- */
  const candidates: InternalCandidate[] = [];
  const filedEpisodes: Episode[] = [];

  for (const witness of witnesses) {
    const testimonies = allTestimonies.filter((t) => t.witnessId === witness.id);
    if (testimonies.length === 0) continue;
    const ownTestimonyIds = testimonies.map((t) => t.id);

    const filing = await attemptJson(
      llm,
      {
        system: buildFilingSystem(displayName),
        user: buildFilingUser(witness, testimonies, displayName),
        maxTokens: 4096,
      },
      (text) => {
        const raw = extractJson(text);
        // Use lenient parsing: validate each item individually
        return lenientParseFilingResponse(raw);
      },
      options.filingAttempts ?? 2,
    );

    if (!filing.ok) {
      // Degradation: sentence-split for episodes, no claims
      transcript.push({
        type: 'claim_proposed',
        witnessId: witness.id,
        text: `立案失败,降级为句切分:${filing.error.message}`,
        at: now(),
      });

      for (const testimony of testimonies) {
        for (const answer of testimony.answers) {
          const degraded = degradeToEpisodes(answer.behindText, answer.qid);
          for (const ep of degraded) {
            // Validate as verbatim substring
            if (answer.behindText.includes(ep.text)) {
              const episodeId = newId();
              try {
                const episode = store.putEpisode({
                  id: episodeId,
                  subjectId,
                  witnessId: witness.id,
                  testimonyId: testimony.id,
                  qid: ep.qid,
                  text: ep.text,
                  elicited: false,
                });
                filedEpisodes.push(episode);
              } catch {
                // Skip invalid episodes silently
              }
            }
          }
        }
      }
      continue;
    }

    // Process episodes
    for (const ep of filing.value.episodes) {
      // Find which testimony/answer this episode belongs to
      let anchored = false;
      for (const testimony of testimonies) {
        const answer = testimony.answers.find((a) => a.qid === ep.qid);
        if (!answer) continue;

        // Check behindText first, then followupText
        let elicited = false;
        if (answer.behindText.includes(ep.text)) {
          elicited = false;
        } else if (answer.followupText && answer.followupText.includes(ep.text)) {
          elicited = true;
        } else {
          transcript.push({
            type: 'claim_proposed',
            witnessId: witness.id,
            text: `事例逐字校验失败,丢弃: "${ep.text.slice(0, 40)}…"`,
            at: now(),
          });
          continue;
        }

        const episodeId = newId();
        try {
          const episode = store.putEpisode({
            id: episodeId,
            subjectId,
            witnessId: witness.id,
            testimonyId: testimony.id,
            qid: ep.qid,
            text: ep.text,
            elicited,
            situation: ep.situation,
            audience: ep.audience,
            timeHint: ep.timeHint,
          });
          filedEpisodes.push(episode);
          anchored = true;
        } catch {
          transcript.push({
            type: 'claim_proposed',
            witnessId: witness.id,
            text: `事例入库失败,丢弃: "${ep.text.slice(0, 40)}…"`,
            at: now(),
          });
        }
        break;
      }
      if (!anchored) {
        transcript.push({
          type: 'claim_proposed',
          witnessId: witness.id,
          text: `事例未找到对应证言,丢弃: qid=${ep.qid}`,
          at: now(),
        });
      }
    }

    // Process claims
    for (const proposed of filing.value.claims) {
      const cited = proposed.evidenceTestimonyIds.filter((id) => ownTestimonyIds.includes(id));
      const evidence = cited.length > 0 ? cited : ownTestimonyIds;
      const candidate: InternalCandidate = {
        id: newId(),
        text: proposed.text,
        witnessId: witness.id,
        evidenceTestimonyIds: evidence,
        kind: proposed.kind,
        domain: proposed.domain,
        context: proposed.context,
        episodeTexts: proposed.episodeTexts,
      };
      candidates.push(candidate);
      transcript.push({
        type: 'claim_proposed',
        claimId: candidate.id,
        witnessId: witness.id,
        text: candidate.text,
        at: now(),
      });
    }
  }

  /* ---- Persist initial claims so pairing can read them ---------------- */
  const persistedClaims: Claim[] = [];
  for (const candidate of candidates) {
    // Find matching episode ids
    const myEpisodes = filedEpisodes.filter(
      (ep) => ep.witnessId === candidate.witnessId,
    );
    const episodeIds = myEpisodes.map((ep) => ep.id);

    const claim: Claim = {
      id: candidate.id,
      subjectId,
      text: candidate.text,
      conviction: 0, // placeholder, will be computed after pairing
      evidence: candidate.evidenceTestimonyIds,
      status: 'surviving',
      courtSessionId: sessionId,
      kind: candidate.kind ?? 'pattern',
      domain: candidate.domain,
      context: candidate.context,
      witnessIds: [candidate.witnessId],
      episodeIds: episodeIds.length > 0 ? episodeIds : undefined,
    };
    store.putClaim(claim);
    persistedClaims.push(claim);
  }

  /* ---------------------- 2. Pairing ----------------------------------- */
  const pairFinder: ClaimPairFinder =
    options.pairFinder ??
    (options.embedding
      ? new EmbeddingClaimPairFinder(options.embedding)
      : new LLMClaimPairFinder(llm));

  const pairs = await pairFinder.findPairs(persistedClaims);

  /* ---------------------- 3. Relation judgment ------------------------- */
  const divergences: Divergence[] = [];

  for (const pair of pairs) {
    pairedClaimIds.add(pair.claimA.id);
    pairedClaimIds.add(pair.claimB.id);

    const judgment = await attemptJson(
      llm,
      {
        system: RELATION_SYSTEM,
        user: buildRelationUser(pair.claimA, pair.claimB, witnessRelationMap),
        maxTokens: 1024,
      },
      (text) => RelationSchema.parse(extractJson(text)),
      1,
    );

    if (!judgment.ok) {
      transcript.push({
        type: 'challenge',
        claimId: pair.claimA.id,
        text: `关系判定失败: ${judgment.error.message}`,
        at: now(),
      });
      continue;
    }

    const relation = judgment.value;

    if (relation.relation === 'agreement') {
      // mergedText is required for agreement; if missing/empty, treat as unrelated
      if (!relation.mergedText || relation.mergedText.trim() === '') {
        transcript.push({
          type: 'defense',
          claimId: pair.claimA.id,
          text: `agreement 缺少 mergedText,按 unrelated 处理`,
          at: now(),
        });
        continue;
      }
      // Merge: replace text with mergedText, union evidence/witnesses/episodes
      const merged = store.getClaim(pair.claimA.id);
      if (merged) {
        const bClaim = store.getClaim(pair.claimB.id);
        const mergedEvidence = [...new Set([...merged.evidence, ...(bClaim?.evidence ?? [])])];
        const mergedWitnessIds = [...new Set([...(merged.witnessIds ?? []), ...(bClaim?.witnessIds ?? [])])];
        const mergedEpisodeIds = [...new Set([...(merged.episodeIds ?? []), ...(bClaim?.episodeIds ?? [])])];
        store.putClaim({
          ...merged,
          text: relation.mergedText,
          evidence: mergedEvidence,
          witnessIds: mergedWitnessIds,
          episodeIds: mergedEpisodeIds.length > 0 ? mergedEpisodeIds : undefined,
        });
        // Retire the merged claim
        store.putClaim({ ...pair.claimB, status: 'retired' });
      }
      transcript.push({
        type: 'defense',
        claimId: pair.claimA.id,
        text: `agreement: 与论断 ${pair.claimB.id} 合并 → "${relation.mergedText}" (${relation.reason ?? ''})`,
        at: now(),
      });

    } else if (relation.relation === 'perspective_difference') {
      // Both kept, write divergence
      const divId = newId();
      const divergence: Divergence = {
        id: divId,
        subjectId,
        courtSessionId: sessionId,
        topic: relation.topic ?? pair.claimA.text.slice(0, 50),
        type: 'perspective',
        positions: [
          { witnessId: pair.claimA.witnessIds?.[0] ?? '', claimId: pair.claimA.id, summary: pair.claimA.text },
          { witnessId: pair.claimB.witnessIds?.[0] ?? '', claimId: pair.claimB.id, summary: pair.claimB.text },
        ],
        resolution: 'kept_both',
      };
      store.putDivergence(divergence);
      divergences.push(divergence);

      transcript.push({
        type: 'challenge',
        claimId: pair.claimA.id,
        text: `perspective_difference: 与 ${pair.claimB.id} 视角分歧,两条都保留 (${relation.reason ?? ''})`,
        at: now(),
      });

    } else if (relation.relation === 'factual_conflict') {
      // Confrontation LLM call
      const confrontation = await attemptJson(
        llm,
        {
          system: CONFRONTATION_SYSTEM,
          user: buildConfrontationUser(pair.claimA, pair.claimB, witnessRelationMap),
          maxTokens: 1024,
        },
        (text) => ConfrontationVerdictSchema.parse(extractJson(text)),
        1,
      );

      if (!confrontation.ok || confrontation.value.verdict === 'unresolved') {
        // Both contested
        store.putClaim({ ...pair.claimA, status: 'contested' });
        store.putClaim({ ...pair.claimB, status: 'contested' });
        const divId = newId();
        const divergence: Divergence = {
          id: divId,
          subjectId,
          courtSessionId: sessionId,
          topic: relation.topic ?? pair.claimA.text.slice(0, 50),
          type: 'factual',
          positions: [
            { witnessId: pair.claimA.witnessIds?.[0] ?? '', claimId: pair.claimA.id, summary: pair.claimA.text },
            { witnessId: pair.claimB.witnessIds?.[0] ?? '', claimId: pair.claimB.id, summary: pair.claimB.text },
          ],
          resolution: 'unresolved',
        };
        store.putDivergence(divergence);
        divergences.push(divergence);

        transcript.push({
          type: 'adjudication',
          claimId: pair.claimA.id,
          text: `factual_conflict unresolved: 两条 contested (${confrontation.ok ? confrontation.value.reason ?? '' : confrontation.error.message})`,
          at: now(),
        });
      } else {
        // Qualified: both get qualifier, both surviving
        const qualifier = confrontation.value.qualifier ?? '经对质后加限定';
        store.putClaim({
          ...pair.claimA,
          qualifiers: [...(pair.claimA.qualifiers ?? []), qualifier],
        });
        store.putClaim({
          ...pair.claimB,
          qualifiers: [...(pair.claimB.qualifiers ?? []), qualifier],
        });
        const divId = newId();
        const divergence: Divergence = {
          id: divId,
          subjectId,
          courtSessionId: sessionId,
          topic: relation.topic ?? pair.claimA.text.slice(0, 50),
          type: 'factual',
          positions: [
            { witnessId: pair.claimA.witnessIds?.[0] ?? '', claimId: pair.claimA.id, summary: pair.claimA.text },
            { witnessId: pair.claimB.witnessIds?.[0] ?? '', claimId: pair.claimB.id, summary: pair.claimB.text },
          ],
          resolution: 'qualified',
        };
        store.putDivergence(divergence);
        divergences.push(divergence);

        transcript.push({
          type: 'adjudication',
          claimId: pair.claimA.id,
          text: `factual_conflict qualified: 限定="${qualifier}" (${confrontation.value.reason ?? ''})`,
          at: now(),
        });
      }
    }
    // unrelated: ignored
  }

  /* ---------------------- 4. Conviction -------------------------------- */
  const allClaims = store.listClaimsBySubject(subjectId)
    .filter((c) => c.courtSessionId === sessionId);
  const allEpisodes = store.listEpisodesBySubject(subjectId);

  for (const claim of allClaims) {
    if (claim.status === 'retired') continue; // already merged

    const claimEpisodes = allEpisodes.filter(
      (ep) => claim.episodeIds?.includes(ep.id),
    );

    const conviction = computeConviction({
      witnessCount: claim.witnessIds?.length ?? 1,
      hasEpisode: claimEpisodes.length > 0,
      allEpisodesElicited:
        claimEpisodes.length > 0 && claimEpisodes.every((ep) => ep.elicited),
      wasPaired: pairedClaimIds.has(claim.id),
      isContested: claim.status === 'contested',
    });

    store.putClaim({ ...claim, conviction });

    transcript.push({
      type: 'adjudication',
      claimId: claim.id,
      witnessId: claim.witnessIds?.[0],
      text: `裁定 status=${claim.status} 置信=${conviction.toFixed(2)}` +
        (claim.qualifiers?.length ? ` 限定=${claim.qualifiers.join(';')}` : ''),
      at: now(),
    });
  }

  /* ----------------------------- Report -------------------------------- */
  const finalClaims = store.listClaimsBySubject(subjectId)
    .filter((c) => c.courtSessionId === sessionId);

  const surviving = finalClaims.filter(
    (c) => c.status === 'surviving' && (c.qualifiers?.length ?? 0) === 0,
  ).length;
  const qualified = finalClaims.filter(
    (c) => c.status === 'surviving' && (c.qualifiers?.length ?? 0) > 0,
  ).length;
  const contested = finalClaims.filter((c) => c.status === 'contested').length;
  const retired = finalClaims.filter((c) => c.status === 'retired').length;
  const withEvidence = finalClaims.filter((c) => c.evidence.length > 0).length;
  const claimsWithEpisode = finalClaims.filter(
    (c) => c.episodeIds && c.episodeIds.length > 0,
  ).length;
  const factualConflicts = divergences.filter((d) => d.type === 'factual').length;

  const report: CourtReport = {
    totalClaims: surviving + qualified + contested + retired,
    surviving,
    qualified,
    contested,
    retired,
    challengeCount: transcript.filter((e) => e.type === 'challenge').length,
    evidenceCoverage: finalClaims.length === 0 ? 1 : round2(withEvidence / finalClaims.length),
    divergences: divergences.length,
    factualConflicts,
    episodeCount: filedEpisodes.length,
    claimsWithEpisode,
  };

  const session: CourtSession = {
    id: sessionId,
    subjectId,
    startedAt,
    finishedAt: now(),
    transcript,
    report,
  };
  store.putCourtSession(session);
  store.events.emit('court.finished', session);

  return session;
}
