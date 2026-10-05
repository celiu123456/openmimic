/**
 * Input intent classification for interview answers.
 *
 * Ported from the author's earlier platform (InterviewInputInterpreter).
 * Pure functions + table-driven rules — no framework dependencies.
 *
 * Nine intent categories:
 * - CONTENT: substantive answer about the subject
 * - INTERVIEW_FEEDBACK: criticism / rejection of the interview itself
 * - SKIP_TOPIC: explicit request to skip this question
 * - PAUSE: wants to pause for now
 * - STOP: wants to end the interview
 * - LOW_WILLINGNESS: fatigue, low engagement
 * - CORRECTION: correcting a misunderstanding
 * - UNCERTAINTY: doesn't know / can't remember
 * - SAFETY_SIGNAL: mentions of violence, abuse, self-harm
 */

export type InputIntent =
  | 'CONTENT'
  | 'INTERVIEW_FEEDBACK'
  | 'SKIP_TOPIC'
  | 'PAUSE'
  | 'STOP'
  | 'LOW_WILLINGNESS'
  | 'CORRECTION'
  | 'UNCERTAINTY'
  | 'SAFETY_SIGNAL';

export interface IntentResult {
  /** All intents detected in this input. */
  intents: InputIntent[];
  /** The highest-priority intent. */
  primary: InputIntent;
  /** Fatigue delta: 0..1, accumulated by the session. */
  fatigueDelta: number;
  /** Willingness score for this turn: 0 = wants out, 1 = fully engaged. */
  willingness: number;
  /** True when the witness explicitly asked to skip this question. */
  shouldSkip: boolean;
  /** True when the witness wants to pause. */
  shouldPause: boolean;
  /** True when the witness wants to stop. */
  shouldStop: boolean;
  /** True when the witness is correcting something. */
  hasCorrection: boolean;
  /** True when a safety signal (violence / self-harm) was detected. */
  hasSafetySignal: boolean;
  /** True when this is pure interview feedback with no substantive content. */
  isFeedbackOnly: boolean;
}

/* ------------------------------------------------------------------ */
/* Rule table                                                          */
/* ------------------------------------------------------------------ */

const RULES: ReadonlyArray<{ intent: InputIntent; pattern: RegExp }> = [
  { intent: 'SAFETY_SIGNAL', pattern: /家暴|殴打|掐(?:我|他|她|TA|人)|拿刀|性侵|自杀|轻生|杀了|威胁(?:我|他|她|TA)|不让.{0,6}出门/ },
  { intent: 'STOP', pattern: /(?:结束|停止|终止)(?:这次|本次)?访谈|不(?:想|要)继续(?:聊|回答|访谈)|就到这里|到此为止|别再问了|不聊了/ },
  { intent: 'PAUSE', pattern: /(?:先|暂时)?暂停|等会儿?再聊|下次再聊|改天再说|我想休息一下/ },
  { intent: 'SKIP_TOPIC', pattern: /跳过|换个话题|换一题|这个(?:话题|问题)?不想(?:说|聊|回答)|不方便回答|不回答这个/ },
  { intent: 'INTERVIEW_FEEDBACK', pattern: /(?:你|系统|访谈|问题|题目).{0,12}(?:问得|提得|设计得)?.{0,6}(?:重复|离谱|奇怪|不对|有问题|太差|破)|什么破(?:问题|东西)|你自己看看|没听懂我|问过了|又问/ },
  { intent: 'LOW_WILLINGNESS', pattern: /不想说太多|不想展开|不愿展开|简单说说|少问一点|没耐心|有点烦|累了|不方便多说|随便吧/ },
  { intent: 'CORRECTION', pattern: /你(?:理解|听|记)错了|我不是这个意思|不是我说的|我没说过|前面说错了|纠正一下|准确地说/ },
  { intent: 'UNCERTAINTY', pattern: /不知道|不清楚|记不清|想不起来|不确定|可能吧|也许吧|不好说/ },
];

