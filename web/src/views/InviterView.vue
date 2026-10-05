<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  ApiError,
  api,
  type RoomPayload,
  type CoverageResponse,
  type DimensionCoveragePayload,
} from '../api';
import { rememberSubjectName, subjectNameFor } from '../room';

/**
 * Single-user, self-hosted: there are no accounts, so the browser remembers
 * the one subject this operator created. Multi-tenancy belongs to W5.
 */
const SUBJECT_KEY = 'openmimic.inviter.subjectId';
const TOKEN_KEY = 'openmimic.inviter.token';
const POLL_MS = 10_000;
/** The pre-seeded demo persona; the key-less install always has it. */
const DEMO_SUBJECT_ID = 'limo';
const DEMO_DISPLAY_NAME = '林默';
/** A room needs enough material to be worth opening. */
const ROOM_THRESHOLD = 3;

const router = useRouter();

const displayName = ref('');
const subjectName = ref('');
const subjectId = ref('');
const token = ref('');
const shortCode = ref('');
const testimonyCount = ref(0);
const rooms = ref<RoomPayload[]>([]);
const coverage = ref<DimensionCoveragePayload[]>([]);
const relationAdvice = ref('');
const busy = ref(false);
const copied = ref(false);
const copiedShort = ref(false);
const error = ref('');
const demoBusy = ref(false);
const demoNote = ref('');
const roomBusy = ref(false);
const roomNeedsKey = ref(false);
const roomError = ref('');
const courtBusy = ref(false);
const courtNeedsKey = ref(false);
const courtError = ref('');
const courtDone = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const link = computed(() =>
  token.value === '' ? '' : `${window.location.origin}/i/${token.value}`,
);
const shortLink = computed(() =>
  shortCode.value === '' ? '' : `${window.location.origin}/i/${shortCode.value}`,
);
const canOpenRoom = computed(
  () => subjectId.value !== '' && testimonyCount.value >= ROOM_THRESHOLD,
);
const roomsNewestFirst = computed(() =>
  [...rooms.value].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
);

function activeName(): string {
  return subjectName.value.trim() !== '' ? subjectName.value.trim() : displayName.value.trim();
}

async function refreshRooms(): Promise<void> {
  if (subjectId.value === '') return;
  try {
    rooms.value = await api.getSubjectRooms(subjectId.value);
  } catch {
    // Keep whatever list we already had.
  }
}

async function refreshProgress(): Promise<void> {
  if (subjectId.value === '') return;
  try {
    const progress = await api.getProgress(subjectId.value);
    testimonyCount.value = progress.testimonyCount;
  } catch {
    // Transient polling failures are not worth an error banner.
  }
  await refreshRooms();
  await refreshCoverage();
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
    subjectName.value = name;
    token.value = invite.token;
    shortCode.value = invite.shortCode ?? '';
    localStorage.setItem(SUBJECT_KEY, subject.id);
    localStorage.setItem(TOKEN_KEY, invite.token);
    rememberSubjectName(localStorage, subject.id, name);
    await refreshProgress();
    void refreshCoverage();
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

async function copyShort(): Promise<void> {
  try {
    await navigator.clipboard.writeText(shortLink.value);
    copiedShort.value = true;
    window.setTimeout(() => {
      copiedShort.value = false;
    }, 2000);
  } catch {
    error.value = '复制失败，请手动长按选中链接。';
  }
}

async function refreshCoverage(): Promise<void> {
  if (subjectId.value === '') return;
  try {
    const result = await api.getCoverage(subjectId.value);
    coverage.value = result.coverage.dimensions;
    relationAdvice.value = result.relationAdvice?.message ?? '';
  } catch {
    // Coverage is optional — swallow errors silently.
  }
}

/** The demo door: 林默's room already exists on a key-less server. */
async function enterDemoRoom(): Promise<void> {
  if (demoBusy.value) return;
  demoBusy.value = true;
  demoNote.value = '';
  try {
    let found = await api.getSubjectRooms(DEMO_SUBJECT_ID);
    if (found.length === 0) {
      const created = await api.createRoom(DEMO_SUBJECT_ID);
      found = [created];
    }
    const room = found[found.length - 1];
    if (!room) {
      demoNote.value = '演示房间还没准备好。';
      return;
    }
    await router.push({
      name: 'room',
      params: { id: room.id },
      query: { name: DEMO_DISPLAY_NAME },
    });
  } catch {
    demoNote.value = '演示房间还没准备好。';
  } finally {
    demoBusy.value = false;
  }
}

/** Open a room for this operator's own subject. */
async function openOwnRoom(): Promise<void> {
  if (!canOpenRoom.value || roomBusy.value || roomNeedsKey.value) return;
  roomBusy.value = true;
  roomError.value = '';
  try {
    await api.createRoom(subjectId.value);
    await refreshRooms();
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 501) {
      // No model configured: the button goes grey and says why.
      roomNeedsKey.value = true;
    } else {
      roomError.value = '这间房没开成，稍后再试一次。';
    }
  } finally {
    roomBusy.value = false;
  }
}

/** Run the court to process testimonies. */
async function runCourt(): Promise<void> {
  if (!canOpenRoom.value || courtBusy.value || courtNeedsKey.value) return;
  courtBusy.value = true;
  courtError.value = '';
  try {
    await api.runCourt(subjectId.value);
    courtDone.value = true;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 501) {
      courtNeedsKey.value = true;
    } else {
      courtError.value = '法庭没能开成,稍后再试。';
    }
  } finally {
    courtBusy.value = false;
  }
}

function goToCourtReport(): void {
  void router.push({ name: 'court-report', params: { id: subjectId.value } });
}

function goToMetaPerception(): void {
  void router.push({ name: 'meta-perception', params: { id: subjectId.value } });
}

