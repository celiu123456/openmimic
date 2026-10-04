<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError, api, type RoomPayload, type RoomUtterance } from '../api';
import {
  DOOR_WAIT_LINE,
  ReplayScheduler,
  behindHeadline,
  beginDoor,
  canPushDoor,
  canShowContrast,
  doorFailed,
  doorOpened,
  frontHeadline,
  hideContrast,
  initialDoorState,
  initialReplayState,
  isLinked,
  pairingKey,
  resolveSubjectName,
  showContrast,
  subjectNameFor,
  witnessTone,
  type DoorState,
  type ReplayState,
} from '../room';

/**
 * The room page: watch a conversation about someone who is not there, then
 * open the door and watch the same people say it differently.
 *
 * Layout decisions worth naming:
 * - The transcript is replayed, never dumped. `ReplayScheduler` owns the beat;
 *   this view only renders `visibleCount` lines and a typing indicator.
 * - The door is pure CSS. The view flips a `closing`/`opening` class and lets
 *   the panels move; `prefers-reduced-motion` turns that into a fade (styles.css).
 * - The contrast view is two static columns. Pairing is by witness id, so a
 *   hover on one side lights up the same person on the other.
 *
 * The room shows lines only. Testimony text has no entry point here on purpose:
 * the evidence chain is a later week's surface.
 */

type LoadPhase = 'loading' | 'missing' | 'error' | 'ready';
type DoorAnim = 'idle' | 'closing' | 'opening';

/** Keep the whole door beat under the 1.2s budget from the brief. */
const DOOR_CLOSE_MS = 460;
const DOOR_OPEN_MS = 520;
/** Reduced motion: the panels only fade, so the beat can be shorter. */
const REDUCED_DOOR_CLOSE_MS = 240;
const REDUCED_DOOR_OPEN_MS = 260;

const route = useRoute();
const roomId = computed(() => String(route.params.id ?? ''));

const phase = ref<LoadPhase>('loading');
const room = ref<RoomPayload | null>(null);

const door = ref<DoorState>(initialDoorState());
const doorAnim = ref<DoorAnim>('idle');
const doorError = ref('');
const frontReady = ref<RoomUtterance[]>([]);

const behindState = ref<ReplayState>(initialReplayState(0));
const frontState = ref<ReplayState>(initialReplayState(0));
let behindReplay: ReplayScheduler | null = null;
let frontReplay: ReplayScheduler | null = null;

/** Witness id whose lines are currently lit in the contrast view. */
const activeWitness = ref<string | null>(null);
const feedEnd = ref<HTMLElement | null>(null);

const subjectName = computed(() =>
  resolveSubjectName(
    (room.value as { subjectDisplayName?: string } | null)?.subjectDisplayName,
    room.value ? subjectNameFor(localStorage, room.value.subjectId) : undefined,
  ),
);

/** `behind` also covers the `opening` beat: the panels are still in the way. */
const mode = computed<'behind' | 'front' | 'contrast'>(() => {
  if (door.value.phase === 'contrast') return 'contrast';
  if (door.value.phase === 'front') return 'front';
  return 'behind';
});

const headline = computed(() =>
  mode.value === 'behind' ? behindHeadline(subjectName.value) : frontHeadline(subjectName.value),
);

const behindLines = computed(() => room.value?.behindTranscript ?? []);
const activeTranscript = computed(() =>
  mode.value === 'front' ? frontReady.value : behindLines.value,
);
const activeState = computed(() => (mode.value === 'front' ? frontState.value : behindState.value));
const visibleLines = computed(() =>
  activeTranscript.value.slice(0, activeState.value.visibleCount),
);
/** The line being "typed" right now, shown as a typing indicator. */
const typingLine = computed(() =>
  activeState.value.typing ? activeTranscript.value[activeState.value.visibleCount] : undefined,
);

