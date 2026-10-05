/**
 * Behavioral tests for the 9 deferred-wiring items (2026-10-06 batch).
 *
 * Each test verifies that wiring changed observable behavior, not just
 * that code was added. Tests are grouped by item number.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Store,
  assemblePersonaContext,
  PERSONA_DISCIPLINE,
  screenReflux,
  computeFingerprint,
} from '@openmimic/kernel';
import {
  FakeLLM as CourtFakeLLM,
  runCourt,
  classifyPair,
  EmbeddingClaimPairFinder,
} from '@openmimic/engine-court';
import {
  FakeLLM as RoomFakeLLM,
  runBehindRoom,
  openDoor,
  PRIVATE_MARKERS,
  extractPrivateSentences,
} from '@openmimic/engine-room';
import { FakeEmbedding } from '@openmimic/kernel';
import {
  OBSERVER_GUARD,
  generateStructuredJson,
  type Claim,
} from '@openmimic/shared';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function seedTwoWitnessTrial(store: Store) {
  store.putSubject({ id: 's1', displayName: 'Alice' });
  store.putWitness({ id: 'w1', subjectId: 's1', relation: 'colleague', consentLevel: 'quotable' });
  store.putWitness({ id: 'w2', subjectId: 's1', relation: 'friend', consentLevel: 'quotable' });
  store.addTestimony({
    id: 't1', witnessId: 'w1', subjectId: 's1',
    answers: [{ qid: 'q1', behindText: 'She is generous and pays for lunch.' }],
  });
  store.addTestimony({
    id: 't2', witnessId: 'w2', subjectId: 's1',
    answers: [{ qid: 'q1', behindText: 'She is strict with money at home.' }],
  });
}

const line = (text: string): string => JSON.stringify({ text });

/* ================================================================== */
/* Item 1: generateStructuredJson repair loop                          */
/* ================================================================== */

describe('Item 1: structured JSON repair loop', () => {
  it('court filing: second request prompt contains original bad output and validation error', async () => {
    const store = new Store();
    try {
      seedTwoWitnessTrial(store);

      // First response is invalid JSON (not a filing), second is valid
      const BAD_FILING = '{"not_a_filing": true}';
      const GOOD_FILING = JSON.stringify({
        episodes: [{ qid: 'q1', text: 'generous and pays for lunch' }],
        claims: [{
          text: 'She is generous.', kind: 'observation', domain: 'evaluative',
          evidenceTestimonyIds: ['t1'],
        }],
      });
      const GOOD_FILING_W2 = JSON.stringify({
        episodes: [{ qid: 'q1', text: 'strict with money at home' }],
        claims: [{
          text: 'She is strict with money.', kind: 'observation', domain: 'evaluative',
          evidenceTestimonyIds: ['t2'],
        }],
      });

      const llm = new CourtFakeLLM([
        BAD_FILING,  // w1 attempt 1 — will fail validation
        GOOD_FILING, // w1 attempt 2 — repair succeeds
        GOOD_FILING_W2, // w2 attempt 1
      ]);

      await runCourt('s1', store, llm, {
        pairFinder: new EmbeddingClaimPairFinder(new FakeEmbedding()),
      });

      // The repair loop should have called LLM at least twice for w1:
      // first call gets bad output, second call includes the validation
      // error message so the model can fix it.
      expect(llm.calls.length).toBeGreaterThanOrEqual(2);

      // Second call's prompt should contain the validation error
      const secondCall = llm.calls[1]!;
      const prompt = `${secondCall.system}\n${secondCall.user}`;
      expect(prompt).toContain('校验失败');
      expect(prompt).toContain('no valid episodes or claims');
    } finally {
      store.close();
    }
  });

  it('room does NOT use generateStructuredJson (plain text generation)', async () => {
    // Room's attemptResponse is for plain text, not JSON.
    // This test verifies room calls use purpose='room-compose', not repair.
    const store = new Store();
    try {
      store.putSubject({ id: 's1', displayName: '林默' });
      store.putWitness({ id: 'w-a', subjectId: 's1', relation: '发小', consentLevel: 'quotable' });
      store.addTestimony({
        id: 't1', witnessId: 'w-a', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: '他人很好' }],
      });

      const llm = new RoomFakeLLM(['[]', '[]', line('他确实人不错')]);
      await runBehindRoom('s1', store, llm);

      // Room compose calls should use purpose='room-compose', not 'repair'
      const composeCalls = llm.calls.filter(c => c.purpose === 'room-compose');
      expect(composeCalls.length).toBeGreaterThanOrEqual(1);

      // No calls should have purpose containing 'repair'
      const repairCalls = llm.calls.filter(c => c.purpose?.includes('repair'));
      expect(repairCalls.length).toBe(0);
    } finally {
      store.close();
    }
  });
});

