/**
 * meta-perception: "你以为他们怎么看你"
 *
 * Based on Kenny & DePaulo 1993; Carlson, Vazire & Furr 2011.
 * The subject predicts how each witness answered a subset of questions,
 * then the predictions are scored against real testimony.
 *
 * Routes (self-registered via router service):
 *   GET  /api/subjects/:id/meta/questions   — questions to predict
 *   POST /api/subjects/:id/meta/predictions — submit predictions (locked once)
 *   POST /api/subjects/:id/meta/score       — trigger LLM scoring
 *   GET  /api/subjects/:id/meta/result      — retrieve result
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Plugin } from '@openmimic/kernel';
import type { Store } from '@openmimic/kernel';
import type { Router } from '@openmimic/server';
import type { LLMClient, LLMCompletionRequest } from '@openmimic/engine-court';
import {
  generateStructuredJson,
  wrapUntrusted,
  appendGuardInstruction,
  type RepairChatMessage,
} from '@openmimic/shared';

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

export const PredictionItemSchema = z.object({
  witnessId: z.string().min(1),
  qid: z.string().min(1),
  predictedText: z.string().min(1),
});
export type PredictionItem = z.infer<typeof PredictionItemSchema>;

export const PredictionSetSchema = z.object({
  subjectId: z.string().min(1),
  predictions: z.array(PredictionItemSchema).min(1),
});
export type PredictionSet = z.infer<typeof PredictionSetSchema>;

export type MatchGrade = 'hit' | 'partial' | 'miss';

export interface ScoreItem {
  witnessId: string;
  qid: string;
  match: MatchGrade;
  cue: string;
}

export interface MetaResult {
  subjectId: string;
  totalScore: number;
  items: ScoreItem[];
  byWitness: Array<{
    witnessId: string;
    relation: string;
    score: number;
    itemCount: number;
  }>;
  scoredAt: string;
}

/* ------------------------------------------------------------------ */
/* Default question subset (3-5 qids from friend-v1)                   */
/* ------------------------------------------------------------------ */

export const DEFAULT_META_QIDS = ['q1', 'q2', 'q4', 'q6', 'q10'];

/* ------------------------------------------------------------------ */
/* Plugin-persisted storage for predictions & results                   */
/* ------------------------------------------------------------------ */

export interface MetaPerceptionState {
  predictions: Map<string, { items: PredictionItem[]; lockedAt: string }>;
  results: Map<string, MetaResult>;
}

export function createMetaState(): MetaPerceptionState {
  return {
    predictions: new Map(),
    results: new Map(),
  };
}

/* ------------------------------------------------------------------ */
/* Scoring logic                                                       */
/* ------------------------------------------------------------------ */

const SCORE_SYSTEM = [
  '你是一个判定智能体。输入是两段话:',
  '- "预测":本人猜测某位朋友会怎么回答某个问题;',
  '- "实际":该朋友的真实回答。',
  '判定预测与实际是否吻合:',
  '- hit:核心意思与方向一致;',
  '- partial:捕捉到了部分事实或情绪方向,但遗漏或偏差明显;',
  '- miss:方向错误或完全不相关。',
  '只输出 JSON 对象:{"match":"hit"|"partial"|"miss","cue":"一句话理由"}',
].join('\n');

function buildScoreUser(predicted: string, actual: string): string {
  return appendGuardInstruction(
    `预测: ${wrapUntrusted('prediction', predicted)}\n实际: ${wrapUntrusted('actual_testimony', actual)}`,
  );
}

const MatchResultSchema = z.object({
  match: z.enum(['hit', 'partial', 'miss']),
  cue: z.string(),
});

export async function scoreOnePrediction(
  llm: LLMClient,
  predicted: string,
  actual: string,
): Promise<{ match: MatchGrade; cue: string }> {
  const repairModel = {
    chat: async (msgs: RepairChatMessage[]) => {
      const sysContent = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const userContent = msgs.filter((m) => m.role === 'user').pop()?.content ?? '';
      return llm.complete({ system: sysContent, user: userContent, maxTokens: 256 });
    },
  };
  return generateStructuredJson({
    model: repairModel,
    messages: [
      { role: 'system', content: SCORE_SYSTEM },
      { role: 'user', content: buildScoreUser(predicted, actual) },
    ],
    validate: (raw) => MatchResultSchema.parse(raw),
    maxAttempts: 2,
  });
}

export function computeScore(items: ScoreItem[]): number {
  if (items.length === 0) return 0;
  let sum = 0;
  for (const item of items) {
    if (item.match === 'hit') sum += 1;
    else if (item.match === 'partial') sum += 0.5;
  }
  return Math.round((sum / items.length) * 100) / 100;
}

