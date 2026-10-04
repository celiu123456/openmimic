import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CONVICTION_DECAY_PER_CHALLENGE,
  CONVICTION_QUALIFY,
  CONVICTION_SURVIVE,
  CONVICTION_UNCHALLENGED_CAP,
  type Claim,
  type ClaimStatus,
  type CourtEvent,
  type CourtReport,
  type CourtSession,
  type Testimony,
  type Witness,
} from '@openmimic/shared';
import type { Store } from '@openmimic/kernel';
import { KeywordConflictFinder, type ConflictFinder, type ConflictMaterial } from './conflict';
import type { LLMClient, LLMCompletionRequest } from './llm';

/* ------------------------------------------------------------------ */
/* LLM response contracts                                              */
/* ------------------------------------------------------------------ */

const CandidateClaimSchema = z.object({
  text: z.string().min(1),
  evidenceTestimonyIds: z.array(z.string()).default([]),
});
const CandidateListSchema = z.array(CandidateClaimSchema);

const VerdictSchema = z.object({
  verdict: z.enum(['survive', 'qualify', 'reject']),
  qualifier: z.string().min(1).optional(),
  reason: z.string().optional(),
});
export type CourtVerdict = z.infer<typeof VerdictSchema>;

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

const FILING_SYSTEM = [
  '你是人格法庭的立案书记员。输入是几位证人关于同一个人的证言。',
  '你的任务:把证言中的可对质论断抽成候选论断。',
  '只输出 JSON 数组,不要输出任何解释或 markdown 代码块。',
  '数组元素形如 {"text":"论断原文","evidenceTestimonyIds":["证言id"]}。',
  '每个论断必须至少引用一条证言 id,且只能引用输入中出现的 id。',
  '如果这段话里没有可对质的论断,输出 []。',
].join('\n');

const CHALLENGE_SYSTEM = [
  '你是人格法庭的质询智能体,专攻证言之间的矛盾。',
  '输入是一条候选论断,以及其他证人证言中与之冲突的原文材料。',
  '请裁定这条论断在质询后应当:',
  '- survive:冲突不成立,论断原样存活;',
  '- qualify:论断只在限定条件下成立,给出 qualifier;',
  '- reject:断定与证据矛盾,论断不成立。',
  '只输出 JSON 对象,不要输出任何解释或 markdown 代码块,形如:',
  '{"verdict":"survive"|"qualify"|"reject","qualifier":"限定条件(可选)","reason":"裁定理由"}',
].join('\n');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Attempt<T> = { ok: true; value: T } | { ok: false; error: Error };

function toError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught));
}

/**
 * Ask the LLM and parse its reply, retrying on any failure (network error or
 * unparseable JSON). Returns a result object so the caller can decide what a
 * failure means — the pipeline never fabricates content on a failed call.
 */
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

/**
 * Each cross-examination round survived beyond the first shaves a little
 * conviction. W1 runs a single round per claim, so the decay is dormant here
 * and becomes active once W2 allows re-challenging.
 */
function applyChallengeDecay(base: number, survivedRounds: number): number {
  return base - CONVICTION_DECAY_PER_CHALLENGE * Math.max(0, survivedRounds - 1);
}

/** Render one witness's testimonies for the filing prompt. */
function buildFilingUser(witness: Witness, testimonies: readonly Testimony[]): string {
  const lines: string[] = [
    `证人 id: ${witness.id}`,
    `与当事人的关系: ${witness.relation}`,
  ];
  if (witness.stance) lines.push(`立场: ${witness.stance}`);
  lines.push('证言:');
  for (const testimony of testimonies) {
    lines.push(`- 证言 id: ${testimony.id}`);
    testimony.answers.forEach((answer, index) => {
      lines.push(`  [${index + 1}] (qid=${answer.qid}) ${answer.behindText}`);
    });
    if (testimony.freeText) lines.push(`  自由陈述: ${testimony.freeText}`);
  }
  return lines.join('\n');
}

