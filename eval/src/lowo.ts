/**
 * Leave-One-Witness-Out (LOWO) evaluation.
 *
 * For a subject with N >= 3 witnesses, leave out each witness w in turn:
 * 1. Build a temporary store with only the other N-1 witnesses' testimonies
 * 2. Run the court -> assemble persona context P
 * 3. For each question w answered, generate two predictions:
 *    - "with persona": given P + w's relation + the question
 *    - "without persona" (baseline): only w's relation + the question
 * 4. Judge which prediction is closer to w's actual answer
 * 5. Optional mismatch control: use a different subject's persona
 *
 * Supports incremental checkpointing: each completed question is saved
 * to a progress file so a crash/timeout does not lose partial results.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { LLMClient, LLMCompletionRequest } from '@openmimic/engine-court';
import type { Store } from '@openmimic/kernel';
import { adapterRunCourt, adapterAssemblePersona } from './engine-adapter';
import { judgePair, getJudgePromptSha, verifyJudgePromptSha, type PairResult } from './judge';
import { wilsonInterval } from './wilson';
import { requireCalibration, writeRun, type RunRecord } from './ledger';

/* ------------------------------------------------------------------ */
/* Prediction generation                                               */
/* ------------------------------------------------------------------ */

const PREDICT_WITH_PERSONA_SYSTEM = [
  '你正在模拟一位证人对一个人的看法。',
  '下面给出了关于这个人的人格描述(由其他证人的证言构建),以及你要扮演的证人与这个人的关系。',
  '请根据人格描述和关系,预测这位证人被问到以下问题时会怎么回答。',
  '用口语化的中文回答,像真人说话一样,不超过200字。',
].join('\n');

const PREDICT_BASELINE_SYSTEM = [
  '你正在猜测一位与某人有特定关系的人,在被问到某个问题时会怎么说。',
  '你没有关于这个人的任何信息,只知道回答者与这个人的关系。',
  '请用口语化的中文给出一个合理的猜测,不超过200字。',
].join('\n');

