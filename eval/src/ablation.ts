/**
 * Ablation arm: three paired comparisons sharing the same court & persona.
 *
 * For each held-out witness:
 *   1. Run court once (shared across arms)
 *   2. Assemble full persona (shared)
 *   3. Generate "with persona" prediction (shared)
 *   4. Generate three comparison arms:
 *      (a) no-persona baseline
 *      (b) claims-stripped persona (episodes only)
 *      (c) episodes-stripped persona (claims only)
 *   5. Judge each arm against the shared "with persona" prediction
 *
 * This saves LLM calls: court runs once, with-persona prediction once,
 * and only the comparison candidates and judge calls differ per arm.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { LLMClient, LLMCompletionRequest } from '@openmimic/engine-court';
import type { Store } from '@openmimic/kernel';
import { adapterRunCourt, adapterAssemblePersona } from './engine-adapter';
import { judgePair, getJudgePromptSha, verifyJudgePromptSha, type PairResult } from './judge';
import { wilsonInterval } from './wilson';
import { requireCalibration, writeRun, type RunRecord } from './ledger';
import { stripClaimsSection, stripEpisodesSection, type PersonaComposition } from './lowo';

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
  const request: LLMCompletionRequest = { system, user, purpose: 'eval-predict' };
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
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface AblationQuestionResult {
  qid: string;
  witnessId: string;
  relation: string;
  realAnswer: string;
  withPersonaPrediction: string;
  baselinePrediction: string;
  claimsStrippedPrediction: string;
  episodesStrippedPrediction: string;
  /** full persona vs no-persona baseline */
  judgeVsBaseline: PairResult;
  /** full persona vs claims-stripped (episodes only) */
  judgeVsClaimsStripped: PairResult;
  /** full persona vs episodes-stripped (claims only) */
  judgeVsEpisodesStripped: PairResult;
}

export interface AblationArmStats {
  validPairs: number;
  discardedPairs: number;
  personaWins: number;
  comparisonWins: number;
  personaWinRate: number;
  wilson95: { lower: number; center: number; upper: number };
}

export interface AblationWitnessResult {
  witnessId: string;
  relation: string;
  questions: AblationQuestionResult[];
  courtStats: { claimCount: number; durationMs: number };
  personaComposition: PersonaComposition;
  vsBaseline: AblationArmStats;
  vsClaimsStripped: AblationArmStats;
  vsEpisodesStripped: AblationArmStats;
}

export interface AblationResult {
  subjectId: string;
  modelName: string;
  promptSha: string;
  witnessResults: AblationWitnessResult[];
  overall: {
    vsBaseline: AblationArmStats;
    vsClaimsStripped: AblationArmStats;
    vsEpisodesStripped: AblationArmStats;
  };
}

export interface AblationOptions {
  modelName: string;
  skipCalibrationCheck?: boolean;
  maxQuestionsPerWitness?: number;
  progressFile?: string;
}

/* ------------------------------------------------------------------ */
/* Checkpoint                                                          */
/* ------------------------------------------------------------------ */

interface AblationCheckpoint {
  completedWitnesses: AblationWitnessResult[];
  currentWitnessId?: string;
  currentWitnessQuestions?: AblationQuestionResult[];
}

function loadCheckpoint(file: string): AblationCheckpoint | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCheckpoint(file: string, cp: AblationCheckpoint): void {
  writeFileSync(file, JSON.stringify(cp, null, 2), 'utf-8');
}

/* ------------------------------------------------------------------ */
/* Stats computation                                                   */
/* ------------------------------------------------------------------ */

function computeArmStats(
  questions: AblationQuestionResult[],
  getResult: (q: AblationQuestionResult) => PairResult,
): AblationArmStats {
  let personaWins = 0;
  let comparisonWins = 0;
  let discarded = 0;

  for (const q of questions) {
    const r = getResult(q);
    if (r.status === 'valid') {
      if (r.winner === 'first') personaWins++;
      else comparisonWins++;
    } else {
      discarded++;
    }
  }

  const validPairs = personaWins + comparisonWins;
  const personaWinRate = validPairs > 0 ? personaWins / validPairs : 0;
  const wilson95 = wilsonInterval(personaWins, validPairs);

  return { validPairs, discardedPairs: discarded, personaWins, comparisonWins, personaWinRate, wilson95 };
}