function buildChallengeUser(
  claimText: string,
  conflicts: readonly ConflictMaterial[],
): string {
  const lines: string[] = [`候选论断: ${claimText}`, '冲突材料:'];
  for (const conflict of conflicts) {
    lines.push(
      `- 证人 ${conflict.witnessId}(证言 ${conflict.testimonyId},共同关键词: ${conflict.matchedKeywords.join(', ')}): ${conflict.snippet}`,
    );
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

export interface RunCourtOptions {
  /** Defaults to {@link KeywordConflictFinder} (W1 placeholder). */
  conflictFinder?: ConflictFinder;
  /** Id factory, injectable for deterministic tests. */
  newId?: () => string;
  /** Clock, injectable for deterministic tests. */
  now?: () => string;
  /** Filing attempts per witness before skipping them (default 2 = initial + 1 retry). */
  filingAttempts?: number;
}

interface InternalCandidate {
  id: string;
  text: string;
  witnessId: string;
  evidenceTestimonyIds: string[];
}

/**
 * Run the W1 adversarial pipeline for one witness:
 *
 * 1. **Filing** — each witness's testimony is handed to the LLM, which
 *    proposes candidate claims anchored to testimony ids.
 * 2. **Cross-examination** — each candidate is matched against *other*
 *    witnesses' testimony; a conflict triggers one LLM judgment.
 * 3. **Adjudication** — verdicts become claims (with qualifiers and a
 *    conviction score), the transcript is recorded, a report is produced and
 *    `court.finished` is emitted.
 */
export async function runCourt(
  subjectId: string,
  store: Store,
  llm: LLMClient,
  options: RunCourtOptions = {},
): Promise<CourtSession> {
  const conflictFinder = options.conflictFinder ?? new KeywordConflictFinder();
  const newId = options.newId ?? (() => randomUUID());
  const now = options.now ?? (() => new Date().toISOString());

  const sessionId = newId();
  const startedAt = now();
  const transcript: CourtEvent[] = [];

  // Persist the session up-front so the transcript is durable from the start.
  store.putCourtSession({
    id: sessionId,
    subjectId,
    startedAt,
    transcript,
  });

  const witnesses = store.listWitnessesBySubject(subjectId);
  const allTestimonies = store.listBySubject(subjectId);

  /* ---------------------------- 1. Filing --------------------------- */
  const candidates: InternalCandidate[] = [];
  for (const witness of witnesses) {
    const testimonies = allTestimonies.filter((t) => t.witnessId === witness.id);
    if (testimonies.length === 0) continue;
    const ownTestimonyIds = testimonies.map((t) => t.id);

    const filing = await attemptJson(
      llm,
      { system: FILING_SYSTEM, user: buildFilingUser(witness, testimonies) },
      (text) => CandidateListSchema.parse(extractJson(text)),
      options.filingAttempts ?? 2,
    );

    if (!filing.ok) {
      transcript.push({
        type: 'claim_proposed',
        witnessId: witness.id,
        text: `立案失败,该证人(关系:${witness.relation})的证言本轮不产生论断:${filing.error.message}`,
        at: now(),
      });
      continue;
    }

    for (const proposed of filing.value) {
      const cited = proposed.evidenceTestimonyIds.filter((id) => ownTestimonyIds.includes(id));
      // A claim extracted from this witness may only cite this witness's words.
      // Fall back to all of their testimony if the model cited nothing usable.
      const evidence = cited.length > 0 ? cited : ownTestimonyIds;
      const candidate: InternalCandidate = {
        id: newId(),
        text: proposed.text,
        witnessId: witness.id,
        evidenceTestimonyIds: evidence,
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

  /* ----------------------- 2. Cross-examination --------------------- */
  const verdicts = new Map<string, CourtVerdict>();
  const challenged = new Set<string>();

  for (const candidate of candidates) {
    const conflicts = conflictFinder.findConflicts(candidate, allTestimonies);
    if (conflicts.length === 0) {
      verdicts.set(candidate.id, { verdict: 'survive', reason: 'no conflicting material found' });
      transcript.push({
        type: 'defense',
        claimId: candidate.id,
        witnessId: candidate.witnessId,
        text: '未找到冲突材料,论断未经对质直接存活(置信上限 0.6)',
        at: now(),
      });
      continue;
    }

    challenged.add(candidate.id);
    const conflictingWitnesses = [...new Set(conflicts.map((c) => c.witnessId))];
    const keywords = [...new Set(conflicts.flatMap((c) => c.matchedKeywords))].sort();
    transcript.push({
      type: 'challenge',
      claimId: candidate.id,
      witnessId: conflictingWitnesses[0],
      text: `质询来自证人 ${conflictingWitnesses.join(', ')},冲突关键词: ${keywords.join(', ')}`,
      at: now(),
    });

    const judgment = await attemptJson(
      llm,
      {
        system: CHALLENGE_SYSTEM,
        user: buildChallengeUser(candidate.text, conflicts),
      },
      (text) => VerdictSchema.parse(extractJson(text)),
      1,
    );

    if (!judgment.ok) {
      verdicts.set(candidate.id, {
        verdict: 'reject',
        reason: `质询判定失败,按未通过处理:${judgment.error.message}`,
      });
      continue;
    }

    verdicts.set(candidate.id, judgment.value);
    transcript.push({
      type: 'defense',
      claimId: candidate.id,
      witnessId: candidate.witnessId,
      text: judgment.value.reason ?? `裁定:${judgment.value.verdict}`,
      at: now(),
    });
  }

  /* ------------------------- 3. Adjudication ------------------------ */
  const claims: Claim[] = [];

  for (const candidate of candidates) {
    const verdict = verdicts.get(candidate.id) ?? { verdict: 'reject' as const };
    const wasChallenged = challenged.has(candidate.id);

    let status: ClaimStatus;
    let conviction: number;
    let qualifiers: string[] | undefined;

    if (verdict.verdict === 'survive') {
      status = 'surviving';
      conviction = wasChallenged
        ? applyChallengeDecay(CONVICTION_SURVIVE, 1)
        : CONVICTION_UNCHALLENGED_CAP;
    } else if (verdict.verdict === 'qualify') {
      status = 'surviving';
      conviction = applyChallengeDecay(CONVICTION_QUALIFY, 1);
      qualifiers = [verdict.qualifier ?? '经质询后仅在限定条件下成立'];
    } else {
      status = 'retired';
      conviction = 0;
    }

    const claim: Claim = {
      id: candidate.id,
      subjectId,
      text: candidate.text,
      conviction: round2(clamp01(conviction)),
      evidence: candidate.evidenceTestimonyIds,
      ...(qualifiers ? { qualifiers } : {}),
      status,
      courtSessionId: sessionId,
    };
    store.putClaim(claim);
    claims.push(claim);

    transcript.push({
      type: 'adjudication',
      claimId: candidate.id,
      witnessId: candidate.witnessId,
      text:
        `裁定=${verdict.verdict} 置信=${claim.conviction.toFixed(2)}` +
        (qualifiers ? ` 限定=${qualifiers.join(';')}` : '') +
        (verdict.reason ? ` 理由=${verdict.reason}` : ''),
      at: now(),
    });
  }

  /* ---------------------------- Report ------------------------------ */
  const surviving = claims.filter(
    (claim) => claim.status === 'surviving' && (claim.qualifiers?.length ?? 0) === 0,
  ).length;
  const qualified = claims.filter(
    (claim) => claim.status === 'surviving' && (claim.qualifiers?.length ?? 0) > 0,
  ).length;
  const rejected = claims.filter((claim) => claim.status === 'retired').length;
  const withEvidence = claims.filter((claim) => claim.evidence.length > 0).length;

  const report: CourtReport = {
    totalClaims: claims.length,
    surviving,
    qualified,
    rejected,
    challengeCount: transcript.filter((event) => event.type === 'challenge').length,
    evidenceCoverage: claims.length === 0 ? 1 : round2(withEvidence / claims.length),
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
