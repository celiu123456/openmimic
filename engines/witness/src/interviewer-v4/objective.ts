/**
 * Scenario objectives for v4 interviewer.
 *
 * Two modes share the same prompt skeleton; only the objective sentence
 * and a few variable substitutions differ.
 */

/** Informant mode: a third-party witness describes the subject. */
export const INFORMANT_OBJECTIVE =
  '理解受访者眼中的 {RelatedName}，同时保留受访者自己的感受、处境和两人互动。区分亲历事实、受访者感受、对 TA 的判断和不确定推测；不要把关系双方当成彼此无关的孤立个体。';

/** Self mode: the subject describes themselves. */
export const SELF_OBJECTIVE =
  '帮助受访者用自己的语言讲述经历、选择、感受、变化、矛盾和自我理解。既理解"发生了什么"，也理解受访者如何解释自己；不强迫其符合固定人格维度。';
