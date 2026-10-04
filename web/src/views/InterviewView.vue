<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError, api, type ConsentLevel, type Questionnaire } from '../api';
import {
  clearDraft,
  emptyDraft,
  loadDraft,
  saveDraft,
  type InterviewDraft,
} from '../answers';
import {
  allResolved,
  answerFor,
  buildSubmission,
  canContinue,
  canStart,
  isFrontRevealed,
  isLastQuestion,
  questionAt,
  skipFront,
  updateBehind,
  updateFront,
} from '../interview';
import MicButton from '../components/MicButton.vue';
import ProgressDots from '../components/ProgressDots.vue';

type Phase = 'loading' | 'invalid' | 'error' | 'opening' | 'questions' | 'submit' | 'done';

const RELATIONS = ['朋友', '同事', '家人', '其他'];
/** Fixed opening line the product insists on; not configurable on purpose. */
const FIXED_LINE =
  'TA 看不到你此刻写的内容。说法冲突不用怕——矛盾本身就是信息。';

const route = useRoute();
const token = computed(() => String(route.params.token ?? ''));

const phase = ref<Phase>('loading');
const displayName = ref('');
const questionnaire = ref<Questionnaire | null>(null);
const draft = ref<InterviewDraft>(emptyDraft());
const asrReady = ref(false);
const submitting = ref(false);
const submitError = ref('');
const finalCount = ref(0);

const questions = computed(() => questionnaire.value?.questions ?? []);
const index = computed(() =>
  questionnaire.value ? questionAt(draft.value, questionnaire.value) : 0,
);
const current = computed(() => questions.value[index.value]);
const currentAnswer = computed(() => answerFor(draft.value, current.value?.qid ?? ''));
const last = computed(() =>
  questionnaire.value ? isLastQuestion(draft.value, questionnaire.value) : false,
);
const readyToSubmit = computed(() =>
  questionnaire.value ? allResolved(draft.value, questionnaire.value) : false,
);

watch(
  draft,
  (value) => {
    if (phase.value === 'opening' || phase.value === 'questions' || phase.value === 'submit') {
      saveDraft(sessionStorage, token.value, value);
    }
  },
  { deep: true },
);

async function probeAsr(): Promise<void> {
  try {
    asrReady.value = await api.checkAsrAvailable();
  } catch {
    // Speech is a convenience; its absence must never block the interview.
    asrReady.value = false;
  }
}

async function load(): Promise<void> {
  phase.value = 'loading';
  try {
    const invite = await api.fetchInvite(token.value);
    displayName.value = invite.subjectDisplayName;
    questionnaire.value = invite.questionnaire;
    draft.value = loadDraft(sessionStorage, token.value) ?? emptyDraft();
    phase.value = canStart(draft.value) ? 'questions' : 'opening';
    void probeAsr();
  } catch (caught) {
    phase.value = caught instanceof ApiError && caught.status === 410 ? 'invalid' : 'error';
  }
}

function chooseRelation(relation: string): void {
  draft.value = { ...draft.value, relationChoice: relation };
}

function chooseConsent(level: ConsentLevel): void {
  draft.value = { ...draft.value, consentLevel: level };
}

function startInterview(): void {
  if (!canStart(draft.value)) return;
  draft.value = { ...draft.value, currentIndex: 0 };
  phase.value = 'questions';
}

function setBehind(text: string): void {
  if (current.value) draft.value = updateBehind(draft.value, current.value.qid, text);
}

function appendBehind(text: string): void {
  const existing = currentAnswer.value.behindText;
  setBehind(existing.trim() === '' ? text : `${existing}\n${text}`);
}

function setFront(text: string): void {
  if (current.value) draft.value = updateFront(draft.value, current.value.qid, text);
}

function appendFront(text: string): void {
  const existing = currentAnswer.value.frontText;
  setFront(existing.trim() === '' ? text : `${existing}\n${text}`);
}

/** The explicit skip: a press, not an empty field. Pressing again undoes it. */
function toggleSkip(): void {
  if (!current.value) return;
  const qid = current.value.qid;
  draft.value = currentAnswer.value.frontSkipped
    ? updateFront(draft.value, qid, '')
    : skipFront(draft.value, qid);
}

function goPrev(): void {
  if (index.value > 0) draft.value = { ...draft.value, currentIndex: index.value - 1 };
}

function goNext(): void {
  if (!canContinue(currentAnswer.value)) return;
  if (last.value) {
    phase.value = 'submit';
    return;
  }
  draft.value = { ...draft.value, currentIndex: index.value + 1 };
}