/* ------------------------------------------------------------------ */
/* Held-out store builder                                              */
/* ------------------------------------------------------------------ */

function buildHeldOutStore(
  StoreClass: new () => Store,
  originalStore: Store,
  subjectId: string,
  heldOutWitnessId: string,
): Store {
  const tempStore = new StoreClass();
  const subject = originalStore.getSubject(subjectId);
  if (subject) tempStore.putSubject(subject);
  const witnesses = originalStore.listWitnessesBySubject(subjectId);
  for (const w of witnesses) {
    if (w.id !== heldOutWitnessId) tempStore.putWitness(w);
  }
  const testimonies = originalStore.listBySubject(subjectId);
  for (const t of testimonies) {
    if (t.witnessId !== heldOutWitnessId) tempStore.addTestimony(t);
  }
  return tempStore;
}

/* ------------------------------------------------------------------ */
/* Main runner                                                         */
/* ------------------------------------------------------------------ */

export async function runAblation(
  subjectId: string,
  store: Store,
  courtLlm: LLMClient,
  evalLlm: LLMClient,
  StoreClass: new () => Store,
  options: AblationOptions,
): Promise<AblationResult> {
  const promptSha = getJudgePromptSha();

  if (!options.skipCalibrationCheck) {
    requireCalibration(options.modelName, promptSha);
    verifyJudgePromptSha(promptSha);
  }

  const witnesses = store.listWitnessesBySubject(subjectId);
  if (witnesses.length < 3) {
    throw new Error(`Ablation requires >= 3 witnesses; subject "${subjectId}" has ${witnesses.length}`);
  }

  const allTestimonies = store.listBySubject(subjectId);

  // Load checkpoint
  const checkpoint = options.progressFile ? loadCheckpoint(options.progressFile) : null;
  const witnessResults: AblationWitnessResult[] = checkpoint?.completedWitnesses ?? [];
  const completedWitnessIds = new Set(witnessResults.map((wr) => wr.witnessId));

  for (let wi = 0; wi < witnesses.length; wi++) {
    const heldOut = witnesses[wi];
    if (completedWitnessIds.has(heldOut.id)) {
      console.error(`[Ablation] Witness ${wi + 1}/${witnesses.length}: ${heldOut.id} (${heldOut.relation}) — already done`);
      continue;
    }

    console.error(`[Ablation] Witness ${wi + 1}/${witnesses.length}: holding out ${heldOut.id} (${heldOut.relation})`);
    const tempStore = buildHeldOutStore(StoreClass, store, subjectId, heldOut.id);

    try {
      // 1. Run court once (shared)
      console.error(`[Ablation]   Running court...`);
      const courtStart = Date.now();
      await adapterRunCourt(subjectId, tempStore, courtLlm);
      const courtDurationMs = Date.now() - courtStart;

      const claims = tempStore.listClaimsBySubject(subjectId);
      const survivingCount = claims.filter((c) => c.status === 'surviving').length;
      console.error(`[Ablation]   Court produced ${survivingCount} surviving claims in ${(courtDurationMs / 1000).toFixed(1)}s`);

      if (survivingCount === 0) {
        throw new Error(
          `Court produced 0 surviving claims for witness holdout ${heldOut.id}. Aborting.`,
        );
      }

      // 2. Assemble full persona (shared)
      const persona = await adapterAssemblePersona(subjectId, tempStore);
      console.error(`[Ablation]   Persona: ${persona.meta.charCount} chars, ${persona.meta.includedClaimIds.length} claims, ${persona.meta.episodeCount} episodes`);

      // 3. Build comparison prompts
      let claimsStrippedPrompt: string | null = null;
      let episodesStrippedPrompt: string | null = null;

      const hasClaimsSection = persona.systemPrompt.includes('## 他在不同人面前');
      const hasEpisodesSection = persona.systemPrompt.includes('## 别人讲过的事');

      if (hasClaimsSection) {
        claimsStrippedPrompt = stripClaimsSection(persona.systemPrompt);
        console.error(`[Ablation]   Claims-stripped: ${claimsStrippedPrompt.length} chars`);
      } else {
        console.error(`[Ablation]   No claims section — claims-stripped arm will use full persona (no-op)`);
        claimsStrippedPrompt = persona.systemPrompt;
      }

      if (hasEpisodesSection) {
        episodesStrippedPrompt = stripEpisodesSection(persona.systemPrompt);
        console.error(`[Ablation]   Episodes-stripped: ${episodesStrippedPrompt.length} chars`);
      } else {
        console.error(`[Ablation]   No episodes section — episodes-stripped arm will use full persona (no-op)`);
        episodesStrippedPrompt = persona.systemPrompt;
      }

      // 4. Process each held-out question
      const heldOutTestimonies = allTestimonies.filter((t) => t.witnessId === heldOut.id);
      const questions: AblationQuestionResult[] =
        (checkpoint?.currentWitnessId === heldOut.id ? checkpoint.currentWitnessQuestions : undefined) ?? [];
      const completedQids = new Set(questions.map((q) => q.qid));
      const maxQ = options.maxQuestionsPerWitness ?? Infinity;

      for (const testimony of heldOutTestimonies) {
        for (const answer of testimony.answers) {
          if (questions.length >= maxQ) break;
          if (!answer.behindText || answer.behindText.trim().length === 0) continue;
          if (completedQids.has(answer.qid)) continue;

          console.error(`[Ablation]   Q${questions.length + 1} (${answer.qid})...`);

          // Shared "with persona" prediction
          const withPersonaUser = [
            `## 人格描述`,
            persona.systemPrompt,
            '',
            `## 证人与当事人的关系`,
            heldOut.relation,
            '',
            `## 问题 (qid: ${answer.qid})`,
            `请以这位证人(${heldOut.relation})的口吻,预测他/她会怎么回答关于当事人的这个方面。`,
          ].join('\n');
          const withPersonaPrediction = await generatePrediction(evalLlm, PREDICT_WITH_PERSONA_SYSTEM, withPersonaUser);

          // (a) no-persona baseline
          const baselineUser = [
            `## 证人与当事人的关系`,
            heldOut.relation,
            '',
            `## 问题 (qid: ${answer.qid})`,
            `请以这位证人(${heldOut.relation})的口吻,猜测他/她会怎么描述当事人。`,
          ].join('\n');
          const baselinePrediction = await generatePrediction(evalLlm, PREDICT_BASELINE_SYSTEM, baselineUser);

          // (b) claims-stripped prediction
          const claimsStrippedUser = [
            `## 人格描述`,
            claimsStrippedPrompt,
            '',
            `## 证人与当事人的关系`,
            heldOut.relation,
            '',
            `## 问题 (qid: ${answer.qid})`,
            `请以这位证人(${heldOut.relation})的口吻,预测他/她会怎么回答关于当事人的这个方面。`,
          ].join('\n');
          const claimsStrippedPrediction = await generatePrediction(evalLlm, PREDICT_WITH_PERSONA_SYSTEM, claimsStrippedUser);

          // (c) episodes-stripped prediction
          const episodesStrippedUser = [
            `## 人格描述`,
            episodesStrippedPrompt,
            '',
            `## 证人与当事人的关系`,
            heldOut.relation,
            '',
            `## 问题 (qid: ${answer.qid})`,
            `请以这位证人(${heldOut.relation})的口吻,预测他/她会怎么回答关于当事人的这个方面。`,
          ].join('\n');
          const episodesStrippedPrediction = await generatePrediction(evalLlm, PREDICT_WITH_PERSONA_SYSTEM, episodesStrippedUser);

          // Judge all three arms
          const judgeVsBaseline = await judgePair(evalLlm, answer.behindText, withPersonaPrediction, baselinePrediction);
          const judgeVsClaimsStripped = await judgePair(evalLlm, answer.behindText, withPersonaPrediction, claimsStrippedPrediction);
          const judgeVsEpisodesStripped = await judgePair(evalLlm, answer.behindText, withPersonaPrediction, episodesStrippedPrediction);

          questions.push({
            qid: answer.qid,
            witnessId: heldOut.id,
            relation: heldOut.relation,
            realAnswer: answer.behindText,
            withPersonaPrediction,
            baselinePrediction,
            claimsStrippedPrediction,
            episodesStrippedPrediction,
            judgeVsBaseline,
            judgeVsClaimsStripped,
            judgeVsEpisodesStripped,
          });

          if (options.progressFile) {
            saveCheckpoint(options.progressFile, {
              completedWitnesses: witnessResults,
              currentWitnessId: heldOut.id,
              currentWitnessQuestions: questions,
            });
          }
        }
      }

      const composition: PersonaComposition = {
        episodeCount: persona.meta.episodeCount,
        claimCount: persona.meta.includedClaimIds.length,
        charCount: persona.meta.charCount,
        truncated: persona.meta.truncated,
      };

      const wr: AblationWitnessResult = {
        witnessId: heldOut.id,
        relation: heldOut.relation,
        questions,
        courtStats: { claimCount: survivingCount, durationMs: courtDurationMs },
        personaComposition: composition,
        vsBaseline: computeArmStats(questions, (q) => q.judgeVsBaseline),
        vsClaimsStripped: computeArmStats(questions, (q) => q.judgeVsClaimsStripped),
        vsEpisodesStripped: computeArmStats(questions, (q) => q.judgeVsEpisodesStripped),
      };
      witnessResults.push(wr);

      if (options.progressFile) {
        saveCheckpoint(options.progressFile, { completedWitnesses: witnessResults });
      }
    } finally {
      tempStore.close();
    }
  }

  // Aggregate across all witnesses
  function aggregateArm(getStats: (wr: AblationWitnessResult) => AblationArmStats): AblationArmStats {
    let totalPersonaWins = 0;
    let totalComparisonWins = 0;
    let totalDiscarded = 0;
    for (const wr of witnessResults) {
      const s = getStats(wr);
      totalPersonaWins += s.personaWins;
      totalComparisonWins += s.comparisonWins;
      totalDiscarded += s.discardedPairs;
    }
    const totalValid = totalPersonaWins + totalComparisonWins;
    return {
      validPairs: totalValid,
      discardedPairs: totalDiscarded,
      personaWins: totalPersonaWins,
      comparisonWins: totalComparisonWins,
      personaWinRate: totalValid > 0 ? totalPersonaWins / totalValid : 0,
      wilson95: wilsonInterval(totalPersonaWins, totalValid),
    };
  }

  const result: AblationResult = {
    subjectId,
    modelName: options.modelName,
    promptSha,
    witnessResults,
    overall: {
      vsBaseline: aggregateArm((wr) => wr.vsBaseline),
      vsClaimsStripped: aggregateArm((wr) => wr.vsClaimsStripped),
      vsEpisodesStripped: aggregateArm((wr) => wr.vsEpisodesStripped),
    },
  };

  // Write run log
  const run: RunRecord = {
    kind: 'ablation',
    modelName: options.modelName,
    promptSha,
    commitSha: getCommitSha(),
    params: {
      subjectId,
      witnessCount: witnesses.length,
      maxQuestionsPerWitness: options.maxQuestionsPerWitness ?? 'all',
    },
    results: {
      overall: result.overall,
    },
    details: witnessResults.map((wr) => ({
      witnessId: wr.witnessId,
      relation: wr.relation,
      courtStats: wr.courtStats,
      personaComposition: wr.personaComposition,
      vsBaseline: wr.vsBaseline,
      vsClaimsStripped: wr.vsClaimsStripped,
      vsEpisodesStripped: wr.vsEpisodesStripped,
      questions: wr.questions.map((q) => ({
        qid: q.qid,
        vsBaseline: { status: q.judgeVsBaseline.status, winner: q.judgeVsBaseline.status === 'valid' ? q.judgeVsBaseline.winner : null },
        vsClaimsStripped: { status: q.judgeVsClaimsStripped.status, winner: q.judgeVsClaimsStripped.status === 'valid' ? q.judgeVsClaimsStripped.winner : null },
        vsEpisodesStripped: { status: q.judgeVsEpisodesStripped.status, winner: q.judgeVsEpisodesStripped.status === 'valid' ? q.judgeVsEpisodesStripped.winner : null },
      })),
    })),
  };
  writeRun(run);

  return result;
}