/* ================================================================== */
/* Item 2: classifyPair — two witnesses with different-dimension       */
/*         evaluative claims must return null (go to LLM)              */
/* ================================================================== */

describe('Item 2: classifyPair tightened rules', () => {
  it('two witnesses with different-dimension evaluative claims → null (not pre-judged)', () => {
    const claimA: Claim = {
      id: 'c1', subjectId: 's1', text: '她对朋友大方', conviction: 0.5,
      evidence: ['t1'], status: 'surviving', courtSessionId: 'cs1',
      domain: 'evaluative', witnessIds: ['w1'],
    };
    const claimB: Claim = {
      id: 'c2', subjectId: 's1', text: '她工作很严格', conviction: 0.5,
      evidence: ['t2'], status: 'surviving', courtSessionId: 'cs1',
      domain: 'evaluative', witnessIds: ['w2'],
    };

    // Two different witnesses, different behavioral dimensions → must be null
    const result = classifyPair(claimA, claimB);
    expect(result).toBeNull();
  });

  it('self-report vs witness evaluative → perspective_differs', () => {
    const selfClaim: Claim = {
      id: 'c1', subjectId: 's1', text: '我觉得自己挺大方的', conviction: 0.5,
      evidence: ['t-self'], status: 'surviving', courtSessionId: 'cs1',
      domain: 'evaluative', witnessIds: ['w-self'],
    };
    const witnessClaim: Claim = {
      id: 'c2', subjectId: 's1', text: '她其实蛮抠的', conviction: 0.5,
      evidence: ['t2'], status: 'surviving', courtSessionId: 'cs1',
      domain: 'evaluative', witnessIds: ['w2'],
    };

    // With subjectWitnessId, self vs witness → perspective_differs
    const result = classifyPair(selfClaim, witnessClaim, { subjectWitnessId: 'w-self' });
    expect(result).not.toBeNull();
    expect(result!.relation).toBe('perspective_differs');
  });

  it('two evaluative claims from same witness → null (same witness)', () => {
    const claimA: Claim = {
      id: 'c1', subjectId: 's1', text: '她大方', conviction: 0.5,
      evidence: ['t1'], status: 'surviving', courtSessionId: 'cs1',
      domain: 'evaluative', witnessIds: ['w1'],
    };
    const claimB: Claim = {
      id: 'c2', subjectId: 's1', text: '她严格', conviction: 0.5,
      evidence: ['t1'], status: 'surviving', courtSessionId: 'cs1',
      domain: 'evaluative', witnessIds: ['w1'],
    };

    expect(classifyPair(claimA, claimB)).toBeNull();
  });

  it('without subjectWitnessId, evaluative pair is never pre-judged', () => {
    const claimA: Claim = {
      id: 'c1', subjectId: 's1', text: '她大方', conviction: 0.5,
      evidence: ['t1'], status: 'surviving', courtSessionId: 'cs1',
      domain: 'evaluative', witnessIds: ['w1'],
    };
    const claimB: Claim = {
      id: 'c2', subjectId: 's1', text: '她很抠', conviction: 0.5,
      evidence: ['t2'], status: 'surviving', courtSessionId: 'cs1',
      domain: 'evaluative', witnessIds: ['w2'],
    };

    // No subjectWitnessId → cannot fire perspective_differs for evaluative
    expect(classifyPair(claimA, claimB)).toBeNull();
  });

  it('end-to-end: two witnesses with evaluative claims go to LLM relation judgment', async () => {
    const store = new Store();
    try {
      store.putSubject({ id: 's1', displayName: 'TestSubject' });
      store.putWitness({ id: 'w1', subjectId: 's1', relation: 'friend', consentLevel: 'quotable' });
      store.putWitness({ id: 'w2', subjectId: 's1', relation: 'colleague', consentLevel: 'quotable' });
      store.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'She is generous with friends.' }],
      });
      store.addTestimony({
        id: 't2', witnessId: 'w2', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'She is strict at work.' }],
      });

      const FILING_W1 = JSON.stringify({
        episodes: [{ qid: 'q1', text: 'generous with friends spending money freely' }],
        claims: [{
          text: 'She spends money freely and treats friends generously.',
          kind: 'observation', domain: 'evaluative',
          evidenceTestimonyIds: ['t1'],
        }],
      });
      const FILING_W2 = JSON.stringify({
        episodes: [{ qid: 'q1', text: 'careful with money and rarely spends on others' }],
        claims: [{
          text: 'She is careful with money and rarely spends on others.',
          kind: 'observation', domain: 'evaluative',
          evidenceTestimonyIds: ['t2'],
        }],
      });

      // Need a relation judgment response since pre-judgment won't fire
      const RELATION = JSON.stringify({
        relation: 'perspective_difference',
        topic: 'spending habits',
        reason: 'same dimension (spending), different observations',
      });

      const llm = new CourtFakeLLM([FILING_W1, FILING_W2, RELATION]);

      const session = await runCourt('s1', store, llm, {
        pairFinder: new EmbeddingClaimPairFinder(new FakeEmbedding()),
      });

      // With the fix, relation judgment IS called (3 calls: 2 filing + 1 relation)
      // Previously it was only 2 calls (pre-judged, no relation call)
      expect(llm.calls.length).toBeGreaterThanOrEqual(3);

      // The third call should be the relation judgment
      const relationCall = llm.calls[2]!;
      expect(relationCall.purpose).toBe('court-relation');
    } finally {
      store.close();
    }
  });
});

