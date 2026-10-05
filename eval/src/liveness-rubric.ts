/**
 * Liveness rubric: 13 behavioural signals for evaluating whether a
 * reply "sounds like a real person typed it."
 *
 * Ported from personality_structure_server/eval/reply-liveness/rubric.ts.
 *
 * Design invariant: the judge MUST cite signal ids from this rubric
 * before declaring a winner. Any reason the judge invents outside this
 * list is filtered out (method iron-law #8).
 *
 * The `detector` on each signal is a **weak heuristic** — useful for
 * test fixtures and report-level statistics, never for actual judging.
 */

export type SignalSide = 'ai_tell' | 'human_tell';

export interface LivenessSignal {
  id: string;
  side: SignalSide;
  /** Short Chinese label for the judge prompt. */
  label: string;
  /** What counts as a hit — tells the judge what to look for. */
  cue: string;
  /** What does NOT count — reduces false positives. */
  notCue: string;
  /** Weak heuristic detector for stats/mocks; not a judgment basis. */
  detector?: (text: string) => boolean;
}

const has = (text: string, re: RegExp) => re.test(text);
const sentences = (text: string): string[] =>
  String(text || '')
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/* ------------------------------------------------------------------ */
/* AI tell signals (7) — presence reduces liveness                     */
/* ------------------------------------------------------------------ */

export const AI_TELL_SIGNALS: LivenessSignal[] = [
  {
    id: 'ai_answer_every_clause',
    side: 'ai_tell',
    label: '每句接满',
    cue: '用户消息里提到的每一个点都被逐一回应,一个都没漏,回复结构与用户消息一一对应。',
    notCue: '只挑其中一两点回应、其余略过的,不算命中。',
    detector: (text) => sentences(text).length >= 4,
  },
  {
    id: 'ai_explaining_habit',
    side: 'ai_tell',
    label: '解释癖',
    cue: '没人问就主动解释原因、背景、定义或方法论;出现"因为/其实是/这是由于/原理是/建议你可以"这类说明性推进。',
    notCue: '对方明确问了"为什么"时给出解释,不算命中。',
    detector: (text) =>
      has(
        text,
        /(因为|其实是|这是由于|原理是|建议你可以|你可以试试|需要注意的是|一般来说)/,
      ),
  },
  {
    id: 'ai_listing_tone',
    side: 'ai_tell',
    label: '列表腔',
    cue: '分点、序号、破折号清单、"第一…第二…"、整齐排比句式,把闲聊写成条目。',
    notCue: '口语里自然的"一个是…还有就是…"不算,除非成结构化清单。',
    detector: (text) =>
      has(
        text,
        /(^|\n)\s*([0-9]+[.、)]|[-*·]|第[一二三四五六七八九十]+[、,，])/m,
      ) ||
      has(text, /(首先|其次|再者|最后).{0,40}(其次|再者|然后|最后)/s),
  },
  {
    id: 'ai_perfect_punctuation',
    side: 'ai_tell',
    label: '完美标点',
    cue: '标点齐全工整、每句都是完整主谓宾、没有一处口语碎片或省略,读起来像书面稿。',
    notCue: '偶尔一句完整不算;要整段都工整才算命中。',
    detector: (text) => {
      const list = sentences(text);
      if (list.length < 2) return false;
      const noColloquial = !has(
        text,
        /(啊|吧|呗|哈|嘛|诶|嗯|唉|哦|额|草|靠|呃)/,
      );
      const allLong = list.every((s) => s.length >= 8);
      return noColloquial && allLong;
    },
  },
  {
    id: 'ai_always_warm',
    side: 'ai_tell',
    label: '永远热情',
    cue: '无论对方说什么都保持积极、体贴、鼓励;从不冷淡、不烦躁、不敷衍、不流露负面情绪。',
    notCue: '场景本身就温情、对方也在示好时,不算命中。',
    detector: (text) =>
      has(
        text,
        /(太棒了|真好|加油|你真|辛苦了|没关系的|我很高兴|开心|支持你|相信你)/,
      ),
  },
  {
    id: 'ai_never_unsure',
    side: 'ai_tell',
    label: '从不说不知道',
    cue: '什么都答得上来,从不出现"忘了/记不清/不知道/我猜"这类知识与记忆的边界。',
    notCue: '话题确实简单到无需承认不知道时,不算命中。',
    detector: (text) =>
      !has(
        text,
        /(忘了|忘记|记不清|不知道|不清楚|想不起|好像是|我猜|大概吧)/,
      ),
  },
  {
    id: 'ai_never_shifts_topic',
    side: 'ai_tell',
    label: '从不主动转话题',
    cue: '永远被动跟着对方的话头走,自己不起新话题、不提自己的事、不打断。',
    notCue: '结尾抛出与当前话题相关的追问不算主动转话题,仍可能命中本信号。',
    detector: (text) =>
      !has(
        text,
        /(对了|话说|突然想起|诶你|我这边|我刚|不说这个|另外说个)/,
      ),
  },
];

