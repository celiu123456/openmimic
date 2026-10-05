<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { ApiError, api } from '../api';

const props = defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ (event: 'text', text: string): void; (event: 'unavailable'): void }>();

const recording = ref(false);
const busy = ref(false);
const error = ref('');

/**
 * v3: low-confidence confirmation state. When the ASR returns a
 * low-confidence transcription, we show the text and ask the witness
 * to confirm or re-type before it enters the answer field.
 */
const pendingConfirmation = ref('');
const lowConfidenceCount = ref(0);

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];

function releaseStream(): void {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

async function start(): Promise<void> {
  error.value = '';
  pendingConfirmation.value = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    error.value = '无法访问麦克风';
    return;
  }
  chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => {
    void finish();
  };
  recorder.start();
  recording.value = true;
}

async function finish(): Promise<void> {
  const type = recorder?.mimeType || 'audio/webm';
  releaseStream();
  recorder = null;
  recording.value = false;
  busy.value = true;
  try {
    const result = await api.transcribe(new Blob(chunks, { type }));
    if (result.text.trim() === '') return;

    if (result.lowConfidence) {
      // Show confirmation prompt instead of directly emitting
      pendingConfirmation.value = result.text.trim();
      lowConfidenceCount.value++;
    } else {
      emit('text', result.text.trim());
    }
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 501) emit('unavailable');
    else error.value = '转写失败，请直接输入';
  } finally {
    busy.value = false;
  }
}

function confirmTranscription(): void {
  if (pendingConfirmation.value.trim()) {
    emit('text', pendingConfirmation.value.trim());
  }
  pendingConfirmation.value = '';
}

function dismissTranscription(): void {
  pendingConfirmation.value = '';
}

function toggle(): void {
  if (busy.value) return;
  if (recording.value) recorder?.stop();
  else void start();
}

onBeforeUnmount(() => {
  recorder?.stop();
  releaseStream();
});
</script>

<template>
  <button
    type="button"
    class="mic"
    :class="{ recording }"
    :disabled="props.disabled || busy"
    :title="recording ? '停止并转写' : '语音输入'"
    :aria-label="recording ? '停止并转写' : '语音输入'"
    @click="toggle"
  >
    {{ recording ? '■' : '🎙' }}
  </button>
  <div v-if="pendingConfirmation" class="asr-confirm">
    <p class="asr-confirm-label">没太听清，您是说:</p>
    <p class="asr-confirm-text">{{ pendingConfirmation }}</p>
    <textarea
      v-model="pendingConfirmation"
      class="textarea asr-confirm-edit"
      rows="2"
      placeholder="可以在这里改"
    />
    <div class="asr-confirm-actions">
      <button type="button" class="btn ghost" @click="dismissTranscription">放弃</button>
      <button type="button" class="btn primary" @click="confirmTranscription">确认使用</button>
    </div>
  </div>
  <p v-if="error" class="error" style="font-size: 0.82rem">{{ error }}</p>
</template>
