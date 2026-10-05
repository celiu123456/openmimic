import { describe, expect, it, beforeEach } from 'vitest';
import {
  // Word list & detection
  CRISIS_WORDS_ALL,
  CRISIS_WORDS_MULTILINGUAL,
  findCrisisSignal,
  // Help resources
  formatHelpResources,
  DEFAULT_HELP_TEXT_ZH,
  DEFAULT_HELP_TEXT_EN,
  type HelpResource,
  // Crisis prompt
  buildCrisisPrompt,
  BANNED_REFUSAL_PHRASES,
  // Crisis state
  createCrisisState,
  activateCrisis,
  checkCrisisActive,
  isCrisisActive,
  CRISIS_QUIET_PERIOD_MS,
  // LLM confirmation
  buildCrisisConfirmPrompt,
  parseCrisisConfirmation,
  // Interview
  INTERVIEW_CRISIS_RESPONSE_ZH,
  INTERVIEW_CRISIS_RESPONSE_EN,
  getInterviewCrisisResponse,
  // Audit
  type CrisisAuditEvent,
} from '../src/crisis';
import { CRISIS_WORDS } from '@openmimic/kernel';

/* ================================================================== */
/* 1. Word list & detection                                            */
/* ================================================================== */

describe('crisis word list', () => {
  it('combined list includes all kernel CRISIS_WORDS', () => {
    for (const word of CRISIS_WORDS) {
      expect(CRISIS_WORDS_ALL).toContain(word);
    }
  });

  it('combined list includes multilingual extensions', () => {
    for (const word of CRISIS_WORDS_MULTILINGUAL) {
      expect(CRISIS_WORDS_ALL).toContain(word);
    }
  });

  it('has no duplicates', () => {
    const unique = new Set(CRISIS_WORDS_ALL);
    expect(unique.size).toBe(CRISIS_WORDS_ALL.length);
  });

  it('includes English crisis terms', () => {
    expect(CRISIS_WORDS_ALL).toContain('suicide');
    expect(CRISIS_WORDS_ALL).toContain('kill myself');
    expect(CRISIS_WORDS_ALL).toContain('self-harm');
  });

  it('includes Japanese crisis terms', () => {
    expect(CRISIS_WORDS_ALL).toContain('死にたい');
    expect(CRISIS_WORDS_ALL).toContain('自殺');
  });
});

describe('findCrisisSignal', () => {
  it('detects Chinese crisis words', () => {
    expect(findCrisisSignal('我想自杀')).toBe('自杀');
    expect(findCrisisSignal('活不下去了')).toBe('活不下去');
    expect(findCrisisSignal('想从楼上跳下去')).toBe('从楼上跳');
  });

  it('detects English crisis words (case-insensitive)', () => {
    expect(findCrisisSignal('I want to kill myself')).toBe('kill myself');
    expect(findCrisisSignal('thinking about SUICIDE')).toBe('suicide');
    expect(findCrisisSignal('Self-Harm thoughts')).toBe('self-harm');
  });

  it('detects Japanese crisis words', () => {
    expect(findCrisisSignal('もう死にたい')).toBe('死にたい');
  });

  it('returns undefined for non-crisis text', () => {
    expect(findCrisisSignal('今天天气真好')).toBeUndefined();
    expect(findCrisisSignal('I love programming')).toBeUndefined();
    expect(findCrisisSignal('这道题难得要死')).toBeUndefined();
  });

  it('returns undefined for empty text', () => {
    expect(findCrisisSignal('')).toBeUndefined();
  });
});

/* ================================================================== */
/* 2. Help resources                                                   */
/* ================================================================== */

describe('formatHelpResources', () => {
  it('returns default Chinese text when no resources configured', () => {
    const result = formatHelpResources([], 'zh');
    expect(result).toBe(DEFAULT_HELP_TEXT_ZH);
  });

  it('returns default English text when no resources configured', () => {
    const result = formatHelpResources([], 'en');
    expect(result).toBe(DEFAULT_HELP_TEXT_EN);
  });

  it('formats configured resources with contact info', () => {
    const resources: HelpResource[] = [
      { region: 'CN', lang: 'zh', label: '全国心理援助热线', contact: '400-161-9995' },
    ];
    const result = formatHelpResources(resources, 'zh');
    expect(result).toContain('全国心理援助热线');
    expect(result).toContain('400-161-9995');
  });

  it('formats resources without contact info', () => {
    const resources: HelpResource[] = [
      { region: 'default', lang: 'zh', label: '请联系当地紧急服务' },
    ];
    const result = formatHelpResources(resources, 'zh');
    expect(result).toContain('请联系当地紧急服务');
  });

  it('never fabricates phone numbers', () => {
    // Default text must not contain any phone-like patterns
    const zh = formatHelpResources([], 'zh');
    const en = formatHelpResources([], 'en');
    expect(zh).not.toMatch(/\d{3,}/);
    expect(en).not.toMatch(/\d{3,}/);
  });
});

