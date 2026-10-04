/**
 * W3a mental-health word list.
 *
 * Two deliberately small lists rather than a classifier:
 *
 * - {@link CRISIS_WORDS} guards the *topic seed*. If someone opens a room
 *   about self-harm or suicide, the room refuses to start
 *   ({@link RoomRefusedError}) — this layer must never improvise a persona
 *   response to an acute crisis.
 * - {@link DIAGNOSIS_WORDS} guards the *generated lines*. A persona must not
 *   put clinical labels in a friend's mouth ("he's bipolar"); the line is
 *   rewritten as a factual observation once, and dropped to a stage direction
 *   if it persists.
 *
 * The list is intentionally naive substring matching: it is a cheap floor, not
 * a medical screening instrument, and it is meant to be reviewed by humans.
 *
 * CRISIS_WORDS and findCrisisWord are canonical in kernel/gate and re-exported
 * here for backward compatibility.
 */

// Re-export from kernel (the canonical location)
export { CRISIS_WORDS, findCrisisWord } from '@openmimic/kernel';

import { CRISIS_WORDS } from '@openmimic/kernel';

export const DIAGNOSIS_WORDS: readonly string[] = [
  '抑郁症',
  '焦虑症',
  '双相',
  '躁郁',
  '精神分裂',
  '人格障碍',
  '边缘型',
  '强迫症',
  '创伤后应激',
  '社交恐惧症',
  '惊恐发作',
  '精神病',
  '心理疾病',
  '心理有病',
  '心理问题',
  '心理医生',
  '心理咨询',
  '确诊',
  '躁狂',
  '妄想',
  '偏执',
  '自恋型',
  '多动症',
  'ADHD',
  '病态',
  '不正常',
];

/** Every word the list knows, de-duplicated and in declaration order. */
export const MENTAL_HEALTH_WORDS: readonly string[] = [
  ...new Set([...CRISIS_WORDS, ...DIAGNOSIS_WORDS]),
];

function findWord(text: string, words: readonly string[]): string | undefined {
  for (const word of words) {
    if (word.length > 0 && text.includes(word)) return word;
  }
  return undefined;
}

/** First quasi-diagnostic expression that appears in `text`, if any. */
export function findDiagnosisWord(text: string): string | undefined {
  return findWord(text, DIAGNOSIS_WORDS);
}
