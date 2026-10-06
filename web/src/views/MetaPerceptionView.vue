<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { getAdminToken } from '../api';

interface MetaQuestion {
  qid: string;
}

interface WitnessInfo {
  id: string;
  relation: string;
  consentLevel: string;
}

interface ScoreItem {
  witnessId: string;
  qid: string;
  match: 'hit' | 'partial' | 'miss';
  cue: string;
}

interface ByWitness {
  witnessId: string;
  relation: string;
  score: number;
  itemCount: number;
}

interface MetaResult {
  subjectId: string;
  totalScore: number;
  items: ScoreItem[];
  byWitness: ByWitness[];
  scoredAt: string;
  pending?: boolean;
  message?: string;
}

const route = useRoute();
const subjectId = route.params.id as string;

const questions = ref<MetaQuestion[]>([]);
const witnesses = ref<WitnessInfo[]>([]);
const predictions = ref<Map<string, string>>(new Map());
const result = ref<MetaResult | null>(null);
const phase = ref<'loading' | 'predict' | 'submitted' | 'result'>('loading');
const error = ref('');
const scoring = ref(false);

function authHeaders(): Record<string, string> {
  const token = getAdminToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const merged = { ...init, headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) } };
  const response = await fetch(path, merged);
  if (!response.ok) throw new Error(`${response.status}`);
  return (await response.json()) as T;
}

function predKey(witnessId: string, qid: string): string {
  return `${witnessId}::${qid}`;
}

onMounted(async () => {
  try {
    // Check if result already exists
    const resResponse = await fetch(`/api/subjects/${encodeURIComponent(subjectId)}/meta/result`, { headers: authHeaders() });
    if (resResponse.ok) {
      const data = (await resResponse.json()) as MetaResult;
      if (data.pending) {
        phase.value = 'submitted';
      } else if (data.totalScore !== undefined) {
        result.value = data;
        phase.value = 'result';
        return;
      }
    }

    // Load questions
    const qData = await fetchJson<{
      questions: MetaQuestion[];
      witnesses: WitnessInfo[];
    }>(`/api/subjects/${encodeURIComponent(subjectId)}/meta/questions`);
    questions.value = qData.questions;
    witnesses.value = qData.witnesses;
    if (phase.value === 'loading') phase.value = 'predict';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  }
});

