/**
 * Witness v2 questionnaires: observer-style dimensions ported from the author's
 * earlier platform project. Interview strategies adapted from relationship-type
 * prompt templates (family / friend / colleague).
 *
 * Each question carries:
 * - `dimensionId`: one of the ten observer v2 dimensions
 * - `sensitivity`: controls ordering (high-sensitivity questions go to the back
 *   and may be skipped)
 * - `frontPrompt` (optional): per-question "to their face" variant override
 *
 * Three variants — friend, family, colleague — differ in wording and topic
 * selection based on the relation-type strategies. The default is friend.
 */

import type { WitnessQuestion, Questionnaire } from './friend-v1';

/* ------------------------------------------------------------------ */
/* Extended question type                                              */
/* ------------------------------------------------------------------ */

export interface WitnessV2Question extends WitnessQuestion {
  /** Which of the ten observer dimensions this question probes. */
  dimensionId: string;
  /** Controls ordering: high-sensitivity questions are placed at the end. */
  sensitivity: 'low' | 'medium' | 'high';
}

/* ------------------------------------------------------------------ */
/* The ten observer v2 dimensions (from blueprint-registry)            */
/* ------------------------------------------------------------------ */

export const OBSERVER_DIMENSIONS = [
  { id: 'relationship_origin_shared_history', label: '关系起点与共同经历' },
  { id: 'observed_concrete_behavior', label: '亲眼见过的具体行为' },
  { id: 'observed_pressure_vulnerability', label: '压力与脆弱时的表现' },
  { id: 'observed_context_difference', label: '对不同人的差异' },
  { id: 'observed_habit_interest_ability', label: '习惯兴趣与能力' },
  { id: 'observed_subject_language', label: '被描述者的真实语言' },
  { id: 'observed_change_turning_point', label: '重要变化与转折' },
  { id: 'observed_impression_counterexample', label: '稳定印象与反例' },
  { id: 'observer_relationship_cycle', label: '双方互动模式' },
  { id: 'respondent_relationship_experience', label: '讲述者在关系中的体验' },
] as const;

/* ------------------------------------------------------------------ */
/* Relation-type strategies (from prompt_templates.json)               */
/* ------------------------------------------------------------------ */

export interface RelationStrategy {
  /** Identifier matching the invite's relation type. */
  key: 'friend' | 'family' | 'colleague';
  label: string;
  tone: string;
  priorityTopics: string;
  taboo: string;
  icebreaker: string;
}

export const RELATION_STRATEGIES: readonly RelationStrategy[] = [
  {
    key: 'friend',
    label: '朋友',
    tone: '轻松随意，像老友闲聊',
    priorityTopics: '共同经历、性格反差、价值观碰撞',
    taboo: '避免像HR面试一样正式',
    icebreaker: '从你们认识的契机、最有意思的回忆切入',
  },
  {
    key: 'family',
    label: '家人',
    tone: '尊重但亲切',
    priorityTopics: '成长故事、家庭传统、人生转折点',
    taboo: '避免直接问缺点，用"有没有让TA头疼的事"替代"TA有什么缺点"',
    icebreaker: '从家庭聚会、一起生活的日常切入',
  },
  {
    key: 'colleague',
    label: '同事',
    tone: '专业但友好，像项目复盘',
    priorityTopics: '工作能力、团队协作、压力应对',
    taboo: '避免问过于私人的家庭问题',
    icebreaker: '从最近一起做的项目、工作中的趣事切入',
  },
] as const;

/** Look up a strategy by key; returns the friend strategy as fallback. */
export function strategyFor(key: string): RelationStrategy {
  return (
    RELATION_STRATEGIES.find((s) => s.key === key) ??
    RELATION_STRATEGIES[0]! /* friend */
  );
}

/* ------------------------------------------------------------------ */
/* Friend variant (default, 10 questions)                              */
/* ------------------------------------------------------------------ */

