<script setup lang="ts">
/**
 * v4 chat-based interview view.
 *
 * Scrolling history, mic-first input, no ProgressDots / total / followup.
 * Bottom "end and submit" button, consent step reused from the old view.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  ApiError,
  api,
  type ConsentLevel,
  type ChatTurnPayload,
} from '../api';
import MicButton from '../components/MicButton.vue';

type Phase = 'loading' | 'invalid' | 'error' | 'chat' | 'submit' | 'done';

const RELATIONS = ['朋友', '同事', '家人', '其他'];

const props = defineProps<{ token: string; displayName: string }>();
const emit = defineEmits<{ (event: 'fallback'): void }>();

const phase = ref<Phase>('loading');
const sessionId = ref('');
const chatMode = ref<'informant' | 'self'>('informant');
const turns = ref<ChatTurnPayload[]>([]);
const asrReady = ref(false);
const busy = ref(false);
const inputText = ref('');
const chatError = ref('');
const submitError = ref('');
const submitting = ref(false);
const finalCount = ref(0);
const relationChoice = ref('');
const relationOther = ref('');
const consentLevel = ref<ConsentLevel>('synthesis_only');
const historyEl = ref<HTMLElement | null>(null);

const relation = computed(() =>
  relationChoice.value === '其他' ? relationOther.value.trim() : relationChoice.value.trim(),
);
const hasAnswers = computed(() =>
  turns.value.some((t) => t.role === 'user'),
);
const canSubmit = computed(() => hasAnswers.value && relation.value.length > 0);

function scrollToBottom(): void {
  void nextTick(() => {
    if (historyEl.value) {
      historyEl.value.scrollTop = historyEl.value.scrollHeight;
    }
  });
}

watch(turns, scrollToBottom, { deep: true });

async function probeAsr(): Promise<void> {
  try {
    asrReady.value = await api.checkAsrAvailable();
  } catch {
    asrReady.value = false;
  }
}

async function start(): Promise<void> {
  phase.value = 'loading';
  try {
    const result = await api.startChat(props.token);
    sessionId.value = result.sessionId;
    chatMode.value = result.mode ?? 'informant';
    turns.value = [
      {
        id: result.message.id,
        role: 'assistant',
        text: result.message.text,
        at: new Date().toISOString(),
      },
    ];
    phase.value = 'chat';
    void probeAsr();
    scrollToBottom();
  } catch (caught) {
    if (caught instanceof ApiError && (caught.status === 404 || caught.status === 501)) {
      // v4 not available — tell parent to fall back
      emit('fallback');
      return;
    }
    if (caught instanceof ApiError && caught.status === 410) {
      phase.value = 'invalid';
      return;
    }
    phase.value = 'error';
  }
}

async function recover(): Promise<void> {
  if (!sessionId.value) return;
  try {
    const history = await api.getChatHistory(sessionId.value);
    turns.value = history.turns;
    chatMode.value = (history.mode === 'self' ? 'self' : 'informant');
    phase.value = 'chat';
    scrollToBottom();
  } catch {
    // Recovery failed; start fresh
    void start();
  }
}

async function sendMessage(text: string, source?: 'text' | 'speech', asrConfidence?: number): Promise<void> {
  if (!text.trim() || busy.value) return;
  busy.value = true;
  chatError.value = '';

  // Optimistically add user turn
  const userTurn: ChatTurnPayload = {
    id: `local-${Date.now()}`,
    role: 'user',
    text: text.trim(),
    at: new Date().toISOString(),
  };
  turns.value = [...turns.value, userTurn];
  inputText.value = '';
  scrollToBottom();

  try {
    const result = await api.sayChat(sessionId.value, text.trim(), source, asrConfidence);
    if (result.confirm) {
      // Low confidence — remove the optimistic turn and show confirmation
      turns.value = turns.value.filter((t) => t.id !== userTurn.id);
      chatError.value = `没太听清，您是说：${result.confirm.text}`;
      inputText.value = result.confirm.text;
      return;
    }
    if (result.message) {
      turns.value = [
        ...turns.value,
        {
          id: result.message.id,
          role: 'assistant',
          text: result.message.text,
          at: new Date().toISOString(),
        },
      ];
    }
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 503) {
      // Generation failed — remove the optimistic user turn
      turns.value = turns.value.filter((t) => t.id !== userTurn.id);
      chatError.value = '稍等再试';
      inputText.value = text.trim();
      return;
    }
    // Remove optimistic turn on other errors too
    turns.value = turns.value.filter((t) => t.id !== userTurn.id);
    chatError.value = '发送失败，请再试一次';
    inputText.value = text.trim();
  } finally {
    busy.value = false;
    scrollToBottom();
  }
}

function onSubmitInput(): void {
  void sendMessage(inputText.value, 'text');
}

function onSpeechText(text: string): void {
  void sendMessage(text, 'speech');
}

function goToSubmit(): void {
  phase.value = 'submit';
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const result = await api.finishChat(
      sessionId.value,
      consentLevel.value,
      relation.value,
    );
    finalCount.value = result.count;
    phase.value = 'done';
  } catch (caught) {
    submitError.value =
      caught instanceof ApiError && caught.status === 410
        ? '会话已过期'
        : '提交失败，请稍后再试';
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  // Try to recover an existing session from sessionStorage
  const savedSid = sessionStorage.getItem(`openmimic.chat.sid.${props.token}`);
  if (savedSid) {
    sessionId.value = savedSid;
    void recover();
  } else {
    void start();
  }
});

watch(sessionId, (sid) => {
  if (sid) {
    sessionStorage.setItem(`openmimic.chat.sid.${props.token}`, sid);
  }
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
      它可能已经过期，或者被撤销了。
    </p>
  </main>

  <main v-else-if="phase === 'error'" class="room center">
    <h1 class="name">暂时打不开</h1>
    <p class="lede">网络好像出了点问题，稍后再试一次就好。</p>
    <button type="button" class="btn" @click="start">重试</button>
  </main>

  <main v-else-if="phase === 'chat'" class="room chat-room">
    <p class="eyebrow">{{ chatMode === 'self' ? '聊聊你自己' : `聊聊 ${displayName}` }}</p>

    <div ref="historyEl" class="chat-history">
      <div
        v-for="turn in turns"
        :key="turn.id"
        class="chat-bubble"
        :class="turn.role === 'assistant' ? 'bubble-left' : 'bubble-right'"
      >
        <span class="bubble-label">{{ turn.role === 'assistant' ? '访谈员' : '你' }}</span>
        <p class="bubble-text">{{ turn.text }}</p>
      </div>
      <div v-if="busy" class="chat-bubble bubble-left">
        <span class="bubble-label">访谈员</span>
        <p class="bubble-text thinking">正在想……</p>
      </div>
    </div>

    <p v-if="chatError" class="error small chat-error">{{ chatError }}</p>

    <div class="chat-input">
      <MicButton
        v-if="asrReady"
        :disabled="busy"
        @text="onSpeechText"
        @unavailable="asrReady = false"
      />
      <input
        v-model="inputText"
        type="text"
        class="input chat-text-input"
        placeholder="输入你的回答"
        :disabled="busy"
        @keydown.enter="onSubmitInput"
      />
      <button
        type="button"
        class="btn primary chat-send"
        :disabled="busy || inputText.trim() === ''"
        @click="onSubmitInput"
      >
        发送
      </button>
    </div>

    <button
      type="button"
      class="btn ghost chat-finish"
      :disabled="busy || !hasAnswers"
      @click="goToSubmit"
    >
      结束并提交
    </button>
  </main>

  <main v-else-if="phase === 'submit'" class="room">
    <p class="eyebrow">最后一步</p>
    <h1 class="prompt">确认提交</h1>

    <div style="margin-bottom: 1rem">
      <span class="label">你们是什么关系？</span>
      <div class="relations">
        <button
          v-for="r in RELATIONS"
          :key="r"
          type="button"
          class="chip"
          :class="{ active: relationChoice === r }"
          @click="relationChoice = r"
        >
          {{ r }}
        </button>
      </div>
      <input
        v-if="relationChoice === '其他'"
        v-model="relationOther"
        class="input"
        type="text"
        placeholder="比如：房东、球友"
        style="margin-bottom: 1.2rem"
      />
    </div>

    <h2 class="prompt" style="font-size: 1rem">你的话，可以怎么用？</h2>
    <div class="cards">
      <button
        type="button"
        class="card"
        :class="{ active: consentLevel === 'synthesis_only' }"
        @click="consentLevel = 'synthesis_only'"
      >
        <span class="card-title">只参与合成，原话不露出</span>
        <span class="card-note">你的原话只用来理解 TA，不会以原文出现在任何地方。（默认）</span>
      </button>
      <button
        type="button"
        class="card"
        :class="{ active: consentLevel === 'quotable' }"
        @click="consentLevel = 'quotable'"
      >
        <span class="card-title">原话可展示</span>
        <span class="card-note">允许在需要时直接引用你的原话。</span>
      </button>
    </div>

    <p class="honesty">
      提交后就不能再改了：这份讲述会以「只追加」的方式进入账本。
    </p>
    <p v-if="submitError" class="error">{{ submitError }}</p>
    <div class="row">
      <button type="button" class="btn" @click="phase = 'chat'">继续聊</button>
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

<style scoped>
.chat-room {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  max-height: 100dvh;
  padding-bottom: 0;
}

.chat-history {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 0;
  -webkit-overflow-scrolling: touch;
}

.chat-bubble {
  margin-bottom: 0.75rem;
  max-width: 85%;
}

.bubble-left {
  margin-right: auto;
}

.bubble-right {
  margin-left: auto;
  text-align: right;
}

.bubble-label {
  font-size: 0.75rem;
  opacity: 0.5;
  display: block;
  margin-bottom: 0.2rem;
}

.bubble-text {
  display: inline-block;
  padding: 0.6rem 1rem;
  border-radius: 1rem;
  background: var(--surface, #f0f0f0);
  text-align: left;
  line-height: 1.5;
  word-break: break-word;
}

.bubble-right .bubble-text {
  background: var(--primary-light, #e3e8ff);
}

.thinking {
  opacity: 0.6;
  font-style: italic;
}

.chat-error {
  text-align: center;
  margin: 0.3rem 0;
}

.chat-input {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 0;
  border-top: 1px solid var(--border, #e0e0e0);
}

.chat-text-input {
  flex: 1;
  min-width: 0;
}

.chat-send {
  flex-shrink: 0;
}

.chat-finish {
  text-align: center;
  margin: 0.25rem 0 0.75rem;
  font-size: 0.85rem;
  opacity: 0.7;
}
</style>
