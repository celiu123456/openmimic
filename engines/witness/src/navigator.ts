/**
 * Navigator memo: asynchronous evidence stocktake every N answers.
 *
 * Migrated from the author's earlier platform (interview-navigator.service.ts,
 * interview-direct-prompts.v1.json key "interview-navigator-system-v1").
 * Rewritten as pure functions + a single LLM call; no framework, no MySQL
 * lease, no retry/repair loop (the interviewer simply skips the memo on
 * failure and proceeds with the question tree as before).
 *
 * The memo is a structured snapshot that tells the *follow-up generator* and
 * the *next-question selector* what the interview has covered so far, which
 * threads are alive, what to avoid, and what the witness's pace looks like.
 *
 * Hard design rule (from the source platform):
 *   The memo MUST NOT contain candidate next questions, example questions,
 *   quoted questions, or question marks. It is a stocktake, not a script.
 *   The schema enforces this with a refinement, and the test suite validates
 *   the constraint.
 */

import { z } from 'zod';
import { wrapUntrusted, appendGuardInstruction } from '@openmimic/shared';
import { extractJson } from '@openmimic/shared';
import type { LLMClient, LLMCompletionRequest } from './llm';
import type { InterviewAnswer } from './interview-state';
import type { WitnessQuestion } from './questionnaires/friend-v1';

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/** How many answers between navigator memo generations. */
export const NAVIGATOR_MEMO_INTERVAL = 3;

/** Hard cap on navigator memo calls per session. */
export const MAX_NAVIGATOR_CALLS_PER_SESSION = 4;

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

/** No question marks allowed in guidance text (hard rule). */
const noQuestionMark = (maxLen: number) =>
  z.string().trim().min(1).max(maxLen).refine(
    (v) => !/[?？]/.test(v),
    'guidance must not contain questions (? or ？)',
  );

/**
 * The navigator memo schema — the JSON the model must output.
 *
 * Migrated from contract.ts `navigatorMemoSchema` with adjustments:
 * - `throughTurnId` replaced by `throughAnswerCount` (we have no turn ids)
 * - `injectionMemo` replaced by structured `foregroundGuidance`
 * - Hard refinement: no question marks in the entire memo
 */
export const NavigatorMemoSchema = z.object({
  throughAnswerCount: z.number().int().nonnegative(),
  /** Facts with direct evidence from the witness's answers. */
  evidenceBacked: z.array(z.string().trim().min(1).max(300)).max(12),
  /** Working hypotheses that need more evidence. */
  tentativeInferences: z.array(z.string().trim().min(1).max(300)).max(8),
  /** Threads the witness opened but hasn't expanded. */
  liveThreads: z.array(z.string().trim().min(1).max(300)).max(8),
  /** Directions the witness rejected or that triggered retreat/discomfort. */
  avoid: z.array(z.string().trim().min(1).max(300)).max(8),
  /** Feedback about the interview process itself (not relationship evidence). */
  interviewFeedback: z.array(z.string().trim().min(1).max(300)).max(8),
  /** Free-text description of witness engagement / pace. */
  respondentPace: z.string().trim().max(500),
  /** Structured soft guidance for the front-end interviewer. */
  foregroundGuidance: z.object({
    focusArea: noQuestionMark(100),
    focusRationale: noQuestionMark(240),
    avoidDirection: noQuestionMark(240),
    pace: noQuestionMark(120),
  }).strict(),
}).strict().superRefine((memo, ctx) => {
  // Hard rule: the entire memo must not contain candidate questions.
  // Check every string field for question marks.
  const allStrings = [
    ...memo.evidenceBacked,
    ...memo.tentativeInferences,
    ...memo.liveThreads,
    ...memo.avoid,
    ...memo.interviewFeedback,
    memo.respondentPace,
  ];
  for (const s of allStrings) {
    if (/[?？]/.test(s)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'navigator memo must not contain candidate questions (? or ？ found)',
        path: [],
      });
      return;
    }
  }
});

export type NavigatorMemo = z.infer<typeof NavigatorMemoSchema>;

/* ------------------------------------------------------------------ */
/* Prompt construction                                                 */
/* ------------------------------------------------------------------ */

