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
  /**
   * Topic labels of content excluded from the persona prompt due to
   * privacy/secrecy markers. When provided, the verifier will flag
   * responses that confirm or deny user premises touching these topics.
   * Contains only short topic markers (e.g. "借钱"), NOT the private
   * content itself.
   */
  excludedPrivateTopics?: string[];
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
  '1. 人格提示词(包含所有可用素材:论断、事例、语料、自述;事例标签含"他叫对方:X"的称呼线索)',
  '2. 用户问题',
  '3. 人格的回答',
  '',
  '任务:逐句检查人格回答,把每一个具体细节归入以下四类之一:',
  '',
  'A. contradicts — 与素材矛盾(回答说的和素材写的相反或冲突)',
  'B. unsupported — 素材里没有的新增具体事实(人名、地点、时间、金额、原因、结果、行为细节)',
  'C. off_topic — 用户明确问的是一件具体的事,回答讲的却是素材里的另一件事(即使那件事本身有据,也算答非所问)',
  'D. user_premise — 仅复述/承认/否认用户问题里已经提到的事物(不算无据)',
  '',
  '判定规则:',
  '- 用户问题里提到的人名、事件、称呼:人格对此进行承认、否认或简短回应,不算无据——归入 user_premise。',
  '- 素材事例标签里的称呼线索(如"他叫对方:周野")说明了该关系人的真实称呼,引用这些称呼不算无据。',
  '- 人格在回应时新增了素材里没有的具体细节(如补充了时间、地点、原因等),那些新增部分归 unsupported。',
  '- 用户问"搬家"的事,回答却讲了"住院"的事——即使住院确有素材,这也是 off_topic。',
  '- 模糊表达(如"嗯""还行""记不太清")不算无据。',
  '',
  '只输出JSON:',
  '{"contradicts":["..."],"unsupported":["..."],"off_topic":["..."],"user_premise":["..."]}',
  '任何一类为空就写空数组。',
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
    '你是人格回答改写器。去除下列无据或答非所问的片段,保留有据部分,保持口吻。',
    '如果去除后什么都不剩,输出一句该人格口吻的回避("记不太清了""这事不方便说")。',
    '★重要:不要用"没有"去否认用户问到的事——否认本身是一个事实断言。如果素材里找不到用户问的那件事,说"记不太清了"而不是否认。',
    '',
    `需去除的片段:${fragments.join(', ')}`,
  ].join('\n');
}

/** Parsed verification result with structured categories. */
export interface VerifyCategories {
  contradicts: string[];
  unsupported: string[];
  offTopic: string[];
  userPremise: string[];
}

/** Best-effort JSON extraction for the verify response. */
function parseVerifyResult(raw: string): VerifyCategories {
  const empty: VerifyCategories = { contradicts: [], unsupported: [], offTopic: [], userPremise: [] };
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return empty;
    const parsed = JSON.parse(jsonMatch[0]);

    const toArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : [];

    // New structured format
    if ('contradicts' in parsed || 'unsupported' in parsed || 'off_topic' in parsed || 'user_premise' in parsed) {
      return {
        contradicts: toArr(parsed.contradicts),
        unsupported: toArr(parsed.unsupported),
        offTopic: toArr(parsed.off_topic),
        userPremise: toArr(parsed.user_premise),
      };
    }

    // Legacy format fallback: {"unfounded": [...]}
    if (Array.isArray(parsed.unfounded)) {
      return { contradicts: [], unsupported: toArr(parsed.unfounded), offTopic: [], userPremise: [] };
    }

    return empty;
  } catch {
    return empty;
  }
}

/** Extract only the actionable unfounded fragments (contradicts + unsupported + off_topic). */
function getUnfounded(cats: VerifyCategories): string[] {
  return [...cats.contradicts, ...cats.unsupported, ...cats.offTopic];
}

const FALLBACK_RESPONSE = '记不太清了。';

/** Deflection response for questions about privately-excluded topics. */
const PRIVATE_TOPIC_DEFLECTION = '这事不方便说。';

/**
 * Confirmation/denial patterns that indicate the persona is acknowledging
 * or explicitly refusing a factual premise from the user's question.
 */
