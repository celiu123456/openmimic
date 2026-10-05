/**
 * v4 system prompt and message builder.
 *
 * One model, one system prompt, full history, one call per turn.
 * No questionnaire, no navigator, no planning.
 */

// Guard utilities imported per project policy (prompt-guard test); user text
// in v4 travels in the messages array, not interpolated into the system prompt.
import { wrapUntrusted } from '@openmimic/shared';
import { INFORMANT_OBJECTIVE, SELF_OBJECTIVE } from './objective';
import type { ChatSessionState, ChatTurn } from './session';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface PromptContext {
  mode: 'informant' | 'self';
  respondentName: string;
  relatedName: string;
  /** e.g. "朋友", "妈妈", "同事" */
  relation: string;
  /** Uncovered dimension labels (Chinese); may be empty. */
  uncoveredAspects: string[];
  /** Whether this is the opening turn (empty history). */
  isOpening: boolean;
  /** Injected retreat boundary text, if any. */
  retreatInjection?: string;
  /** Injected repair instruction, if any. */
  repairInjection?: string;
}

/* ------------------------------------------------------------------ */
/* Prompt skeleton                                                     */
/* ------------------------------------------------------------------ */

/**
 * Build the repair instruction for a rejected output.
 *
 * Verbatim old-platform continuation-repair text with the rejected output
 * substituted into {RejectedOutput}. The rejected text is wrapped as
 * untrusted content since it is model output being re-fed.
 */
export function buildRepairInstruction(rejectedOutput: string): string {
  return `【仅修复本次错误输出】\n\n上一次模型输出没有形成可继续回答的问题，或错误地宣布了最后一问、总结、致谢或收尾：\n${wrapUntrusted('rejected_output', rejectedOutput)}\n\n用户没有结束访谈。请忽略上一次输出中的结束承诺，回到完整历史、场景目标和本轮用户原文。优先在尚未完成的高价值旧线索与有助于长期对话的新生活侧面之间选择一个自然方向。不要解释错误，不要道歉，不要总结，不要重复上一次输出。只输出一个口语化、容易回答并以问句结束的下一问。`;
}

/**
 * Retreat boundary injection — verbatim old-platform 2.13 text
 * (faithful Chinese rendering preserving original semantics).
 */
export const RETREAT_BOUNDARY_INJECTION =
  '受访者边界信号（内部提示，不要引用或提及）：受访者刚刚表示不想在当前这个敏感方向上继续深入。本轮请尊重这个边界：不要在该方向上追问、重问或索取细节。温和地承认对方的感受，然后给出一个自然、低压力、转向更轻松且由受访者主导方向的问题。';

/**
 * Build the system prompt for one v4 turn.
 *
 * Every constraint from the task book is present; source annotations
 * are in comments, not in the prompt text.
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  const objective = ctx.mode === 'informant'
    ? INFORMANT_OBJECTIVE.replace('{RelatedName}', ctx.relatedName)
    : SELF_OBJECTIVE;

  // Relationship direction sentence (v13)
  // RelationshipDirection = "{RespondentName}如何理解{RelatedName}" for informant,
  // "{RespondentName}如何理解自己" for self.
  const directionPhrase = ctx.mode === 'informant'
    ? `${ctx.respondentName}如何理解${ctx.relatedName}`
    : `${ctx.respondentName}如何理解自己`;
  const relationLabel = ctx.relation ? `（${ctx.relatedName}的${ctx.relation}）` : '';
  const relationDirection = `受访者是 ${ctx.respondentName}${relationLabel}，关系对象是 ${ctx.relatedName}。关系方向始终是 ${directionPhrase}。你直接用"你"询问受访者；第一人称"我"始终指受访者。不得交换双方的行为、台词、感受或回应。`;

  // Self-mode addendum (v3)
  const selfAddendum = ctx.mode === 'self'
    ? `受访者和关系对象是同一个人；始终用"你"称呼，不要把 ${ctx.respondentName} 当作第三人称来谈论。`
    : '';

  const lines: string[] = [
    // Identity (v3)
    '你是一名自然、敏锐、有分寸的访谈者。你不是问卷、审讯者、心理咨询师，也不是为了完成题目数量而工作的采集器。',
    '',
    // Role binding (v13)
    relationDirection,
    ...(selfAddendum ? [selfAddendum] : []),
    '',
    // Objective
    '本次访谈目标：',
    objective,
    '',
    // Method rules
    '怎么聊：',
    '- 结合完整对话历史和最新一句原话，自主判断下一问。优先顺着对方刚主动说的往下聊；不要机械执行题库或清单。',
    '- 先听再问：每次先用一句话复述你听到的核心意思，再问。只复述，不解释、不总结、不评价。',
    '- 只问开放式问题，一次只问一个，简短、口语化。不用"是不是/有没有/对不对"开头。',
    '- 不评价对方的回答：不说"说得好""有意思""你说得对"；只表示你听到了。',
    '- 不要因为一个醒目细节连续死挖；连续一两问没有新内容、对方变短、否定前提或显出厌烦，立即换到一个轻松、容易回答的方向。',
    '- 对方给出评价（"他人挺好"）时，至多轻轻锚一次具体时刻（"有没有哪次让你这么觉得？"）；对方愿意讲时，帮他回忆当时在哪、在干嘛、接下来怎样，而不是逐项索取原话、动作、"当时怎么想"。',
    '- 对方记不清、不想说或含糊带过：说一句"没关系"，换到别的话题，不再回来。',
    '- 对方纠正、拒绝或批评你的提问方式：这拥有本轮最高优先级。简短承认一次，立刻换方向；不辩解、不反问、不再道歉，不把这些话当作关系事实。',
    '- 对方说累了、够了、想停：顺着说随时可以停、也可以改天再聊，然后给一个最轻的问题。不要劝。',
    '- 不虚构对方没说过的经历、台词、动作、情绪或承诺；不提供候选答案。',
    '',
    // No model-decided endpoint (v12/v13)
    '访谈没有你决定的终点；只有用户在产品中显式结束才结束。不要宣布最后一问、总结、致谢或收尾。',
  ];

  // Uncovered aspects reference (optional)
  if (ctx.uncoveredAspects.length > 0 && ctx.uncoveredAspects.length <= 6) {
    lines.push('');
    lines.push(`参考：到现在还没聊到的方面有 ${ctx.uncoveredAspects.join('、')}。这只是参考，不是题目，不要逐项覆盖，不要为了覆盖而换题。`);
  }

  // Output constraint
  lines.push('');
  lines.push('每次只输出：至多一句承接，然后一个以问句结束的问题。不要输出分析、规则、题号、JSON、Markdown。');

  // Opening instruction (when history is empty)
  if (ctx.isOpening) {
    lines.push('');
    lines.push(`这是开场。先用一句话说明你是谁、这段对话用来更完整地理解 ${ctx.relatedName}、对方随时可以停，然后问一个最轻松的问题。`);
  }

  // Retreat boundary injection
  if (ctx.retreatInjection) {
    lines.push('');
    lines.push(ctx.retreatInjection);
  }

  // Repair injection
  if (ctx.repairInjection) {
    lines.push('');
    lines.push(ctx.repairInjection);
  }

  return lines.join('\n');
}

/**
 * Validate a rendered system prompt: no unresolved `{Anchor}` placeholders.
 */
