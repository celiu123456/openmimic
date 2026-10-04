import { HttpError } from './router';

/**
 * Speech-to-text is a thin proxy to any OpenAI-compatible
 * `/audio/transcriptions` endpoint. The key is read from the same
 * `LLM_BASE_URL`/`LLM_API_KEY` pair the rest of the project uses, so a
 * deployment that cannot talk to a model also has no ASR — and says so with
 * a 501 instead of pretending.
 */
export const DEFAULT_ASR_MODEL = 'whisper-1';
export const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1';

export interface AsrConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export function readAsrConfig(env: NodeJS.ProcessEnv = process.env): AsrConfig {
  const baseUrl = (env.LLM_BASE_URL ?? '').trim();
  const apiKey = (env.LLM_API_KEY ?? '').trim();
  const model = (env.ASR_MODEL ?? '').trim();
  return {
    baseUrl: (baseUrl === '' ? DEFAULT_LLM_BASE_URL : baseUrl).replace(/\/+$/, ''),
    apiKey: apiKey === '' ? undefined : apiKey,
    model: model === '' ? DEFAULT_ASR_MODEL : model,
  };
}

export function isAsrAvailable(config: AsrConfig): boolean {
  return config.apiKey !== undefined;
}

export interface AudioInput {
  body: Buffer;
  contentType: string;
  filename?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function parseMultipart(body: Buffer, contentTypeHeader: string): Promise<AudioInput> {
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), {
      headers: { 'content-type': contentTypeHeader },
    }).formData();
  } catch {
    throw new HttpError(400, 'asr_bad_audio', '无法解析音频上传');
  }

  const part = form.get('file') ?? form.get('audio');
  if (!(part instanceof Blob)) {
    throw new HttpError(400, 'asr_no_audio', '没有收到音频数据');
  }
  return {
    body: Buffer.from(await part.arrayBuffer()),
    contentType: part.type === '' ? 'application/octet-stream' : part.type,
    filename: part instanceof File && part.name !== '' ? part.name : 'audio',
  };
}

/** Accept both a raw audio body and a multipart upload. */
export async function normalizeAudioInput(
  body: Buffer,
  contentTypeHeader: string,
): Promise<AudioInput> {
  const mime = contentTypeHeader.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime === 'multipart/form-data') return parseMultipart(body, contentTypeHeader);
  return {
    body,
    contentType: mime === '' ? 'application/octet-stream' : mime,
    filename: 'audio',
  };
}

/**
 * Send one recording upstream and return the transcript.
 *
 * The upstream body is always rebuilt as multipart with the configured model,
 * so clients never have to know (or be trusted with) the model name.
 */
export async function transcribeAudio(
  input: AudioInput,
  config: AsrConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!isAsrAvailable(config)) {
    throw new HttpError(501, 'asr_unavailable', '服务器未配置语音转写');
  }

  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(input.body)], { type: input.contentType }),
    input.filename ?? 'audio',
  );
  form.append('model', config.model);

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey ?? ''}` },
      body: form,
    });
  } catch {
    throw new HttpError(502, 'asr_failed', '语音转写服务暂时不可用');
  }

  if (!response.ok) {
    throw new HttpError(502, 'asr_failed', `语音转写失败（上游 ${response.status}）`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(502, 'asr_failed', '语音转写返回了无法解析的结果');
  }

  return isRecord(payload) && typeof payload.text === 'string' ? payload.text : '';
}