const FRIEND_V2_QUESTIONS: readonly WitnessV2Question[] = [
  {
    qid: 'wv2-f-01',
    dimensionId: 'relationship_origin_shared_history',
    sensitivity: 'low',
    prompt: '你们最初是怎么认识的？后来是怎么熟起来的？',
    followupHint: '想想最早有印象的一件事。',
  },
  {
    qid: 'wv2-f-02',
    dimensionId: 'observed_concrete_behavior',
    sensitivity: 'low',
    prompt: '你亲眼见过 TA 做的哪件事，最能说明 TA 平时是什么样的人？',
    followupHint: '不一定是大事，日常的也行。',
  },
  {
    qid: 'wv2-f-03',
    dimensionId: 'observed_habit_interest_ability',
    sensitivity: 'low',
    prompt: '在一起相处的时候，TA 有什么小习惯或者特别擅长的事？',
    followupHint: '比如吃饭、出门、做事的习惯。',
  },
  {
    qid: 'wv2-f-04',
    dimensionId: 'observed_subject_language',
    sensitivity: 'low',
    prompt: 'TA 平时说话是什么风格？有没有哪句话特别像 TA 的语气？',
    followupHint: '爱开玩笑、说话直，还是比较含蓄？',
  },
  {
    qid: 'wv2-f-05',
    dimensionId: 'observed_context_difference',
    sensitivity: 'medium',
    prompt: 'TA 面对不同的人时，表现有什么不一样的地方？',
    followupHint: '比如对家里人和对朋友，或者对领导和对陌生人。',
  },
  {
    qid: 'wv2-f-06',
    dimensionId: 'observed_pressure_vulnerability',
    sensitivity: 'medium',
    prompt: '遇到压力大或者不顺的时候，TA 通常是什么反应？',
    followupHint: '找人聊、自己扛着、还是先想办法？',
  },
  {
    qid: 'wv2-f-07',
    dimensionId: 'observer_relationship_cycle',
    sensitivity: 'medium',
    prompt: '你们意见不同的时候，通常是怎么处理的？',
    followupHint: '直接说开、冷处理，还是绕着说？',
  },
  {
    qid: 'wv2-f-08',
    dimensionId: 'observed_change_turning_point',
    sensitivity: 'medium',
    prompt: '你有没有觉得 TA 在哪段时期发生了比较大的变化？',
    followupHint: '比如换了工作、经历了什么事之后。',
  },
  {
    qid: 'wv2-f-09',
    dimensionId: 'observed_impression_counterexample',
    sensitivity: 'high',
    prompt: '有没有哪次 TA 的表现让你很意外，跟你平时的印象很不一样？',
    followupHint: '意外可以是好的也可以是不好的。',
  },
  {
    qid: 'wv2-f-10',
    dimensionId: 'respondent_relationship_experience',
    sensitivity: 'high',
    prompt: '这段关系里，TA 的做法通常让你有什么感受？',
    followupHint: '不评价对错，就说你的真实感受。',
  },
];

/* ------------------------------------------------------------------ */
/* Family variant (9 questions, softer wording, no direct "缺点")       */
/* ------------------------------------------------------------------ */

const FAMILY_V2_QUESTIONS: readonly WitnessV2Question[] = [
  {
    qid: 'wv2-m-01',
    dimensionId: 'relationship_origin_shared_history',
    sensitivity: 'low',
    prompt: '你们平时在一起的时候，一般会做些什么？',
    followupHint: '吃饭、聊天、一起忙家里的事，都算。',
  },
  {
    qid: 'wv2-m-02',
    dimensionId: 'observed_concrete_behavior',
    sensitivity: 'low',
    prompt: '你亲眼见过 TA 做的哪件事，最能说明 TA 的为人？',
    followupHint: '日常小事也可以。',
  },
  {
    qid: 'wv2-m-03',
    dimensionId: 'observed_habit_interest_ability',
    sensitivity: 'low',
    prompt: '在家里，TA 有什么小习惯或者特别擅长的事？',
    followupHint: '做饭、收拾、照顾人，想到什么说什么。',
  },
  {
    qid: 'wv2-m-04',
    dimensionId: 'observed_subject_language',
    sensitivity: 'low',
    prompt: 'TA 在家里说话是什么风格？有没有 TA 常说的一句话？',
    followupHint: '比如口头禅、叮嘱的话、开玩笑的方式。',
  },
  {
    qid: 'wv2-m-05',
    dimensionId: 'observed_pressure_vulnerability',
    sensitivity: 'medium',
    prompt: '遇到不顺心的事，TA 一般会怎么处理？',
    followupHint: '比如工作上的麻烦、家里的烦心事。',
  },
  {
    qid: 'wv2-m-06',
    dimensionId: 'observed_context_difference',
    sensitivity: 'medium',
    prompt: 'TA 在家人面前和在外面，表现有什么不一样？',
    followupHint: '有的人在家话多，出门话少，反过来也有。',
  },
  {
    qid: 'wv2-m-07',
    dimensionId: 'observed_change_turning_point',
    sensitivity: 'medium',
    prompt: '你觉得 TA 这些年有没有什么比较大的变化？',
    followupHint: '比如性格、生活方式或者待人的态度。',
  },
  {
    qid: 'wv2-m-08',
    dimensionId: 'observed_impression_counterexample',
    sensitivity: 'high',
    prompt: '有没有哪次 TA 的做法让你挺意外的，跟你平时对 TA 的印象不太一样？',
    followupHint: '不一定是坏事，好的意外也算。',
  },
  {
    qid: 'wv2-m-09',
    dimensionId: 'respondent_relationship_experience',
    sensitivity: 'high',
    prompt: '作为家人，TA 平时的做法一般让你有什么感受？',
    followupHint: '不用评价对错，说你的真实体会就好。',
  },
];

/* ------------------------------------------------------------------ */
/* Colleague variant (8 questions, professional focus)                  */
/* ------------------------------------------------------------------ */