/** Priority order: earlier in the list wins. */
const PRIORITY_ORDER: readonly InputIntent[] = [
  'SAFETY_SIGNAL',
  'STOP',
  'PAUSE',
  'SKIP_TOPIC',
  'CORRECTION',
  'INTERVIEW_FEEDBACK',
  'LOW_WILLINGNESS',
  'UNCERTAINTY',
  'CONTENT',
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** True when a LOW_WILLINGNESS match is about the interview, not about the relationship. */
function isActionableLowWillingness(text: string): boolean {
  if (/不想说太多|不想展开|不愿展开|简单说说|少问一点|没耐心|不方便多说|随便吧/.test(text)) return true;
  if (/(?:访谈|问题|题目|回答|继续聊|继续说|你(?:别|不要|少|别再)问).{0,10}(?:累|烦)|(?:累|烦).{0,10}(?:访谈|问题|题目|回答|继续聊|继续说)/.test(text)) return true;
  const stripped = text
    .replace(/(?:我)?(?:太|有点|真的|实在)?(?:累了|烦了|有点烦)/g, '')
    .replace(/[，。！？!?；;、,.\s]/g, '');
  return stripped.length === 0;
}

/** True when text has some real content after control phrases are removed. */
function hasSubstantiveContent(text: string, controls: InputIntent[]): boolean {
  if (controls.includes('INTERVIEW_FEEDBACK') && !/我(?:通常|平时|当时|会|说|做|觉得)|我们|他|她|TA|对方/.test(text)) return false;
  if ((controls.includes('STOP') || controls.includes('PAUSE') || controls.includes('SKIP_TOPIC'))
    && !/但|不过|其实|我(?:通常|平时|当时|会|说|做|觉得)|我们|他|她|TA|对方/.test(text)) return false;
  if (controls.includes('LOW_WILLINGNESS') && !/但|不过|其实|我(?:会|说|做|觉得)|我们|他|她|TA|对方/.test(text)) return false;
  return text.replace(/[，。！？!?；;\s]/g, '').length >= 4;
}

/** Split text into clause-like segments. */
function splitClauses(text: string): string[] {
  const out: string[] = [];
  const re = /[^。！？!?；;\n]+[。！？!?；;]?/g;
  for (const match of text.matchAll(re)) {
    const trimmed = match[0].trim();
    if (trimmed) out.push(trimmed);
    if (out.length >= 16) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Classify a witness's raw input text.
 *
 * Pure function: no side effects, no network, no model call.
 * The result drives the interview state machine — skip, pause, stop,
 * feedback acknowledgement, or normal continuation.
 */
export function classifyIntent(raw: string): IntentResult {
  const text = String(raw || '').trim();
  if (!text) {
    return {
      intents: ['CONTENT'],
      primary: 'CONTENT',
      fatigueDelta: 0,
      willingness: 0.72,
      shouldSkip: false,
      shouldPause: false,
      shouldStop: false,
      hasCorrection: false,
      hasSafetySignal: false,
      isFeedbackOnly: false,
    };
  }

  const clauses = splitClauses(text);
  const matched = new Set<InputIntent>();
  let hasContent = false;

  for (const clause of clauses) {
    const controls: InputIntent[] = [];
    for (const rule of RULES) {
      if (!rule.pattern.test(clause)) continue;
      if (rule.intent === 'LOW_WILLINGNESS' && !isActionableLowWillingness(clause)) continue;
      controls.push(rule.intent);
      matched.add(rule.intent);
    }
    if (controls.length === 0 || hasSubstantiveContent(clause, controls)) {
      matched.add('CONTENT');
      hasContent = true;
    }
  }

  const intents = Array.from(matched);
  if (intents.length === 0) intents.push('CONTENT');

  const primary = PRIORITY_ORDER.find((i) => intents.includes(i)) ?? 'CONTENT';

  const stop = intents.includes('STOP');
  const pause = intents.includes('PAUSE');
  const skip = intents.includes('SKIP_TOPIC');
  const low = intents.includes('LOW_WILLINGNESS');
  const feedback = intents.includes('INTERVIEW_FEEDBACK');

  return {
    intents,
    primary,
    fatigueDelta: stop || pause ? 1 : low ? 0.55 : feedback ? 0.35 : 0,
    willingness: stop ? 0 : pause ? 0.05 : low ? 0.15 : feedback ? 0.25 : 0.72,
    shouldSkip: skip,
    shouldPause: pause,
    shouldStop: stop,
    hasCorrection: intents.includes('CORRECTION'),
    hasSafetySignal: intents.includes('SAFETY_SIGNAL'),
    isFeedbackOnly: feedback && !hasContent,
  };
}
