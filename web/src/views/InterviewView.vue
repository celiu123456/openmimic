<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  ApiError,
  api,
  type ConsentLevel,
  type InterviewStepPayload,
  type Questionnaire,
} from '../api';
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
  skipQuestion,
  updateBehind,
  updateFollowup,
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
const busy = ref(false);
const submitError = ref('');
const stepError = ref('');
const finalCount = ref(0);

/**
 * The interviewer's follow-up currently on screen, if any. It is deliberately
 * separate from the question: the witness must answer it or skip it before the
 * interview moves on.
 */
const followup = ref('');
const followupQid = ref('');
const followupDraft = ref('');

/**
 * True when the session API is unavailable (an older server). The interview
 * then runs the plain question tree and submits through the direct endpoint —
 * exactly the W2b behaviour, with no follow-ups.
 */
const legacy = ref(false);

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
const hasAnswers = computed(() =>
  Object.values(draft.value.answers).some(
    (answer) => answer.behindText.trim().length > 0,
  ),
);
const canSubmit = computed(() => readyToSubmit.value && hasAnswers.value);
/** The question skip is offered only on the question not yet committed. */
const canSkipQuestion = computed(
  () => !followup.value && index.value >= draft.value.committedUpTo,
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

/** Open a server session once, tolerating a server that does not have the route. */
async function ensureSession(): Promise<void> {
  if (legacy.value || draft.value.sessionId !== '') return;
  try {
    const started = await api.startInterview(token.value);
    draft.value = { ...draft.value, sessionId: started.sessionId };
  } catch (caught) {
    if (
      caught instanceof ApiError &&
      (caught.status === 404 || caught.status === 405 || caught.status === 501)
    ) {
      legacy.value = true;
      return;
    }
    throw caught;
  }
}

/** Run one session call, reopening the session once if it has gone stale. */
async function withSession<T>(call: (sessionId: string) => Promise<T>): Promise<T> {
  await ensureSession();
  if (legacy.value || draft.value.sessionId === '') throw new ApiError(0, 'legacy', '降级模式');
  const sessionId = draft.value.sessionId;
  try {
    return await call(sessionId);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 410) {
      draft.value = { ...draft.value, sessionId: '' };
      await ensureSession();
      if (draft.value.sessionId !== '') return await call(draft.value.sessionId);
    }
    throw caught;
  }
}

function chooseRelation(relation: string): void {
  draft.value = { ...draft.value, relationChoice: relation };
}

function chooseConsent(level: ConsentLevel): void {
  draft.value = { ...draft.value, consentLevel: level };
}