const COLLEAGUE_V2_QUESTIONS: readonly WitnessV2Question[] = [
  {
    qid: 'wv2-c-01',
    dimensionId: 'relationship_origin_shared_history',
    sensitivity: 'low',
    prompt: '你们是在什么情况下开始一起工作的？',
    followupHint: '同一个项目、同一个部门，或者其他场合。',
  },
  {
    qid: 'wv2-c-02',
    dimensionId: 'observed_concrete_behavior',
    sensitivity: 'low',
    prompt: '在工作中，你亲眼见过 TA 做的哪件事最能说明 TA 的做事方式？',
    followupHint: '不一定是大事，日常的也行。',
  },
  {
    qid: 'wv2-c-03',
    dimensionId: 'observed_habit_interest_ability',
    sensitivity: 'low',
    prompt: '工作中 TA 有什么特别擅长的，或者什么明显的工作习惯？',
    followupHint: '比如处理问题的方式、和人沟通的风格。',
  },
  {
    qid: 'wv2-c-04',
    dimensionId: 'observed_pressure_vulnerability',
    sensitivity: 'medium',
    prompt: '项目紧张或遇到困难的时候，TA 通常是什么反应？',
    followupHint: '比如主动加班、先理思路，还是容易急。',
  },
  {
    qid: 'wv2-c-05',
    dimensionId: 'observed_context_difference',
    sensitivity: 'medium',
    prompt: 'TA 对不同的同事，比如上级、平级、下属，态度有什么不一样？',
    followupHint: '开会和私下聊天的时候可能不太一样。',
  },
  {
    qid: 'wv2-c-06',
    dimensionId: 'observer_relationship_cycle',
    sensitivity: 'medium',
    prompt: '你们在工作上意见不同的时候，通常是怎么解决的？',
    followupHint: '直接讨论、各退一步，还是找第三方？',
  },
  {
    qid: 'wv2-c-07',
    dimensionId: 'observed_impression_counterexample',
    sensitivity: 'high',
    prompt: '有没有哪次 TA 在工作中的表现让你挺意外的？',
    followupHint: '跟你平时对 TA 的印象不一样的那种。',
  },
  {
    qid: 'wv2-c-08',
    dimensionId: 'respondent_relationship_experience',
    sensitivity: 'high',
    prompt: '跟 TA 共事的这段时间，TA 的做事方式给你留下了什么感受？',
    followupHint: '不用客套，说真实体会就好。',
  },
];

/* ------------------------------------------------------------------ */
/* Questionnaire objects                                               */
/* ------------------------------------------------------------------ */

export const WITNESS_V2_FRIEND: Questionnaire = {
  id: 'witness-v2-friend',
  title: '朋友版问卷 v2',
  frontPrompt: '如果 TA 就坐在你对面，这话你会怎么对 TA 说？',
  questions: FRIEND_V2_QUESTIONS as unknown as WitnessQuestion[],
};

export const WITNESS_V2_FAMILY: Questionnaire = {
  id: 'witness-v2-family',
  title: '家人版问卷 v2',
  frontPrompt: '如果 TA 就坐在你对面，这话你会怎么说？',
  questions: FAMILY_V2_QUESTIONS as unknown as WitnessQuestion[],
};

export const WITNESS_V2_COLLEAGUE: Questionnaire = {
  id: 'witness-v2-colleague',
  title: '同事版问卷 v2',
  frontPrompt: '如果 TA 就在旁边，这话你会怎么说？',
  questions: COLLEAGUE_V2_QUESTIONS as unknown as WitnessQuestion[],
};

/** All v2 questionnaires indexed by id. */
export const WITNESS_V2_QUESTIONNAIRES: Record<string, Questionnaire> = {
  [WITNESS_V2_FRIEND.id]: WITNESS_V2_FRIEND,
  [WITNESS_V2_FAMILY.id]: WITNESS_V2_FAMILY,
  [WITNESS_V2_COLLEAGUE.id]: WITNESS_V2_COLLEAGUE,
};

/**
 * Pick the best questionnaire variant for a given relation string.
 *
 * When an invite specifies a `questionnaireId` in the v2 set, that wins.
 * Otherwise we guess from the relation label.
 */
export function pickV2Questionnaire(relation?: string): Questionnaire {
  if (!relation) return WITNESS_V2_FRIEND;
  const lower = relation.toLowerCase();
  if (/家人|父|母|兄|弟|姐|妹|爸|妈|爷|奶|亲戚|叔|姑|舅|姨|婆|媳|女儿|儿子|孩子/.test(lower)) {
    return WITNESS_V2_FAMILY;
  }
  if (/同事|领导|上司|下属|老板|经理|主管|合伙人|搭档/.test(lower)) {
    return WITNESS_V2_COLLEAGUE;
  }
  return WITNESS_V2_FRIEND;
}