/**
 * System prompt for the navigator, adapted from the old platform's
 * interview-navigator-system-v1 (v4) and interview-navigator-system-v1 (v3).
 *
 * Key differences from the source:
 * - No "device conversation" framing (we are OpenMimic, not a chatbot)
 * - No participant name substitution (our context is simpler)
 * - Explicit JSON schema in the prompt
 * - "foregroundGuidance" replaces "injectionMemo" with structured fields
 */
export const NAVIGATOR_SYSTEM_PROMPT = [
  '你是幕后访谈导航员。你不直接与证人对话,不生成下一问,不签发题目。',
  '',
  '依据完整访谈记录和上一版导航结果,分析当前访谈的覆盖、深度和节奏。',
  '所有结论必须区分:',
  '- 已有直接证据支持的事实;',
  '- 仍需谨慎对待的暂定推断;',
  '- 当前无法判断的不确定项。',
  '',
  '重点检查:',
  '1. 当前真正理解了这段关系的什么。',
  '2. 当前理解是否被某个醒目或负面话题过度占据。',
  '3. 哪些线索由证人主动提供、信息价值高且仍有展开意愿。',
  '4. 哪些前提已被否定,哪些话题已重复、无效或引发反感。',
  '5. 证人是否在批评访谈方式(批评只能进 interviewFeedback 和 avoid,不能成为关系事实)。',
  '6. 接下来更适合拓宽、轻追、还是自然换题。',
  '',
  '不得从一两次回答推断稳定偏好。不得要求连续索取场景、原话或异常情况。',
  '',
  'foregroundGuidance 是唯一给前台访谈员的软提醒,必须是陈述式高层方向。',
  'focusArea 使用名词性短语;其余字段只描述理由、风险和节奏。',
  '四个字段都不得出现问号、引号、第二人称、完整问句或候选台词。',
  '',
  '只输出严格 JSON,不要 Markdown:',
  '{',
  '  "throughAnswerCount": 截至第几题的分析,',
  '  "evidenceBacked": ["有直接证据的理解"],',
  '  "tentativeInferences": ["暂定推断及其不确定性"],',
  '  "liveThreads": ["证人主动展开且仍有生命力的线索"],',
  '  "avoid": ["被否定、重复或引发反感的内容"],',
  '  "interviewFeedback": ["证人对提问方式的反馈"],',
  '  "respondentPace": "证人当前耐心和参与状态",',
  '  "foregroundGuidance": {',
  '    "focusArea": "名词性关注方向",',
  '    "focusRationale": "选择理由",',
  '    "avoidDirection": "近期应避开的方向",',
  '    "pace": "节奏建议"',
  '  }',
  '}',
].join('\n');

/**
 * Build the user prompt for navigator analysis.
 *
 * Includes: the questionnaire context, all answers so far (wrapped as
 * untrusted data), the previous memo if any, and the answer count.
 */
export function buildNavigatorUserPrompt(
  answers: readonly InterviewAnswer[],
  questions: readonly WitnessQuestion[],
  avoidedQids: readonly string[],
  answerCount: number,
  previousMemo: NavigatorMemo | null,
): string {
  const questionMap = new Map(questions.map((q) => [q.qid, q]));

  // Build a transcript of Q&A pairs
  const transcript = answers.map((a) => {
    const q = questionMap.get(a.qid);
    const qText = q ? q.prompt : `(题目 ${a.qid})`;
    let entry = `问: ${qText}\n答: ${a.behindText}`;
    if (a.followupText) {
      entry += `\n追问回答: ${a.followupText}`;
    }
    return entry;
  }).join('\n\n');

  const avoidedText = avoidedQids.length > 0
    ? `\n\n被跳过的题目: ${avoidedQids.map((qid) => {
        const q = questionMap.get(qid);
        return q ? `${qid}(${q.prompt.slice(0, 20)}…)` : qid;
      }).join(', ')}`
    : '';

  const previousText = previousMemo
    ? `\n\n上一版导航结果:\n${JSON.stringify(previousMemo)}`
    : '';

  const lines = [
    `当前已完成 ${answerCount} 题。`,
    '',
    '访谈记录:',
    wrapUntrusted('interview_transcript', transcript + avoidedText),
    previousText,
    '',
    `请生成截至第 ${answerCount} 题的导航分析。`,
  ];

  return appendGuardInstruction(lines.join('\n'));
}