async function generatePrediction(
  llm: LLMClient,
  system: string,
  user: string,
): Promise<string> {
  const request: LLMCompletionRequest = { system, user };
  return await llm.complete(request);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getCommitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/* ------------------------------------------------------------------ */
/* LOWO types                                                          */
/* ------------------------------------------------------------------ */

export interface LowoQuestionResult {
  qid: string;
  witnessId: string;
  relation: string;
  realAnswer: string;
  withPersonaPrediction: string;
  baselinePrediction: string;
  judgeResult: PairResult;
}

export interface LowoWitnessResult {
  witnessId: string;
  relation: string;
  questions: LowoQuestionResult[];
  personaWins: number;
  baselineWins: number;
  discarded: number;
  courtStats: {
    claimCount: number;
    durationMs: number;
  };
}

export interface LowoResult {
  subjectId: string;
  modelName: string;
  promptSha: string;
  witnessResults: LowoWitnessResult[];
  totalValidPairs: number;
  totalDiscardedPairs: number;
  personaWinRate: number;
  wilson95: { lower: number; center: number; upper: number };
  /** By relation breakdown */
  byRelation: Record<string, { wins: number; total: number; rate: number }>;
}

export interface LowoOptions {
  /** Model name for calibration check */
  modelName: string;
  /** Skip calibration check (for testing only) */
  skipCalibrationCheck?: boolean;
  /** Alternative subject's persona for mismatch control (optional) */
  mismatchSubjectId?: string;
  /** Max questions per held-out witness (default: all) — controls call volume. */
  maxQuestionsPerWitness?: number;
  /** Path to checkpoint file for incremental save/resume */
  progressFile?: string;
  /** Ablation mode: strip claims from persona, keep only episodes */
  ablationEpisodesOnly?: boolean;
}

/* ------------------------------------------------------------------ */
/* Checkpoint: incremental save/resume                                 */
/* ------------------------------------------------------------------ */

interface LowoCheckpoint {
  completedWitnesses: LowoWitnessResult[];
  /** witnessId of in-progress witness, if any */
  currentWitnessId?: string;
  currentWitnessQuestions?: LowoQuestionResult[];
}

function loadCheckpoint(file: string): LowoCheckpoint | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCheckpoint(file: string, cp: LowoCheckpoint): void {
  writeFileSync(file, JSON.stringify(cp, null, 2), 'utf-8');
}

/* ------------------------------------------------------------------ */
/* Helper: build temporary store with one witness held out             */
/* ------------------------------------------------------------------ */

function buildHeldOutStore(
  StoreClass: new () => Store,
  originalStore: Store,
  subjectId: string,
  heldOutWitnessId: string,
): Store {
  const tempStore = new StoreClass();

  // Copy subject
  const subject = originalStore.getSubject(subjectId);
  if (subject) tempStore.putSubject(subject);

  // Copy all witnesses except the held-out one
  const witnesses = originalStore.listWitnessesBySubject(subjectId);
  for (const w of witnesses) {
    if (w.id !== heldOutWitnessId) tempStore.putWitness(w);
  }

  // Copy all testimonies except those by the held-out witness
  const testimonies = originalStore.listBySubject(subjectId);
  for (const t of testimonies) {
    if (t.witnessId !== heldOutWitnessId) tempStore.addTestimony(t);
  }

  return tempStore;
}

/* ------------------------------------------------------------------ */
/* Main LOWO runner                                                    */
/* ------------------------------------------------------------------ */

/**
 * Run Leave-One-Witness-Out evaluation.
 *
 * @param subjectId - the subject to evaluate
 * @param store - store containing the full data
 * @param courtLlm - LLM client for court calls (must support thinking disabled for DeepSeek)
 * @param evalLlm - LLM client for prediction and judging
 * @param StoreClass - Store constructor (for creating temporary stores)
 * @param options - configuration
 */
export async function runLowo(
  subjectId: string,
  store: Store,
  courtLlm: LLMClient,
  evalLlm: LLMClient,
  StoreClass: new () => Store,
  options: LowoOptions,
): Promise<LowoResult> {
  const promptSha = getJudgePromptSha();

  // Calibration gate
  if (!options.skipCalibrationCheck) {
    requireCalibration(options.modelName, promptSha);
    verifyJudgePromptSha(promptSha);
  }

  const witnesses = store.listWitnessesBySubject(subjectId);
  if (witnesses.length < 3) {
    throw new Error(`LOWO requires >= 3 witnesses; subject "${subjectId}" has ${witnesses.length}`);
  }

  const allTestimonies = store.listBySubject(subjectId);

  // Load checkpoint if available
  const checkpoint = options.progressFile ? loadCheckpoint(options.progressFile) : null;
  const witnessResults: LowoWitnessResult[] = checkpoint?.completedWitnesses ?? [];
  const completedWitnessIds = new Set(witnessResults.map((wr) => wr.witnessId));

  for (let wi = 0; wi < witnesses.length; wi++) {
    const heldOut = witnesses[wi];

    // Skip already-completed witnesses
    if (completedWitnessIds.has(heldOut.id)) {
      console.error(`[LOWO] Witness ${wi + 1}/${witnesses.length}: ${heldOut.id} (${heldOut.relation}) — resuming, already done`);
      continue;
    }

    console.error(`[LOWO] Witness ${wi + 1}/${witnesses.length}: holding out ${heldOut.id} (${heldOut.relation})`);
    // 1. Build temporary store without this witness
    const tempStore = buildHeldOutStore(StoreClass, store, subjectId, heldOut.id);

    try {
      // 2. Run court on reduced data — uses courtLlm, NOT evalLlm
      console.error(`[LOWO]   Running court...`);
      const courtStart = Date.now();
      await adapterRunCourt(subjectId, tempStore, courtLlm);
      const courtDurationMs = Date.now() - courtStart;

      // Hard gate: court must produce surviving claims
      const claims = tempStore.listClaimsBySubject(subjectId);
      const survivingCount = claims.filter((c) => c.status === 'surviving').length;
      console.error(`[LOWO]   Court produced ${survivingCount} surviving claims in ${(courtDurationMs / 1000).toFixed(1)}s`);

      if (survivingCount === 0) {
        throw new Error(
          `Court produced 0 surviving claims for witness holdout ${heldOut.id} (${heldOut.relation}). ` +
          `This makes LOWO results degenerate. Aborting. ` +
          `Check that the court LLM client correctly disables thinking for DeepSeek models.`,
        );
      }

      // 3. Assemble persona from the reduced court results
      const persona = await adapterAssemblePersona(subjectId, tempStore);
      console.error(`[LOWO]   Persona assembled (${persona.meta.charCount} chars, ${persona.meta.includedClaimIds.length} claims)`);

      // Ablation: strip claims, keep only episodes
      let personaPrompt = persona.systemPrompt;
      if (options.ablationEpisodesOnly) {
        const episodes = tempStore.listEpisodesBySubject(subjectId);
        const episodeTexts = episodes.map((e) => e.text).join('\n');
        personaPrompt = episodeTexts || '(无事例)';
        console.error(`[LOWO]   Ablation: episodes only (${episodes.length} episodes, ${personaPrompt.length} chars)`);
      }

      // 4. Get held-out witness's testimonies
      const heldOutTestimonies = allTestimonies.filter((t) => t.witnessId === heldOut.id);

      // Resume in-progress questions for this witness
      const questions: LowoQuestionResult[] =
        (checkpoint?.currentWitnessId === heldOut.id ? checkpoint.currentWitnessQuestions : undefined) ?? [];
      const completedQids = new Set(questions.map((q) => q.qid));

      const maxQ = options.maxQuestionsPerWitness ?? Infinity;

      for (const testimony of heldOutTestimonies) {
        for (const answer of testimony.answers) {
          if (questions.length >= maxQ) break;
          if (!answer.behindText || answer.behindText.trim().length === 0) continue;
          if (completedQids.has(answer.qid)) continue;

          console.error(`[LOWO]   Q${questions.length + 1} (${answer.qid})...`);

          // Generate "with persona" prediction — uses evalLlm
          const withPersonaUser = [
            `## 人格描述`,
            personaPrompt,
            '',
            `## 证人与当事人的关系`,
            heldOut.relation,
            '',
            `## 问题 (qid: ${answer.qid})`,
            `请以这位证人(${heldOut.relation})的口吻,预测他/她会怎么回答关于当事人的这个方面。`,
          ].join('\n');

          const withPersonaPrediction = await generatePrediction(
            evalLlm,
            PREDICT_WITH_PERSONA_SYSTEM,
            withPersonaUser,
          );

          // Generate baseline prediction (no persona) — uses evalLlm
          const baselineUser = [
            `## 证人与当事人的关系`,
            heldOut.relation,
            '',
            `## 问题 (qid: ${answer.qid})`,
            `请以这位证人(${heldOut.relation})的口吻,猜测他/她会怎么描述当事人。`,
          ].join('\n');

          const baselinePrediction = await generatePrediction(
            evalLlm,
            PREDICT_BASELINE_SYSTEM,
            baselineUser,
          );

          // 5. Judge: which prediction is closer to real answer? — uses evalLlm
          // first = withPersona, second = baseline
          const judgeResult = await judgePair(
            evalLlm,
            answer.behindText,
            withPersonaPrediction,
            baselinePrediction,
          );

          questions.push({
            qid: answer.qid,
            witnessId: heldOut.id,
            relation: heldOut.relation,
            realAnswer: answer.behindText,
            withPersonaPrediction,
            baselinePrediction,
            judgeResult,
          });

          // Checkpoint after each question
          if (options.progressFile) {
            saveCheckpoint(options.progressFile, {
              completedWitnesses: witnessResults,
              currentWitnessId: heldOut.id,
              currentWitnessQuestions: questions,
            });
          }
        }
      }

      const personaWins = questions.filter(
        (q) => q.judgeResult.status === 'valid' && q.judgeResult.winner === 'first',
      ).length;
      const baselineWins = questions.filter(
        (q) => q.judgeResult.status === 'valid' && q.judgeResult.winner === 'second',
      ).length;
      const discarded = questions.filter((q) => q.judgeResult.status === 'discarded').length;

      const wr: LowoWitnessResult = {
        witnessId: heldOut.id,
        relation: heldOut.relation,
        questions,
        personaWins,
        baselineWins,
        discarded,
        courtStats: {
          claimCount: survivingCount,
          durationMs: courtDurationMs,
        },
      };
      witnessResults.push(wr);

      // Checkpoint after each witness
      if (options.progressFile) {
        saveCheckpoint(options.progressFile, {
          completedWitnesses: witnessResults,
        });
      }
    } finally {
      tempStore.close();
    }
  }

  // Aggregate
  const totalPersonaWins = witnessResults.reduce((s, w) => s + w.personaWins, 0);
  const totalBaselineWins = witnessResults.reduce((s, w) => s + w.baselineWins, 0);
  const totalDiscarded = witnessResults.reduce((s, w) => s + w.discarded, 0);
  const totalValid = totalPersonaWins + totalBaselineWins;

  const personaWinRate = totalValid > 0 ? totalPersonaWins / totalValid : 0;
  const wilson95 = wilsonInterval(totalPersonaWins, totalValid);

  // By-relation breakdown
  const byRelation: Record<string, { wins: number; total: number; rate: number }> = {};
  for (const wr of witnessResults) {
    const valid = wr.personaWins + wr.baselineWins;
    byRelation[wr.relation] = {
      wins: wr.personaWins,
      total: valid,
      rate: valid > 0 ? wr.personaWins / valid : 0,
    };
  }

  const result: LowoResult = {
    subjectId,
    modelName: options.modelName,
    promptSha,
    witnessResults,
    totalValidPairs: totalValid,
    totalDiscardedPairs: totalDiscarded,
    personaWinRate,
    wilson95,
    byRelation,
  };

  // Write run log
  const run: RunRecord = {
    kind: options.ablationEpisodesOnly ? 'lowo-ablation-episodes-only' : 'lowo',
    modelName: options.modelName,
    promptSha,
    commitSha: getCommitSha(),
    params: {
      subjectId,
      witnessCount: witnesses.length,
      maxQuestionsPerWitness: options.maxQuestionsPerWitness ?? 'all',
      mismatchSubjectId: options.mismatchSubjectId ?? null,
      ablationEpisodesOnly: options.ablationEpisodesOnly ?? false,
    },
    results: {
      totalValidPairs: totalValid,
      totalDiscardedPairs: totalDiscarded,
      personaWinRate,
      wilson95,
      byRelation,
    },
    details: witnessResults.map((wr) => ({
      witnessId: wr.witnessId,
      relation: wr.relation,
      personaWins: wr.personaWins,
      baselineWins: wr.baselineWins,
      discarded: wr.discarded,
      courtStats: wr.courtStats,
      questions: wr.questions.map((q) => ({
        qid: q.qid,
        status: q.judgeResult.status,
        winner: q.judgeResult.status === 'valid' ? q.judgeResult.winner : null,
      })),
    })),
  };
  writeRun(run);

  return result;
}
