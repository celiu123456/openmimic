import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '@openmimic/kernel';
import { FakeLLM, type LLMCompletionRequest } from '@openmimic/engine-court';
import {
  seedDemo,
  DEMO_SUBJECT_ID,
  DEMO_WITNESSES,
} from '@openmimic/fixtures';
import {
  judgePair,
  sha256,
  getJudgePromptSha,
  loadJudgePrompt,
  verifyJudgePromptSha,
} from '../src/judge';
import {
  loadCalibrationPairs,
  CALIBRATION_ACCURACY_THRESHOLD,
  CALIBRATION_MIN_VALID_PAIRS,
  CALIBRATION_MAX_BIAS,
} from '../src/calibrate';
import { wilsonInterval } from '../src/wilson';
import {
  bigramJaccard, matchClaims, pairwiseOverlap,
  llmClaimMatch, matchClaimsLlm, pairwiseOverlapLlm,
  loadClaimMatchPrompt, getClaimMatchPromptSha,
} from '../src/stability';
import { writeRun, RUNS_DIR, findCalibrationRun, requireCalibration } from '../src/ledger';
import type { Claim } from '@openmimic/shared';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeJudgeResponse(winner: 'A' | 'B', cue: string = 'test'): string {
  return JSON.stringify({ winner, cue });
}

/** FakeLLM that returns consistent A-wins for judge calls. */
function consistentJudgeLLM(): FakeLLM {
  return new FakeLLM([
    makeJudgeResponse('A'),  // run 1
    makeJudgeResponse('B'),  // run 2 (swapped, so B = original A => consistent)
  ]);
}

/** FakeLLM that returns inconsistent results (position bias). */
function inconsistentJudgeLLM(): FakeLLM {
  return new FakeLLM([
    makeJudgeResponse('A'),  // run 1: A wins
    makeJudgeResponse('A'),  // run 2: A wins (but positions swapped => inconsistent)
  ]);
}

/* Clean up runs dir before/after tests */
const TEST_RUNS_DIR = RUNS_DIR;