export function computeByWitness(
  items: ScoreItem[],
  witnessMap: Map<string, string>,
): MetaResult['byWitness'] {
  const groups = new Map<string, ScoreItem[]>();
  for (const item of items) {
    if (!groups.has(item.witnessId)) groups.set(item.witnessId, []);
    groups.get(item.witnessId)!.push(item);
  }
  const result: MetaResult['byWitness'] = [];
  for (const [witnessId, witItems] of groups) {
    result.push({
      witnessId,
      relation: witnessMap.get(witnessId) ?? '证人',
      score: computeScore(witItems),
      itemCount: witItems.length,
    });
  }
  result.sort((a, b) => b.score - a.score);
  return result;
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

export interface MetaPerceptionConfig {
  /** Which qids to use for predictions. Default: DEFAULT_META_QIDS */
  qids?: string[];
}

export const metaPerceptionPlugin: Plugin<MetaPerceptionConfig> = {
  name: 'meta-perception',
  kind: 'engine',
  version: '0.0.1',
  inject: ['store'],
  apply(ctx, config) {
    const store = ctx.get<Store>('store');
    const qids = config?.qids ?? DEFAULT_META_QIDS;

    // Persistent tables for predictions (append-only) and results
    const predTable = store.registerPluginTable(
      'meta_perception', 'predictions',
      `CREATE TABLE IF NOT EXISTS plugin_meta_perception_predictions (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        witness_id TEXT NOT NULL,
        qid TEXT NOT NULL,
        predicted_text TEXT NOT NULL,
        locked_at TEXT NOT NULL
      )`,
      { appendOnly: true },
    );
    const resultTable = store.registerPluginTable(
      'meta_perception', 'results',
      `CREATE TABLE IF NOT EXISTS plugin_meta_perception_results (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        witness_id TEXT NOT NULL,
        qid TEXT NOT NULL,
        match_grade TEXT NOT NULL,
        cue TEXT NOT NULL,
        scored_at TEXT NOT NULL
      )`,
      { appendOnly: false },
    );

    // In-memory cache hydrated from DB on load
    const state = createMetaState();

    // Hydrate from DB
    for (const row of predTable.query()) {
      const subjectId = row.subject_id as string;
      if (!state.predictions.has(subjectId)) {
        state.predictions.set(subjectId, { items: [], lockedAt: row.locked_at as string });
      }
      state.predictions.get(subjectId)!.items.push({
        witnessId: row.witness_id as string,
        qid: row.qid as string,
        predictedText: row.predicted_text as string,
      });
    }
    for (const row of resultTable.query()) {
      const subjectId = row.subject_id as string;
      if (!state.results.has(subjectId)) {
        state.results.set(subjectId, {
          subjectId,
          totalScore: 0,
          items: [],
          byWitness: [],
          scoredAt: row.scored_at as string,
        });
      }
      state.results.get(subjectId)!.items.push({
        witnessId: row.witness_id as string,
        qid: row.qid as string,
        match: row.match_grade as MatchGrade,
        cue: row.cue as string,
      });
    }
    // Recompute scores from hydrated items
    for (const [subjectId, result] of state.results) {
      const witnesses = store.listWitnessesBySubject(subjectId);
      const witnessMap = new Map(witnesses.map((w) => [w.id, w.relation]));
      result.totalScore = computeScore(result.items);
      result.byWitness = computeByWitness(result.items, witnessMap);
    }

    // Provide the state for testing access
    ctx.provide('meta-perception', state);

    if (!ctx.has('router')) return;
    const router = ctx.get<Router>('router');

    /* GET /api/subjects/:id/meta/questions */
    router.get('/api/subjects/:id/meta/questions', (context) => {
      const subjectId = context.params.id ?? '';
      const subject = store.getSubject(subjectId);
      if (!subject) return { status: 404, body: { error: { code: 'not_found', message: '对象不存在' } } };

      const witnesses = store.listWitnessesBySubject(subjectId);
      const questions = qids.map((qid) => ({ qid }));

      return {
        status: 200,
        body: {
          subjectId,
          questions,
          witnesses: witnesses.map((w) => ({
            id: w.id,
            relation: w.relation,
            consentLevel: w.consentLevel,
          })),
        },
      };
    }, { scope: 'admin' });

    /* POST /api/subjects/:id/meta/predictions */
    router.post('/api/subjects/:id/meta/predictions', (context) => {
      const subjectId = context.params.id ?? '';
      const subject = store.getSubject(subjectId);
      if (!subject) return { status: 404, body: { error: { code: 'not_found', message: '对象不存在' } } };

      // Already locked?
      if (state.predictions.has(subjectId)) {
        return { status: 409, body: { error: { code: 'already_locked', message: '预测已提交,不可修改' } } };
      }

      const body = z.object({
        predictions: z.array(PredictionItemSchema).min(1),
      }).parse(context.body);

      const lockedAt = new Date().toISOString();
      state.predictions.set(subjectId, {
        items: body.predictions,
        lockedAt,
      });

      // Persist to DB (append-only)
      for (const pred of body.predictions) {
        predTable.insert({
          id: randomUUID(),
          subject_id: subjectId,
          witness_id: pred.witnessId,
          qid: pred.qid,
          predicted_text: pred.predictedText,
          locked_at: lockedAt,
        });
      }

      return { status: 201, body: { locked: true, count: body.predictions.length } };
    }, { scope: 'admin' });

    /* POST /api/subjects/:id/meta/score */
    router.post('/api/subjects/:id/meta/score', (context) => {
      const subjectId = context.params.id ?? '';
      const pred = state.predictions.get(subjectId);
      if (!pred) {
        return { status: 400, body: { error: { code: 'no_predictions', message: '尚未提交预测' } } };
      }

      if (!ctx.has('llm')) {
        return { status: 501, body: { error: { code: 'no_llm', message: '需要配置模型后评分' } } };
      }

      const llm = ctx.get<LLMClient>('llm');
      const testimonies = store.listBySubject(subjectId);
      const witnesses = store.listWitnessesBySubject(subjectId);
      const witnessMap = new Map(witnesses.map((w) => [w.id, w.relation]));

      const scorePromise = (async () => {
        const items: ScoreItem[] = [];
        for (const prediction of pred.items) {
          const witTestimonies = testimonies.filter((t) => t.witnessId === prediction.witnessId);
          let actualText: string | undefined;
          for (const t of witTestimonies) {
            const answer = t.answers.find((a) => a.qid === prediction.qid);
            if (answer) {
              actualText = answer.behindText;
              break;
            }
          }
          if (!actualText) {
            items.push({ witnessId: prediction.witnessId, qid: prediction.qid, match: 'miss', cue: '未找到对应证言' });
            continue;
          }
          try {
            const result = await scoreOnePrediction(llm, prediction.predictedText, actualText);
            items.push({ witnessId: prediction.witnessId, qid: prediction.qid, ...result });
          } catch {
            items.push({ witnessId: prediction.witnessId, qid: prediction.qid, match: 'miss', cue: '评分失败' });
          }
        }

        const totalScore = computeScore(items);
        const byWitness = computeByWitness(items, witnessMap);
        const scoredAt = new Date().toISOString();

        const metaResult: MetaResult = {
          subjectId,
          totalScore,
          items,
          byWitness,
          scoredAt,
        };
        state.results.set(subjectId, metaResult);

        // Persist to DB (clear previous results for this subject, then insert)
        resultTable.delete('subject_id = ?', [subjectId]);
        for (const item of items) {
          resultTable.insert({
            id: randomUUID(),
            subject_id: subjectId,
            witness_id: item.witnessId,
            qid: item.qid,
            match_grade: item.match,
            cue: item.cue,
            scored_at: scoredAt,
          });
        }

        return metaResult;
      })();

      return scorePromise.then((result) => ({
        status: 200,
        body: result,
      }));
    }, { scope: 'admin' });

    /* GET /api/subjects/:id/meta/result */
    router.get('/api/subjects/:id/meta/result', (context) => {
      const subjectId = context.params.id ?? '';
      const result = state.results.get(subjectId);
      if (!result) {
        if (state.predictions.has(subjectId)) {
          if (!ctx.has('llm')) {
            return { status: 200, body: { subjectId, pending: true, message: '需要配置模型后评分' } };
          }
          return { status: 200, body: { subjectId, pending: true, message: '尚未评分' } };
        }
        return { status: 404, body: { error: { code: 'not_found', message: '无预测数据' } } };
      }

      // Apply authorization: synthesis_only witnesses don't show actual text
      const witnesses = store.listWitnessesBySubject(subjectId);
      const synthWitnessIds = new Set(
        witnesses
          .filter((w) => w.consentLevel === 'synthesis_only')
          .map((w) => w.id),
      );

      const redactedItems = result.items.map((item) => {
        if (synthWitnessIds.has(item.witnessId)) {
          return { ...item, cue: '该证人未授权展示原文' };
        }
        return item;
      });

      // Anonymous witnesses: exclude from byWitness breakdown, keep in total
      const anonymousWitnessIds = new Set(
        witnesses
          .filter((w) => w.anonymousInRoom === true)
          .map((w) => w.id),
      );
      const filteredByWitness = result.byWitness.filter(
        (bw) => !anonymousWitnessIds.has(bw.witnessId),
      );

      return {
        status: 200,
        body: {
          ...result,
          items: redactedItems,
          byWitness: filteredByWitness,
        },
      };
    }, { scope: 'admin' });
  },
};
