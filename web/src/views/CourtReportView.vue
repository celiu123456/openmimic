<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';

interface DivergencePosition {
  witnessId: string;
  claimId: string;
  summary: string;
}

interface Divergence {
  id: string;
  topic: string;
  type: 'perspective' | 'factual';
  positions: DivergencePosition[];
  resolution?: string;
}

interface Claim {
  id: string;
  text: string;
  conviction: number;
  status: string;
  kind?: string;
  witnessIds?: string[];
  reraised?: boolean;
}

interface Witness {
  id: string;
  relation: string;
}

interface ContestedListItem {
  id: string;
  text: string;
  conviction: number;
}

interface SilenceSignalItem {
  id: string;
  qid: string;
  skipRatio: number;
  totalWitnesses: number;
  skipperIds: string[];
}

const route = useRoute();
const subjectId = route.params.id as string;
const divergences = ref<Divergence[]>([]);
const claims = ref<Claim[]>([]);
const silenceSignals = ref<SilenceSignalItem[]>([]);
const witnessMap = ref(new Map<string, string>());
const loading = ref(true);
const error = ref('');
const gateEnabled = ref(false);

// Veto state
const confirmingClaimId = ref<string | null>(null);
const contestedExpanded = ref(false);

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status}`);
  return (await response.json()) as T;
}

async function checkGateEnabled(): Promise<boolean> {
  try {
    await fetchJson(`/api/subjects/${encodeURIComponent(subjectId)}/contested`);
    return true;
  } catch {
    return false;
  }
}

async function fetchSilenceSignals(): Promise<SilenceSignalItem[]> {
  try {
    const result = await fetchJson<{ signals: SilenceSignalItem[] }>(
      `/api/subjects/${encodeURIComponent(subjectId)}/silence-signals`,
    );
    return result.signals ?? [];
  } catch {
    return [];
  }
}

onMounted(async () => {
  try {
    const [divResult, claimResult, gateOk, signals] = await Promise.all([
      fetchJson<{ divergences: Divergence[] }>(
        `/api/subjects/${encodeURIComponent(subjectId)}/divergences`,
      ),
      fetchJson<{ claims: Claim[] }>(
        `/api/subjects/${encodeURIComponent(subjectId)}/claims`,
      ),
      checkGateEnabled(),
      fetchSilenceSignals(),
    ]);
    divergences.value = divResult.divergences;
    claims.value = claimResult.claims;
    gateEnabled.value = gateOk;
    silenceSignals.value = signals;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
});

const survivingClaims = computed(() =>
  claims.value.filter((c) => c.status === 'surviving'),
);

const contestedClaims = computed(() =>
  claims.value.filter((c) => c.status === 'contested'),
);

function typeLabel(type: string): string {
  return type === 'factual' ? '事实性' : '视角性';
}

function resolutionLabel(resolution?: string): string {
  switch (resolution) {
    case 'kept_both': return '两条都保留';
    case 'qualified': return '加限定后共存';
    case 'unresolved': return '未解决';
    default: return '';
  }
}

function showConfirm(claimId: string): void {
  confirmingClaimId.value = claimId;
}

function cancelConfirm(): void {
  confirmingClaimId.value = null;
}

async function contestClaim(claimId: string): Promise<void> {
  try {
    const response = await fetch(`/api/claims/${encodeURIComponent(claimId)}/contest`, {
      method: 'POST',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const msg = (body as { error?: { message?: string } })?.error?.message ?? '操作失败';
      alert(msg);
      return;
    }
    // Update local state
    const claim = claims.value.find((c) => c.id === claimId);
    if (claim) claim.status = 'contested';
  } finally {
    confirmingClaimId.value = null;
  }
}

async function uncontestClaim(claimId: string): Promise<void> {
  try {
    const response = await fetch(`/api/claims/${encodeURIComponent(claimId)}/uncontest`, {
      method: 'POST',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const msg = (body as { error?: { message?: string } })?.error?.message ?? '操作失败';
      alert(msg);
      return;
    }
    // Update local state
    const claim = claims.value.find((c) => c.id === claimId);
    if (claim) claim.status = 'surviving';
  } catch {
    alert('撤回失败');
  }
}
</script>

<template>
  <main class="court-report">
    <h1>法庭报告</h1>
    <p v-if="loading">加载中...</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <template v-else>
      <section class="claims-section">
        <h2>论断 ({{ survivingClaims.length }})</h2>
        <ul>
          <li v-for="claim in survivingClaims" :key="claim.id" class="claim-item">
            <div class="claim-content">
              <span class="conviction">{{ claim.conviction.toFixed(2) }}</span>
              <span v-if="claim.kind" class="kind">[{{ claim.kind }}]</span>
              <span v-if="claim.reraised" class="reraised-tag">重新提出</span>
              {{ claim.text }}
            </div>
            <button
              v-if="gateEnabled && confirmingClaimId !== claim.id"
              class="contest-btn"
              @click="showConfirm(claim.id)"
            >
              我不同意
            </button>
            <div v-if="confirmingClaimId === claim.id" class="confirm-dialog">
              <span>确认否决这条论断?否决后它将不再出现在人格画像中。</span>
              <button class="confirm-yes" @click="contestClaim(claim.id)">确认否决</button>
              <button class="confirm-no" @click="cancelConfirm()">取消</button>
            </div>
          </li>
        </ul>
      </section>

      <!-- Contested claims section -->
      <section
        v-if="gateEnabled && contestedClaims.length > 0"
        class="contested-section"
      >
        <h3
          class="contested-header"
          @click="contestedExpanded = !contestedExpanded"
        >
          <span class="toggle-icon">{{ contestedExpanded ? '▼' : '▶' }}</span>
          你否决过的论断 ({{ contestedClaims.length }})
        </h3>
        <ul v-if="contestedExpanded">
          <li v-for="claim in contestedClaims" :key="claim.id" class="claim-item contested">
            <div class="claim-content">
              <span class="conviction">{{ claim.conviction.toFixed(2) }}</span>
              <span v-if="claim.kind" class="kind">[{{ claim.kind }}]</span>
              <s>{{ claim.text }}</s>
            </div>
            <button class="withdraw-btn" @click="uncontestClaim(claim.id)">
              撤回否决
            </button>
          </li>
        </ul>
      </section>

      <!-- Silence signals section -->
      <section v-if="silenceSignals.length > 0" class="silence-section">
        <h2>无人谈及的话题 ({{ silenceSignals.length }})</h2>
        <ul>
          <li v-for="signal in silenceSignals" :key="signal.id" class="silence-item">
            <span class="silence-qid">{{ signal.qid }}</span>
            <span class="silence-stats">
              {{ signal.skipperIds.length }}/{{ signal.totalWitnesses }} 位证人跳过
              ({{ Math.round(signal.skipRatio * 100) }}%)
            </span>
          </li>
        </ul>
      </section>

      <section class="divergence-map">
        <h2>分歧地图 ({{ divergences.length }})</h2>
        <p v-if="divergences.length === 0" class="empty">无分歧记录</p>
        <div
          v-for="div in divergences"
          :key="div.id"
          class="divergence-card"
          :class="div.type"
        >
          <div class="divergence-header">
            <span class="type-tag">{{ typeLabel(div.type) }}</span>
            <span class="topic">{{ div.topic }}</span>
            <span v-if="div.resolution" class="resolution">
              {{ resolutionLabel(div.resolution) }}
            </span>
          </div>
          <ul class="positions">
            <li v-for="(pos, idx) in div.positions" :key="idx">
              <strong>{{ pos.witnessId }}</strong>: {{ pos.summary }}
            </li>
          </ul>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.court-report {
  max-width: 720px;
  margin: 0 auto;
  padding: 1rem;
}

.claims-section ul,
.contested-section ul {
  list-style: none;
  padding: 0;
}

.claim-item {
  margin: 0.5rem 0;
  line-height: 1.5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.claim-content {
  flex: 1;
  min-width: 0;
}

.conviction {
  display: inline-block;
  min-width: 3em;
  font-family: monospace;
  color: #666;
}

.kind {
  color: #888;
  font-size: 0.85em;
  margin-right: 0.25em;
}

.reraised-tag {
  font-size: 0.75em;
  padding: 0.1em 0.4em;
  border-radius: 3px;
  background: #fef3cd;
  color: #856404;
  margin-right: 0.25em;
}

.contest-btn {
  flex-shrink: 0;
  padding: 0.2em 0.6em;
  font-size: 0.85em;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  color: #666;
  cursor: pointer;
}
.contest-btn:hover {
  border-color: #e74c3c;
  color: #e74c3c;
}

.confirm-dialog {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: #fdf2f2;
  border-radius: 4px;
  font-size: 0.85em;
}

.confirm-yes {
  padding: 0.2em 0.6em;
  border: none;
  border-radius: 4px;
  background: #e74c3c;
  color: #fff;
  cursor: pointer;
}

.confirm-no {
  padding: 0.2em 0.6em;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}

/* Contested section */
.contested-section {
  margin-top: 1.5rem;
  border-top: 1px solid #eee;
  padding-top: 0.75rem;
}

.contested-header {
  cursor: pointer;
  user-select: none;
  color: #888;
  font-size: 0.95em;
  margin: 0;
}

.toggle-icon {
  display: inline-block;
  width: 1em;
  font-size: 0.8em;
}

.claim-item.contested {
  color: #999;
}

.withdraw-btn {
  flex-shrink: 0;
  padding: 0.2em 0.6em;
  font-size: 0.85em;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  color: #888;
  cursor: pointer;
}
.withdraw-btn:hover {
  border-color: #27ae60;
  color: #27ae60;
}

/* Silence section */
.silence-section {
  margin-top: 1.5rem;
}

.silence-section ul {
  list-style: none;
  padding: 0;
}

.silence-item {
  margin: 0.4rem 0;
  padding: 0.4rem 0.75rem;
  background: #f8f9fa;
  border-left: 3px solid #95a5a6;
  border-radius: 0 4px 4px 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.silence-qid {
  font-weight: 600;
  color: #555;
}

.silence-stats {
  font-size: 0.85em;
  color: #888;
}

.divergence-map h2 {
  margin-top: 2rem;
}

.divergence-card {
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  margin: 0.75rem 0;
}

.divergence-card.factual {
  border-left: 3px solid #e74c3c;
}

.divergence-card.perspective {
  border-left: 3px solid #3498db;
}

.divergence-header {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.type-tag {
  font-size: 0.8em;
  padding: 0.1em 0.4em;
  border-radius: 3px;
  font-weight: 600;
}

.factual .type-tag {
  background: #fde2e2;
  color: #c0392b;
}

.perspective .type-tag {
  background: #d6eaf8;
  color: #2980b9;
}

.topic {
  font-weight: 600;
}

.resolution {
  color: #888;
  font-size: 0.85em;
}

.positions {
  list-style: none;
  padding: 0;
  margin: 0;
}

.positions li {
  margin: 0.25rem 0;
  padding-left: 1rem;
  border-left: 2px solid #eee;
}

.empty {
  color: #999;
}

.error {
  color: #e74c3c;
}
</style>
