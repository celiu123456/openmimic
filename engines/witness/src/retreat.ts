/**
 * Sensitive retreat detection.
 *
 * Ported from the author's earlier platform (InterviewSensitiveRetreatService).
 * Pure functions — no framework, no DB, no LLM.
 *
 * Distinguishes volitional refusal ("I don't want to talk about this") from
 * memory inability ("I can't remember"). The latter is NOT a retreat.
 */

/** Result of retreat detection on a single answer text. */
export interface RetreatCue {
  /** The kind of retreat detected. */
  kind: 'volitional_refusal' | 'distress_withdrawal';
}

/* ------------------------------------------------------------------ */
/* Patterns                                                            */
/* ------------------------------------------------------------------ */

/**
 * Volitional refusal: the witness explicitly refuses to discuss this.
 * Added "他/她/TA"-related variants for the OpenMimic witness context.
 */
const RETREAT_VOLITIONAL =
  /(不想说|不愿说|不想聊|不愿聊|不想谈|不愿谈|不想提|不愿提|不想回答|不想讲|不愿讲|别问了?|别再问|不要问|不想回忆|这个不(?:说|谈|聊|提)|不(?:说|谈|聊|提)这个|不谈这个|换个话题|说点别的|聊点别的|别提(?:这个|了)|到此为止|打住|过去了?就别(?:提|说)|这事儿?不(?:说|提)了?|关于(?:他|她|TA)这个不想说|别问(?:他|她|TA)这个)/;

/** Distress withdrawal: strong emotional pain + avoidance tone. */
const RETREAT_DISTRESS =
  /(太(?:难受|痛苦|伤心)|很(?:难受|痛苦|伤心)了?|受不了|说不下去|不想再想)/;

/** Memory inability: NOT a retreat. Excludes "记不清" etc. from retreat detection. */
const MEMORY_INABILITY = /(记不(?:清|得)|想不起来?|忘(?:了|记)|不记得)/;

/** User explicitly reopening a cautious topic. */
const REOPEN_POSITIVE =
  /(其实我想(?:说|聊|讲)|我(?:还是)?想(?:说|聊|讲|说说|聊聊)一下|我可以(?:说|聊|讲)|现在(?:可以|想)(?:说|聊|讲)|我想起来|后来我|那时候我|我决定|我坚持|我做到|说回|接着说|继续(?:说|聊)那个)/;

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Detect a volitional retreat cue in witness text.
 *
 * Returns the kind of retreat if found, or `undefined` if the text is not
 * a retreat. "记不清" (can't remember) is explicitly excluded.
 */
export function detectRetreat(text: string): RetreatCue | undefined {
  const value = String(text || '').trim();
  if (!value) return undefined;

  if (RETREAT_VOLITIONAL.test(value)) {
    return { kind: 'volitional_refusal' };
  }

  // Distress is only a retreat when it's not dominated by memory inability.
  if (RETREAT_DISTRESS.test(value) && !MEMORY_INABILITY.test(value)) {
    return { kind: 'distress_withdrawal' };
  }

  return undefined;
}

/**
 * Detect if the witness is reopening a previously avoided topic.
 *
 * Conservative: requires positive intent, first person, no retreat cues,
 * and no question marks (to exclude questions about the process).
 */
export function detectReopen(text: string): boolean {
  const value = String(text || '').trim();
  if (value.length < 6) return false;
  if (/[?？]/.test(value)) return false;
  if (detectRetreat(value)) return false;
  if (!/(我|我们|我的)/.test(value)) return false;
  return REOPEN_POSITIVE.test(value);
}