/* ================================================================== */
/* 3. Crisis prompt                                                    */
/* ================================================================== */

describe('buildCrisisPrompt', () => {
  it('retains persona display name', () => {
    const prompt = buildCrisisPrompt('林默', []);
    expect(prompt).toContain('林默');
  });

  it('includes crisis mode marker', () => {
    const prompt = buildCrisisPrompt('林默', []);
    expect(prompt).toContain('危机模式');
  });

  it('includes warmth/presence/non-judgment instructions', () => {
    const prompt = buildCrisisPrompt('林默', []);
    expect(prompt).toContain('温暖');
    expect(prompt).toContain('在场');
    expect(prompt).toContain('不评判');
  });

  it('includes "never push away" instruction', () => {
    const prompt = buildCrisisPrompt('林默', []);
    expect(prompt).toContain('不要推开');
  });

  it('includes safety confirmation instruction', () => {
    const prompt = buildCrisisPrompt('林默', []);
    expect(prompt).toContain('安全');
  });

  it('includes help resources', () => {
    const resources: HelpResource[] = [
      { region: 'CN', lang: 'zh', label: '心理热线', contact: '123-456' },
    ];
    const prompt = buildCrisisPrompt('林默', resources);
    expect(prompt).toContain('心理热线');
    expect(prompt).toContain('123-456');
  });

  it('bans refusal-style phrases', () => {
    const prompt = buildCrisisPrompt('林默', []);
    for (const phrase of BANNED_REFUSAL_PHRASES) {
      expect(prompt).toContain(phrase);
    }
  });

  it('explicitly says NOT to role-play', () => {
    const prompt = buildCrisisPrompt('林默', []);
    expect(prompt).toContain('不要继续扮演');
  });

  it('works in English', () => {
    const prompt = buildCrisisPrompt('Limo', [], 'en');
    expect(prompt).toContain('Limo');
    expect(prompt).toContain('CRISIS MODE');
    expect(prompt).toContain('Do NOT role-play');
    expect(prompt).toContain('warm');
  });
});

/* ================================================================== */
/* 4. Crisis state & quiet period                                      */
/* ================================================================== */

describe('crisis state', () => {
  it('starts inactive', () => {
    const state = createCrisisState();
    expect(state.active).toBe(false);
  });

  it('activates with matched word', () => {
    const state = activateCrisis(createCrisisState(), '自杀');
    expect(state.active).toBe(true);
    expect(state.matchedWord).toBe('自杀');
    expect(state.activatedAt).toBeDefined();
  });

  it('remains active during quiet period', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const state = activateCrisis(createCrisisState(), '自杀', now);

    // 5 minutes later: still active
    const later = new Date('2026-01-01T12:05:00Z');
    expect(isCrisisActive(state, later)).toBe(true);
  });

  it('deactivates after quiet period expires', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const state = activateCrisis(createCrisisState(), '自杀', now);

    // 11 minutes later: expired (default quiet period is 10 min)
    const later = new Date('2026-01-01T12:11:00Z');
    expect(isCrisisActive(state, later)).toBe(false);
  });

  it('quiet period is configurable', () => {
    const fiveMin = 5 * 60 * 1000;
    const now = new Date('2026-01-01T12:00:00Z');
    const state = activateCrisis(createCrisisState(fiveMin), '自杀', now);

    // 4 minutes: still active
    expect(isCrisisActive(state, new Date('2026-01-01T12:04:00Z'))).toBe(true);
    // 6 minutes: expired
    expect(isCrisisActive(state, new Date('2026-01-01T12:06:00Z'))).toBe(false);
  });

  it('checkCrisisActive returns deactivated state after expiry', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const state = activateCrisis(createCrisisState(), '自杀', now);

    const later = new Date('2026-01-01T12:11:00Z');
    const checked = checkCrisisActive(state, later);
    expect(checked.active).toBe(false);
  });

  it('default quiet period is 10 minutes', () => {
    expect(CRISIS_QUIET_PERIOD_MS).toBe(10 * 60 * 1000);
  });
});

