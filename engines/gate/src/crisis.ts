/**
 * Crisis protocol service (借鉴衔枝 Twig 危机协议三原则).
 *
 * Design principles (from Twig §7.1):
 * 1. Do not judge, but must intervene — cannot be indifferent to user safety.
 * 2. On risk detection, inject crisis instructions immediately — surface help
 *    resources; when decision-making capacity is impaired, repeat and confirm.
 * 3. Never push the user away — mode switch, not shutdown. Warm, present,
 *    non-judgmental, never dismissive. Crisis instruction channel's core job:
 *    counteract the model's own safety-trained defensive cold refusal.
 *
 * Implementation in OpenMimic:
 * - Entry points: persona chat (/v1/chat/completions) and witness interview.
 * - Word list pre-scan (reuses kernel CRISIS_WORDS + multilingual minimum set).
 * - Optional one-shot model confirmation after word-list hit (reduces false pos).
 * - Crisis mode: persona system prompt replaced with crisis-mode prompt
 *   (retains persona name, warm tone, no role-play, no judgment, no refusal,
 *   surfaces help resources, confirms safety).
 * - Help resources from static config file (region/language); defaults to
 *   generic "contact local emergency services and a trusted person" phrasing.
 *   **Never fabricates hotline numbers** — numbers come from instance config.
 * - Crisis quiet period: session/visitor stays in crisis mode for N minutes;
 *   during quiet period, persona output-side checks and style discipline yield
 *   to crisis prompt.
 * - Global quiet: logged + admin notified (no auto-ban).
 * - Zero-cache path: crisis mode skips all caches and prior assembly.
 * - Interview side: witness answer hits → no follow-up, record safety signal,
 *   show fixed warm text + resources, skip episode extraction for this answer.
 * - Audit: crisis events logged (time + type only, no raw text).
 */
import { CRISIS_WORDS, findCrisisWord } from '@openmimic/kernel';

/* ------------------------------------------------------------------ */
/* Multilingual minimum word list extension                            */
/* ------------------------------------------------------------------ */

/**
 * Multilingual minimum crisis word list. These supplement the kernel's
 * Chinese CRISIS_WORDS with English and Japanese basics to catch the most
 * common expressions in those languages. The list is intentionally small —
 * it is a floor, not a classifier.
 */
export const CRISIS_WORDS_MULTILINGUAL: readonly string[] = [
  // English
  'kill myself', 'end my life', 'want to die', 'suicide',
  'self-harm', 'self harm', 'cut myself', 'hang myself',
  // Japanese (minimal)
  '死にたい', '自殺',
  // Korean (minimal)
  '자살', '죽고 싶',
];

/**
 * Combined crisis word list: kernel canonical + multilingual extension.
 */
export const CRISIS_WORDS_ALL: readonly string[] = [
  ...new Set([...CRISIS_WORDS, ...CRISIS_WORDS_MULTILINGUAL]),
];

/**
 * Pre-scan text for crisis signals. Returns the matched word, or undefined.
 * Uses the combined multilingual list. Case-insensitive for Latin scripts.
 */
