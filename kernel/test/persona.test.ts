import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PERSONA_PROMPT_BUDGET,
  Store,
  assemblePersonaContext,
  personaIdentityLine,
} from '@openmimic/kernel';

const SUBJECT = 's1';

function seedSubject(store: Store, selfReport?: string): void {
  store.putSubject({
    id: SUBJECT,
    displayName: '林默',
    ...(selfReport !== undefined ? { selfReport } : {}),
  });
}

function addWitness(
  store: Store,
  id: string,
  relation: string,
  consentLevel: 'quotable' | 'synthesis_only' = 'quotable',
): void {
  store.putWitness({ id, subjectId: SUBJECT, relation, consentLevel });
}

function addTestimony(
  store: Store,
  id: string,
  witnessId: string,
  behindText: string,
): void {
  store.addTestimony({
    id,
    witnessId,
    subjectId: SUBJECT,
    answers: [{ qid: 'q1', behindText }],
  });
}

function addClaim(
  store: Store,
  id: string,
  text: string,
  evidence: string[],
  conviction = 0.8,
  qualifiers?: string[],
): void {
  store.putClaim({
    id,
    subjectId: SUBJECT,
    text,
    conviction,
    evidence,
    ...(qualifiers !== undefined ? { qualifiers } : {}),
    status: 'surviving',
    courtSessionId: 'court-1',
  });
}

describe('assemblePersonaContext', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('always opens with the non-negotiable identity declaration', () => {
    seedSubject(store, '我今年二十八。');
    addWitness(store, 'w1', '发小');
    addTestimony(store, 't1', 'w1', '他总是最后一个走。');
    addClaim(store, 'c1', '林默习惯自己扛。', ['t1']);

    const { systemPrompt, meta } = assemblePersonaContext(SUBJECT, store);

    expect(systemPrompt.startsWith(personaIdentityLine('林默'))).toBe(true);
    expect(systemPrompt).toContain('你正在扮演基于他人证言构建的林默。');
    expect(systemPrompt).toContain('这是人格模拟,不是本人。');
    expect(meta.displayName).toBe('林默');
    expect(meta.includedClaimIds).toEqual(['c1']);
  });

  it('drops claims below 0.5 conviction and records them as excluded', () => {
    seedSubject(store);
    addWitness(store, 'w1', '同事');
    addTestimony(store, 't1', 'w1', '他开会从不抢话。');
    addClaim(store, 'c-high', '林默在压力下会沉默。', ['t1'], 0.8);
    addClaim(store, 'c-low', '林默其实讨厌猫。', ['t1'], 0.49);

    const { systemPrompt, meta } = assemblePersonaContext(SUBJECT, store);

    expect(systemPrompt).toContain('林默在压力下会沉默。');
    expect(systemPrompt).not.toContain('林默其实讨厌猫。');
    expect(meta.includedClaimIds).toEqual(['c-high']);
    expect(meta.excludedClaimIds).toContain('c-low');
  });

  it('never quotes synthesis_only raw words, only the claims derived from them', () => {
    const secret =
      '她其实特别害怕一个人待着而且半夜会反复检查门锁是否锁好这件事没人知道';
    seedSubject(store);
    addWitness(store, 'w-q', '发小', 'quotable');
    addWitness(store, 'w-s', '同事', 'synthesis_only');
    addTestimony(store, 't-q', 'w-q', '他话不多。');
    addTestimony(store, 't-s', 'w-s', secret);
    addClaim(store, 'c-q', '林默话不多。', ['t-q'], 0.8);
    addClaim(store, 'c-s', '林默独处时会反复确认安全。', ['t-s'], 0.7);

    const { systemPrompt } = assemblePersonaContext(SUBJECT, store);

    expect(systemPrompt).not.toContain(secret);
    expect(systemPrompt).not.toContain(secret.slice(0, 20));
    // The derived claim is allowed: it is synthesis, not quotation.
    expect(systemPrompt).toContain('林默独处时会反复确认安全。');
  });

  it('keeps the identity line after truncating an over-budget prompt by conviction', () => {
    seedSubject(store);
    addWitness(store, 'w1', '同事');
    addTestimony(store, 't1', 'w1', '他很少解释自己。');
    for (let index = 0; index < 40; index += 1) {
      addClaim(
        store,
        `c-${index}`,
        `林默在工作里会把压力全部压在自己身上,遇到${index}号问题也从不主动开口求助别人。`,
        ['t1'],
        0.5 + index / 100,
      );
    }

    const { systemPrompt, meta } = assemblePersonaContext(SUBJECT, store);

    expect(systemPrompt.length).toBeLessThanOrEqual(PERSONA_PROMPT_BUDGET);
    expect(systemPrompt.startsWith(personaIdentityLine('林默'))).toBe(true);
    expect(systemPrompt).toContain('这是人格模拟,不是本人。');
    expect(meta.truncated).toBe(true);
    expect(meta.includedClaimIds.length).toBeLessThan(40);
    // Highest conviction survives; the lowest is cut first.
    expect(meta.includedClaimIds).toContain('c-39');
    expect(meta.includedClaimIds).not.toContain('c-0');
  });

  it('caps quotable style samples per witness and labels the self-report as a caveat', () => {
    seedSubject(store, '我今年二十八,刚把工作辞了。');
    addWitness(store, 'w1', '发小');
    addTestimony(
      store,
      't1',
      'w1',
      '他总是最后一个走。他喜欢坐在角落。他喝咖啡不加糖。他走路很快。他从不迟到。',
    );
    addClaim(store, 'c1', '林默话不多。', ['t1']);

    const { systemPrompt, meta } = assemblePersonaContext(SUBJECT, store);

    const sampleLines = systemPrompt.match(/发小:「/g) ?? [];
    expect(sampleLines.length).toBeLessThanOrEqual(2);
    expect(meta.sampleCount).toBeLessThanOrEqual(2);
    expect(systemPrompt).toContain('本人自述（仅供口径参照,与他证冲突时以他证为准）');
    expect(systemPrompt).toContain('我今年二十八,刚把工作辞了。');
    expect(meta.selfReportIncluded).toBe(true);
  });

  it('stays within budget even without any claims or self-report', () => {
    seedSubject(store);

    const { systemPrompt, meta } = assemblePersonaContext(SUBJECT, store);

    expect(systemPrompt.length).toBeLessThanOrEqual(PERSONA_PROMPT_BUDGET);
    expect(systemPrompt.startsWith(personaIdentityLine('林默'))).toBe(true);
    expect(meta.includedClaimIds).toEqual([]);
    expect(meta.truncated).toBe(false);
  });
});