async function submit(): Promise<void> {
  if (!questionnaire.value || !readyToSubmit.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const result = await api.submitTestimony(
      token.value,
      buildSubmission(draft.value, questionnaire.value),
    );
    finalCount.value = result.count;
    clearDraft(sessionStorage, token.value);
    phase.value = 'done';
  } catch (caught) {
    submitError.value =
      caught instanceof ApiError && caught.status === 410
        ? '这条链接已经失效了，这份讲述没能提交。'
        : '提交失败，请稍后再试一次。';
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <main v-if="phase === 'loading'" class="room center">
    <p class="lede">正在打开……</p>
  </main>

  <main v-else-if="phase === 'invalid'" class="room center">
    <p class="eyebrow">链接失效</p>
    <h1 class="name">这条链接打不开了</h1>
    <p class="lede">
      它可能已经过期，或者被撤销了。这不是你的问题；如果想要一份新的，去问问发给你的人。
    </p>
  </main>

  <main v-else-if="phase === 'error'" class="room center">
    <h1 class="name">暂时打不开</h1>
    <p class="lede">网络好像出了点问题，稍后再试一次就好。</p>
    <button type="button" class="btn" @click="load">重试</button>
  </main>

  <main v-else-if="phase === 'opening'" class="room center">
    <p class="eyebrow">写给 {{ displayName }}</p>
    <h1 class="name">{{ displayName }}</h1>
    <p class="quote">{{ FIXED_LINE }}</p>
    <div>
      <span class="label">你们是什么关系？</span>
      <div class="relations">
        <button
          v-for="relation in RELATIONS"
          :key="relation"
          type="button"
          class="chip"
          :class="{ active: draft.relationChoice === relation }"
          @click="chooseRelation(relation)"
        >
          {{ relation }}
        </button>
      </div>
      <input
        v-if="draft.relationChoice === '其他'"
        v-model="draft.relationOther"
        class="input"
        type="text"
        placeholder="比如：房东、球友"
        style="margin-bottom: 1.2rem"
      />
      <button
        type="button"
        class="btn primary"
        :disabled="!canStart(draft)"
        @click="startInterview"
      >
        开始
      </button>
    </div>
  </main>

  <main v-else-if="phase === 'questions' && current" class="room">
    <div class="progress">
      <span>第 {{ index + 1 }} / {{ questions.length }} 题</span>
      <ProgressDots :total="questions.length" :current="index" />
    </div>

    <h1 class="prompt">{{ current.prompt }}</h1>
    <p class="hint">{{ current.followupHint }}</p>
    <div class="answer">
      <textarea
        class="textarea"
        :value="currentAnswer.behindText"
        placeholder="想到什么写什么，具体的一件事最好。"
        @input="setBehind(($event.target as HTMLTextAreaElement).value)"
      />
      <MicButton v-if="asrReady" @text="appendBehind" @unavailable="asrReady = false" />
    </div>

    <section v-if="isFrontRevealed(currentAnswer)" class="front">
      <span class="label">{{ questionnaire?.frontPrompt }}</span>
      <div class="answer">
        <textarea
          class="textarea"
          :value="currentAnswer.frontText"
          :disabled="currentAnswer.frontSkipped"
          placeholder="当面说，你会怎么开口？"
          @input="setFront(($event.target as HTMLTextAreaElement).value)"
        />
        <MicButton
          v-if="asrReady && !currentAnswer.frontSkipped"
          @text="appendFront"
          @unavailable="asrReady = false"
        />
      </div>
      <div class="front-actions">
        <button
          type="button"
          class="btn ghost skip"
          :class="{ active: currentAnswer.frontSkipped }"
          @click="toggleSkip"
        >
          当面我不会说
        </button>
      </div>
      <p v-if="currentAnswer.frontSkipped" class="muted" style="font-size: 0.82rem">
        好，这一题不再追问。改主意就再点一下上面那个按钮。
      </p>
    </section>

    <div class="nav">
      <div class="inner">
        <button type="button" class="btn" :disabled="index === 0" @click="goPrev">上一题</button>
        <button
          type="button"
          class="btn primary"
          :disabled="!canContinue(currentAnswer)"
          @click="goNext"
        >
          {{ last ? '去确认' : '下一题' }}
        </button>
      </div>
    </div>
  </main>

  <main v-else-if="phase === 'submit'" class="room">
    <p class="eyebrow">最后一步</p>
    <h1 class="prompt">你的话，可以怎么用？</h1>
    <div class="cards">
      <button
        type="button"
        class="card"
        :class="{ active: draft.consentLevel === 'synthesis_only' }"
        @click="chooseConsent('synthesis_only')"
      >
        <span class="card-title">只参与合成，原话不露出</span>
        <span class="card-note">你的原话只用来理解 TA，不会以原文出现在任何地方。（默认）</span>
      </button>
      <button
        type="button"
        class="card"
        :class="{ active: draft.consentLevel === 'quotable' }"
        @click="chooseConsent('quotable')"
      >
        <span class="card-title">原话可展示</span>
        <span class="card-note">允许在需要时直接引用你的原话。</span>
      </button>
    </div>
    <p class="honesty">
      提交后就不能再改了：这份讲述会以「只追加」的方式进入账本，旧版本不会被覆盖。提交前，你还可以点「上一题」回去改。
    </p>
    <p v-if="submitError" class="error">{{ submitError }}</p>
    <div class="row">
      <button type="button" class="btn" @click="phase = 'questions'">上一题</button>
      <button
        type="button"
        class="btn primary"
        :disabled="submitting || !readyToSubmit"
        @click="submit"
      >
        {{ submitting ? '正在提交……' : '提交' }}
      </button>
    </div>
  </main>

  <main v-else-if="phase === 'done'" class="room center">
    <p class="eyebrow">收到了</p>
    <p class="count">{{ finalCount }}</p>
    <h1 class="name">你是第 {{ finalCount }} 位讲述者</h1>
    <p class="lede">
      谢谢你说这些。这些话会被好好收着，只用来更完整地理解 TA。
    </p>
  </main>
</template>