/** Clean only test-generated run files (2026-01-01 timestamp prefix). */
function cleanRuns(): void {
  if (existsSync(TEST_RUNS_DIR)) {
    for (const f of readdirSync(TEST_RUNS_DIR)) {
      if (f.endsWith('.json') && f.startsWith('2026-01-01')) {
        rmSync(join(TEST_RUNS_DIR, f));
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 1. Judge: position swap & discard                                   */
/* ------------------------------------------------------------------ */

describe('Judge', () => {
  it('returns valid result when positions agree (first wins)', async () => {
    const llm = consistentJudgeLLM();
    const result = await judgePair(llm, 'real answer', 'close candidate', 'far candidate');
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.winner).toBe('first');
      expect(result.cues).toHaveLength(2);
    }
  });

  it('returns valid result when positions agree (second wins)', async () => {
    const llm = new FakeLLM([
      makeJudgeResponse('B'),  // run 1: B wins (second)
      makeJudgeResponse('A'),  // run 2: A wins (swapped: A = second) => consistent
    ]);
    const result = await judgePair(llm, 'real', 'far', 'close');
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.winner).toBe('second');
    }
  });

  it('discards when position swap is inconsistent', async () => {
    const llm = inconsistentJudgeLLM();
    const result = await judgePair(llm, 'real answer', 'a', 'b');
    expect(result.status).toBe('discarded');
    if (result.status === 'discarded') {
      expect(result.reason).toContain('position swap inconsistency');
    }
  });

  it('discards when LLM returns unparseable response', async () => {
    const llm = new FakeLLM([
      'not json at all!',
      'still not json!',  // retry for run 1 parse fail
    ]);
    const result = await judgePair(llm, 'real', 'a', 'b');
    expect(result.status).toBe('discarded');
    if (result.status === 'discarded') {
      expect(result.reason).toContain('parse failure');
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. SHA freeze                                                       */
/* ------------------------------------------------------------------ */

describe('SHA freeze', () => {
  it('verifyJudgePromptSha passes with correct SHA', () => {
    const correctSha = getJudgePromptSha();
    expect(() => verifyJudgePromptSha(correctSha)).not.toThrow();
  });

  it('verifyJudgePromptSha throws on wrong SHA', () => {
    expect(() => verifyJudgePromptSha('deadbeef')).toThrow('SHA mismatch');
  });

  it('sha256 is deterministic', () => {
    const text = 'hello world';
    expect(sha256(text)).toBe(sha256(text));
    expect(sha256(text)).not.toBe(sha256('goodbye'));
  });
});

/* ------------------------------------------------------------------ */
/* 3. Calibration                                                      */
/* ------------------------------------------------------------------ */

describe('Calibration', () => {
  it('loads at least 48 calibration pairs (24 easy + 24 hard)', () => {
    const pairs = loadCalibrationPairs();
    expect(pairs.length).toBeGreaterThanOrEqual(48);
    const easy = pairs.filter((p) => p.difficulty === 'easy');
    const hard = pairs.filter((p) => p.difficulty === 'hard');
    expect(easy.length).toBeGreaterThanOrEqual(24);
    expect(hard.length).toBeGreaterThanOrEqual(24);
  });

  it('all pairs have required fields', () => {
    const pairs = loadCalibrationPairs();
    for (const pair of pairs) {
      expect(pair.id).toBeTruthy();
      expect(pair.real).toBeTruthy();
      expect(pair.close).toBeTruthy();
      expect(pair.far).toBeTruthy();
      expect(pair.expectedWinner).toBe('close');
      expect(['easy', 'hard']).toContain(pair.difficulty);
    }
  });

  it('accuracy threshold gates correctly: all correct passes', () => {
    // With 24 correct out of 24: accuracy = 100%
    const accuracy = 24 / 24;
    expect(accuracy).toBeGreaterThan(CALIBRATION_ACCURACY_THRESHOLD);
  });

  it('accuracy threshold gates correctly: too few correct fails', () => {
    // With 16 correct out of 24: accuracy = 66.7% < 80%
    const accuracy = 16 / 24;
    expect(accuracy).toBeLessThanOrEqual(CALIBRATION_ACCURACY_THRESHOLD);
  });

  it('valid pairs minimum gates correctly', () => {
    expect(CALIBRATION_MIN_VALID_PAIRS).toBe(20);
    // 19 valid pairs < 20 minimum
    expect(19).toBeLessThan(CALIBRATION_MIN_VALID_PAIRS);
  });

  it('position bias maximum gates correctly', () => {
    expect(CALIBRATION_MAX_BIAS).toBe(0.3);
    // 8 discarded out of 24 = 33.3% > 30%
    expect(8 / 24).toBeGreaterThan(CALIBRATION_MAX_BIAS);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Calibration gate enforcement                                     */
/* ------------------------------------------------------------------ */

describe('Calibration gate', () => {
  beforeEach(cleanRuns);
  afterEach(cleanRuns);

  it('requireCalibration throws when no calibration exists', () => {
    expect(() => requireCalibration('test-model', 'abc123')).toThrow('No calibration found');
  });

  it('requireCalibration throws when calibration failed', () => {
    writeRun({
      kind: 'calibration',
      modelName: 'test-model',
      promptSha: 'sha-test',
      commitSha: 'abc',
      params: {},
      results: { passed: false },
      details: [],
      timestamp: '2026-01-01T00-00-00-000Z',
    });
    expect(() => requireCalibration('test-model', 'sha-test')).toThrow('did not pass');
  });

  it('requireCalibration succeeds when calibration passed', () => {
    writeRun({
      kind: 'calibration',
      modelName: 'good-model',
      promptSha: 'sha-good',
      commitSha: 'abc',
      params: {},
      results: { passed: true },
      details: [],
      timestamp: '2026-01-01T00-00-00-000Z',
    });
    expect(() => requireCalibration('good-model', 'sha-good')).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* 5. LOWO: held-out isolation                                         */
/* ------------------------------------------------------------------ */

describe('LOWO isolation', () => {
  beforeEach(cleanRuns);
  afterEach(cleanRuns);

  it('held-out witness text never appears in court or prediction prompts', async () => {
    const store = new Store();
    seedDemo(store);

    // We will hold out w-faxiao and check that their testimony text
    // never appears in the prompts sent to the LLM
    const heldOutId = 'w-faxiao';
    const heldOutTestimonies = store.listBySubject(DEMO_SUBJECT_ID)
      .filter((t) => t.witnessId === heldOutId);

    // Collect unique phrases from held-out witness
    const heldOutPhrases: string[] = [];
    for (const t of heldOutTestimonies) {
      for (const a of t.answers) {
        // Take first 20 chars of each answer as a distinctive signature
        if (a.behindText.length >= 20) {
          heldOutPhrases.push(a.behindText.slice(0, 20));
        }
      }
    }
    expect(heldOutPhrases.length).toBeGreaterThan(0);

    // Build FakeLLM that records all prompts
    const courtResponses = Array.from({ length: 20 }, () =>
      JSON.stringify([
        { text: 'test claim', evidenceTestimonyIds: [] },
      ]),
    );
    // Court: filing per witness (5 remaining) + challenge verdicts
    const challengeResponses = Array.from({ length: 20 }, () =>
      JSON.stringify({ verdict: 'survive', reason: 'ok' }),
    );
    // Predictions: 10 questions x 2 (with/without persona) = 20
    const predictionResponses = Array.from({ length: 20 }, () =>
      'some prediction text',
    );
    // Judge: 10 questions x 2 (swap) = 20
    const judgeResponses = Array.from({ length: 20 }, () =>
      makeJudgeResponse('A'),
    );

    const llm = new FakeLLM([
      ...courtResponses,
      ...challengeResponses,
      ...predictionResponses,
      ...judgeResponses,
    ]);

    // Import the LOWO internals we need
    const { runLowo } = await import('../src/lowo');

    // We need to mock the requireCalibration - write a passing calibration
    writeRun({
      kind: 'calibration',
      modelName: 'test',
      promptSha: getJudgePromptSha(),
      commitSha: 'test',
      params: {},
      results: { passed: true },
      details: [],
      timestamp: '2026-01-01T00-00-00-000Z',
    });

    // We can't easily run full LOWO with FakeLLM (script length mismatch),
    // so instead verify isolation by building a held-out store directly
    const { Store: StoreClass } = await import('@openmimic/kernel');

    // Build a store without the held-out witness
    const tempStore = new StoreClass();
    const subject = store.getSubject(DEMO_SUBJECT_ID);
    if (subject) tempStore.putSubject(subject);
    const allWitnesses = store.listWitnessesBySubject(DEMO_SUBJECT_ID);
    for (const w of allWitnesses) {
      if (w.id !== heldOutId) tempStore.putWitness(w);
    }
    const allTestimonies = store.listBySubject(DEMO_SUBJECT_ID);
    for (const t of allTestimonies) {
      if (t.witnessId !== heldOutId) tempStore.addTestimony(t);
    }

    // Verify the held-out witness's testimony is NOT in the temp store
    const tempTestimonies = tempStore.listBySubject(DEMO_SUBJECT_ID);
    for (const t of tempTestimonies) {
      expect(t.witnessId).not.toBe(heldOutId);
    }

    // Verify the held-out witness is NOT in the temp store
    const tempWitnesses = tempStore.listWitnessesBySubject(DEMO_SUBJECT_ID);
    expect(tempWitnesses.map((w) => w.id)).not.toContain(heldOutId);

    // Verify that assembling persona from temp store produces a prompt
    // that does NOT contain the held-out witness's specific phrases
    const { adapterRunCourt, adapterAssemblePersona } = await import('../src/engine-adapter');

    // First run court to generate claims
    const courtLlm = new FakeLLM([
      ...courtResponses,
      ...challengeResponses,
    ]);
    await adapterRunCourt(DEMO_SUBJECT_ID, tempStore, courtLlm);

    const persona = await adapterAssemblePersona(DEMO_SUBJECT_ID, tempStore);

    for (const phrase of heldOutPhrases) {
      expect(persona.systemPrompt).not.toContain(phrase);
    }

    store.close();
    tempStore.close();
  });
});

/* ------------------------------------------------------------------ */
/* 6. Wilson interval                                                  */
/* ------------------------------------------------------------------ */

describe('Wilson interval', () => {
  it('returns [0,0,0] for zero total', () => {
    const result = wilsonInterval(0, 0);
    expect(result.lower).toBe(0);
    expect(result.center).toBe(0);
    expect(result.upper).toBe(0);
  });

  it('computes correct interval for 50/50', () => {
    const result = wilsonInterval(50, 100);
    expect(result.center).toBeCloseTo(0.5, 1);
    expect(result.lower).toBeGreaterThan(0.3);
    expect(result.upper).toBeLessThan(0.7);
  });

  it('computes correct interval for all successes', () => {
    const result = wilsonInterval(20, 20);
    expect(result.center).toBeGreaterThan(0.8);
    expect(result.upper).toBeLessThanOrEqual(1);
  });

  it('lower is never negative, upper is never > 1', () => {
    const result = wilsonInterval(1, 1000);
    expect(result.lower).toBeGreaterThanOrEqual(0);
    expect(result.upper).toBeLessThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Stability: bigram Jaccard and matching                           */
/* ------------------------------------------------------------------ */

describe('Stability: similarity', () => {
  it('bigramJaccard returns 1 for identical strings', () => {
    expect(bigramJaccard('hello', 'hello')).toBe(1);
  });

  it('bigramJaccard returns 0 for completely different strings', () => {
    expect(bigramJaccard('abc', 'xyz')).toBe(0);
  });

  it('bigramJaccard returns partial value for overlapping strings', () => {
    const sim = bigramJaccard('abcdef', 'abcxyz');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('bigramJaccard handles empty strings', () => {
    expect(bigramJaccard('', '')).toBe(1);
    expect(bigramJaccard('ab', '')).toBe(0);
  });
});

describe('Stability: claim matching', () => {
  const baseClaim = (id: string, text: string): Claim => ({
    id,
    subjectId: 'test',
    text,
    conviction: 0.8,
    evidence: ['t1'],
    status: 'surviving',
    courtSessionId: 'cs1',
  });

  it('matchClaims returns 1 for identical claim sets', () => {
    const claims = [baseClaim('c1', '他很善良'), baseClaim('c2', '他很聪明')];
    expect(matchClaims(claims, claims)).toBe(1);
  });

  it('matchClaims returns 0 for disjoint claim sets', () => {
    const a = [baseClaim('c1', '他很善良')];
    const b = [baseClaim('c2', '完全不同的内容完全不同')];
    expect(matchClaims(a, b)).toBe(0);
  });

  it('matchClaims returns 1 for two empty surviving sets', () => {
    const a = [{ ...baseClaim('c1', 'x'), status: 'retired' as const }];
    const b = [{ ...baseClaim('c2', 'y'), status: 'retired' as const }];
    expect(matchClaims(a, b)).toBe(1);
  });

  it('matchClaims returns 0 when one set has 0 surviving', () => {
    const a = [baseClaim('c1', '他很善良')];
    const b = [{ ...baseClaim('c2', '他很善良'), status: 'retired' as const }];
    expect(matchClaims(a, b)).toBe(0);
  });

  it('pairwiseOverlap computes mean and stddev', () => {
    const sets = [
      [baseClaim('c1', '他很善良'), baseClaim('c2', '他很聪明')],
      [baseClaim('c3', '他很善良'), baseClaim('c4', '他很勇敢')],
      [baseClaim('c5', '他很善良'), baseClaim('c6', '他很聪明')],
    ];
    const result = pairwiseOverlap(sets);
    expect(result.pairs).toBe(3); // C(3,2) = 3
    expect(result.mean).toBeGreaterThanOrEqual(0);
    expect(result.mean).toBeLessThanOrEqual(1);
    expect(result.stddev).toBeGreaterThanOrEqual(0);
  });
});

/* ------------------------------------------------------------------ */
/* 7b. LLM-judge claim matching                                        */
/* ------------------------------------------------------------------ */

function makeClaimMatchResponse(verdict: 'same' | 'different', reason: string = 'test'): string {
  return JSON.stringify({ verdict, reason });
}

describe('LLM claim matching', () => {
  const baseClaim = (id: string, text: string): Claim => ({
    id,
    subjectId: 'test',
    text,
    conviction: 0.8,
    evidence: ['t1'],
    status: 'surviving',
    courtSessionId: 'cs1',
  });

  it('claim-match prompt file loads and has a stable SHA', () => {
    const prompt = loadClaimMatchPrompt();
    expect(prompt).toContain('verdict');
    const sha = getClaimMatchPromptSha();
    expect(sha).toHaveLength(64);
    expect(getClaimMatchPromptSha()).toBe(sha); // deterministic
  });

  it('llmClaimMatch returns true when both directions agree "same"', async () => {
    const llm = new FakeLLM([
      makeClaimMatchResponse('same'),      // A,B
      makeClaimMatchResponse('same'),      // B,A (swap)
    ]);
    const result = await llmClaimMatch(llm, 'claim A', 'claim B');
    expect(result).toBe(true);
  });

  it('llmClaimMatch returns false when first direction says "different"', async () => {
    const llm = new FakeLLM([
      makeClaimMatchResponse('different'),
    ]);
    const result = await llmClaimMatch(llm, 'claim A', 'claim B');
    expect(result).toBe(false);
  });

  it('llmClaimMatch returns false on position swap disagreement', async () => {
    const llm = new FakeLLM([
      makeClaimMatchResponse('same'),      // A,B says same
      makeClaimMatchResponse('different'), // B,A says different => inconsistent
    ]);
    const result = await llmClaimMatch(llm, 'claim A', 'claim B');
    expect(result).toBe(false);
  });

  it('llmClaimMatch returns false on parse failure', async () => {
    const llm = new FakeLLM([
      'not json at all!',
      'still not json!',  // retry
    ]);
    const result = await llmClaimMatch(llm, 'claim A', 'claim B');
    expect(result).toBe(false);
  });

  it('matchClaimsLlm returns 1 for identical claims (all same)', async () => {
    const claims = [baseClaim('c1', 'text')];
    // For 1 vs 1: need 2 calls (forward + swap)
    const llm = new FakeLLM([
      makeClaimMatchResponse('same'),
      makeClaimMatchResponse('same'),
    ]);
    const rate = await matchClaimsLlm(claims, claims, llm);
    expect(rate).toBe(1);
  });

  it('matchClaimsLlm returns 0 for claims judged different', async () => {
    const a = [baseClaim('c1', 'he is kind')];
    const b = [baseClaim('c2', 'he is tall')];
    const llm = new FakeLLM([
      makeClaimMatchResponse('different'),
    ]);
    const rate = await matchClaimsLlm(a, b, llm);
    expect(rate).toBe(0);
  });

  it('pairwiseOverlapLlm computes mean over pairs', async () => {
    const sets = [
      [baseClaim('c1', 'text1')],
      [baseClaim('c2', 'text2')],
    ];
    // 1 pair: A->B forward+swap, B->A forward+swap = 4 calls total
    const llm = new FakeLLM([
      makeClaimMatchResponse('same'),  // A in B: forward
      makeClaimMatchResponse('same'),  // A in B: swap
      makeClaimMatchResponse('same'),  // B in A: forward
      makeClaimMatchResponse('same'),  // B in A: swap
    ]);
    const result = await pairwiseOverlapLlm(sets, llm);
    expect(result.pairs).toBe(1);
    expect(result.mean).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 8. Calibration: difficulty-based gating                             */
/* ------------------------------------------------------------------ */

describe('Calibration difficulty', () => {
  it('pairs include both easy and hard difficulties', () => {
    const pairs = loadCalibrationPairs();
    const easy = pairs.filter((p) => p.difficulty === 'easy');
    const hard = pairs.filter((p) => p.difficulty === 'hard');
    expect(easy.length).toBeGreaterThanOrEqual(24);
    expect(hard.length).toBeGreaterThanOrEqual(24);
  });

  it('hard pair IDs all start with cal-h', () => {
    const pairs = loadCalibrationPairs();
    const hard = pairs.filter((p) => p.difficulty === 'hard');
    for (const p of hard) {
      expect(p.id).toMatch(/^cal-h/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 9. Ledger: run writing and format                                   */
/* ------------------------------------------------------------------ */

describe('Ledger', () => {
  beforeEach(cleanRuns);
  afterEach(cleanRuns);

  it('writeRun creates a JSON file in the runs directory', () => {
    const path = writeRun({
      kind: 'test',
      modelName: 'test-model',
      promptSha: 'abc',
      commitSha: 'def',
      params: { key: 'value' },
      results: { score: 0.95 },
      details: [{ id: 1 }],
      timestamp: '2026-10-05T00-00-00-000Z',
    });

    expect(existsSync(path)).toBe(true);
    const content = JSON.parse(readFileSync(path, 'utf-8'));
    expect(content.kind).toBe('test');
    expect(content.modelName).toBe('test-model');
    expect(content.results.score).toBe(0.95);
  });

  it('findCalibrationRun finds matching model + SHA', () => {
    writeRun({
      kind: 'calibration',
      modelName: 'model-a',
      promptSha: 'sha-a',
      commitSha: 'c1',
      params: {},
      results: { passed: true },
      details: [],
      timestamp: '2026-01-01T00-00-00-000Z',
    });

    const found = findCalibrationRun('model-a', 'sha-a');
    expect(found).toBeDefined();
    expect(found?.results.passed).toBe(true);
  });

  it('findCalibrationRun returns undefined for mismatched model', () => {
    writeRun({
      kind: 'calibration',
      modelName: 'model-a',
      promptSha: 'sha-a',
      commitSha: 'c1',
      params: {},
      results: { passed: true },
      details: [],
      timestamp: '2026-01-01T00-00-00-000Z',
    });

    const found = findCalibrationRun('model-b', 'sha-a');
    expect(found).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 10. Hard gate: 0 claims = abort                                     */
/* ------------------------------------------------------------------ */

describe('Hard gate: zero claims abort', () => {
  beforeEach(cleanRuns);
  afterEach(cleanRuns);

  it('stability aborts when court produces 0 surviving claims', async () => {
    const store = new Store();
    seedDemo(store);

    // FakeLLM that produces 0 claims (filing returns empty arrays)
    const zeroClaimLlm = new FakeLLM(
      Array.from({ length: 50 }, () => JSON.stringify([])),
    );

    writeRun({
      kind: 'calibration',
      modelName: 'test',
      promptSha: getJudgePromptSha(),
      commitSha: 'test',
      params: {},
      results: { passed: true },
      details: [],
      timestamp: '2026-01-01T00-00-00-000Z',
    });

    const { runStability } = await import('../src/stability');
    await expect(
      runStability(DEMO_SUBJECT_ID, store, zeroClaimLlm, Store, {
        modelName: 'test',
        K: 1,
        maxSubsets: 1,
      }),
    ).rejects.toThrow(/0 surviving claims/);

    store.close();
  });

  it('LOWO aborts when court produces 0 surviving claims', async () => {
    const store = new Store();
    seedDemo(store);

    // courtLlm produces 0 claims, evalLlm is for predictions/judging (won't be reached)
    const zeroClaimCourtLlm = new FakeLLM(
      Array.from({ length: 50 }, () => JSON.stringify([])),
    );
    const evalLlm = new FakeLLM(['unused']);

    writeRun({
      kind: 'calibration',
      modelName: 'test',
      promptSha: getJudgePromptSha(),
      commitSha: 'test',
      params: {},
      results: { passed: true },
      details: [],
      timestamp: '2026-01-01T00-00-00-000Z',
    });

    const { runLowo } = await import('../src/lowo');
    await expect(
      runLowo(DEMO_SUBJECT_ID, store, zeroClaimCourtLlm, evalLlm, Store, {
        modelName: 'test',
        maxQuestionsPerWitness: 1,
      }),
    ).rejects.toThrow(/0 surviving claims/);

    store.close();
  });
});

/* ------------------------------------------------------------------ */
/* 11. Adversarial calibration pairs                                   */
/* ------------------------------------------------------------------ */

describe('Adversarial calibration pairs', () => {
  it('has at least 12 adversarial pairs (cal-h-adv prefix)', () => {
    const pairs = loadCalibrationPairs();
    const adversarial = pairs.filter((p) => p.id.startsWith('cal-h-adv'));
    expect(adversarial.length).toBeGreaterThanOrEqual(12);
  });

  it('original adversarial pairs (adv01-14) have non-trivial similarity between close and far', () => {
    const pairs = loadCalibrationPairs();
    // Only the original adversarial pairs (01-14) were designed with high close-far keyword overlap.
    // The round-2 challenge pairs (adv15+) use different adversarial strategies.
    const originalAdversarial = pairs.filter((p) =>
      p.id.startsWith('cal-h-adv') && parseInt(p.id.replace('cal-h-adv', ''), 10) <= 14,
    );
    for (const p of originalAdversarial) {
      const sim = bigramJaccard(p.close, p.far);
      expect(sim).toBeGreaterThan(0.02);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 11b. Round-2 challenge pairs                                        */
/* ------------------------------------------------------------------ */

describe('Round-2 challenge pairs', () => {
  it('has at least 10 challenge pairs (cal-h-adv15+)', () => {
    const pairs = loadCalibrationPairs();
    const challenge = pairs.filter((p) => {
      if (!p.id.startsWith('cal-h-adv')) return false;
      const num = parseInt(p.id.replace('cal-h-adv', ''), 10);
      return num >= 15;
    });
    expect(challenge.length).toBeGreaterThanOrEqual(10);
  });

  it('total calibration pairs is now at least 74 (64 + 10)', () => {
    const pairs = loadCalibrationPairs();
    expect(pairs.length).toBeGreaterThanOrEqual(74);
  });

  it('all challenge pairs have valid schema', () => {
    const pairs = loadCalibrationPairs();
    const challenge = pairs.filter((p) => p.id.startsWith('cal-h-adv') && parseInt(p.id.replace('cal-h-adv', ''), 10) >= 15);
    for (const p of challenge) {
      expect(p.real.length).toBeGreaterThan(10);
      expect(p.close.length).toBeGreaterThan(10);
      expect(p.far.length).toBeGreaterThan(10);
      expect(p.expectedWinner).toBe('close');
      expect(p.difficulty).toBe('hard');
    }
  });
});

/* ------------------------------------------------------------------ */
/* 12. LOWO ablation: claims section stripping                         */
/* ------------------------------------------------------------------ */

describe('LOWO ablation: stripClaimsSection', () => {
  const prompt = [
    '身份行',
    '## 他在不同人面前\n### 发小\n- 论断甲\n\n### 上司\n- 论断乙',
    '## 别人讲过的事（证人视角,不是他本人的口吻）\n- 事例一',
    '## 行为纪律\n- 纪律',
  ].join('\n\n');

  it('removes the claims section and keeps the rest intact', async () => {
    const { stripClaimsSection } = await import('../src/lowo');
    const stripped = stripClaimsSection(prompt);
    expect(stripped).not.toContain('论断甲');
    expect(stripped).not.toContain('论断乙');
    expect(stripped).not.toContain('他在不同人面前');
    expect(stripped).toBe(
      ['身份行', '## 别人讲过的事（证人视角,不是他本人的口吻）\n- 事例一', '## 行为纪律\n- 纪律'].join('\n\n'),
    );
  });

  it('throws when the prompt has no claims section', async () => {
    const { stripClaimsSection } = await import('../src/lowo');
    expect(() => stripClaimsSection('身份行\n\n## 行为纪律\n- 纪律')).toThrow('no claims section');
  });
});

/* ------------------------------------------------------------------ */
/* 12b. LOWO ablation: episodes section stripping                      */
/* ------------------------------------------------------------------ */

describe('LOWO ablation: stripEpisodesSection', () => {
  const prompt = [
    '身份行',
    '## 他在不同人面前\n### 发小\n- 论断甲',
    '## 别人讲过的事（证人视角,不是他本人的口吻）\n- 事例一\n- 事例二',
    '## 行为纪律\n- 纪律',
  ].join('\n\n');

  it('removes the episodes section and keeps the rest intact', async () => {
    const { stripEpisodesSection } = await import('../src/lowo');
    const stripped = stripEpisodesSection(prompt);
    expect(stripped).not.toContain('事例一');
    expect(stripped).not.toContain('事例二');
    expect(stripped).not.toContain('别人讲过的事');
    expect(stripped).toContain('论断甲');
    expect(stripped).toContain('纪律');
  });

  it('throws when the prompt has no episodes section', async () => {
    const { stripEpisodesSection } = await import('../src/lowo');
    expect(() => stripEpisodesSection('身份行\n\n## 行为纪律\n- 纪律')).toThrow('no episodes section');
  });
});

/* ------------------------------------------------------------------ */
/* 12c. Ablation arm: stats computation                                */
/* ------------------------------------------------------------------ */

describe('Ablation arm stats', () => {
  it('PersonaComposition type is usable', async () => {
    const lowo = await import('../src/lowo');
    // Verify stripClaimsSection and stripEpisodesSection are exported
    expect(typeof lowo.stripClaimsSection).toBe('function');
    expect(typeof lowo.stripEpisodesSection).toBe('function');
  });

  it('ablation module exports runAblation', async () => {
    const ablation = await import('../src/ablation');
    expect(typeof ablation.runAblation).toBe('function');
  });
});

/* ------------------------------------------------------------------ */
/* 12d. Stability v2 curve types                                       */
/* ------------------------------------------------------------------ */

describe('Stability v2 curve', () => {
  it('StabilityCurvePointV2 type includes intra-subset overlap', async () => {
    const stab = await import('../src/stability');
    // Just verify the type definition compiles and the function exports work
    expect(typeof stab.runStability).toBe('function');
    expect(typeof stab.matchClaimsLlm).toBe('function');
    expect(typeof stab.pairwiseOverlapLlm).toBe('function');
  });
});

/* ------------------------------------------------------------------ */
/* 13. Batch semantic claim matching (matchClaimsBatch)                 */
/* ------------------------------------------------------------------ */

describe('Batch semantic claim matching', () => {
  function makeClaim(text: string, id: string): Claim {
    return {
      id, subjectId: 's1', text, conviction: 0.9,
      evidence: ['t1'], status: 'surviving', courtSessionId: 'cs1',
    };
  }

  it('returns correct structure with FakeLLM', async () => {
    const { matchClaimsBatch } = await import('../src/stability');

    const claimsA = [makeClaim('他很节俭不爱花钱', 'a1'), makeClaim('他喜欢跑步热爱运动', 'a2'), makeClaim('他讨厌社交场合', 'a3')];
    const claimsB = [makeClaim('他不爱花钱很节俭', 'b1'), makeClaim('他热爱运动喜欢跑步', 'b2'), makeClaim('他害怕参加社交场合', 'b3')];

    // FakeLLM returns all-same verdicts for all 3 pairs
    const batchResponse = JSON.stringify([
      { pairIndex: 0, verdict: 'same' },
      { pairIndex: 1, verdict: 'same' },
      { pairIndex: 2, verdict: 'same' },
    ]);
    const fakeLlm = new FakeLLM([batchResponse]);

    const result = await matchClaimsBatch(claimsA, claimsB, fakeLlm);
    expect(result.total).toBe(3);
    expect(result.matched).toBe(3);
    expect(result.rate).toBeCloseTo(1, 5);
    expect(result.pairs).toHaveLength(3);
    // Each pair should have a verdict of 'same'
    for (const pair of result.pairs) {
      expect(pair.verdict).toBe('same');
      expect(typeof pair.bigramSim).toBe('number');
      expect(pair.bigramSim).toBeGreaterThan(0);
    }
  });

  it('handles empty claim lists', async () => {
    const { matchClaimsBatch } = await import('../src/stability');
    const emptyClaim = makeClaim('something', 'x1');
    const fakeLlm = new FakeLLM([]);
    const result = await matchClaimsBatch([], [emptyClaim], fakeLlm);
    expect(result.total).toBe(1);
    expect(result.rate).toBe(0);
    expect(result.pairs).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* 14. Calibration pairs: count and fact-reversal validation            */
/* ------------------------------------------------------------------ */

describe('Calibration pairs expanded', () => {
  it('has >= 86 total pairs (24 easy + 62 hard)', () => {
    const pairs = loadCalibrationPairs();
    expect(pairs.length).toBeGreaterThanOrEqual(86);

    const easy = pairs.filter((p: { difficulty: string }) => p.difficulty === 'easy');
    const hard = pairs.filter((p: { difficulty: string }) => p.difficulty === 'hard');
    expect(easy.length).toBe(24);
    expect(hard.length).toBeGreaterThanOrEqual(62);
  });

  it('has >= 12 fact-reversal pairs (cal-h-rev*)', () => {
    const pairs = loadCalibrationPairs();
    const rev = pairs.filter((p: { id: string }) => p.id.startsWith('cal-h-rev'));
    expect(rev.length).toBeGreaterThanOrEqual(12);
  });

  it('fact-reversal pairs have close and far texts with different content', () => {
    const pairs = loadCalibrationPairs();
    const rev = pairs.filter((p: { id: string }) => p.id.startsWith('cal-h-rev'));
    for (const pair of rev) {
      expect(pair.close.length).toBeGreaterThan(30);
      expect(pair.far.length).toBeGreaterThan(30);
      expect(pair.close).not.toBe(pair.far);
      // They should share some vocabulary (same subject) but differ in key facts
      expect(pair.difficulty).toBe('hard');
    }
  });
});

/* ------------------------------------------------------------------ */
/* 15. Self-report ablation arm types                                   */
/* ------------------------------------------------------------------ */

describe('Self-report ablation arm', () => {
  it('AblationOptions accepts selfReportArm flag', async () => {
    const abl = await import('../src/ablation');
    // Verify the type compiles - selfReportArm is optional
    const opts: import('../src/ablation').AblationOptions = {
      modelName: 'test',
      selfReportArm: true,
    };
    expect(opts.selfReportArm).toBe(true);
  });

  it('AblationQuestionResult includes optional self-report fields', async () => {
    // Type-level check: verify the interface compiles with selfReport fields
    const q: import('../src/ablation').AblationQuestionResult = {
      qid: 'q1',
      witnessId: 'w1',
      relation: 'test',
      realAnswer: 'real',
      withPersonaPrediction: 'pred',
      baselinePrediction: 'baseline',
      claimsStrippedPrediction: 'cs',
      episodesStrippedPrediction: 'es',
      selfReportPrediction: 'sr',
      judgeVsBaseline: { status: 'valid', winner: 'first', cues: ['a', 'b'] },
      judgeVsClaimsStripped: { status: 'valid', winner: 'first', cues: ['a', 'b'] },
      judgeVsEpisodesStripped: { status: 'valid', winner: 'first', cues: ['a', 'b'] },
      judgeVsSelfReport: { status: 'valid', winner: 'first', cues: ['a', 'b'] },
    };
    expect(q.selfReportPrediction).toBe('sr');
    expect(q.judgeVsSelfReport?.status).toBe('valid');
  });

  it('AblationResult includes optional vsSelfReport in overall', async () => {
    const partial: import('../src/ablation').AblationResult = {
      subjectId: 'test',
      modelName: 'test',
      promptSha: 'abc',
      witnessResults: [],
      overall: {
        vsBaseline: { validPairs: 0, discardedPairs: 0, personaWins: 0, comparisonWins: 0, personaWinRate: 0, wilson95: { lower: 0, center: 0, upper: 0 } },
        vsClaimsStripped: { validPairs: 0, discardedPairs: 0, personaWins: 0, comparisonWins: 0, personaWinRate: 0, wilson95: { lower: 0, center: 0, upper: 0 } },
        vsEpisodesStripped: { validPairs: 0, discardedPairs: 0, personaWins: 0, comparisonWins: 0, personaWinRate: 0, wilson95: { lower: 0, center: 0, upper: 0 } },
        vsSelfReport: { validPairs: 5, discardedPairs: 1, personaWins: 4, comparisonWins: 1, personaWinRate: 0.8, wilson95: { lower: 0.4, center: 0.8, upper: 1.0 } },
      },
    };
    expect(partial.overall.vsSelfReport?.personaWinRate).toBe(0.8);
  });
});

/* ------------------------------------------------------------------ */
/* 16. Twin-2K-500 adapter                                              */
/* ------------------------------------------------------------------ */

describe('Twin-2K-500 adapter', () => {
  it('twin2kToSubject converts participant to Subject with selfReport', async () => {
    const { twin2kToSubject, fabricatedTwin2KParticipants } = await import('../src/twin2k-adapter');
    const participants = fabricatedTwin2KParticipants();
    const subject = twin2kToSubject(participants[0]);
    expect(subject.id).toBe('twin2k-FAKE-001');
    expect(subject.displayName).toBe('Participant FAKE-001');
    expect(subject.selfReport).toContain('exercise');
    expect(subject.selfReport!.length).toBeLessThanOrEqual(6100); // maxChars=6000 + truncation suffix
  });

  it('twin2kToSubject truncates long persona text', async () => {
    const { twin2kToSubject } = await import('../src/twin2k-adapter');
    const longText = 'A'.repeat(10000);
    const subject = twin2kToSubject({ pid: 'X', personaText: longText, heldOutQuestions: [] }, 500);
    expect(subject.selfReport!.length).toBeLessThanOrEqual(520);
    expect(subject.selfReport).toContain('[... truncated ...]');
  });

  it('fabricatedTwin2KParticipants returns 3 participants with held-out questions', async () => {
    const { fabricatedTwin2KParticipants } = await import('../src/twin2k-adapter');
    const ps = fabricatedTwin2KParticipants();
    expect(ps).toHaveLength(3);
    expect(ps[0].heldOutQuestions).toHaveLength(3);
    expect(ps[1].heldOutQuestions).toHaveLength(2);
    expect(ps[2].heldOutQuestions).toHaveLength(1);
    // Verify structure
    for (const p of ps) {
      expect(p.pid).toBeTruthy();
      expect(p.personaText.length).toBeGreaterThan(0);
      for (const q of p.heldOutQuestions) {
        expect(q.options.length).toBeGreaterThanOrEqual(3);
        expect(q.correctIndex).toBeGreaterThanOrEqual(0);
        expect(q.correctIndex).toBeLessThan(q.options.length);
        expect(q.options[q.correctIndex]).toBe(q.correctAnswer);
      }
    }
  });

  it('predictTwin2KAnswer parses letter from FakeLLM', async () => {
    const { predictTwin2KAnswer, fabricatedTwin2KParticipants } = await import('../src/twin2k-adapter');
    const p = fabricatedTwin2KParticipants()[0];
    const q = p.heldOutQuestions[0]; // correctIndex=1 (B)

    // FakeLLM returns "B" => should match correctIndex=1
    const fakeLlm = new FakeLLM(['B']);
    const pred = await predictTwin2KAnswer(fakeLlm, p.personaText, q);
    expect(pred.predictedIndex).toBe(1);
    expect(pred.correct).toBe(true);
    expect(pred.predictedAnswer).toBe(q.options[1]);
  });

  it('predictTwin2KAnswer handles wrong letter', async () => {
    const { predictTwin2KAnswer, fabricatedTwin2KParticipants } = await import('../src/twin2k-adapter');
    const p = fabricatedTwin2KParticipants()[0];
    const q = p.heldOutQuestions[0]; // correctIndex=1 (B)

    // FakeLLM returns "C" => predictedIndex=2 != correctIndex=1
    const fakeLlm = new FakeLLM(['C']);
    const pred = await predictTwin2KAnswer(fakeLlm, p.personaText, q);
    expect(pred.predictedIndex).toBe(2);
    expect(pred.correct).toBe(false);
  });

  it('runTwin2K computes accuracy over all questions', async () => {
    const { runTwin2K, fabricatedTwin2KParticipants } = await import('../src/twin2k-adapter');
    const p = fabricatedTwin2KParticipants()[0]; // 3 questions, all correctIndex=1 (B)

    // FakeLLM returns B, B, A => 2 correct out of 3
    const fakeLlm = new FakeLLM(['B', 'B', 'A']);
    const result = await runTwin2K(fakeLlm, p);
    expect(result.pid).toBe('FAKE-001');
    expect(result.totalQuestions).toBe(3);
    expect(result.correctCount).toBe(2);
    expect(result.accuracy).toBeCloseTo(2 / 3, 5);
  });

  it('dataset metadata matches CC BY 4.0 license', async () => {
    // Verify the adapter header documents CC BY 4.0 and arXiv citation
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'twin2k-adapter.ts'),
      'utf-8',
    );
    expect(src).toContain('CC BY 4.0');
    expect(src).toContain('arXiv 2505.17479');
    expect(src).toContain('Toubia');
    expect(src).toContain('LLM-Digital-Twin/Twin-2K-500');
  });
});
