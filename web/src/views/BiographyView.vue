<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';

interface Paragraph {
  text: string;
  attribution: { displayName: string; relation?: string } | null;
  sourceRefs: Array<{ witnessId: string; testimonyId?: string }>;
  conflict: boolean;
}

interface Section {
  id: string;
  chapterNo: number;
  title: string;
  paragraphs: Paragraph[];
  removed: boolean;
  removalNote: string | null;
  qualityScore: number | null;
  qualityPass: boolean | null;
}

interface BiographyData {
  id: string;
  subjectId: string;
  title: string;
  sections: Section[];
  silenceNote: string | null;
  finalChapterNote: string | null;
  generatedAt: string;
  style: { voice: string; label: string };
}

const route = useRoute();
const subjectId = route.params.id as string;

const biography = ref<BiographyData | null>(null);
const phase = ref<'loading' | 'empty' | 'generating' | 'ready' | 'error'>('loading');
const error = ref('');
const generating = ref(false);
const includeConfidential = ref(false);

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const msg = (body as any)?.error?.message ?? `${response.status}`;
    throw new Error(msg);
  }
  return (await response.json()) as T;
}

async function load() {
  try {
    const data = await fetchJson<BiographyData>(
      `/api/subjects/${encodeURIComponent(subjectId)}/biography`,
    );
    biography.value = data;
    phase.value = 'ready';
  } catch (e) {
    if (e instanceof Error && e.message.includes('404')) {
      phase.value = 'empty';
    } else {
      phase.value = 'empty';
    }
  }
}

async function generate() {
  generating.value = true;
  error.value = '';
  phase.value = 'generating';
  try {
    const result = await fetchJson<{ biography: BiographyData }>(
      `/api/subjects/${encodeURIComponent(subjectId)}/biography`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeConfidential: includeConfidential.value }),
      },
    );
    biography.value = result.biography;
    phase.value = 'ready';
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Generation failed';
    phase.value = 'error';
  } finally {
    generating.value = false;
  }
}

async function removeSection(sectionId: string) {
  if (!biography.value) return;
  try {
    const data = await fetchJson<BiographyData>(
      `/api/biography/${encodeURIComponent(biography.value.id)}/sections/${encodeURIComponent(sectionId)}/remove`,
      { method: 'POST' },
    );
    biography.value = data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Remove failed';
  }
}

onMounted(load);

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Find quoted text in a paragraph for highlight */
function splitQuotes(text: string): Array<{ text: string; quoted: boolean }> {
  const parts: Array<{ text: string; quoted: boolean }> = [];
  let last = 0;
  const regex = /["“]([^"”]+)["”]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), quoted: false });
    }
    parts.push({ text: match[0], quoted: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), quoted: false });
  }
  return parts.length > 0 ? parts : [{ text, quoted: false }];
}
</script>

<template>
  <div class="bio-view">
    <p class="disclaimer">
      本文由系统根据朋友们的讲述生成。引号内的文字来自他们的原话。
    </p>

    <template v-if="phase === 'loading'">
      <p class="muted">加载中...</p>
    </template>

    <template v-if="phase === 'empty'">
      <h1>小传</h1>
      <p>还没有生成小传。</p>
      <label class="confidential-toggle">
        <input type="checkbox" v-model="includeConfidential" />
        包含朋友嘱托保密的内容
      </label>
      <button class="btn primary" @click="generate" :disabled="generating">
        生成小传
      </button>
    </template>

    <template v-if="phase === 'generating'">
      <p class="muted">正在生成小传,可能需要一分钟...</p>
    </template>

    <template v-if="phase === 'error'">
      <p class="error">{{ error }}</p>
      <button class="btn" @click="generate" :disabled="generating">重试</button>
    </template>

    <template v-if="phase === 'ready' && biography">
      <h1>{{ biography.title }}</h1>
      <p class="meta">Generated {{ formatDate(biography.generatedAt) }}</p>

      <div
        v-for="section in biography.sections"
        :key="section.id"
        class="section"
      >
        <h2 class="section-title">{{ section.title }}</h2>

        <div
          v-for="(para, pi) in section.paragraphs"
          :key="pi"
          :class="['paragraph', { conflict: para.conflict, removed: section.removed }]"
        >
          <div class="para-text">
            <template v-for="(part, qi) in splitQuotes(para.text)" :key="qi">
              <span v-if="part.quoted" class="quoted" :title="'证人原话'">{{ part.text }}</span>
              <span v-else>{{ part.text }}</span>
            </template>
          </div>
          <div v-if="para.attribution" class="attribution">
            -- {{ para.attribution.displayName }}
          </div>
        </div>

        <div v-if="!section.removed" class="section-actions">
          <button class="btn-small" @click="removeSection(section.id)">
            移除本节
          </button>
        </div>
      </div>

      <div v-if="biography.silenceNote" class="silence-note">
        <p>{{ biography.silenceNote }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bio-view {
  max-width: 680px;
  margin: 2rem auto;
  padding: 0 1rem;
  line-height: 1.7;
}
.disclaimer {
  font-size: 0.85rem;
  color: #64748b;
  border-left: 3px solid #e2e8f0;
  padding-left: 0.8rem;
  margin-bottom: 1.5rem;
}
.confidential-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
  color: #64748b;
  margin-bottom: 1rem;
  cursor: pointer;
}
.confidential-toggle input {
  margin: 0;
}
.meta {
  font-size: 0.85rem;
  color: #94a3b8;
  margin-bottom: 2rem;
}
.section {
  margin-bottom: 2.5rem;
}
.section-title {
  font-size: 1.15rem;
  font-weight: 600;
  margin-bottom: 0.8rem;
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 0.3rem;
}
.paragraph {
  margin-bottom: 1rem;
  padding: 0.6rem 0;
}
.paragraph.conflict {
  border-left: 3px solid #f59e0b;
  padding-left: 0.8rem;
  background: #fffbeb;
}
.paragraph.removed {
  opacity: 0.5;
  font-style: italic;
}
.para-text {
  font-size: 0.95rem;
  color: #1e293b;
}
.quoted {
  background: #f0f9ff;
  border-bottom: 1px dotted #3b82f6;
  cursor: help;
}
.attribution {
  font-size: 0.8rem;
  color: #64748b;
  margin-top: 0.2rem;
}
.section-actions {
  margin-top: 0.3rem;
}
.silence-note {
  margin-top: 2rem;
  padding: 1rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  color: #64748b;
  font-style: italic;
}
.btn {
  padding: 0.5rem 1.2rem;
  font-size: 0.9rem;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}
.btn.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-small {
  font-size: 0.75rem;
  padding: 0.2rem 0.6rem;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  background: #fff;
  color: #94a3b8;
  cursor: pointer;
}
.btn-small:hover { color: #dc2626; border-color: #fca5a5; }
.error { color: #dc2626; margin-bottom: 1rem; }
.muted { color: #94a3b8; }
</style>