async function submitPredictions() {
  const items = [];
  for (const w of witnesses.value) {
    for (const q of questions.value) {
      const text = predictions.value.get(predKey(w.id, q.qid));
      if (text && text.trim()) {
        items.push({ witnessId: w.id, qid: q.qid, predictedText: text.trim() });
      }
    }
  }
  if (items.length === 0) {
    error.value = '请至少填写一条预测';
    return;
  }
  try {
    await fetchJson(`/api/subjects/${encodeURIComponent(subjectId)}/meta/predictions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ predictions: items }),
    });
    phase.value = 'submitted';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败';
  }
}

async function triggerScore() {
  scoring.value = true;
  try {
    const data = await fetchJson<MetaResult>(
      `/api/subjects/${encodeURIComponent(subjectId)}/meta/score`,
      { method: 'POST' },
    );
    result.value = data;
    phase.value = 'result';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '评分失败';
  } finally {
    scoring.value = false;
  }
}

const scorePercent = computed(() =>
  result.value ? Math.round(result.value.totalScore * 100) : 0,
);

const matchLabel: Record<string, string> = {
  hit: '猜中',
  partial: '部分',
  miss: '偏了',
};

function updatePrediction(witnessId: string, qid: string, text: string) {
  predictions.value.set(predKey(witnessId, qid), text);
}
</script>

<template>
  <div class="meta-view">
    <h1>元知觉:你觉得他们怎么看你</h1>

    <div v-if="error" class="error">{{ error }}</div>

    <!-- Phase: predict -->
    <template v-if="phase === 'predict'">
      <p class="intro">
        对每位证人,猜猜他们会怎么回答以下问题。提交后锁定,不可修改。
      </p>

      <div v-for="w in witnesses" :key="w.id" class="witness-block">
        <h2>{{ w.relation }}</h2>
        <div v-for="q in questions" :key="q.qid" class="question-block">
          <label>{{ q.qid }}: 你觉得「{{ w.relation }}」会怎么回答？</label>
          <textarea
            rows="2"
            :value="predictions.get(predKey(w.id, q.qid)) ?? ''"
            @input="updatePrediction(w.id, q.qid, ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
        </div>
      </div>

      <button class="submit-btn" @click="submitPredictions">锁定提交</button>
    </template>

    <!-- Phase: submitted -->
    <template v-if="phase === 'submitted'">
      <p>预测已锁定。</p>
      <button class="submit-btn" @click="triggerScore" :disabled="scoring">
        {{ scoring ? '评分中...' : '开始评分' }}
      </button>
    </template>

    <!-- Phase: result -->
    <template v-if="phase === 'result' && result">
      <!-- Shareable result card -->
      <div class="result-card">
        <div class="total-score">
          <span class="score-number">{{ scorePercent }}%</span>
          <span class="score-label">
            {{ result.byWitness.length }} 位朋友怎么看我,我猜中了 {{ scorePercent }}%
          </span>
        </div>

        <div class="by-witness">
          <h3>分项</h3>
          <div v-for="bw in result.byWitness" :key="bw.witnessId" class="witness-score">
            <span class="relation">{{ bw.relation }}</span>
            <span class="score">{{ Math.round(bw.score * 100) }}%</span>
          </div>
        </div>
      </div>

      <!-- Detail items -->
      <h3>逐题对照</h3>
      <div v-for="item in result.items" :key="`${item.witnessId}-${item.qid}`" class="detail-item">
        <span :class="['match-badge', item.match]">{{ matchLabel[item.match] }}</span>
        <span class="qid">{{ item.qid }}</span>
        <span class="cue">{{ item.cue }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.meta-view {
  max-width: 640px;
  margin: 2rem auto;
  padding: 0 1rem;
}
.intro { color: #666; margin-bottom: 1.5rem; }
.witness-block { margin-bottom: 2rem; }
.witness-block h2 { font-size: 1.1rem; border-bottom: 1px solid #eee; padding-bottom: 0.3rem; }
.question-block { margin: 0.8rem 0; }
.question-block label { display: block; font-size: 0.9rem; color: #444; margin-bottom: 0.3rem; }
.question-block textarea { width: 100%; box-sizing: border-box; padding: 0.5rem; font-size: 0.9rem; border: 1px solid #ccc; border-radius: 4px; }
.submit-btn { margin-top: 1rem; padding: 0.6rem 1.5rem; font-size: 1rem; background: #2563eb; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.error { color: #dc2626; margin-bottom: 1rem; }

.result-card {
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
  padding: 1.5rem; margin: 1.5rem 0;
}
.total-score { text-align: center; margin-bottom: 1rem; }
.score-number { font-size: 2.5rem; font-weight: bold; color: #2563eb; display: block; }
.score-label { font-size: 0.95rem; color: #64748b; }
.by-witness h3 { font-size: 0.95rem; margin-bottom: 0.5rem; }
.witness-score { display: flex; justify-content: space-between; padding: 0.3rem 0; border-bottom: 1px solid #f1f5f9; }
.relation { color: #334155; }
.score { font-weight: 600; }

.detail-item { display: flex; gap: 0.5rem; align-items: center; padding: 0.4rem 0; border-bottom: 1px solid #f1f5f9; }
.match-badge { font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 10px; font-weight: 600; }
.match-badge.hit { background: #dcfce7; color: #166534; }
.match-badge.partial { background: #fef3c7; color: #92400e; }
.match-badge.miss { background: #fee2e2; color: #991b1b; }
.qid { font-size: 0.8rem; color: #94a3b8; }
.cue { font-size: 0.9rem; color: #475569; }
</style>