function goToBiography(): void {
  void router.push({ name: 'biography', params: { id: subjectId.value } });
}

function goToChatlogImport(): void {
  void router.push({ name: 'chatlog-import', params: { id: subjectId.value } });
}

function enterRoom(room: RoomPayload): void {
  const name = activeName();
  void router.push({
    name: 'room',
    params: { id: room.id },
    query: name === '' ? {} : { name },
  });
}

function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function roomStatusLabel(room: RoomPayload): string {
  return room.status === 'door_opened' ? '已推门' : '只有背后';
}

onMounted(() => {
  subjectId.value = localStorage.getItem(SUBJECT_KEY) ?? '';
  token.value = localStorage.getItem(TOKEN_KEY) ?? '';
  subjectName.value = subjectNameFor(localStorage, subjectId.value) ?? '';
  if (subjectId.value !== '') {
    void refreshProgress();
    startPolling();
  }
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <main class="room">
    <section class="demo-card">
      <p class="eyebrow">不配置模型也能看</p>
      <h2 class="demo-title">先看看别人的房间</h2>
      <p class="demo-note">林默，28 岁，刚裸辞。六个认识他的人正在聊他。</p>
      <button type="button" class="btn primary" :disabled="demoBusy" @click="enterDemoRoom">
        {{ demoBusy ? '正在推门……' : '走进这间房' }}
      </button>
      <p v-if="demoNote" class="muted small">{{ demoNote }}</p>
    </section>

    <p class="eyebrow" style="margin-top: 2.6rem">OpenMimic</p>
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
      <div v-if="shortCode !== ''" style="margin-top: 1rem">
        <span class="label">短码（口头传达更方便）</span>
        <p class="link short-code">{{ shortCode }}</p>
        <p class="muted small">{{ shortLink }}</p>
        <div class="row" style="margin-top: 0.4rem">
          <button type="button" class="btn" @click="copyShort">{{ copiedShort ? '已复制' : '复制短链' }}</button>
        </div>
      </div>
      <p class="progress-line" style="margin-top: 1.6rem">已收到 {{ testimonyCount }} 份讲述</p>
      <p class="muted small">每 10 秒自动刷新一次。</p>
    </section>

    <section v-if="coverage.length > 0" class="coverage-panel">
      <span class="label">维度覆盖</span>
      <p v-if="relationAdvice" class="muted small" style="margin-bottom: 0.8rem">{{ relationAdvice }}</p>
      <ul class="coverage-list">
        <li v-for="dim in coverage" :key="dim.dimensionId" class="coverage-item">
          <span class="coverage-dim">{{ dim.label }}</span>
          <span :class="['coverage-state', `state-${dim.state}`]">
            {{ { untouched: '未触及', shallow: '浅层', covered: '已覆盖', cautious: '需谨慎' }[dim.state] }}
          </span>
          <span class="coverage-meta">{{ dim.witnessCount }} 人提及</span>
        </li>
      </ul>
    </section>

    <section v-if="subjectId !== ''" class="room-panel">
      <div class="room-panel-head">
        <span class="label" style="margin: 0">房间</span>
        <button
          type="button"
          class="btn"
          :disabled="!canOpenRoom || roomBusy || roomNeedsKey"
          @click="openOwnRoom"
        >
          {{ roomBusy ? '正在开房……' : '开一间房' }}
        </button>
      </div>
      <p v-if="!canOpenRoom" class="muted small">
        收满 {{ ROOM_THRESHOLD }} 份讲述后可以开一间房。现在有 {{ testimonyCount }} 份。
      </p>
      <p v-else-if="roomNeedsKey" class="muted small">
        需要配置模型：服务器还没有语言模型，暂时开不了新房间。
      </p>
      <p v-if="roomError" class="error small">{{ roomError }}</p>

      <ul v-if="roomsNewestFirst.length > 0" class="room-list">
        <li v-for="room in roomsNewestFirst" :key="room.id">
          <button type="button" class="room-list-item" @click="enterRoom(room)">
            <span class="room-list-title">
              {{ room.topicSeed || '最近怎么看 TA' }}
            </span>
            <span class="room-list-meta">
              {{ formatTime(room.createdAt) }} · {{ roomStatusLabel(room) }} ·
              背后 {{ room.behindTranscript.length }} 条<span
                v-if="room.frontTranscript"
              >
                · 当面 {{ room.frontTranscript.length }} 条</span
              >
            </span>
          </button>
        </li>
      </ul>
      <p v-else-if="canOpenRoom" class="muted small">还没有房间。开一间，看看他们背后怎么说。</p>
    </section>

    <section v-if="subjectId !== '' && canOpenRoom" class="court-panel">
      <div class="room-panel-head">
        <span class="label" style="margin: 0">法庭与报告</span>
        <div class="row" style="gap: 0.5rem">
          <button
            type="button"
            class="btn"
            :disabled="courtBusy || courtNeedsKey"
            @click="runCourt"
          >
            {{ courtBusy ? '正在开审……' : '开审' }}
          </button>
          <button type="button" class="btn" @click="goToCourtReport">查看报告</button>
          <button type="button" class="btn" @click="goToMetaPerception">元知觉</button>
          <button type="button" class="btn" @click="goToBiography">Biography</button>
          <button type="button" class="btn" @click="goToChatlogImport">导入聊天记录</button>
        </div>
      </div>
      <p v-if="courtNeedsKey" class="muted small">
        需要配置模型：服务器还没有语言模型，法庭暂时开不了。
      </p>
      <p v-if="courtDone" class="muted small">法庭已结束，点「查看报告」看结果。</p>
      <p v-if="courtError" class="error small">{{ courtError }}</p>
    </section>
  </main>
</template>