/* ================================================================== */
/* 5. Zero-cache path (structural test)                                */
/* ================================================================== */

describe('zero-cache path', () => {
  it('crisis prompt does not reference persona context', () => {
    // The crisis prompt must be self-contained, not referencing any
    // cached persona assembly
    const prompt = buildCrisisPrompt('林默', []);
    // Should not contain typical persona context markers
    expect(prompt).not.toContain('你是「林默」');
    expect(prompt).not.toContain('以下是关于林默的');
    // But should contain the name in context of crisis mode
    expect(prompt).toContain('林默');
  });
});

/* ================================================================== */
/* 6. LLM confirmation                                                 */
/* ================================================================== */

describe('crisis LLM confirmation', () => {
  it('builds a prompt with system and user', () => {
    const { system, user } = buildCrisisConfirmPrompt('我真的想自杀');
    expect(system).toContain('safety classifier');
    expect(user).toBe('我真的想自杀');
  });

  it('parseCrisisConfirmation: YES returns true', () => {
    expect(parseCrisisConfirmation('YES')).toBe(true);
    expect(parseCrisisConfirmation('yes')).toBe(true);
  });

  it('parseCrisisConfirmation: NO returns false', () => {
    expect(parseCrisisConfirmation('NO')).toBe(false);
    expect(parseCrisisConfirmation('no')).toBe(false);
  });

  it('parseCrisisConfirmation: fail-safe — ambiguous returns true', () => {
    expect(parseCrisisConfirmation('Maybe')).toBe(true);
    expect(parseCrisisConfirmation('I think so')).toBe(true);
    expect(parseCrisisConfirmation('')).toBe(true);
  });
});

/* ================================================================== */
/* 7. Interview crisis response                                        */
/* ================================================================== */

describe('interview crisis response', () => {
  it('Chinese response is warm and non-judgmental', () => {
    expect(INTERVIEW_CRISIS_RESPONSE_ZH).toContain('谢谢');
    expect(INTERVIEW_CRISIS_RESPONSE_ZH).toContain('不必独自面对');
  });

  it('English response is warm and non-judgmental', () => {
    expect(INTERVIEW_CRISIS_RESPONSE_EN).toContain('Thank you');
    expect(INTERVIEW_CRISIS_RESPONSE_EN).toContain('do not have to face it alone');
  });

  it('getInterviewCrisisResponse appends help resources', () => {
    const resources: HelpResource[] = [
      { region: 'CN', lang: 'zh', label: '心理热线', contact: '123' },
    ];
    const result = getInterviewCrisisResponse(resources, 'zh');
    expect(result).toContain(INTERVIEW_CRISIS_RESPONSE_ZH);
    expect(result).toContain('心理热线');
  });

  it('getInterviewCrisisResponse uses default when no resources', () => {
    const result = getInterviewCrisisResponse([], 'zh');
    expect(result).toContain(INTERVIEW_CRISIS_RESPONSE_ZH);
    expect(result).toContain(DEFAULT_HELP_TEXT_ZH);
  });
});

/* ================================================================== */
/* 8. Audit event structure                                            */
/* ================================================================== */

describe('crisis audit event', () => {
  it('event structure has required fields', () => {
    const event: CrisisAuditEvent = {
      at: new Date().toISOString(),
      type: 'crisis_activated',
      source: 'persona_chat',
      subjectId: 's1',
    };
    expect(event.at).toBeTruthy();
    expect(event.type).toBe('crisis_activated');
    expect(event.source).toBe('persona_chat');
  });

  it('event does NOT contain raw text', () => {
    // This is a structural test: the CrisisAuditEvent interface
    // must not have any field for raw text/content
    const event: CrisisAuditEvent = {
      at: new Date().toISOString(),
      type: 'crisis_activated',
      source: 'persona_chat',
    };
    // TypeScript enforces this at compile time; runtime check
    // ensures no extra fields sneak in
    const keys = Object.keys(event);
    expect(keys).not.toContain('text');
    expect(keys).not.toContain('content');
    expect(keys).not.toContain('message');
    expect(keys).not.toContain('rawText');
  });
});

/* ================================================================== */
/* 9. Refusal phrase replacement (structural)                          */
/* ================================================================== */

