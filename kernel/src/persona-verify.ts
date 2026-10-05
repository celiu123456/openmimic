/**
 * Output-side persona response verification.
 *
 * After the persona model generates a reply, this module checks whether
 * the reply contains factual claims not grounded in the assembled persona
 * prompt (the evidence). Unfounded fragments trigger a rewrite; if the
 * rewrite still fabricates, the response is replaced with a safe fallback.
 *
 * Toggle: set `PERSONA_VERIFY=0` to disable (default: enabled).
 * LLM usage is tagged `persona-verify` in the usage ledger.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Minimal LLM interface required by the verifier. */
export interface VerifyLLM {
  complete(opts: {
    system: string;
    user: string;
    purpose: string;
    maxTokens?: number;
  }): Promise<string>;
}

export interface PersonaVerifyOptions {
  /** The persona system prompt that was used (contains all evidence). */
  systemPrompt: string;
  /** The user's question. */
  userMessage: string;
  /** The persona's generated response. */
  response: string;
  /** LLM client for verification call. */
  llm: VerifyLLM;
  /** Display name of the persona subject. */
  displayName: string;
}

export interface PersonaVerifyResult {
  /** Whether verification was performed (false if pre-screen passed). */
  verified: boolean;
  /** Whether the response passed verification (true = no unfounded content). */
  passed: boolean;
  /** Unfounded fragments found in the first verification, if any. */
  unfoundedFragments: string[];
  /** The final response to use (original, rewritten, or fallback). */
  finalResponse: string;
  /** How many LLM calls were made (0 if pre-screened out). */
  verifyCallCount: number;
}

/* ------------------------------------------------------------------ */
/* Pre-screening                                                       */
/* ------------------------------------------------------------------ */

/** Responses that are inherently safe (dodge / low-content). */
const SAFE_PHRASES = [
  '记不清', '记不太清', '不太确定', '不记得', '不方便说',
  '嗯', '行吧', '知道了', '还行', '就那样', '没什么',
  '这事不方便说', '说不好', '不好说', '算了',
];

/** Fact-signaling patterns — if ANY matches, the response needs verification. */
const FACT_SIGNAL_PATTERNS: RegExp[] = [
  /\d/,                                                          // numbers / digits
  /年|月|日|号|天|次|回|岁|点|分钟|小时|周|星期/,                  // time words
  /因为|所以|后来|结果|然后|于是|导致/,                            // causal / result
  /大学|学校|公司|医院|城市|北京|上海|广州|深圳/,                   // institutions / places
  /好|坏|病|伤|痛|累|忙|怕|急|难|重|轻/,                          // evaluative / physical
  /搬|借|还|买|卖|做|去|来|走|跑|说|讲|问|答|帮|给|送|拿|找/,       // action verbs (specific events)
];

/**
 * Return true when the response is safe to pass through without LLM
 * verification (pure greetings, dodges, or low-content replies).
 */
function preScreenPass(response: string): boolean {
  const trimmed = response.trim();

  // Very short responses are safe
  if (trimmed.length < 10) return true;

  // Pure safe-phrase responses
  const stripped = trimmed.replace(/[，。！？、\s…]+/g, '');
  if (SAFE_PHRASES.some((p) => stripped === p)) return true;

  // No fact-signaling patterns → safe
  if (!FACT_SIGNAL_PATTERNS.some((pat) => pat.test(trimmed))) return true;

  return false;
}

/* ------------------------------------------------------------------ */
/* LLM verification                                                    */
/* ------------------------------------------------------------------ */

const VERIFY_SYSTEM = [
  '你是人格回答核查器。输入是:',
  '1. 人格提示词(包含所有可用素材:论断、事例、语料、自述)',
  '2. 用户问题',
  '3. 人格的回答',
  '',
  '任务:逐句检查人格回答,找出素材里**没有依据**的具体细节。',
  '- "没有依据"的定义:回答中出现了素材里没有写明的具体事实(人名、地点、时间、金额、原因、结果、行为细节)。',
  '- 模糊表达(如"嗯""还行""记不太清")不算无据。',
  '- 素材里有笼统描述但回答加了具体细节,算部分无据。',
  '',
  '只输出JSON:{"unfounded": ["无据片段1", "无据片段2"]}',
  '如果全部有据,输出:{"unfounded": []}',
].join('\n');

