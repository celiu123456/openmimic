/**
 * Sample hygiene checker for liveness evaluation.
 *
 * Before any liveness calibration or evaluation, both human and AI
 * samples pass through these contamination checks. A contaminated
 * sample is excluded — it would corrupt the ground truth.
 *
 * Ported from personality_structure_server/eval/discrimination-baseline-rules.js,
 * with old-platform-specific patterns removed (card effects, voice
 * policy contracts, paired-trigger fingerprinting, provenance audit).
 */

export interface HygieneResult {
  clean: boolean;
  reasons: string[];
}

export type ContaminationCode =
  | 'ai_identity_leak'
  | 'prompt_leak'
  | 'seed_or_fixture_marker'
  | 'stage_direction'
  | 'emoji_spam'
  | 'too_long';

interface ContaminationRule {
  code: ContaminationCode;
  pattern: RegExp;
}

/**
 * Contamination patterns. Each hit adds a reason code.
 *
 * These are generic checks applicable to any persona simulation
 * platform — old-platform-specific patterns (card_effect_leak,
 * template_reply_prefix, voice_policy_contract) are removed.
 */
const CONTAMINATION_RULES: ContaminationRule[] = [
  {
    code: 'ai_identity_leak',
    pattern: /作为(?:一个)?AI|AI语言模型|人工智能助手|我是AI|I am an AI/iu,
  },
  {
    code: 'prompt_leak',
    pattern:
      /system\s*prompt|系统提示词|你的设定是|你是一个\s*(?:AI|语言模型|人工智能)/iu,
  },
  {
    code: 'seed_or_fixture_marker',
    pattern: /(?:seed|fixture|probe|contract)[-_ ]?\d{3,}/iu,
  },
  {
    code: 'stage_direction',
    pattern: /（[^）]{4,}(?:轻笑|低语|靠近|呼吸|指尖|挑眉|歪头)[^）]*）/u,
  },
];

/** Maximum emoji count before flagging as emoji spam. */
const MAX_EMOJI_COUNT = 3;

/** Maximum text length before flagging as too long. */
const MAX_TEXT_LENGTH = 280;

/** Maximum line count before flagging. */
const MAX_LINE_COUNT = 6;

/**
 * Check a single text sample for contamination.
 */
export function checkSampleHygiene(text: string): HygieneResult {
  const content = String(text || '').trim();
  const reasons: string[] = [];

  // Pattern checks
  for (const rule of CONTAMINATION_RULES) {
    if (rule.pattern.test(content)) {
      reasons.push(rule.code);
    }
  }

  // Emoji spam
  const emojiCount = (content.match(/\p{Extended_Pictographic}/gu) ?? [])
    .length;
  if (emojiCount > MAX_EMOJI_COUNT) {
    reasons.push('emoji_spam');
  }

  // Length checks
  if (
    content.length > MAX_TEXT_LENGTH ||
    (content ? content.split('\n').length : 0) > MAX_LINE_COUNT
  ) {
    reasons.push('too_long');
  }

  return {
    clean: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
  };
}

/**
 * Batch-check an array of samples, returning only the clean ones
 * along with counts of excluded samples by reason.
 */
export function filterCleanSamples(
  samples: string[],
): {
  clean: string[];
  excluded: number;
  reasonCounts: Record<string, number>;
} {
  const clean: string[] = [];
  const reasonCounts: Record<string, number> = {};
  let excluded = 0;

  for (const sample of samples) {
    const result = checkSampleHygiene(sample);
    if (result.clean) {
      clean.push(sample);
    } else {
      excluded++;
      for (const reason of result.reasons) {
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
      }
    }
  }

  return { clean, excluded, reasonCounts };
}
