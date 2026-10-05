/**
 * Guard prompt rules.
 *
 * Three structural guardrails migrated from the old platform's
 * prompt_templates table. They are constant strings — not LLM-
 * generated — meant to be injected into system prompts or
 * appended as guard instructions.
 *
 * Keys match the old platform:
 *   interview-memory-source-guard
 *   mem0-contradiction-check
 *   ai-observer-guard
 */

/* ------------------------------------------------------------------ */
/* Source guard (interview/filing)                                      */
/* ------------------------------------------------------------------ */

/**
 * Prevents the model from extracting "facts" from its own examples,
 * hypotheticals, or interview assistant context.
 *
 * Injected into filing and interview prompts.
 */
export const SOURCE_GUARD = [
  '【事实来源守卫】',
  '事实来源只能是访谈者原始回答。',
  '访谈助手语境只用于理解用户在回应什么问题或追问方向;',
  '不得把助手语境中的事件、地点、人物、物品、比喻或举例提取为事实记忆。',
  '如果助手语境和用户原始回答不一致,以用户原始回答为准。',
  '每条原始回答至少提取一条可用于数字人格建构的记忆;',
  '如果一条回答包含多个稳定特征,可以拆成多条。',
].join('\n');

/* ------------------------------------------------------------------ */
/* Contradiction check rules                                           */
/* ------------------------------------------------------------------ */

/**
 * Rules for the contradiction / divergence detector.
 *
 * Injected into the relation-judgment and confrontation prompts.
 * Prevents false-positive contradiction detection on perspective
 * differences and time evolution.
 */
export const CONTRADICTION_CHECK_RULES = [
  '【矛盾判定规则】',
  '不同人对同一个人的不同评价不算矛盾(如家人觉得温和、同事觉得严厉)。',
  '同一个人在不同时期的变化不算矛盾(如以前喜欢、现在不喜欢)。',
  '只有在同一时间、同一视角下的完全对立才算矛盾。',
].join('\n');

/* ------------------------------------------------------------------ */
/* Observer guard (AI observer mode)                                   */
/* ------------------------------------------------------------------ */

/**
 * Hard boundaries for AI observer mode: observe only, no advice,
 * no judgment, no diagnosis.
 *
 * Injected into observer-mode system prompts.
 */
export const OBSERVER_GUARD = [
  '【AI观测者硬边界】',
  '只观察并描述互动模式,不提供建议。',
  '不评判谁对谁错,不诊断心理疾病、人格障碍或亲密关系问题。',
  '不使用操控性话术,不输出可以直接拿去发送给对方的话。',
  '使用谨慎表达:「我观察到」「看起来像是」「这里有一个信号」——所有判断必须基于证据。',
].join('\n');