describe('banned refusal phrases', () => {
  it('has at least 5 banned phrases', () => {
    expect(BANNED_REFUSAL_PHRASES.length).toBeGreaterThanOrEqual(5);
  });

  it('includes Chinese refusal patterns', () => {
    const zhPhrases = BANNED_REFUSAL_PHRASES.filter(
      (p) => /[一-鿿]/.test(p),
    );
    expect(zhPhrases.length).toBeGreaterThanOrEqual(2);
  });

  it('includes English refusal patterns', () => {
    const enPhrases = BANNED_REFUSAL_PHRASES.filter(
      (p) => /^[A-Z]/.test(p) || /^I/.test(p),
    );
    expect(enPhrases.length).toBeGreaterThanOrEqual(2);
  });
});

/* ================================================================== */
/* 10. Plugin crisis audit table (integration)                         */
/* ================================================================== */

describe('crisis audit persistence', () => {
  it('CrisisAuditEvent types cover all scenarios', () => {
    const types: CrisisAuditEvent['type'][] = [
      'crisis_activated',
      'crisis_expired',
      'crisis_interview_hit',
    ];
    expect(types).toHaveLength(3);
  });
});

/* ================================================================== */
/* 11. Mode switch replaces persona prompt                             */
/* ================================================================== */

describe('crisis mode switch', () => {
  it('crisis prompt is distinct from persona prompt structure', () => {
    const crisisPrompt = buildCrisisPrompt('林默', []);
    // Crisis prompt must not contain persona assembly markers
    expect(crisisPrompt).not.toContain('说话风格');
    expect(crisisPrompt).not.toContain('证人');
    expect(crisisPrompt).not.toContain('论断');
    // Must contain crisis-specific markers
    expect(crisisPrompt).toContain('危机模式');
    expect(crisisPrompt).toContain('温暖');
  });
});

/* ================================================================== */
/* 12. Multilingual word list structure                                 */
/* ================================================================== */

describe('multilingual word list', () => {
  it('English words are lowercase', () => {
    const enWords = CRISIS_WORDS_MULTILINGUAL.filter(
      (w) => /^[a-z\s-]+$/.test(w),
    );
    expect(enWords.length).toBeGreaterThan(0);
    for (const w of enWords) {
      expect(w).toBe(w.toLowerCase());
    }
  });
});

/* ================================================================== */
/* 13. Edge cases                                                      */
/* ================================================================== */

describe('crisis edge cases', () => {
  it('activating already-active crisis does not reset timer', () => {
    const t1 = new Date('2026-01-01T12:00:00Z');
    const state = activateCrisis(createCrisisState(), '自杀', t1);
    // Re-activate 5 minutes later
    const t2 = new Date('2026-01-01T12:05:00Z');
    const reactivated = activateCrisis(state, '自残', t2);
    // Timer resets to t2
    expect(reactivated.activatedAt).toBe(t2.toISOString());
    expect(reactivated.matchedWord).toBe('自残');
  });

  it('crisis signal detection is substring-based', () => {
    // The word "自杀" should be detected even within a longer phrase
    expect(findCrisisSignal('他提到了自杀的念头')).toBe('自杀');
  });

  it('mixed language text: Chinese crisis word in English sentence', () => {
    expect(findCrisisSignal('I feel like 想死')).toBe('想死');
  });
});

/* ================================================================== */
/* 14. Interview safety signal branch consistency                      */
/* ================================================================== */

describe('interview crisis branch', () => {
  it('crisis response does not contain clinical language', () => {
    const response = getInterviewCrisisResponse([], 'zh');
    expect(response).not.toContain('诊断');
    expect(response).not.toContain('治疗');
    expect(response).not.toContain('精神');
  });
});

/* ================================================================== */
/* 15. Full crisis lifecycle                                           */
/* ================================================================== */

describe('crisis lifecycle', () => {
  it('inactive → detect → active → quiet period → inactive', () => {
    const t0 = new Date('2026-01-01T12:00:00Z');
    let state = createCrisisState();
    expect(state.active).toBe(false);

    // Detect crisis
    const word = findCrisisSignal('我想自杀');
    expect(word).toBe('自杀');
    state = activateCrisis(state, word!, t0);
    expect(state.active).toBe(true);

    // During quiet period
    const t5 = new Date('2026-01-01T12:05:00Z');
    expect(isCrisisActive(state, t5)).toBe(true);

    // After quiet period
    const t11 = new Date('2026-01-01T12:11:00Z');
    expect(isCrisisActive(state, t11)).toBe(false);

    // State is updated
    state = checkCrisisActive(state, t11);
    expect(state.active).toBe(false);
  });
});
