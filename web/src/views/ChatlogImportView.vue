<script setup lang="ts">
/**
 * Chat log import view.
 *
 * Two-step flow: preview (parse & see senders) → import (pick self → see results).
 * Privacy notice: chat records travel only between the user's device and this server;
 * only the designated person's own words are stored.
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, getAdminToken } from '../api';

const route = useRoute();
const router = useRouter();
const subjectId = computed(() => route.params.id as string);

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

// Input
const inputMode = ref<'paste' | 'file'>('paste');
const pastedContent = ref('');
const fileContent = ref('');
const fileName = ref('');

// Preview
const previewing = ref(false);
const previewResult = ref<any>(null);
const previewError = ref('');

// Import
const selectedSenders = ref<Set<string>>(new Set());
const importing = ref(false);
const importResult = ref<any>(null);
const importError = ref('');

// History
const imports = ref<any[]>([]);
const historyLoading = ref(false);

/* ------------------------------------------------------------------ */
/* Computed                                                            */
/* ------------------------------------------------------------------ */

const content = computed(() =>
  inputMode.value === 'paste' ? pastedContent.value : fileContent.value,
);

const canPreview = computed(() => content.value.trim().length > 0);
const canImport = computed(() => selectedSenders.value.size > 0 && previewResult.value);

/* ------------------------------------------------------------------ */
/* File handling                                                       */
/* ------------------------------------------------------------------ */

function onFileSelect(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  fileName.value = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    fileContent.value = reader.result as string;
    // Auto-preview on file select
    void doPreview();
  };
  reader.readAsText(file, 'utf-8');
}

/* ------------------------------------------------------------------ */
/* Minimal request helper (chatlog routes are not in the shared API)    */
/* ------------------------------------------------------------------ */