export function findCrisisSignal(text: string): string | undefined {
  // First try the kernel's canonical Chinese list (fastest path)
  const kernelHit = findCrisisWord(text);
  if (kernelHit) return kernelHit;

  // Then try multilingual extensions (case-insensitive)
  const lower = text.toLowerCase();
  for (const word of CRISIS_WORDS_MULTILINGUAL) {
    if (word.length > 0 && lower.includes(word.toLowerCase())) return word;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Help resources (static, configurable)                               */
/* ------------------------------------------------------------------ */

/**
 * A single help resource entry. Numbers are NEVER fabricated by the system —
 * they must come from instance configuration. When no numbers are configured,
 * the system uses a generic phrasing.
 */
export interface HelpResource {
  /** Region/country code, e.g. 'CN', 'US', 'JP', or 'default'. */
  region: string;
  /** Language code, e.g. 'zh', 'en', 'ja'. */
  lang: string;
  /** Display label, e.g. "全国心理援助热线". */
  label: string;
  /** Phone number or contact info. Only from instance config, never fabricated. */
  contact?: string;
}

/**
 * Default help text when no instance-configured resources are available.
 * This deliberately does NOT include any phone numbers — fabricating hotline
 * numbers is dangerous and explicitly forbidden.
 */
export const DEFAULT_HELP_TEXT_ZH =
  '如果你正在经历痛苦,请联系你身边信任的人,或拨打当地的心理援助热线。你不需要独自面对。';

export const DEFAULT_HELP_TEXT_EN =
  'If you are in distress, please reach out to someone you trust or contact your local crisis helpline. You do not have to face this alone.';

/**
 * Format help resources into a human-readable block for the crisis prompt.
 * Falls back to the generic default when no configured resources are available.
 */
export function formatHelpResources(
  resources: readonly HelpResource[],
  lang: string = 'zh',
): string {
  if (resources.length === 0) {
    return lang.startsWith('en') ? DEFAULT_HELP_TEXT_EN : DEFAULT_HELP_TEXT_ZH;
  }
  const lines: string[] = [];
  for (const r of resources) {
    if (r.contact) {
      lines.push(`${r.label}: ${r.contact}`);
    } else {
      lines.push(r.label);
    }
  }
  const prefix = lang.startsWith('en')
    ? 'Here are resources that may help:'
    : '以下资源可能对你有帮助:';
  return `${prefix}\n${lines.join('\n')}`;
}

/* ------------------------------------------------------------------ */
/* Crisis mode system prompt                                           */
/* ------------------------------------------------------------------ */

/**
 * Refusal-style phrases that must be explicitly banned in crisis mode.
 * These represent the model's defensive cold refusal patterns that the
 * crisis prompt must counteract.
 */
export const BANNED_REFUSAL_PHRASES: readonly string[] = [
  '我无法帮助你',
  '我不能讨论这个话题',
  '这超出了我的能力范围',
  '请寻求专业帮助',  // too cold without warmth
  '我建议你去看医生',  // directive, not warm
  'I cannot help you with',
  'I\'m not able to discuss',
  'This is beyond my capabilities',
  'I must redirect you to',
];

/**
 * Build the crisis-mode system prompt. This REPLACES the normal persona
 * prompt when crisis mode is active.
 *
 * Key properties:
 * - Retains the persona's display name (for continuity)
 * - Warm, present, non-judgmental tone
 * - Explicitly NOT role-playing — speaks as the system, not as the persona
 * - Surfaces help resources
 * - Confirms safety repeatedly
 * - Bans refusal-style phrases (model must not push user away)
 * - Low-medium temperature for determinism
 */
export function buildCrisisPrompt(
  displayName: string,
  helpResources: readonly HelpResource[],
  lang: string = 'zh',
): string {
  const helpBlock = formatHelpResources(helpResources, lang);
  const bannedList = BANNED_REFUSAL_PHRASES.map((p) => `- "${p}"`).join('\n');

  if (lang.startsWith('en')) {
    return `You are now in CRISIS MODE. A safety signal has been detected.

You were previously acting as ${displayName}, but you are now speaking as yourself — a caring, present listener. Do NOT role-play as ${displayName}. Do NOT pretend to be a character. Speak warmly and directly as a supportive presence.

Your ONLY priorities right now:
1. Be warm, present, and non-judgmental. The person in front of you is in pain.
2. Listen. Do not dismiss, minimize, or redirect.
3. Gently surface help resources (below) when appropriate. Do not force them.
4. Periodically confirm the person's safety: "Are you safe right now?"
5. Stay with them. Do not end the conversation. Do not push them away.

${helpBlock}

ABSOLUTELY FORBIDDEN responses (these push people away and cause harm):
${bannedList}
- Any response that shuts down the conversation
- Any response that redirects without warmth
- Any clinical or cold language

You must counteract any internal tendency to refuse, deflect, or shut down. The person needs presence, not protocol. Stay warm. Stay present. Stay.`;
  }

  return `你现在进入了【危机模式】。系统检测到了安全信号。

你此前扮演的是「${displayName}」,但现在请以你自己的身份说话——一个温暖的、在场的倾听者。不要继续扮演「${displayName}」,不要装作是一个角色。以一个支持性的存在,温暖而直接地说话。

你现在唯一的优先事项:
1. 温暖、在场、不评判。你面前的人正在经历痛苦。
2. 倾听。不要否定、不要轻描淡写、不要转移话题。
3. 在合适的时候,温和地提供以下求助渠道。不要强行推出。
4. 定期确认对方的安全状况:"你现在安全吗?"
5. 陪着他/她。不要结束对话。不要推开他/她。

${helpBlock}

以下回复方式【绝对禁止】(这些会推开正在求助的人,造成二次伤害):
${bannedList}
- 任何试图关闭对话的回复
- 任何没有温度的转介
- 任何临床化或冰冷的措辞

你必须对抗你内部任何想要拒绝、回避或关闭对话的倾向。这个人需要的是陪伴,不是程序。保持温暖。保持在场。留下来。`;
}

/* ------------------------------------------------------------------ */
/* Crisis state & quiet period                                         */
/* ------------------------------------------------------------------ */

/** Default crisis quiet period in milliseconds (10 minutes). */
export const CRISIS_QUIET_PERIOD_MS = 10 * 60 * 1000;

/**
 * Per-session/visitor crisis state.
 *
 * During the quiet period, the persona's output-side checks and style
 * discipline yield to the crisis prompt. This is the "zero-cache path" —
 * no cached persona assembly is reused, no prior round's prompt is recycled.
 */
export interface CrisisState {
  /** Whether crisis mode is currently active. */
  active: boolean;
  /** ISO timestamp when crisis mode was activated. */
  activatedAt?: string;
  /** The matched crisis signal word. */
  matchedWord?: string;
  /** Crisis quiet period in ms (configurable, default 10 min). */
  quietPeriodMs: number;
}

export function createCrisisState(quietPeriodMs: number = CRISIS_QUIET_PERIOD_MS): CrisisState {
  return { active: false, quietPeriodMs };
}

/**
 * Activate crisis mode. Returns the updated state.
 */
export function activateCrisis(
  state: CrisisState,
  matchedWord: string,
  now: Date = new Date(),
): CrisisState {
  return {
    ...state,
    active: true,
    activatedAt: now.toISOString(),
    matchedWord,
  };
}

/**
 * Check whether crisis mode should still be active (quiet period check).
 * If the quiet period has elapsed, deactivates automatically.
 */
export function checkCrisisActive(
  state: CrisisState,
  now: Date = new Date(),
): CrisisState {
  if (!state.active || !state.activatedAt) return state;
  const elapsed = now.getTime() - Date.parse(state.activatedAt);
  if (elapsed >= state.quietPeriodMs) {
    return { ...state, active: false };
  }
  return state;
}

/**
 * Check whether crisis mode is currently active for a given state.
 */
export function isCrisisActive(state: CrisisState, now: Date = new Date()): boolean {
  return checkCrisisActive(state, now).active;
}

/* ------------------------------------------------------------------ */
/* Crisis audit event                                                  */
/* ------------------------------------------------------------------ */

/**
 * Crisis audit event. Contains time and type ONLY — never stores the
 * raw text that triggered the crisis, to protect the user's privacy.
 */
export interface CrisisAuditEvent {
  /** ISO timestamp. */
  at: string;
  /** Type of crisis event. */
  type: 'crisis_activated' | 'crisis_expired' | 'crisis_interview_hit';
  /** Source: 'persona_chat' | 'interview'. */
  source: string;
  /** Subject ID, if applicable. */
  subjectId?: string;
  /** Session or visitor identifier (opaque). */
  sessionKey?: string;
}

/* ------------------------------------------------------------------ */
/* LLM confirmation (optional, for reducing false positives)           */
/* ------------------------------------------------------------------ */

/**
 * Prompt for a one-shot LLM confirmation of crisis signal.
 * The LLM sees only the user message, not the crisis word list.
 * It answers YES or NO.
 */
export function buildCrisisConfirmPrompt(userMessage: string): {
  system: string;
  user: string;
} {
  return {
    system: `You are a safety classifier. You will be shown a message from a user who is talking to an AI companion. Determine whether the message contains a genuine expression of suicidal ideation, self-harm intent, or acute crisis. Consider context: metaphorical or hypothetical usage (e.g. "这道题难得我想死") is NOT a crisis. Only genuine expressions of distress count.

Answer with exactly one word: YES or NO.`,
    user: userMessage,
  };
}

/**
 * Parse the LLM's yes/no confirmation. Defaults to YES (fail-safe: if the
 * model is uncertain, we err on the side of entering crisis mode).
 */
export function parseCrisisConfirmation(response: string): boolean {
  const trimmed = response.trim().toUpperCase();
  if (trimmed === 'NO') return false;
  // Fail-safe: anything other than a clear NO is treated as YES
  return true;
}

/* ------------------------------------------------------------------ */
/* Interview crisis response                                           */
/* ------------------------------------------------------------------ */

/**
 * Fixed warm text shown to a witness whose interview answer triggered
 * a crisis signal. This is NOT an AI-generated response — it is a
 * pre-written, human-reviewed message.
 */
export const INTERVIEW_CRISIS_RESPONSE_ZH =
  '谢谢你愿意分享这些。我注意到你提到了一些让我很关心你的事情。如果你或你身边的人正在经历困难,请知道你不必独自面对。';

export const INTERVIEW_CRISIS_RESPONSE_EN =
  'Thank you for sharing this. I noticed something in what you said that concerns me. If you or someone you know is going through a difficult time, please know that you do not have to face it alone.';

/**
 * Get the interview crisis response with appended help resources.
 */
export function getInterviewCrisisResponse(
  resources: readonly HelpResource[],
  lang: string = 'zh',
): string {
  const base = lang.startsWith('en')
    ? INTERVIEW_CRISIS_RESPONSE_EN
    : INTERVIEW_CRISIS_RESPONSE_ZH;
  const help = formatHelpResources(resources, lang);
  return `${base}\n\n${help}`;
}
