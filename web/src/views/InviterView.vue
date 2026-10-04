<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api';

/**
 * Single-user, self-hosted: there are no accounts, so the browser remembers
 * the one subject this operator created. Multi-tenancy belongs to W5.
 */
const SUBJECT_KEY = 'openmimic.inviter.subjectId';
const TOKEN_KEY = 'openmimic.inviter.token';
const POLL_MS = 10_000;

const displayName = ref('');
const subjectId = ref('');
const token = ref('');
const testimonyCount = ref(0);
const busy = ref(false);
const copied = ref(false);
const error = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

const link = computed(() =>
  token.value === '' ? '' : `${window.location.origin}/i/${token.value}`,
);

async function refreshProgress(): Promise<void> {
  if (subjectId.value === '') return;
  try {
    const progress = await api.getProgress(subjectId.value);
    testimonyCount.value = progress.testimonyCount;
  } catch {
    // Transient polling failures are not worth an error banner.
  }
}

function stopPolling(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function startPolling(): void {
  stopPolling();
  timer = setInterval(() => {
    void refreshProgress();
  }, POLL_MS);
}

async function create(): Promise<void> {
  const name = displayName.value.trim();
  if (name === '') {
    error.value = '先写一个称呼。';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const subject = await api.createSubject(name);
    const invite = await api.createInvite(subject.id);
    subjectId.value = subject.id;
    token.value = invite.token;
    localStorage.setItem(SUBJECT_KEY, subject.id);
    localStorage.setItem(TOKEN_KEY, invite.token);
    await refreshProgress();
    startPolling();
  } catch {
    error.value = '创建失败，请稍后再试。';
  } finally {
    busy.value = false;
  }
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(link.value);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    error.value = '复制失败，请手动长按选中链接。';
  }
}

onMounted(() => {
  subjectId.value = localStorage.getItem(SUBJECT_KEY) ?? '';
  token.value = localStorage.getItem(TOKEN_KEY) ?? '';
  if (subjectId.value !== '') {
    void refreshProgress();
    startPolling();
  }
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <main class="room">
    <p class="eyebrow">OpenMimic</p>
    <h1 class="name">发起一份讲述</h1>
    <p class="lede">
      写下一个人的称呼，生成一条链接，发给认识 TA 的人。每收到一份讲述，这里会更新一次。
    </p>

    <div class="stack" style="margin-top: 2.2rem">
      <div>
        <span class="label">TA 的称呼</span>
        <input
          v-model="displayName"
          class="input"
          type="text"
          placeholder="比如：林小满"
          @keyup.enter="create"
        />
      </div>
      <div class="row">
        <button type="button" class="btn primary" :disabled="busy" @click="create">
          {{ busy ? '正在生成……' : token === '' ? '生成邀请链接' : '重新生成一条链接' }}
        </button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <section v-if="token !== ''" style="margin-top: 2.4rem">
      <span class="label">把这条链接发出去</span>
      <p class="link">{{ link }}</p>
      <div class="row" style="margin-top: 0.8rem">
        <button type="button" class="btn" @click="copy">{{ copied ? '已复制' : '复制链接' }}</button>
      </div>
      <p class="progress-line" style="margin-top: 1.6rem">已收到 {{ testimonyCount }} 份讲述</p>
      <p class="muted" style="font-size: 0.82rem">每 10 秒自动刷新一次。</p>
    </section>
  </main>
</template>