const showSkip = computed(
  () => !activeState.value.finished && activeTranscript.value.length > 0,
);
const showDoorButton = computed(
  () =>
    door.value.phase === 'behind' &&
    behindState.value.finished &&
    behindLines.value.length > 0,
);
const showContrastButton = computed(
  () => canShowContrast(door.value) && frontState.value.finished && mode.value === 'front',
);
const showActions = computed(
  () => showSkip.value || showDoorButton.value || showContrastButton.value || doorError.value !== '',
);

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function scrollToLatest(): void {
  void nextTick(() => {
    const target = feedEnd.value;
    if (!target) return;
    try {
      target.scrollIntoView({ block: 'end', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } catch {
      target.scrollIntoView();
    }
  });
}

function startReplay(kind: 'behind' | 'front'): void {
  const total = kind === 'front' ? frontReady.value.length : behindLines.value.length;
  const stateRef = kind === 'front' ? frontState : behindState;
  const scheduler = new ReplayScheduler(total, {
    onUpdate: (state) => {
      stateRef.value = state;
      scrollToLatest();
    },
  });
  if (kind === 'front') {
    frontReplay?.stop();
    frontReplay = scheduler;
  } else {
    behindReplay?.stop();
    behindReplay = scheduler;
  }
  scheduler.start();
}

async function load(): Promise<void> {
  phase.value = 'loading';
  try {
    const fetched = await api.getRoom(roomId.value);
    room.value = fetched;
    phase.value = 'ready';
    startReplay('behind');
  } catch (caught) {
    phase.value = caught instanceof ApiError && caught.status === 404 ? 'missing' : 'error';
  }
}

function skipReplay(): void {
  if (mode.value === 'front') frontReplay?.skip();
  else behindReplay?.skip();
}

function describeDoorError(caught: unknown): string {
  if (caught instanceof ApiError && caught.status === 501) {
    return '这间房要等服务器配置好模型,门才推得开。';
  }
  if (caught instanceof ApiError && caught.status === 404) {
    return '这间房不在了。';
  }
  return '门没推开,稍后再试一次。';
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Push the door. The API answer and the animation run in parallel, so a slow
 * model never cuts the door beat short and a fast one never skips it.
 */
async function pushDoor(): Promise<void> {
  const current = room.value;
  if (!current || !canPushDoor(door.value)) return;

  door.value = beginDoor(door.value);
  doorError.value = '';

  const reduced = prefersReducedMotion();
  const closeMs = reduced ? REDUCED_DOOR_CLOSE_MS : DOOR_CLOSE_MS;
  const openMs = reduced ? REDUCED_DOOR_OPEN_MS : DOOR_OPEN_MS;

  doorAnim.value = 'closing';
  const request = api.openDoor(current.id).then(
    (opened) => ({ ok: true as const, opened }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  await delay(closeMs);
  const result = await request;

  if (!result.ok) {
    doorAnim.value = 'idle';
    door.value = doorFailed(door.value);
    doorError.value = describeDoorError(result.error);
    return;
  }

  frontReady.value = result.opened.frontTranscript ?? [];
  doorAnim.value = 'opening';
  await delay(openMs);

  doorAnim.value = 'idle';
  door.value = doorOpened(door.value);
  startReplay('front');
}

function openContrast(): void {
  if (!canShowContrast(door.value)) return;
  activeWitness.value = null;
  door.value = showContrast(door.value);
}

function closeContrast(): void {
  activeWitness.value = null;
  door.value = hideContrast(door.value);
}

function toggleActive(line: RoomUtterance): void {
  const key = pairingKey(line);
  if (key === null) return;
  activeWitness.value = activeWitness.value === key ? null : key;
}

onMounted(() => {
  void load();
});

onBeforeUnmount(() => {
  behindReplay?.stop();
  frontReplay?.stop();
});
</script>

<template>
  <div class="room-page">
    <header class="room-topline" :class="{ warm: mode !== 'behind' }">
      <p>{{ headline }}</p>
    </header>

    <main v-if="phase === 'loading'" class="room center">
      <p class="lede">正在开门……</p>
    </main>

    <main v-else-if="phase === 'missing'" class="room center">
      <p class="eyebrow">房间不存在</p>
      <h1 class="name">这间房不在了</h1>
      <p class="lede">它可能已经被清掉,或者链接抄错了一个字。</p>
    </main>

    <main v-else-if="phase === 'error'" class="room center">
      <h1 class="name">暂时进不去</h1>
      <p class="lede">网络好像出了点问题,稍后再试一次就好。</p>
      <button type="button" class="btn" @click="load">重试</button>
    </main>

    <template v-else>
      <main v-if="mode !== 'contrast'" class="room room-stage">
        <p class="topic-seed">话题:{{ room?.topicSeed }}</p>

        <section class="transcript" aria-live="polite">
          <template v-for="(line, index) in visibleLines" :key="`${mode}-${index}`">
            <p v-if="line.kind === 'stage'" class="stage-line">{{ line.text }}</p>
            <article
              v-else
              class="bubble"
              :class="[`tone-${witnessTone(line.witnessId)}`, mode === 'front' ? 'mode-front' : 'mode-behind']"
            >
              <span class="speaker">{{ line.displayLabel }}</span>
              <p class="bubble-text">{{ line.text }}</p>
            </article>
          </template>

          <p v-if="typingLine" class="typing" :class="`tone-${witnessTone(typingLine.witnessId)}`">
            <span class="typing-label">
              {{ typingLine.kind === 'stage' ? '……' : typingLine.displayLabel }}
            </span>
            <span class="typing-dots"><i /><i /><i /></span>
          </p>
        </section>
        <div ref="feedEnd" class="feed-end" />
      </main>

      <main v-else class="room room-contrast">
        <div class="contrast-intro">
          <h1 class="name">同一群人,两份转写</h1>
          <p class="muted">
            点一条台词,另一边同一个人说过的话会亮起来。舞台提示不配对——那不是谁说的话。
          </p>
        </div>

        <div class="contrast-grid">
          <section class="contrast-col">
            <header class="contrast-head">
              <span class="col-label cool">背后</span>
              <span class="col-note">{{ subjectName }} 不在场</span>
            </header>
            <template v-for="(line, index) in behindLines" :key="`cb-${index}`">
              <p v-if="line.kind === 'stage'" class="stage-line small">{{ line.text }}</p>
              <article
                v-else
                class="contrast-line mode-behind"
                :class="[
                  `tone-${witnessTone(line.witnessId)}`,
                  { linked: isLinked(line, activeWitness), dim: activeWitness !== null && !isLinked(line, activeWitness) },
                ]"
                @mouseenter="activeWitness = pairingKey(line)"
                @mouseleave="activeWitness = null"
                @click="toggleActive(line)"
              >
                <span class="speaker">{{ line.displayLabel }}</span>
                <p class="bubble-text">{{ line.text }}</p>
              </article>
            </template>
          </section>

          <section class="contrast-col">
            <header class="contrast-head">
              <span class="col-label warm">当面</span>
              <span class="col-note">{{ subjectName }} 推门进来之后</span>
            </header>
            <template v-for="(line, index) in frontReady" :key="`cf-${index}`">
              <p v-if="line.kind === 'stage'" class="stage-line small">{{ line.text }}</p>
              <article
                v-else
                class="contrast-line mode-front"
                :class="[
                  `tone-${witnessTone(line.witnessId)}`,
                  { linked: isLinked(line, activeWitness), dim: activeWitness !== null && !isLinked(line, activeWitness) },
                ]"
                @mouseenter="activeWitness = pairingKey(line)"
                @mouseleave="activeWitness = null"
                @click="toggleActive(line)"
              >
                <span class="speaker">{{ line.displayLabel }}</span>
                <p class="bubble-text">{{ line.text }}</p>
              </article>
            </template>
          </section>
        </div>

        <button type="button" class="btn ghost contrast-back" @click="closeContrast">
          回到当面
        </button>
      </main>
    </template>

    <div v-if="showActions" class="room-actions">
      <p v-if="doorError" class="error small">{{ doorError }}</p>
      <button v-if="showSkip" type="button" class="btn ghost" @click="skipReplay">
        跳到结尾
      </button>
      <button v-if="showDoorButton" type="button" class="btn primary door-btn" @click="pushDoor">
        推门进去
      </button>
      <button v-if="showContrastButton" type="button" class="btn" @click="openContrast">
        对照
      </button>
    </div>

    <div v-if="doorAnim !== 'idle'" class="door" :class="doorAnim">
      <div class="door-panel left" aria-hidden="true" />
      <div class="door-panel right" aria-hidden="true" />
      <p class="door-hint">{{ DOOR_WAIT_LINE }}</p>
    </div>
  </div>
</template>