const CONFIRM_DENY_PATTERNS: RegExp[] = [
  /^[是嗯对啊]的?[,，。！]?/,         // "是的" "嗯" "对"
  /^没[有错]?[,，。！]?/,              // "没有" "没"
  /^不是[,，。！]?/,                    // "不是"
  /^确实[,，。！]?/,                    // "确实"
  /[借做去来过了]过/,                    // verb+过 confirmation pattern
  /^(有|没有)这[回个件]事/,             // "有这回事" "没有这件事"
];

/** Function-word characters that should not count as topic signals. */
const STOP_CHARS = new Set('的了是在有他她我你不也就都很和跟对这那个人说么什吗呢把被让给到为以上下中大小多少可会能要想着过被与');

/**
 * Extract content characters from a Chinese text: characters that carry
 * topical meaning (not punctuation, not function words).
 */
function extractContentChars(text: string): Set<string> {
  const chars = new Set<string>();
  for (const ch of text) {
    // Only keep CJK characters that are not stop words
    if (/[一-鿿]/.test(ch) && !STOP_CHARS.has(ch)) {
      chars.add(ch);
    }
  }
  return chars;
}

/**
 * Check whether the user's question touches any of the excluded private
 * topics, and whether the response confirms or denies it.
 *
 * Returns the deflection response if a private topic confirmation/denial
 * is detected, or null if the response is safe.
 */
function checkPrivateTopicConfirmation(
  userMessage: string,
  response: string,
  excludedPrivateTopics: readonly string[],
): string | null {
  if (excludedPrivateTopics.length === 0) return null;

  const userChars = extractContentChars(userMessage);

  // Check if the user's question references any excluded private topic.
  // A topic is "referenced" if:
  //   (a) the full topic substring appears in the user message, OR
  //   (b) at least 1 content character from the topic appears in the user
  //       message (single-char match suffices because Chinese content
  //       morphemes like 借/辞/病 are highly specific to their domain).
  const touched = excludedPrivateTopics.some((topic) => {
    if (userMessage.includes(topic)) return true;
    const topicChars = extractContentChars(topic);
    for (const ch of topicChars) {
      if (userChars.has(ch)) return true;
    }
    return false;
  });
  if (!touched) return null;

  // Check if the response confirms or denies the premise
  const trimmedResponse = response.trim();
  if (CONFIRM_DENY_PATTERNS.some((pat) => pat.test(trimmedResponse))) {
    return PRIVATE_TOPIC_DEFLECTION;
  }

  return null;
}

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
  const { systemPrompt, userMessage, response, llm, displayName: _displayName, excludedPrivateTopics } = opts;

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

  // Private topic confirmation/denial check (runs BEFORE pre-screen because
  // short confirmations like "借过" would be pre-screened out as safe).
  if (excludedPrivateTopics && excludedPrivateTopics.length > 0) {
    const deflection = checkPrivateTopicConfirmation(
      userMessage,
      response,
      excludedPrivateTopics,
    );
    if (deflection) {
      return {
        verified: true,
        passed: false,
        unfoundedFragments: [response],
        finalResponse: deflection,
        verifyCallCount: 0,
      };
    }
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

  const cats = parseVerifyResult(verifyRaw);
  const unfounded = getUnfounded(cats);

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

  const reCats = parseVerifyResult(reVerifyRaw);
  const reUnfounded = getUnfounded(reCats);

  if (reUnfounded.length === 0) {
    // Safety check: if the rewrite still contains a bare denial ("没有") and the
    // original response had off_topic or unsupported fragments, fall back to the
    // conservative response. A denial is itself a factual assertion and should not
    // survive when the original was flagged.
    const rewrittenTrimmed = rewritten.trim();
    const startsWithDenial = /^没有[,，。]?/.test(rewrittenTrimmed) || /^不是[,，。]/.test(rewrittenTrimmed);
    if (startsWithDenial && (cats.offTopic.length > 0 || cats.unsupported.length > 0)) {
      return {
        verified: true,
        passed: false,
        unfoundedFragments: unfounded,
        finalResponse: FALLBACK_RESPONSE,
        verifyCallCount: callCount,
      };
    }

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