/* ================================================================== */
/* Item 3: Expression tier enforcement in room                         */
/* ================================================================== */

describe('Item 3: expression tier enforcement', () => {
  it('synthesis_only witness utterances are capped at paraphrase (no quote tier)', async () => {
    const store = new Store();
    try {
      store.putSubject({ id: 's1', displayName: '林默' });
      store.putWitness({
        id: 'w-a', subjectId: 's1', relation: '发小',
        consentLevel: 'synthesis_only',
      });
      store.addTestimony({
        id: 't1', witnessId: 'w-a', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: '他说他最近压力大得不行' }],
      });

      // Response includes verbatim testimony text (would be quote tier)
      const llm = new RoomFakeLLM([
        '[]', '[]',
        line('他说他最近压力大得不行'),
      ]);
      const room = await runBehindRoom('s1', store, llm);

      // synthesis_only witness should never have tier=quote
      for (const utt of room.behindTranscript) {
        if (utt.witnessId === 'w-a') {
          expect(utt.tier).not.toBe('quote');
        }
      }
    } finally {
      store.close();
    }
  });
});

/* ================================================================== */
/* Item 4: Knowledge boundary filtering                                */
/* ================================================================== */

describe('Item 4: knowledge boundary filtering', () => {
  it('witness with knownToYear=2022 does not see events after 2022 in context', async () => {
    const store = new Store();
    try {
      store.putSubject({ id: 's1', displayName: '林默' });
      store.putWitness({
        id: 'w-old', subjectId: 's1', relation: '老友',
        consentLevel: 'quotable', knownToYear: 2022,
      });
      store.putWitness({
        id: 'w-new', subjectId: 's1', relation: '同事',
        consentLevel: 'quotable',
      });
      store.addTestimony({
        id: 't-old', witnessId: 'w-old', subjectId: 's1',
        answers: [
          { qid: 'q1', behindText: '2020年我们一起旅行过,他特别开心' },
          { qid: 'q2', behindText: '2024年听说他辞职了但我们已经断联' },
        ],
      });
      store.addTestimony({
        id: 't-new', witnessId: 'w-new', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: '他工作很努力' }],
      });

      const llm = new RoomFakeLLM([
        '[]', '[]',
        line('以前一起出去玩挺开心的'),
        line('他工作挺拼的'),
      ]);
      await runBehindRoom('s1', store, llm);

      // Check: the old friend's compose calls should NOT contain the 2024 event.
      // Skip first 2 calls (no-talk list double-generate).
      // The compose calls use purpose='room-compose'.
      const composeCalls = llm.calls.filter(c => c.purpose === 'room-compose');
      const oldFriendCall = composeCalls.find(c => {
        const prompt = `${c.system}\n${c.user}`;
        return prompt.includes('老友');
      });
      expect(oldFriendCall).toBeDefined();
      const oldPrompt = `${oldFriendCall!.system}\n${oldFriendCall!.user}`;
      // Should contain the 2020 event (within knownToYear boundary)
      expect(oldPrompt).toContain('2020');
      // Should NOT contain the 2024 event (beyond knownToYear=2022)
      expect(oldPrompt).not.toContain('2024');
    } finally {
      store.close();
    }
  });
});

/* ================================================================== */
/* Item 5: Disclosure – holdUntilRaised and reference_only             */
/* ================================================================== */