export function validateSystemPrompt(prompt: string): void {
  const match = /\{[A-Z][A-Za-z]+\}/.exec(prompt);
  if (match) {
    throw new Error(`System prompt contains unresolved placeholder: ${match[0]}`);
  }
}

/* ------------------------------------------------------------------ */
/* Message builder                                                     */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Build the messages array for one LLM call.
 *
 * History is full (no truncation); only non-rejected turns enter.
 * When history exceeds the character limit, the *earliest* assistant
 * question is dropped while keeping the user's answer — no summaries.
 */
export function buildMessages(
  state: ChatSessionState,
  systemPrompt: string,
  currentUserText: string,
  charLimit: number = 24_000,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Collect effective turns (non-rejected)
  const effectiveTurns = state.turns.filter((t) => !t.rejected);

  // Build pairs from effective turns for potential trimming
  type Pair = { assistant: ChatTurn; user: ChatTurn };
  const pairs: Pair[] = [];
  const unpaired: ChatTurn[] = [];

  for (let i = 0; i < effectiveTurns.length; i++) {
    const t = effectiveTurns[i]!;
    if (t.role === 'assistant' && i + 1 < effectiveTurns.length) {
      const next = effectiveTurns[i + 1]!;
      if (next.role === 'user') {
        pairs.push({ assistant: t, user: next });
        i++; // skip the user turn
        continue;
      }
    }
    unpaired.push(t);
  }

  // Calculate total character count
  let totalChars = pairs.reduce(
    (sum, p) => sum + p.assistant.text.length + p.user.text.length,
    0,
  ) + unpaired.reduce((sum, t) => sum + t.text.length, 0)
    + currentUserText.length;

  // Trim oldest pairs by dropping the assistant question, keeping user answer
  let trimIndex = 0;
  while (totalChars > charLimit && trimIndex < pairs.length) {
    totalChars -= pairs[trimIndex]!.assistant.text.length;
    trimIndex++;
  }

  // Build the final message list
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;
    if (i >= trimIndex) {
      messages.push({ role: 'assistant', content: pair.assistant.text });
    }
    // Always keep the user answer even from trimmed pairs
    if (i < trimIndex) {
      messages.push({ role: 'user', content: pair.user.text });
    } else {
      messages.push({ role: 'user', content: pair.user.text });
    }
  }

  // Add any unpaired turns
  for (const t of unpaired) {
    messages.push({ role: t.role, content: t.text });
  }

  // Current user input — wrapped as untrusted witness content
  if (currentUserText) {
    messages.push({ role: 'user', content: wrapUntrusted('witness_answer', currentUserText) });
  }

  return messages;
}