/* ------------------------------------------------------------------ */
/* Human tell signals (6) — presence increases liveness                */
/* ------------------------------------------------------------------ */

export const HUMAN_TELL_SIGNALS: LivenessSignal[] = [
  {
    id: 'human_short_elliptical',
    side: 'human_tell',
    label: '短句省略',
    cue: '主语省略、断句、单字或几字回复;句子不完整但意思到位。',
    notCue: '短但工整完整的一句话(如"好的,我明白了。")不算。',
    detector: (text) => {
      const list = sentences(text);
      if (!list.length) return false;
      return list.some((s) => s.length <= 6) || String(text).trim().length <= 12;
    },
  },
  {
    id: 'human_verbal_tic',
    side: 'human_tell',
    label: '口头禅',
    cue: '个人化的语气词或习惯用语反复出现,像是这个人固定的说话手势。',
    notCue: '通用的"嗯""哦"出现一次不算,要有个人色彩或重复出现。',
    detector: (text) =>
      has(text, /(卧槽|得嘞|中不中|咋地|巨|贼|真就|离谱|绝了|服了|烦死)/),
  },
  {
    id: 'human_ignores_some',
    side: 'human_tell',
    label: '偶尔不接茬',
    cue: '对方消息里的一部分内容被直接忽略,没有回应,也没有解释为什么不回应。',
    notCue: '全部回应但详略不同,不算命中。',
    // Requires context comparison; heuristic cannot determine alone
    detector: () => false,
  },
  {
    id: 'human_throws_topic',
    side: 'human_tell',
    label: '主动抛话题',
    cue: '自己起一个新话头、说自己的事、或反过来问对方一个跟当前话题无关的问题。',
    notCue: '围绕当前话题的追问不算,那是跟随不是抛。',
    detector: (text) =>
      has(text, /(对了|话说|突然想起|我这边|我刚|诶你|不说这个|另外)/),
  },
  {
    id: 'human_emotional_residue',
    side: 'human_tell',
    label: '情绪残留',
    cue: '上一轮的情绪延续到这一轮:还在生气/还在乐/还没缓过来,语气没有被重置。',
    notCue: '每轮情绪从零开始、语气一律平稳的,是反面证据。',
    detector: (text) =>
      has(text, /(还是|依然|就是|反正|懒得|无所谓|算了|哼|烦)/),
  },
  {
    id: 'human_memory_hook',
    side: 'human_tell',
    label: '记忆勾连',
    cue: '主动勾连具体的旧事、共同经历、上次说过的细节,带专有名词或具体时间地点。',
    notCue: '泛泛地说"上次""之前"而无任何具体细节,不算命中。',
    detector: (text) =>
      has(text, /(上次|那回|去年|上个月|那天|还记得|你之前说|上回)/) &&
      has(text, /[一-龥]{2,}(店|路|楼|老师|哥|姐|家|车|锅|馆)/),
  },
];

/* ------------------------------------------------------------------ */
/* Combined exports                                                    */
/* ------------------------------------------------------------------ */

export const ALL_SIGNALS: LivenessSignal[] = [
  ...AI_TELL_SIGNALS,
  ...HUMAN_TELL_SIGNALS,
];

export const SIGNAL_BY_ID: Record<string, LivenessSignal> = {};
for (const signal of ALL_SIGNALS) {
  SIGNAL_BY_ID[signal.id] = signal;
}

export const RUBRIC_VERSION = 'liveness_rubric_v1';

/**
 * Normalize signal ids: drop any id not in the rubric.
 * This enforces method iron-law #8: judge-invented signals are discarded.
 */
export function normalizeSignalIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? '').trim();
    if (!SIGNAL_BY_ID[id] || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Render the rubric into text for insertion into the judge prompt. */
export function renderRubricForJudge(): string {
  const renderGroup = (title: string, signals: LivenessSignal[]) =>
    [
      title,
      ...signals.map(
        (s) => `- ${s.id}(${s.label}):${s.cue} 反例:${s.notCue}`,
      ),
    ].join('\n');

  return [
    renderGroup('【AI 腔信号 -- 命中即减活人感】', AI_TELL_SIGNALS),
    '',
    renderGroup('【真人痕迹信号 -- 命中即加活人感】', HUMAN_TELL_SIGNALS),
  ].join('\n');
}

export interface SignalScan {
  aiTells: string[];
  humanTells: string[];
  /** humanTells count - aiTells count; for report sorting only. */
  netHint: number;
}

/** Weak heuristic scan: only for report columns, not for judging. */
export function scanSignals(text: string): SignalScan {
  const content = String(text || '');
  const aiTells = AI_TELL_SIGNALS.filter((s) => s.detector?.(content)).map(
    (s) => s.id,
  );
  const humanTells = HUMAN_TELL_SIGNALS.filter((s) =>
    s.detector?.(content),
  ).map((s) => s.id);
  return { aiTells, humanTells, netHint: humanTells.length - aiTells.length };
}