async function chatlogRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const adminToken = getAdminToken();
  if (adminToken) headers['authorization'] = `Bearer ${adminToken}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  init.headers = headers;
  const response = await fetch(path, init);
  const text = await response.text();
  const parsed = text.trim() ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const err = parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)
      ? (parsed as Record<string, unknown>).error as Record<string, unknown>
      : {};
    throw new ApiError(
      response.status,
      typeof err.code === 'string' ? err.code : 'request_failed',
      typeof err.message === 'string' ? err.message : '请求失败',
    );
  }
  return parsed as T;
}

/* ------------------------------------------------------------------ */
/* API calls                                                           */
/* ------------------------------------------------------------------ */

async function doPreview(): Promise<void> {
  if (!canPreview.value) return;
  previewing.value = true;
  previewError.value = '';
  previewResult.value = null;
  selectedSenders.value = new Set();
  importResult.value = null;

  try {
    const res = await chatlogRequest('POST', `/api/subjects/${subjectId.value}/chatlog/preview`, {
      content: content.value,
    });
    previewResult.value = res;
  } catch (err) {
    previewError.value = err instanceof ApiError ? err.message : '预览失败';
  } finally {
    previewing.value = false;
  }
}

function toggleSender(name: string): void {
  const next = new Set(selectedSenders.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  selectedSenders.value = next;
}

async function doImport(): Promise<void> {
  if (!canImport.value) return;
  importing.value = true;
  importError.value = '';
  importResult.value = null;

  try {
    const res = await chatlogRequest('POST', `/api/subjects/${subjectId.value}/chatlog/import`, {
      content: content.value,
      selfNames: Array.from(selectedSenders.value),
    });
    importResult.value = res;
    void loadHistory();
  } catch (err) {
    importError.value = err instanceof ApiError ? err.message : '导入失败';
  } finally {
    importing.value = false;
  }
}

async function loadHistory(): Promise<void> {
  historyLoading.value = true;
  try {
    const res = await chatlogRequest<{ imports: unknown[] }>('GET', `/api/subjects/${subjectId.value}/chatlog/imports`);
    imports.value = res.imports ?? [];
  } catch {
    // Non-critical
  } finally {
    historyLoading.value = false;
  }
}

async function deleteImport(importId: string): Promise<void> {
  try {
    await chatlogRequest('DELETE', `/api/subjects/${subjectId.value}/chatlog/imports/${importId}`);
    void loadHistory();
  } catch {
    // Swallow
  }
}

function goBack(): void {
  void router.push({ name: 'inviter' });
}

/* ------------------------------------------------------------------ */
/* Format helpers                                                      */
/* ------------------------------------------------------------------ */

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

onMounted(() => {
  void loadHistory();
});
</script>

<template>
  <main class="room">
    <button type="button" class="btn back-btn" @click="goBack">&larr; 返回</button>

    <h1 class="name">导入聊天记录</h1>
    <p class="lede">
      把你和 TA 的聊天记录粘贴进来或选择文件,系统会解析出 TA 说过的原话,放进语料箱。
    </p>
    <p class="privacy-note">
      聊天记录只在你的设备与这台服务器之间传输;服务器只保存被你指认为 TA 本人说的话。
      导入的聊天记录只用于模仿用词、节奏与长度,不作为事实依据。
    </p>

    <!-- Input mode toggle -->
    <div class="tab-row">
      <button
        type="button"
        :class="['tab-btn', inputMode === 'paste' && 'active']"
        @click="inputMode = 'paste'"
      >
        粘贴文本
      </button>
      <button
        type="button"
        :class="['tab-btn', inputMode === 'file' && 'active']"
        @click="inputMode = 'file'"
      >
        选择文件
      </button>
    </div>

    <!-- Paste input -->
    <div v-if="inputMode === 'paste'" class="stack">
      <textarea
        v-model="pastedContent"
        class="textarea"
        rows="10"
        placeholder="粘贴聊天记录到这里&#10;&#10;支持微信 PC 端复制的文本、CSV、JSON 格式。&#10;格式会自动识别。"
      ></textarea>
    </div>

    <!-- File input -->
    <div v-if="inputMode === 'file'" class="stack">
      <label class="file-label">
        <input type="file" accept=".txt,.csv,.json" @change="onFileSelect" />
        <span class="btn">{{ fileName || '选择文件 (.txt / .csv / .json)' }}</span>
      </label>
    </div>

    <button
      type="button"
      class="btn primary"
      :disabled="!canPreview || previewing"
      @click="doPreview"
    >
      {{ previewing ? '正在解析...' : '预览' }}
    </button>
    <p v-if="previewError" class="error">{{ previewError }}</p>

    <!-- Preview result -->
    <section v-if="previewResult" class="preview-section">
      <h2>解析结果</h2>
      <div class="stat-row">
        <span class="stat">格式: {{ previewResult.format }}</span>
        <span class="stat">总消息: {{ previewResult.totalMessages }}</span>
        <span class="stat">文本消息: {{ previewResult.textMessages }}</span>
      </div>

      <!-- Denoise stats -->
      <div v-if="Object.keys(previewResult.denoiseStats).length > 0" class="denoise-stats">
        <span class="label">已过滤:</span>
        <span v-for="(count, type) in previewResult.denoiseStats" :key="type" class="stat-tag">
          {{ type }} {{ count }}
        </span>
      </div>

      <!-- Failed lines -->
      <div v-if="previewResult.failedLineCount > 0" class="warn-box">
        <p>{{ previewResult.failedLineCount }} 行未能解析。示例:</p>
        <ul>
          <li v-for="fl in previewResult.failedLines.slice(0, 5)" :key="fl.line">
            第 {{ fl.line }} 行: {{ fl.text }}
          </li>
        </ul>
      </div>

      <!-- Sender selection -->
      <h3>选择「TA 本人」的昵称</h3>
      <p class="muted small">勾选代表这个人的昵称(可多选别名)。其余人的消息不会入库。</p>
      <ul class="sender-list">
        <li
          v-for="sender in previewResult.senders"
          :key="sender.name"
          :class="['sender-item', selectedSenders.has(sender.name) && 'selected']"
          @click="toggleSender(sender.name)"
        >
          <span class="sender-check">{{ selectedSenders.has(sender.name) ? '✓' : '' }}</span>
          <span class="sender-name">{{ sender.name }}</span>
          <span class="sender-count">{{ sender.count }} 条</span>
        </li>
      </ul>

      <button
        type="button"
        class="btn primary"
        :disabled="!canImport || importing"
        @click="doImport"
      >
        {{ importing ? '正在导入...' : '导入到语料箱' }}
      </button>
      <p v-if="importError" class="error">{{ importError }}</p>
    </section>

    <!-- Import result -->
    <section v-if="importResult" class="result-section">
      <h2>导入完成</h2>
      <div class="stat-row">
        <span class="stat">入库: {{ importResult.imported }} 条</span>
        <span class="stat">TA 的总消息: {{ importResult.stats.selfTotal }}</span>
        <span class="stat">他人消息: {{ importResult.stats.othersTotal }} (已丢弃)</span>
      </div>
      <div class="stat-row">
        <span v-if="importResult.stats.tooLong" class="stat">过长排除: {{ importResult.stats.tooLong }}</span>
        <span v-if="importResult.stats.duplicatesRemoved" class="stat">去重: {{ importResult.stats.duplicatesRemoved }}</span>
        <span v-if="importResult.stats.injectionFlagged" class="stat">注入标记: {{ importResult.stats.injectionFlagged }}</span>
        <span v-if="importResult.stats.refluxExcluded" class="stat">回流排除: {{ importResult.stats.refluxExcluded }}</span>
      </div>

      <!-- Catchphrases -->
      <div v-if="importResult.stats.catchphrases?.length > 0" class="catchphrase-box">
        <span class="label">口头禅线索:</span>
        <span v-for="cp in importResult.stats.catchphrases" :key="cp.text" class="stat-tag">
          「{{ cp.text }}」&times;{{ cp.count }}
        </span>
      </div>

      <!-- Style profile -->
      <div v-if="importResult.styleProfile?.status === 'ok'" class="style-profile">
        <h3>风格画像预览</h3>
        <div class="stat-row">
          <span class="stat">长度中位数: {{ importResult.styleProfile.profile.power.medianLength }}</span>
          <span class="stat">p90: {{ importResult.styleProfile.profile.power.p90Length }}</span>
          <span class="stat">单句率: {{ Math.round(importResult.styleProfile.profile.power.singleSentenceRate * 100) }}%</span>
          <span class="stat">低功耗回复: {{ importResult.styleProfile.profile.power.allowsLowEffort ? '允许' : '不允许' }}</span>
        </div>
        <div v-if="importResult.styleProfile.profile.speech.commonPhrases?.length > 0" class="stat-row">
          <span class="label">高频短语:</span>
          <span v-for="cp in importResult.styleProfile.profile.speech.commonPhrases" :key="cp.phrase" class="stat-tag">
            {{ cp.phrase }} &times;{{ cp.count }}
          </span>
        </div>
      </div>
      <div v-else-if="importResult.styleProfile?.status === 'insufficient'" class="muted small">
        {{ importResult.styleProfile.reason }}
      </div>
    </section>

    <!-- Import history -->
    <section v-if="imports.length > 0" class="history-section">
      <h2>历次导入</h2>
      <ul class="import-list">
        <li v-for="imp in imports" :key="imp.id" class="import-item">
          <div class="import-meta">
            <span>{{ formatDate(imp.createdAt) }}</span>
            <span>{{ imp.format.toUpperCase() }}</span>
            <span>{{ imp.itemCount }} 条</span>
            <span>发送者: {{ imp.selfNames.join(', ') }}</span>
          </div>
          <button type="button" class="btn btn-small btn-danger" @click="deleteImport(imp.id)">
            撤回
          </button>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.privacy-note {
  margin: 1rem 0;
  padding: 0.8rem 1rem;
  background: var(--surface-2, #f5f5f0);
  border-left: 3px solid var(--accent, #6366f1);
  font-size: 0.85rem;
  color: var(--text-secondary, #666);
  line-height: 1.5;
}

.tab-row {
  display: flex;
  gap: 0;
  margin: 1.2rem 0 0.8rem;
}
.tab-btn {
  padding: 0.5rem 1.2rem;
  border: 1px solid var(--border, #ddd);
  background: none;
  cursor: pointer;
  font-size: 0.9rem;
}
.tab-btn.active {
  background: var(--accent, #6366f1);
  color: white;
  border-color: var(--accent, #6366f1);
}

.textarea {
  width: 100%;
  min-height: 180px;
  padding: 0.8rem;
  border: 1px solid var(--border, #ddd);
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.9rem;
  resize: vertical;
  box-sizing: border-box;
}

.file-label {
  display: block;
  cursor: pointer;
  margin: 0.5rem 0;
}
.file-label input[type="file"] {
  display: none;
}

.back-btn {
  margin-bottom: 0.8rem;
}

.preview-section, .result-section, .history-section {
  margin-top: 2rem;
  padding-top: 1.2rem;
  border-top: 1px solid var(--border, #eee);
}

.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  margin: 0.5rem 0;
}
.stat {
  font-size: 0.85rem;
  color: var(--text-secondary, #666);
}

.stat-tag {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  background: var(--surface-2, #f0f0e8);
  border-radius: 3px;
  font-size: 0.82rem;
  margin: 0.1rem 0;
}

.denoise-stats, .catchphrase-box {
  margin: 0.6rem 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}

.warn-box {
  margin: 0.6rem 0;
  padding: 0.6rem;
  background: #fff3cd;
  border-radius: 4px;
  font-size: 0.85rem;
}
.warn-box ul {
  margin: 0.3rem 0 0 1.2rem;
  padding: 0;
}

.sender-list {
  list-style: none;
  padding: 0;
  margin: 0.8rem 0;
}
.sender-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.8rem;
  border: 1px solid var(--border, #ddd);
  border-radius: 4px;
  margin-bottom: 0.4rem;
  cursor: pointer;
  transition: background 0.15s;
}
.sender-item:hover {
  background: var(--surface-2, #f5f5f0);
}
.sender-item.selected {
  background: var(--accent-light, #e8e8fd);
  border-color: var(--accent, #6366f1);
}
.sender-check {
  width: 1.2rem;
  text-align: center;
  font-weight: bold;
  color: var(--accent, #6366f1);
}
.sender-name {
  flex: 1;
  font-weight: 500;
}
.sender-count {
  font-size: 0.82rem;
  color: var(--text-secondary, #888);
}

.style-profile {
  margin-top: 1rem;
  padding: 0.8rem;
  background: var(--surface-2, #f5f5f0);
  border-radius: 4px;
}

.import-list {
  list-style: none;
  padding: 0;
}
.import-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--border, #eee);
}
.import-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  font-size: 0.85rem;
  color: var(--text-secondary, #666);
}
.btn-small {
  padding: 0.25rem 0.6rem;
  font-size: 0.82rem;
}
.btn-danger {
  color: #c53030;
  border-color: #c53030;
}
.btn-danger:hover {
  background: #fff5f5;
}

@media (max-width: 480px) {
  .stat-row {
    flex-direction: column;
    gap: 0.3rem;
  }
  .import-item {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