function buildVerifyUser(
  systemPrompt: string,
  userMessage: string,
  response: string,
): string {
  return [
    '【人格提示词】',
    systemPrompt,
    '',
    '【用户问题】',
    userMessage,
    '',
    '【人格回答】',
    response,
  ].join('\n');
}

function buildRewriteSystem(fragments: string[]): string {
  return [
    '你是人格回答改写器。去除下列无据片段,保留有据部分,保持口吻。',
    '如果去除后什么都不剩,输出一句该人格口吻的回避("记不太清了""这事不方便说")。',
    '',
    `无据片段:${fragments.join(', ')}`,
  ].join('\n');
}

/** Best-effort JSON extraction for the verify response. */
function parseUnfounded(raw: string): string[] {
  try {
    // Try to find JSON in the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed.unfounded)) {
      return parsed.unfounded.filter((s: unknown) => typeof s === 'string' && s.length > 0);
    }
    return [];
  } catch {
    return [];
  }
}

const FALLBACK_RESPONSE = '记不太清了。';

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

/**
 * Verify a persona response against evidence and rewrite if needed.
 *
 * **Streaming note**: in streaming mode the caller should buffer the full
 * response before calling this function. This adds latency equal to one
 * verification LLM call (~1-3s) when the pre-screen does not pass.
 * Set `PERSONA_VERIFY=0` to disable for latency-sensitive paths.
 *
 * LLM usage is tagged `persona-verify` in the usage ledger.
 */
export async function verifyPersonaResponse(
  opts: PersonaVerifyOptions,
): Promise<PersonaVerifyResult> {
  const { systemPrompt, userMessage, response, llm, displayName: _displayName } = opts;

  // Environment toggle (default: enabled)
  if (process.env.PERSONA_VERIFY === '0') {
    return {
      verified: false,
      passed: true,
      unfoundedFragments: [],
      finalResponse: response,
      verifyCallCount: 0,
    };
  }

  // Pre-screen: skip verification for safe responses
  if (preScreenPass(response)) {
    return {
      verified: false,
      passed: true,
      unfoundedFragments: [],
      finalResponse: response,
      verifyCallCount: 0,
    };
  }

  let callCount = 0;

  // --- First verification ---
  const verifyRaw = await llm.complete({
    system: VERIFY_SYSTEM,
    user: buildVerifyUser(systemPrompt, userMessage, response),
    purpose: 'persona-verify',
    maxTokens: 512,
  });
  callCount++;

  const unfounded = parseUnfounded(verifyRaw);

  if (unfounded.length === 0) {
    return {
      verified: true,
      passed: true,
      unfoundedFragments: [],
      finalResponse: response,
      verifyCallCount: callCount,
    };
  }

  // --- Rewrite ---
  const rewritten = await llm.complete({
    system: buildRewriteSystem(unfounded),
    user: response,
    purpose: 'persona-verify',
    maxTokens: 256,
  });
  callCount++;

  // --- Re-verify ---
  const reVerifyRaw = await llm.complete({
    system: VERIFY_SYSTEM,
    user: buildVerifyUser(systemPrompt, userMessage, rewritten),
    purpose: 'persona-verify',
    maxTokens: 512,
  });
  callCount++;

  const reUnfounded = parseUnfounded(reVerifyRaw);

  if (reUnfounded.length === 0) {
    return {
      verified: true,
      passed: false,
      unfoundedFragments: unfounded,
      finalResponse: rewritten,
      verifyCallCount: callCount,
    };
  }

  // Still unfounded after rewrite → fallback
  return {
    verified: true,
    passed: false,
    unfoundedFragments: unfounded,
    finalResponse: FALLBACK_RESPONSE,
    verifyCallCount: callCount,
  };
}