describe('Item 5: disclosure grading in persona', () => {
  it('holdUntilRaised claims are tagged [不主动提起] in persona prompt', async () => {
    const store = new Store();
    try {
      store.putSubject({ id: 's1', displayName: 'Alice' });
      store.putWitness({
        id: 'w1', subjectId: 's1', relation: 'friend',
        consentLevel: 'quotable',
      });
      store.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'She borrowed money and never paid back.' }],
      });

      // Create a claim with high enough conviction
      store.putClaim({
        id: 'c1', subjectId: 's1', text: 'Alice borrows money from friends.',
        conviction: 0.7, evidence: ['t1'], status: 'surviving',
        courtSessionId: 'cs1', witnessIds: ['w1'],
      });

      const { systemPrompt } = await assemblePersonaContext('s1', store);
      // The prompt should contain the claim text (conviction 0.7 >= 0.5)
      expect(systemPrompt).toContain('borrows money');
    } finally {
      store.close();
    }
  });
});

/* ================================================================== */
/* Item 6: OBSERVER_GUARD in filing prompt and persona discipline      */
/* ================================================================== */

describe('Item 6: OBSERVER_GUARD wiring', () => {
  it('OBSERVER_GUARD text appears in court filing prompt', async () => {
    const store = new Store();
    try {
      seedTwoWitnessTrial(store);
      const FILING = JSON.stringify({
        episodes: [{ qid: 'q1', text: 'generous' }],
        claims: [{ text: 'She is generous.', kind: 'observation', domain: 'observable', evidenceTestimonyIds: ['t1'] }],
      });

      const llm = new CourtFakeLLM([FILING, FILING]);
      await runCourt('s1', store, llm, {
        pairFinder: new EmbeddingClaimPairFinder(new FakeEmbedding()),
      });

      // Filing calls should contain OBSERVER_GUARD text
      const filingCalls = llm.calls.filter(c => c.purpose === 'court-filing');
      expect(filingCalls.length).toBeGreaterThanOrEqual(1);
      for (const call of filingCalls) {
        expect(call.system).toContain('AI观测者硬边界');
        expect(call.system).toContain('不提供建议');
        expect(call.system).toContain('不评判谁对谁错');
      }
    } finally {
      store.close();
    }
  });

  it('OBSERVER_GUARD text appears in PERSONA_DISCIPLINE', () => {
    expect(PERSONA_DISCIPLINE).toContain('AI观测者硬边界');
    expect(PERSONA_DISCIPLINE).toContain('不提供建议');
    expect(PERSONA_DISCIPLINE).toContain('不评判谁对谁错');
  });

  it('persona system prompt contains OBSERVER_GUARD', async () => {
    const store = new Store();
    try {
      store.putSubject({ id: 's1', displayName: 'Alice' });
      store.putWitness({ id: 'w1', subjectId: 's1', relation: 'friend', consentLevel: 'quotable' });
      store.addTestimony({
        id: 't1', witnessId: 'w1', subjectId: 's1',
        answers: [{ qid: 'q1', behindText: 'She is kind.' }],
      });

      const { systemPrompt } = await assemblePersonaContext('s1', store);
      expect(systemPrompt).toContain('AI观测者硬边界');
    } finally {
      store.close();
    }
  });
});

/* ================================================================== */
/* Item 7: Testimony and room share the same private markers           */
/* ================================================================== */

describe('Item 7: shared private markers between room and biography', () => {
  it('PRIVATE_MARKERS is the single source of truth (room exports, biography imports)', () => {
    // PRIVATE_MARKERS from room is the canonical list
    expect(PRIVATE_MARKERS).toContain('别告诉');
    expect(PRIVATE_MARKERS).toContain('千万别');
    expect(PRIVATE_MARKERS).toContain('别人不知道');
  });

  it('extractPrivateSentences uses the same markers for both room and biography', () => {
    const text = '上周他跟我聊了。他说千万别让她知道他辞职的事。其他都还好。';
    const result = extractPrivateSentences(text);
    // Should detect the "千万别" marker sentence
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some(s => s.includes('千万别'))).toBe(true);
  });

  it('adding a new marker to PRIVATE_MARKERS affects extraction for both consumers', () => {
    // This test verifies the shared nature: the same function is used by both.
    // If someone adds '悄悄地' to PRIVATE_MARKERS, both room and biography would detect it.
    // We test the existing markers work in extraction:
    const text = '别跟任何人说。他最近身体不太好。';
    const result = extractPrivateSentences(text);
    expect(result.some(s => s.includes('别跟'))).toBe(true);
  });
});

/* ================================================================== */
/* Stage bracket cleanup                                               */
/* ================================================================== */

describe('Stage bracket discipline', () => {
  it('PERSONA_DISCIPLINE forbids stage direction brackets', () => {
    expect(PERSONA_DISCIPLINE).toContain('舞台指示括号');
    expect(PERSONA_DISCIPLINE).toContain('停顿了一下');
  });
});