async function startInterview(): Promise<void> {
  if (!canStart(draft.value)) return;
  draft.value = { ...draft.value, currentIndex: 0 };
  phase.value = 'questions';
  try {
    await ensureSession();
  } catch {
    // A failed open only means the first commit will surface the problem.
  }
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

/** The explicit front skip: a press, not an empty field. Pressing again undoes it. */
function toggleSkip(): void {
  if (!current.value) return;
  const qid = current.value.qid;
  draft.value = currentAnswer.value.frontSkipped
    ? updateFront(draft.value, qid, '')
    : skipFront(draft.value, qid);
}

/** Fold a step result back into the draft. */
function applyStep(step: InterviewStepPayload): void {
  followup.value = '';
  followupQid.value = '';
  followupDraft.value = '';
  if ('followup' in step) {
    followup.value = step.followup;
    followupQid.value = current.value?.qid ?? '';
    return;
  }
  if ('done' in step) {
    phase.value = 'submit';
    return;
  }
  draft.value = { ...draft.value, currentIndex: step.index };
}

function markCommitted(): void {
  draft.value = {
    ...draft.value,
    committedUpTo: Math.max(draft.value.committedUpTo, index.value + 1),
  };
}

function goNextLocal(): void {
  if (last.value) {
    phase.value = 'submit';
    return;
  }
  draft.value = { ...draft.value, currentIndex: index.value + 1 };
}

async function commitCurrent(): Promise<void> {
  const question = current.value;
  if (!question) return;
  const answer = currentAnswer.value;
  const qid = question.qid;
  busy.value = true;
  stepError.value = '';
  try {
    if (legacy.value) {
      markCommitted();
      goNextLocal();
      return;
    }
    const step = await withSession((sessionId) =>
      api.answerInterview(sessionId, {
        qid,
        text: answer.behindText.trim(),
        ...(answer.frontSkipped
          ? { frontSkipped: true }
          : answer.frontText.trim().length > 0
            ? { frontText: answer.frontText.trim() }
            : {}),
      }),
    );
    if ('followup' in step) {
      followup.value = step.followup;
      followupQid.value = qid;
      followupDraft.value = '';
      return;
    }
    markCommitted();
    applyStep(step);
  } catch {
    stepError.value = '刚才那句话没能送出去，请再试一次。';
  } finally {
    busy.value = false;
  }
}

function goNext(): void {
  if (busy.value || followup.value !== '') return;
  if (index.value < draft.value.committedUpTo) {
    // Already committed: this is review only; edits still travel at finish.
    goNextLocal();
    return;
  }
  if (!canContinue(currentAnswer.value)) return;
  void commitCurrent();
}

function goPrev(): void {
  if (busy.value || followup.value !== '') return;
  if (index.value > 0) draft.value = { ...draft.value, currentIndex: index.value - 1 };
}

/** The explicit "这题跳过": a silence signal, with no attempt to talk them out of it. */
async function skipThisQuestion(): Promise<void> {
  const question = current.value;
  if (!question || busy.value || followup.value !== '') return;
  const qid = question.qid;
  draft.value = skipQuestion(draft.value, qid);
  busy.value = true;
  stepError.value = '';
  try {
    if (legacy.value) {
      markCommitted();
      goNextLocal();
      return;
    }
    const step = await withSession((sessionId) =>
      api.answerInterview(sessionId, { qid, skip: true }),
    );
    markCommitted();
    applyStep(step);
  } catch {
    stepError.value = '这题没能跳过去，请再试一次。';
  } finally {
    busy.value = false;
  }
}

async function sendFollowup(text: string | undefined): Promise<void> {
  const qid = followupQid.value;
  if (qid === '' || busy.value) return;
  busy.value = true;
  stepError.value = '';
  try {
    const step = await withSession((sessionId) =>
      api.answerInterviewFollowup(
        sessionId,
        text === undefined ? { skip: true } : { text },
      ),
    );
    if (text !== undefined && text.trim().length > 0) {
      draft.value = updateFollowup(draft.value, qid, text.trim());
    }
    markCommitted();
    applyStep(step);
  } catch {
    stepError.value = '这句话没能送出去，请再试一次。';
  } finally {
    busy.value = false;
  }
}

function skipFollowup(): void {
  void sendFollowup(undefined);
}

async function submit(): Promise<void> {
  if (!questionnaire.value || !canSubmit.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const payload = buildSubmission(draft.value, questionnaire.value);
    let result;
    if (legacy.value || draft.value.sessionId === '') {
      result = await api.submitTestimony(token.value, payload);
    } else {
      try {
        result = await api.finishInterview(draft.value.sessionId, payload);
      } catch (caught) {
        // The session is gone or the route predates this batch: fall back to
        // the direct intake with exactly the same words.
        if (
          caught instanceof ApiError &&
          (caught.status === 410 || caught.status === 404 || caught.status === 501)
        ) {
          result = await api.submitTestimony(token.value, payload);
        } else {
          throw caught;
        }
      }
    }
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
          placeholder="如果他就坐在你对面,你会怎么对他说？"
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

    <section v-if="followup" class="interviewer">
      <span class="interviewer-label">访谈员</span>
      <p class="interviewer-text">{{ followup }}</p>
      <textarea
        v-model="followupDraft"
        class="textarea"
        placeholder="想得起来就说一件具体的事；想不起来也没关系。"
      />
      <div class="interviewer-actions">
        <button type="button" class="btn ghost skip" :disabled="busy" @click="skipFollowup">
          跳过这个
        </button>
        <button
          type="button"
          class="btn primary"
          :disabled="busy || followupDraft.trim() === ''"
          @click="sendFollowup(followupDraft)"
        >
          回答
        </button>
      </div>
    </section>

    <p v-if="stepError" class="error small">{{ stepError }}</p>

    <div class="nav">
      <div class="inner">
        <button
          type="button"
          class="btn"
          :disabled="index === 0 || busy || followup !== ''"
          @click="goPrev"
        >
          上一题
        </button>
        <button
          v-if="canSkipQuestion"
          type="button"
          class="linkish"
          :disabled="busy"
          @click="skipThisQuestion"
        >
          这题跳过
        </button>
        <button
          type="button"
          class="btn primary"
          :disabled="busy || followup !== '' || !canContinue(currentAnswer)"
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
    <p v-if="readyToSubmit && !hasAnswers" class="muted small">
      每题都跳过了，就没有可提交的内容。至少留下一句，或者先回去补一题。
    </p>
    <p v-if="submitError" class="error">{{ submitError }}</p>
    <div class="row">
      <button type="button" class="btn" @click="phase = 'questions'">上一题</button>
      <button
        type="button"
        class="btn primary"
        :disabled="submitting || !canSubmit"
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