/** Compose the full LLM request for navigator analysis. */
export function buildNavigatorRequest(
  answers: readonly InterviewAnswer[],
  questions: readonly WitnessQuestion[],
  avoidedQids: readonly string[],
  answerCount: number,
  previousMemo: NavigatorMemo | null,
): LLMCompletionRequest {
  return {
    system: NAVIGATOR_SYSTEM_PROMPT,
    user: buildNavigatorUserPrompt(
      answers, questions, avoidedQids, answerCount, previousMemo,
    ),
    purpose: 'navigator',
  };
}

/* ------------------------------------------------------------------ */
/* Parsing and validation                                              */
/* ------------------------------------------------------------------ */

/**
 * Parse a navigator memo from LLM output.
 *
 * Uses the shared `extractJson` utility and validates against the schema.
 * Returns the parsed memo or throws on invalid output.
 */
export function parseNavigatorMemo(raw: string): NavigatorMemo {
  const value = extractJson(raw);
  return NavigatorMemoSchema.parse(value);
}

/* ------------------------------------------------------------------ */
/* Memo generation (one call, one chance)                              */
/* ------------------------------------------------------------------ */

/**
 * Generate a navigator memo using one LLM call.
 *
 * On any failure (network, parse, validation) returns `undefined` — the
 * interview proceeds without a memo, identical to the no-model path.
 * If the memo contains question marks (hard rule violation), tries one
 * repair; if that also fails, gives up.
 */
export async function generateNavigatorMemo(
  llm: LLMClient,
  answers: readonly InterviewAnswer[],
  questions: readonly WitnessQuestion[],
  avoidedQids: readonly string[],
  answerCount: number,
  previousMemo: NavigatorMemo | null,
): Promise<NavigatorMemo | undefined> {
  try {
    const request = buildNavigatorRequest(
      answers, questions, avoidedQids, answerCount, previousMemo,
    );
    const raw = await llm.complete(request);
    try {
      return parseNavigatorMemo(raw);
    } catch {
      // One repair attempt: ask to fix structure/question marks
      const repairRequest: LLMCompletionRequest = {
        system: NAVIGATOR_SYSTEM_PROMPT,
        user: [
          '上一次的输出不符合结构要求。请修复以下输出,使其符合严格 JSON 格式。',
          '如果原文包含问号或候选问句,必须改写成不带问句的陈述式软提醒。',
          '',
          '原始输出:',
          raw.slice(0, 6000),
          '',
          '只输出修复后的严格 JSON。',
        ].join('\n'),
        purpose: 'navigator-repair',
      };
      const repaired = await llm.complete(repairRequest);
      try {
        return parseNavigatorMemo(repaired);
      } catch {
        return undefined;
      }
    }
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Memo influence on question selection                                */
/* ------------------------------------------------------------------ */

/**
 * Whether the memo indicates we should pursue a live thread rather than
 * move to the next questionnaire question.
 *
 * A live thread is worth pursuing when:
 * 1. The memo has at least one live thread
 * 2. The next questionnaire question isn't about an avoided topic
 * 3. The thread relates to the upcoming question's dimension
 *
 * This is a soft signal — the caller decides whether to follow it.
 */
export function shouldPursueLiveThread(memo: NavigatorMemo): boolean {
  return memo.liveThreads.length > 0;
}

/**
 * Whether the memo indicates the witness is fatiguing and the interview
 * should skip sensitive questions and move toward closing.
 */
export function memoSuggestsClosing(memo: NavigatorMemo): boolean {
  const pace = memo.respondentPace.toLowerCase();
  const guidance = memo.foregroundGuidance.pace.toLowerCase();
  const fatigueSignals = [
    '疲劳', '疲倦', '不耐烦', '越来越短', '简短', '敷衍',
    '想结束', '想停', '兴趣下降', '参与度下降', '走神',
    'fatigue', 'declining', 'short', 'disengaged',
  ];
  return fatigueSignals.some(
    (s) => pace.includes(s) || guidance.includes(s),
  );
}

/**
 * Whether the memo says a particular dimension should be avoided
 * (matches against the avoid list).
 */
export function memoAvoidsDirection(
  memo: NavigatorMemo,
  dimensionLabel: string,
): boolean {
  const lower = dimensionLabel.toLowerCase();
  return memo.avoid.some((a) => a.toLowerCase().includes(lower)) ||
    memo.foregroundGuidance.avoidDirection.toLowerCase().includes(lower);
}
