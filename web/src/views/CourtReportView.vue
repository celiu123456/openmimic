<script setup lang="ts">
import { ref, onMounted } from 'vue';
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
}

interface Witness {
  id: string;
  relation: string;
}

const route = useRoute();
const subjectId = route.params.id as string;
const divergences = ref<Divergence[]>([]);
const claims = ref<Claim[]>([]);
const witnessMap = ref(new Map<string, string>());
const loading = ref(true);
const error = ref('');

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status}`);
  return (await response.json()) as T;
}

onMounted(async () => {
  try {
    const [divResult, claimResult] = await Promise.all([
      fetchJson<{ divergences: Divergence[] }>(
        `/api/subjects/${encodeURIComponent(subjectId)}/divergences`,
      ),
      fetchJson<{ claims: Claim[] }>(
        `/api/subjects/${encodeURIComponent(subjectId)}/claims`,
      ),
    ]);
    divergences.value = divResult.divergences;
    claims.value = claimResult.claims;

    // Build witness map from claims' witnessIds
    // This is a minimal approach; a full implementation would fetch witnesses
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
});

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
</script>

<template>
  <main class="court-report">
    <h1>法庭报告</h1>
    <p v-if="loading">加载中...</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <template v-else>
      <section class="claims-section">
        <h2>论断 ({{ claims.length }})</h2>
        <ul>
          <li v-for="claim in claims" :key="claim.id">
            <span class="conviction">{{ claim.conviction.toFixed(2) }}</span>
            <span v-if="claim.kind" class="kind">[{{ claim.kind }}]</span>
            {{ claim.text }}
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

.claims-section ul {
  list-style: none;
  padding: 0;
}

.claims-section li {
  margin: 0.5rem 0;
  line-height: 1.5;
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
