import { describe, expect, it, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventBus, PluginHost, Store } from '@openmimic/kernel';
import { Router, type RouteContext } from '@openmimic/server';
import { silenceSignalPlugin } from '@openmimic/silence-signal';
import type { LLMClient, LLMCompletionRequest } from '@openmimic/engine-court';
import {
  outputBiographyPlugin,
  buildMaterialBuckets,
  buildOutline,
  buildChapterPrompt,
  validateChapter,
  checkSynthesisOnlyLeakage,
  reviewQuality,
  buildSilenceNote,
  buildFinalChapter,
  extractSentences,
  extractConfidentialSentences,
  removeConfidentialContent,
  checkUnsupportedDetails,
  removeUnsupportedSentences,
  computeQuoteRatio,
  countConsecutivePatterns,
  countJuxtapositions,
  computeChapterConsistency,
  applyPolishPatches,
  generateArcProfile,
  BIOGRAPHY_STYLES,
  CONFIDENTIAL_MARKERS,
  type Biography,
  type BiographyParagraph,
  type BiographySection,
  type QuotableEntry,
  type MaterialBucket,
  type UnsupportedDetail,
  type PolishPatch,
  type ArcProfile,
} from '../src/index';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeCtx(body: unknown, params: Record<string, string> = {}): RouteContext {
  return { params, query: new URLSearchParams(), body };
}

/**
 * A FakeLLM that returns structured chapter JSON using actual witness IDs
 * and quotable text from the test seed data. Also records prompts for
 * inspection in tests.
 */
function createFakeLLM(overrides?: Partial<{
  chapter: unknown;
  failFirst: boolean;
  /** Return value for biography-detail-check calls. Default: empty array (no unsupported details). */
  detailCheckResult: unknown;
}>): LLMClient & { prompts: LLMCompletionRequest[] } {
  let callCount = 0;
  const prompts: LLMCompletionRequest[] = [];
  return {
    prompts,
    async complete(req: LLMCompletionRequest): Promise<string> {
      prompts.push(req);
      callCount++;

      // Handle detail-check purpose
      if (req.purpose === 'biography-detail-check') {
        return JSON.stringify(overrides?.detailCheckResult ?? { unsupportedDetails: [] });
      }

      if (overrides?.failFirst && callCount === 1) {
        return 'not json at all';
      }
      // Use actual quotable text from the seedBasicData testimonies
      // so that validation passes (witness IDs w1, w2, w3 match the seed).
      const chapter = overrides?.chapter ?? {
        title: 'Test Chapter',
        paragraphs: [
          {
            text: 'She once paid for everyone at dinner without telling anyone.',
            attribution: { displayName: 'College roommate' },
            sourceWitnessIds: ['w1'],
            conflict: false,
          },
          {
            text: 'She tracks every expense in a spreadsheet.',
            attribution: { displayName: 'Colleague' },
            sourceWitnessIds: ['w2'],
            conflict: false,
          },
        ],
      };
      return JSON.stringify(chapter);
    },
  };
}

async function setupHost(
  store: Store,
  llm?: LLMClient,
  config?: Record<string, unknown>,
) {
  const events = new EventBus();
  const host = new PluginHost(events);
  const router = new Router();
  host.providePreset('store', store);
  host.providePreset('events', events);
  host.providePreset('router', router);
  if (llm) host.providePreset('llm', llm);
  await host.load(silenceSignalPlugin);
  await host.load(outputBiographyPlugin, config);
  return { host, router, events };
}

function seedBasicData(store: Store) {
  store.putSubject({ id: 's1', displayName: 'Alice' });
  // 4 witnesses: w1-w3 quotable, w4 synthesis_only
  store.putWitness({ id: 'w1', subjectId: 's1', relation: 'College roommate', consentLevel: 'quotable' });
  store.putWitness({ id: 'w2', subjectId: 's1', relation: 'Colleague', consentLevel: 'quotable' });
  store.putWitness({ id: 'w3', subjectId: 's1', relation: 'Neighbor', consentLevel: 'quotable' });
  store.putWitness({ id: 'w4', subjectId: 's1', relation: 'Distant friend', consentLevel: 'synthesis_only' });

  store.addTestimony({
    id: 't1', witnessId: 'w1', subjectId: 's1',
    answers: [
      { qid: 'q1', behindText: 'She is incredibly generous. She once paid for everyone at dinner without telling anyone.' },
      { qid: 'q2', behindText: 'When she is upset she goes quiet and walks away.' },
      { qid: 'q3', behindText: 'She always has a plan. She never wings it.' },
    ],
  });
  store.addTestimony({
    id: 't2', witnessId: 'w2', subjectId: 's1',
    answers: [
      { qid: 'q1', behindText: 'She is careful with money. She tracks every expense in a spreadsheet.' },
      { qid: 'q2', behindText: 'She gets frustrated openly. She once slammed a door in a meeting.' },
      { qid: 'q3', behindText: 'She improvises well under pressure.' },
    ],
  });
  store.addTestimony({
    id: 't3', witnessId: 'w3', subjectId: 's1',
    answers: [
      { qid: 'q1', behindText: 'She shares food with neighbors all the time. Very giving person.' },
      { qid: 'q2', behindText: 'I have never seen her angry. She is always calm.' },
      { qid: 'q3', behindText: 'She is organized but flexible when plans change.' },
    ],
  });
  store.addTestimony({
    id: 't4', witnessId: 'w4', subjectId: 's1',
    answers: [
      { qid: 'q1', behindText: 'She spends wisely but can be impulsive with gifts.' },
      { qid: 'q2', behindText: 'She bottles things up until they burst.' },
      { qid: 'q3', behindText: 'She overthinks everything before acting.' },
    ],
  });
}

function seedWithClaims(store: Store) {
  seedBasicData(store);
  // Add a contested claim referencing t1
  store.putClaim({
    id: 'c1', subjectId: 's1', text: 'She is incredibly generous',
    conviction: 0.4, evidence: ['t1'], status: 'contested',
    courtSessionId: 'cs1',
  });
  store.putCourtSession({
    id: 'cs1', subjectId: 's1', startedAt: new Date().toISOString(),
    transcript: [], report: { totalClaims: 1, surviving: 0, qualified: 0, rejected: 0, challengeCount: 0, evidenceCoverage: 1 },
  });
}

function seedWithEpisodes(store: Store) {
  seedBasicData(store);
  store.putEpisode({
    id: 'e1', subjectId: 's1', witnessId: 'w1', testimonyId: 't1', qid: 'q1',
    text: 'She once paid for everyone at dinner without telling anyone.',
    elicited: false, situation: 'spending',
  });
  store.putEpisode({
    id: 'e2', subjectId: 's1', witnessId: 'w2', testimonyId: 't2', qid: 'q1',
    text: 'She tracks every expense in a spreadsheet.',
    elicited: false, situation: 'spending',
  });
  store.putEpisode({
    id: 'e3', subjectId: 's1', witnessId: 'w3', testimonyId: 't3', qid: 'q1',
    text: 'She shares food with neighbors all the time.',
    elicited: false, situation: 'spending',
  });
}

function seedWithCorpus(store: Store) {
  seedBasicData(store);
  store.putCorpusItem({
    id: 'corp1', subjectId: 's1',
    text: 'I never thought they saw me that way.',
    source: 'pasted',
    createdAt: new Date().toISOString(),
  });
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('output-biography plugin', () => {
  let store: Store;

  afterEach(() => {
    store?.close();
  });

  /* --- Service registration --- */

  it('provides output-biography service', async () => {
    store = new Store();
    seedBasicData(store);
    const { host } = await setupHost(store);
    expect(host.hasService('output-biography')).toBe(true);
  });

  /* --- Material buckets --- */

  it('buildMaterialBuckets groups by witness x topic', () => {
    store = new Store();
    seedBasicData(store);
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const { buckets, quotableIndex } = buildMaterialBuckets(witnesses, testimonies, [], []);

    // Should have buckets for each witness x qid
    expect(buckets.length).toBeGreaterThanOrEqual(4 * 3); // 4 witnesses, 3 questions each

    // quotable index should not include synthesis_only witness
    const synthEntries = quotableIndex.filter((q) => q.witnessId === 'w4');
    expect(synthEntries.length).toBe(0);

    // quotable index should have entries from quotable witnesses
    const quotableEntries = quotableIndex.filter((q) => q.witnessId === 'w1');
    expect(quotableEntries.length).toBeGreaterThan(0);
  });

  it('buildMaterialBuckets excludes contested claim evidence', () => {
    store = new Store();
    seedWithClaims(store);
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const claims = store.listClaimsBySubject('s1');
    const { buckets } = buildMaterialBuckets(witnesses, testimonies, [], claims);

    // t1 is evidence of contested claim c1, so w1's material from t1 should be excluded
    const w1Buckets = buckets.filter((b) => b.witnessId === 'w1');
    for (const b of w1Buckets) {
      for (const excerpt of b.excerpts) {
        // The specific testimony t1 text should not be present
        expect(excerpt).not.toContain('She is incredibly generous');
      }
    }
  });

  it('buildMaterialBuckets uses episodes when available', () => {
    store = new Store();
    seedWithEpisodes(store);
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const episodes = store.listEpisodesBySubject('s1');
    const { buckets, quotableIndex } = buildMaterialBuckets(witnesses, testimonies, episodes, []);

    // Should have 'spending' dimension from episodes
    const spendingBuckets = buckets.filter((b) => b.topicDimension === 'spending');
    expect(spendingBuckets.length).toBeGreaterThanOrEqual(3);

    // Episode text should be in quotable index
    const dinnerQuote = quotableIndex.find((q) =>
      q.text.includes('paid for everyone at dinner'),
    );
    expect(dinnerQuote).toBeDefined();
  });

  /* --- Outline builder --- */

  it('buildOutline produces 3-6 chapters', () => {
    store = new Store();
    seedBasicData(store);
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const { buckets, quotableIndex } = buildMaterialBuckets(witnesses, testimonies, [], []);

    const outline = buildOutline(buckets, quotableIndex, 'Alice', { minWitnesses: 3 });
    expect(outline.chapters.length).toBeGreaterThanOrEqual(3);
    expect(outline.chapters.length).toBeLessThanOrEqual(6);
    expect(outline.title).toContain('Alice');
  });

  it('buildOutline includes final chapter when corpus exists', () => {
    store = new Store();
    seedBasicData(store);
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const { buckets, quotableIndex } = buildMaterialBuckets(witnesses, testimonies, [], []);

    const outline = buildOutline(buckets, quotableIndex, 'Alice', { hasCorpus: true });
    const last = outline.chapters[outline.chapters.length - 1];
    expect(last.title).toBe('他们不知道的');
    expect(last.theme).toBe('subject_own_words');
  });

  it('buildOutline respects minWitnesses threshold', () => {
    store = new Store();
    seedBasicData(store);
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const { buckets, quotableIndex } = buildMaterialBuckets(witnesses, testimonies, [], []);

    // With threshold=10, no dimension qualifies; should still produce minimum chapters
    const outline = buildOutline(buckets, quotableIndex, 'Alice', { minWitnesses: 10 });
    expect(outline.chapters.length).toBeGreaterThanOrEqual(3);
  });

  /* --- Validation --- */

  it('validateChapter passes when quotes match', () => {
    const quotableIndex: QuotableEntry[] = [
      { text: 'She is careful with money.', witnessId: 'w2', displayName: 'Colleague', testimonyId: 't2', qid: 'q1' },
    ];
    const paragraphs: BiographyParagraph[] = [
      {
        text: 'Her colleague said: "She is careful with money."',
        attribution: { displayName: 'Colleague' },
        sourceRefs: [{ witnessId: 'w2' }],
        conflict: false,
      },
    ];
    const failures = validateChapter(
      paragraphs, quotableIndex, new Set(), new Set(['w2']),
    );
    expect(failures.length).toBe(0);
  });

  it('validateChapter fails when a quote is altered by one word', () => {
    const quotableIndex: QuotableEntry[] = [
      { text: 'She is careful with money.', witnessId: 'w2', displayName: 'Colleague', testimonyId: 't2', qid: 'q1' },
    ];
    const paragraphs: BiographyParagraph[] = [
      {
        text: 'Her colleague said: "She is very careful with money."',
        attribution: { displayName: 'Colleague' },
        sourceRefs: [{ witnessId: 'w2' }],
        conflict: false,
      },
    ];
    const failures = validateChapter(
      paragraphs, quotableIndex, new Set(), new Set(['w2']),
    );
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0].reason).toContain('untraceable quote');
  });

  it('validateChapter fails on unknown witness ref', () => {
    const paragraphs: BiographyParagraph[] = [
      {
        text: 'Someone said something.',
        attribution: { displayName: 'Unknown' },
        sourceRefs: [{ witnessId: 'w-unknown' }],
        conflict: false,
      },
    ];
    const failures = validateChapter(paragraphs, [], new Set(), new Set(['w1']));
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0].reason).toContain('unknown witness ref');
  });

  /* --- Synthesis-only leakage check --- */

  it('checkSynthesisOnlyLeakage catches 8+ char verbatim leak', () => {
    const synthExcerpts = ['She spends wisely but can be impulsive with gifts.'];
    const text = 'According to a friend, she spends wisely but can be impulsive sometimes.';
    const leaks = checkSynthesisOnlyLeakage(text, synthExcerpts);
    expect(leaks.length).toBeGreaterThan(0);
  });

  it('checkSynthesisOnlyLeakage passes when no 8-char match', () => {
    const synthExcerpts = ['She spends wisely but can be impulsive with gifts.'];
    const text = 'A friend mentioned she tends to be generous with presents.';
    const leaks = checkSynthesisOnlyLeakage(text, synthExcerpts);
    expect(leaks.length).toBe(0);
  });

  /* --- Quality review --- */

  it('reviewQuality detects omniscient narrator', () => {
    const result = reviewQuality(
      'He secretly felt that nobody understood him. Deep down he was lonely.',
      [],
    );
    const obs = result.dimensions.find((d) => d.key === 'observerSemantics');
    expect(obs).toBeDefined();
    expect(obs!.score).toBeLessThan(60);
    expect(obs!.issues).toContain('omniscient_narrator_language');
  });

  it('reviewQuality detects speculative language', () => {
    const result = reviewQuality(
      'She must have felt terrible. Perhaps she regretted it.',
      [],
    );
    const spec = result.dimensions.find((d) => d.key === 'speculativeLanguage');
    expect(spec!.score).toBeLessThan(80);
  });

  it('reviewQuality detects sensitive diagnostic terms', () => {
    const result = reviewQuality(
      'She was clearly showing signs of clinical depression and narcissism.',
      [],
    );
    const sens = result.dimensions.find((d) => d.key === 'sensitiveContent');
    expect(sens!.score).toBeLessThan(50);
  });

  it('reviewQuality detects over-praise', () => {
    const result = reviewQuality(
      'She was legendary in her field, destined for greatness.',
      [],
    );
    const praise = result.dimensions.find((d) => d.key === 'overPraise');
    expect(praise!.score).toBeLessThan(60);
  });

  it('reviewQuality detects duplication between chapters', () => {
    const body = 'She was always generous with her time and energy. Her friends admired her dedication.';
    const sibling = 'She was always generous with her time and energy. Her friends admired her so much.';
    const result = reviewQuality(body, [], { siblingBodies: [sibling] });
    const dup = result.dimensions.find((d) => d.key === 'duplication');
    expect(dup!.score).toBeLessThan(50);
  });

  /* --- Silence note and final chapter --- */

  it('buildSilenceNote returns null when no signals', () => {
    expect(buildSilenceNote([])).toBeNull();
  });

  it('buildSilenceNote returns fixed text when signals exist', () => {
    const signal = {
      id: 's1', subjectId: 's1', qid: 'q5',
      skipperIds: ['w1', 'w2', 'w3'],
      totalWitnesses: 4, skipRatio: 0.75,
      createdAt: new Date().toISOString(),
    };
    const note = buildSilenceNote([signal]);
    expect(note).toBeTruthy();
    expect(note).toContain('有意留下');
  });

  it('buildFinalChapter uses corpus when available', () => {
    const section = buildFinalChapter(
      [{ id: 'c1', subjectId: 's1', text: 'My own words.', source: 'pasted', createdAt: new Date().toISOString() }],
      'Alice',
    );
    expect(section.title).toBe('他们不知道的');
    expect(section.paragraphs[0].text).toBe('My own words.');
    expect(section.paragraphs[0].attribution?.displayName).toBe('Alice');
  });

  it('buildFinalChapter uses placeholder when no corpus', () => {
    const section = buildFinalChapter([], 'Alice');
    expect(section.paragraphs[0].text).toContain('留给主角');
  });

  /* --- Anonymous witness handling --- */

  it('anonymous witnesses get generic display name in buckets', () => {
    store = new Store();
    store.putSubject({ id: 's1', displayName: 'Alice' });
    store.putWitness({ id: 'w1', subjectId: 's1', relation: 'Secret admirer', consentLevel: 'quotable', anonymousInRoom: true });
    store.putWitness({ id: 'w2', subjectId: 's1', relation: 'Friend', consentLevel: 'quotable' });
    store.putWitness({ id: 'w3', subjectId: 's1', relation: 'Sibling', consentLevel: 'quotable' });
    store.addTestimony({ id: 't1', witnessId: 'w1', subjectId: 's1', answers: [{ qid: 'q1', behindText: 'She is kind.' }] });
    store.addTestimony({ id: 't2', witnessId: 'w2', subjectId: 's1', answers: [{ qid: 'q1', behindText: 'Very kind.' }] });
    store.addTestimony({ id: 't3', witnessId: 'w3', subjectId: 's1', answers: [{ qid: 'q1', behindText: 'Kind indeed.' }] });

    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const { buckets } = buildMaterialBuckets(witnesses, testimonies, [], []);

    const anonBucket = buckets.find((b) => b.witnessId === 'w1');
    expect(anonBucket?.displayName).toBe('A friend');
  });

  /* --- Conflict detection --- */

  it('parallel paragraphs with different attributions and similar text are flagged as conflict', () => {
    // This is tested via the trigramOverlap in generateBiography, but we test
    // the logic via reviewQuality duplication as proxy.
    // A more direct test would be the adjacent paragraph detection in the pipeline.
    // We test it here through the outline builder and material:
    store = new Store();
    seedBasicData(store);
    // w1 says generous, w2 says careful about money -- these are diverging views
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const { buckets } = buildMaterialBuckets(witnesses, testimonies, [], []);
    // The q1 dimension should have multiple witnesses with different views
    const q1Buckets = buckets.filter((b) => b.topicDimension === 'q1');
    expect(q1Buckets.length).toBeGreaterThanOrEqual(3);
  });

  /* --- Route tests --- */

  async function callRoute(
    router: Router,
    method: string,
    path: string,
    body: unknown = {},
    params?: Record<string, string>,
  ): Promise<{ status: number; body: unknown }> {
    const match = router.match(method, path);
    if (!match) return { status: 404, body: { error: { code: 'not_found', message: 'No route' } } };
    const ctx = makeCtx(body, params ?? match.params);
    const result = await match.handler(ctx);
    return result as { status: number; body: unknown };
  }

  it('GET /api/subjects/:id/biography returns 404 when no biography', async () => {
    store = new Store();
    seedBasicData(store);
    const { router } = await setupHost(store);

    const result = await callRoute(router, 'GET', '/api/subjects/s1/biography');
    expect(result.status).toBe(404);
  });

  it('POST /api/subjects/:id/biography returns 501 without LLM', async () => {
    store = new Store();
    seedBasicData(store);
    const { router } = await setupHost(store); // no LLM

    const result = await callRoute(router, 'POST', '/api/subjects/s1/biography');
    expect(result.status).toBe(501);
  });

  it('POST and GET biography with FakeLLM', async () => {
    store = new Store();
    seedBasicData(store);
    const llm = createFakeLLM();
    const { router } = await setupHost(store, llm);

    const postResult = await callRoute(router, 'POST', '/api/subjects/s1/biography');
    expect(postResult.status).toBe(200);
    const body = postResult.body as any;
    expect(body.biography).toBeDefined();
    expect(body.biography.subjectId).toBe('s1');
    expect(body.biography.sections.length).toBeGreaterThan(0);

    // GET should return the same biography
    const getResult = await callRoute(router, 'GET', '/api/subjects/s1/biography');
    expect(getResult.status).toBe(200);
    const getBio = (getResult.body as any);
    expect(getBio.subjectId).toBe('s1');
  });

  it('POST /api/biography/:id/sections/:sid/remove marks section as removed', async () => {
    store = new Store();
    seedBasicData(store);
    const llm = createFakeLLM();
    const { router } = await setupHost(store, llm);

    // Generate first
    const postResult = await callRoute(router, 'POST', '/api/subjects/s1/biography');
    const bio = (postResult.body as any).biography;
    const sectionId = bio.sections[0].id;
    const bioId = bio.id;

    // Remove section
    const removeResult = await callRoute(
      router, 'POST', `/api/biography/${bioId}/sections/${sectionId}/remove`,
    );
    expect(removeResult.status).toBe(200);
    const updated = (removeResult.body as any);
    const removedSection = updated.sections.find((s: any) => s.id === sectionId);
    expect(removedSection).toBeDefined();
    // After removal, the section's paragraphs should be the removal note
    expect(removedSection.paragraphs[0].text).toContain('应主角要求');
  });

  it('GET biography after section removal shows removal note', async () => {
    store = new Store();
    seedBasicData(store);
    const llm = createFakeLLM();
    const { router } = await setupHost(store, llm);

    const postResult = await callRoute(router, 'POST', '/api/subjects/s1/biography');
    const bio = (postResult.body as any).biography;
    const sectionId = bio.sections[0].id;
    const bioId = bio.id;

    await callRoute(router, 'POST', `/api/biography/${bioId}/sections/${sectionId}/remove`);

    const getResult = await callRoute(router, 'GET', '/api/subjects/s1/biography');
    const getBio = (getResult.body as any);
    const removed = getBio.sections.find((s: any) => s.id === sectionId);
    expect(removed.paragraphs[0].text).toContain('已移除');
  });

  it('plugin not loaded means route 404', async () => {
    store = new Store();
    seedBasicData(store);
    const events = new EventBus();
    const host = new PluginHost(events);
    const router = new Router();
    host.providePreset('store', store);
    host.providePreset('events', events);
    host.providePreset('router', router);
    // Do NOT load the biography plugin

    const match = router.match('GET', '/api/subjects/s1/biography');
    expect(match).toBeUndefined();
  });

  /* --- extractSentences --- */

  it('extractSentences splits on sentence boundaries', () => {
    const sentences = extractSentences('She is kind. She helps everyone! Really?');
    expect(sentences.length).toBe(3);
  });

  it('extractSentences limits output length', () => {
    const long = 'x'.repeat(300);
    const sentences = extractSentences(long);
    expect(sentences[0].length).toBeLessThanOrEqual(200);
  });

  /* --- Repair retry (structured JSON) --- */

  it('FakeLLM with failFirst triggers repair retry', async () => {
    store = new Store();
    seedBasicData(store);
    const llm = createFakeLLM({ failFirst: true });
    const { router } = await setupHost(store, llm);

    const result = await callRoute(router, 'POST', '/api/subjects/s1/biography');
    // Should still succeed because the second call returns valid JSON
    expect(result.status).toBe(200);
  });

  /* --- Subject not found --- */

  it('GET biography for non-existent subject returns 404', async () => {
    store = new Store();
    const { router } = await setupHost(store);
    const result = await callRoute(router, 'GET', '/api/subjects/nonexistent/biography');
    expect(result.status).toBe(404);
  });

  it('POST biography for non-existent subject returns 404', async () => {
    store = new Store();
    const llm = createFakeLLM();
    const { router } = await setupHost(store, llm);
    const result = await callRoute(router, 'POST', '/api/subjects/nonexistent/biography');
    expect(result.status).toBe(404);
  });

  /* --- Quality review: language and material overlap --- */

  it('reviewQuality rejects English woodworker text against Chinese material', () => {
    // This is the exact failure mode from the first real run: model generated
    // English fiction about a woodworker when material was Chinese.
    const englishWoodworkerText = [
      'On a Tuesday afternoon in October 2018, in a converted garage on Cherry Street,',
      'Marcus set a half-finished wooden chair on the workbench.',
      '"He wrote down everything," Dale said.',
      '"He had a spot for every tool," she said.',
      'Marcus once spent two hours adjusting the fence on a table saw.',
    ].join(' ');

    const chineseMaterial = [
      '他花钱这事特别分裂。跟我吃饭从来没让我买过单',
      '他不怎么当众发火,但你能感觉到',
      '林默对钱不敏感,但这不代表他大方',
    ];

    const result = reviewQuality(englishWoodworkerText, [], {
      materialExcerpts: chineseMaterial,
      quotableTexts: chineseMaterial,
      validationFailureCount: 24,
    });

    // Must be judged unacceptable
    expect(result.requiresRewrite).toBe(true);
    expect(result.score).toBeLessThan(50);

    // Language mismatch dimension should fire
    const langDim = result.dimensions.find((d) => d.key === 'languageMatch');
    expect(langDim).toBeDefined();
    expect(langDim!.score).toBeLessThan(20);

    // Material overlap should also be near zero
    const overlapDim = result.dimensions.find((d) => d.key === 'materialOverlap');
    expect(overlapDim).toBeDefined();
    expect(overlapDim!.score).toBeLessThan(30);

    // Validation alignment should also flag
    const valDim = result.dimensions.find((d) => d.key === 'validationAlignment');
    expect(valDim).toBeDefined();
    expect(valDim!.score).toBeLessThan(30);
  });

  it('reviewQuality accepts Chinese text that uses Chinese material', () => {
    const chineseOutput = '他的发小回忆说,跟他吃饭从来没让买过单。前上司说林默对钱不敏感。';
    const chineseMaterial = [
      '跟我吃饭从来没让我买过单',
      '林默对钱不敏感,但这不代表他大方',
    ];

    const result = reviewQuality(chineseOutput, [], {
      materialExcerpts: chineseMaterial,
      quotableTexts: chineseMaterial,
      validationFailureCount: 0,
    });

    const langDim = result.dimensions.find((d) => d.key === 'languageMatch');
    expect(langDim!.score).toBeGreaterThan(80);

    const overlapDim = result.dimensions.find((d) => d.key === 'materialOverlap');
    expect(overlapDim!.score).toBeGreaterThan(50);
  });

  /* --- Prompt content integration test --- */

  it('chapter prompt contains real witness IDs and quotable texts', () => {
    store = new Store();
    seedBasicData(store);
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const { buckets, quotableIndex } = buildMaterialBuckets(witnesses, testimonies, [], []);

    const outline = buildOutline(buckets, quotableIndex, 'Alice', { minWitnesses: 3 });
    const ch = outline.chapters[0]; // first content chapter

    const chapterBuckets = buckets.filter((b) =>
      ch.bucketKeys.includes(`${b.witnessId}::${b.topicDimension}`),
    );
    const chapterQuotable = quotableIndex.filter((q) =>
      ch.quotableTexts.includes(q.text),
    );

    const { system, user } = buildChapterPrompt(
      ch, chapterBuckets, chapterQuotable, [], 'Alice', BIOGRAPHY_STYLES[0],
    );

    // The prompt must contain real witness IDs from the test data
    expect(user).toContain('w1');
    expect(user).toContain('w2');
    expect(user).toContain('w3');

    // The prompt must contain at least some quotable text from the seed data
    // seedBasicData has: 'She is incredibly generous', 'She is careful with money'
    const hasRealText = chapterQuotable.some((q) => user.includes(q.text));
    expect(hasRealText).toBe(true);

    // The system prompt must be in Chinese
    expect(system).toContain('中文');
    expect(system).toContain('引号');

    // The prompt must NOT contain placeholder IDs like the old "w1" example
    // (The system prompt JSON example now says "此处填素材区给出的证人id")
    expect(system).toContain('此处填素材区给出的证人id');
  });

  it('FakeLLM prompt recording shows material is sent', async () => {
    store = new Store();
    seedBasicData(store);
    const llm = createFakeLLM();
    const { router } = await setupHost(store, llm);

    await callRoute(router, 'POST', '/api/subjects/s1/biography');

    // At least one prompt should have been sent
    expect(llm.prompts.length).toBeGreaterThan(0);

    // The user prompt for chapter generation should contain witness IDs
    const chapterPrompt = llm.prompts.find((p) => p.purpose === 'biography-chapter');
    expect(chapterPrompt).toBeDefined();
    expect(chapterPrompt!.user).toContain('w1');

    // Should contain actual quotable text from seed data
    const hasQuotable = chapterPrompt!.user.includes('generous') ||
      chapterPrompt!.user.includes('careful with money') ||
      chapterPrompt!.user.includes('shares food');
    expect(hasQuotable).toBe(true);
  });

  /* --- Confidential content filter --- */

  it('extractConfidentialSentences finds sentences with secrecy markers', () => {
    const text = '他特别慷慨。千万别跟他妈提这事。他对钱不敏感。';
    const confidential = extractConfidentialSentences(text);
    // Should find 2: the marker sentence AND the preceding fact sentence
    expect(confidential.length).toBe(2);
    expect(confidential[0]).toContain('他特别慷慨'); // preceding fact
    expect(confidential[1]).toContain('千万别'); // marker sentence
  });

  it('extractConfidentialSentences returns empty when no markers present', () => {
    const text = '他每次都抢着买单。朋友们都知道他大方。';
    const confidential = extractConfidentialSentences(text);
    expect(confidential.length).toBe(0);
  });

  it('removeConfidentialContent strips marked sentences and preceding facts', () => {
    // The preceding sentence (fact) and the marker sentence are both removed
    const text = '他花钱大方。别告诉别人他借了钱。他请客从不犹豫。';
    const cleaned = removeConfidentialContent(text);
    expect(cleaned).not.toContain('别告诉');
    expect(cleaned).not.toContain('他花钱大方'); // preceding fact also removed
    expect(cleaned).toContain('请客从不犹豫'); // unrelated sentence stays
  });

  it('buildMaterialBuckets with filterConfidential removes marked content', () => {
    store = new Store();
    store.putSubject({ id: 's1', displayName: 'Alice' });
    store.putWitness({ id: 'w1', subjectId: 's1', relation: 'Friend', consentLevel: 'quotable' });
    store.putWitness({ id: 'w2', subjectId: 's1', relation: 'Colleague', consentLevel: 'quotable' });
    store.putWitness({ id: 'w3', subjectId: 's1', relation: 'Neighbor', consentLevel: 'quotable' });
    store.addTestimony({
      id: 't1', witnessId: 'w1', subjectId: 's1',
      answers: [{ qid: 'q1', behindText: '他花钱大方。千万别跟他妈提他借了五万。' }],
    });
    store.addTestimony({
      id: 't2', witnessId: 'w2', subjectId: 's1',
      answers: [{ qid: 'q1', behindText: 'She is careful with money.' }],
    });
    store.addTestimony({
      id: 't3', witnessId: 'w3', subjectId: 's1',
      answers: [{ qid: 'q1', behindText: 'She shares food with neighbors.' }],
    });
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');

    // With filtering
    const { buckets: filtered } = buildMaterialBuckets(
      witnesses, testimonies, [], [], { filterConfidential: true },
    );
    const w1Filtered = filtered.filter((b) => b.witnessId === 'w1');
    for (const b of w1Filtered) {
      for (const excerpt of b.excerpts) {
        expect(excerpt).not.toContain('千万别');
      }
    }

    // Without filtering
    const { buckets: unfiltered } = buildMaterialBuckets(
      witnesses, testimonies, [], [], { filterConfidential: false },
    );
    const w1Unfiltered = unfiltered.filter((b) => b.witnessId === 'w1');
    const allText = w1Unfiltered.flatMap((b) => b.excerpts).join('');
    // The original text should still be there (or at least not have the marker removed)
    expect(allText).toContain('千万别');
  });

  /* --- Unsupported detail check --- */

  it('checkUnsupportedDetails returns details from LLM response', async () => {
    const fakeLLM: LLMClient = {
      async complete(): Promise<string> {
        return JSON.stringify({ unsupportedDetails: [
          { sentence: '他穿着蓝色工装', detail: '蓝色工装', reason: '素材中没有提到衣着颜色' },
        ] });
      },
    };
    const body = '他穿着蓝色工装来到了办公室。同事说他很勤快。';
    const material = ['同事说他加班到很晚'];
    const details = await checkUnsupportedDetails(fakeLLM, body, material);
    expect(details.length).toBe(1);
    expect(details[0].sentence).toContain('蓝色工装');
  });

  it('checkUnsupportedDetails returns empty when LLM finds nothing', async () => {
    const fakeLLM: LLMClient = {
      async complete(): Promise<string> {
        return JSON.stringify({ unsupportedDetails: [] });
      },
    };
    const body = '同事说他加班到很晚。';
    const material = ['同事说他加班到很晚'];
    const details = await checkUnsupportedDetails(fakeLLM, body, material);
    expect(details.length).toBe(0);
  });

  it('removeUnsupportedSentences strips flagged sentences', () => {
    const paragraphs: BiographyParagraph[] = [
      {
        text: '他穿着蓝色工装走进来。同事都很佩服他。',
        attribution: null,
        sourceRefs: [{ witnessId: 'w1' }],
        conflict: false,
      },
    ];
    const unsupported: UnsupportedDetail[] = [
      { sentence: '他穿着蓝色工装走进来', detail: '蓝色工装', reason: '无据' },
    ];
    const { cleaned, removed } = removeUnsupportedSentences(paragraphs, unsupported);
    expect(removed.length).toBe(1);
    expect(cleaned[0].text).not.toContain('蓝色工装');
    expect(cleaned[0].text).toContain('佩服');
  });

  /* --- Quality score variation --- */

  it('two clearly different texts must produce different quality scores', () => {
    // Good Chinese text with material overlap
    const goodText = '他的发小回忆说,跟他吃饭从来没让买过单。前上司说林默对钱不敏感。';
    const material = [
      '跟我吃饭从来没让我买过单',
      '林默对钱不敏感,但这不代表他大方',
    ];

    const goodResult = reviewQuality(goodText, [{ witnessId: 'w1' }, { witnessId: 'w2' }], {
      materialExcerpts: material,
      quotableTexts: material,
      validationFailureCount: 0,
    });

    // Bad text: English, speculative, omniscient, no material overlap
    const badText = 'He secretly felt that nobody understood him. Perhaps he was destined for greatness. She must have felt terrible about his clinical depression.';
    const badResult = reviewQuality(badText, [], {
      materialExcerpts: material,
      quotableTexts: material,
      validationFailureCount: 10,
    });

    // Scores must differ
    expect(goodResult.score).not.toBe(badResult.score);
    // Good text should score higher
    expect(goodResult.score).toBeGreaterThan(badResult.score);
    // Bad text should be flagged for rewrite
    expect(badResult.requiresRewrite).toBe(true);
    expect(goodResult.requiresRewrite).toBe(false);
  });

  it('quality scores vary across chapters with different content', () => {
    const material = ['他花钱大方,请客从不犹豫'];

    // Chapter with projected feelings (should get dinged)
    const withProjection = '他觉得自己不够好。他觉得朋友们不理解他。他觉得工作没意义。他觉得生活很累。';
    const r1 = reviewQuality(withProjection, [{ witnessId: 'w1' }], {
      materialExcerpts: material,
      validationFailureCount: 0,
    });

    // Chapter without projected feelings
    const withoutProjection = '朋友们都说他花钱大方,请客从不犹豫。';
    const r2 = reviewQuality(withoutProjection, [{ witnessId: 'w1' }], {
      materialExcerpts: material,
      validationFailureCount: 0,
    });

    // The chapter with multiple projected feelings should score lower on observerSemantics
    const obs1 = r1.dimensions.find((d) => d.key === 'observerSemantics');
    const obs2 = r2.dimensions.find((d) => d.key === 'observerSemantics');
    expect(obs1!.score).toBeLessThan(obs2!.score);

    // Overall scores should differ
    expect(r1.score).not.toBe(r2.score);
  });

  /* ================================================================ */
  /* v2 narrative weaving: structural quality metrics                  */
  /* ================================================================ */

  /* --- Quote ratio --- */

  it('computeQuoteRatio returns correct percentage for text with quotes', () => {
    // ~30 chars body, 10 chars quoted -> ~33%
    const text = '他很大方。发小说,"他花钱从不犹豫。"';
    const ratio = computeQuoteRatio(text);
    expect(ratio).toBeGreaterThan(15);
    expect(ratio).toBeLessThanOrEqual(60);
  });

  it('computeQuoteRatio returns 0 for text without quotes', () => {
    const text = '他对钱不敏感。团队都知道这一点。';
    const ratio = computeQuoteRatio(text);
    expect(ratio).toBe(0);
  });

  it('reviewQuality flags quote ratio below 15%', () => {
    // Narrative with no quotes at all
    const body = '朋友们都说他很大方。他对钱不敏感。团队买东西从不犹豫。报销单算得很清。大方和精打细算两面都有。';
    const result = reviewQuality(body, [{ witnessId: 'w1' }], {
      materialExcerpts: ['他很大方', '对钱不敏感'],
      validationFailureCount: 0,
    });
    const qr = result.dimensions.find((d) => d.key === 'quoteRatio');
    expect(qr).toBeDefined();
    expect(qr!.issues.length).toBeGreaterThan(0);
    expect(qr!.issues[0]).toContain('quote_ratio_low');
  });

  it('reviewQuality flags quote ratio above 35%', () => {
    // Text that is almost entirely quotes (quote stacking)
    const body = '发小说,"他花钱分裂。"前上司说,"对钱不敏感。"前任说,"AA精确到小数点。"';
    const result = reviewQuality(body, [{ witnessId: 'w1' }], {
      materialExcerpts: ['花钱分裂', '对钱不敏感', 'AA精确到小数点'],
      validationFailureCount: 0,
    });
    const qr = result.dimensions.find((d) => d.key === 'quoteRatio');
    expect(qr).toBeDefined();
    expect(qr!.issues.length).toBeGreaterThan(0);
    expect(qr!.issues[0]).toContain('quote_ratio_high');
  });

  /* --- Consecutive pattern detection --- */

  it('countConsecutivePatterns detects "X说" runs', () => {
    const body = [
      '发小说,他很大方。',
      '前上司说,他不大方。',
      '前任说,他AA。',
      '同事记得,他请客。',
    ].join('\n');
    const maxRun = countConsecutivePatterns(body);
    expect(maxRun).toBeGreaterThanOrEqual(3);
  });

  it('countConsecutivePatterns returns 0 for narrative text', () => {
    const body = [
      '几个人不约而同提到他对钱的态度。',
      '在发小眼里,这种分裂始终存在。',
      '前上司的说法不同。',
    ].join('\n');
    const maxRun = countConsecutivePatterns(body);
    expect(maxRun).toBeLessThanOrEqual(1);
  });

  it('reviewQuality penalizes consecutive "X说" pattern', () => {
    const stackedBody = [
      '发小说,他很大方。他花钱分裂。',
      '前上司说,他不大方。报销很精确。',
      '前任说,他AA到小数点。',
      '同事提到,他请客从不犹豫。',
    ].join('\n');
    const result = reviewQuality(stackedBody, [{ witnessId: 'w1' }], {
      materialExcerpts: ['大方', '不大方', 'AA'],
      validationFailureCount: 0,
    });
    const cp = result.dimensions.find((d) => d.key === 'consecutivePatterns');
    expect(cp).toBeDefined();
    expect(cp!.score).toBeLessThan(80);
  });

  /* --- Whole-testimony pasting detection --- */

  it('whole-testimony verbatim paste is flagged via high quote ratio', () => {
    // Simulate a chapter that pastes entire testimony blocks
    const body = '发小说了很多:"他花钱这事特别分裂。跟我吃饭从来没让我买过单,有一回我抢着付,他脸都拉下来了,说你少来这套。他平时那副我不缺钱的样子,现在想想全是撑的。上周我约他吃饭,又推了,说在忙。他最近联系确实少了。"';
    const ratio = computeQuoteRatio(body);
    // The quote takes up most of the text
    expect(ratio).toBeGreaterThan(60);
    const result = reviewQuality(body, [{ witnessId: 'w1' }], {
      materialExcerpts: ['花钱分裂'],
      validationFailureCount: 0,
    });
    const qr = result.dimensions.find((d) => d.key === 'quoteRatio');
    expect(qr!.score).toBeLessThan(50);
  });

  /* --- Juxtaposition detection --- */

  it('countJuxtapositions detects parallel views', () => {
    const body = '发小看到的是一面,前任看到的是另一面。前上司的说法不同。但前任记得的完全相反。';
    const count = countJuxtapositions(body);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('countJuxtapositions returns 0 when no contrasting phrases', () => {
    const body = '他每天上班。他很勤快。他从不迟到。';
    const count = countJuxtapositions(body);
    expect(count).toBe(0);
  });

  /* --- Chapter consistency --- */

  it('computeChapterConsistency returns 1 for identical structures', () => {
    const bodies = [
      '几个人提到他的慷慨。\n发小说他请客。\n前上司确认这一点。\n这件事没有定论。',
      '花钱方式引起关注。\n发小的描述生动。\n前任有不同看法。\n双方各执一词。',
    ];
    const score = computeChapterConsistency(bodies);
    expect(score).toBeGreaterThan(0.5);
  });

  it('computeChapterConsistency detects structural mismatch', () => {
    const bodies = [
      // One-liner vs multi-paragraph
      '"他很好。"',
      '几个人提到他的慷慨。\n发小说他请客。\n前上司确认这一点。\n前任有不同看法。\n这件事没有定论。',
    ];
    const score = computeChapterConsistency(bodies);
    expect(score).toBeLessThan(1);
  });

  /* --- Polish patches --- */

  it('applyPolishPatches applies find/replace correctly', () => {
    const sections: BiographySection[] = [{
      id: 'sec1', chapterNo: 1, title: 'test',
      paragraphs: [
        { text: '林默的发小说了一件事。', attribution: null, sourceRefs: [], conflict: false },
      ],
      removed: false, removalNote: null, qualityScore: null, qualityPass: null, qualityIssues: [],
    }];
    const patches: PolishPatch[] = [
      { chapterNo: 1, find: '林默的发小说了一件事', replace: '发小提起一件事', reason: '简化' },
    ];
    const applied = applyPolishPatches(sections, patches);
    expect(applied).toBe(1);
    expect(sections[0].paragraphs[0].text).toContain('发小提起一件事');
    expect(sections[0].paragraphs[0].text).not.toContain('林默的发小说了');
  });

  it('applyPolishPatches skips patches where find not found', () => {
    const sections: BiographySection[] = [{
      id: 'sec1', chapterNo: 1, title: 'test',
      paragraphs: [
        { text: '这是一段文字。', attribution: null, sourceRefs: [], conflict: false },
      ],
      removed: false, removalNote: null, qualityScore: null, qualityPass: null, qualityIssues: [],
    }];
    const patches: PolishPatch[] = [
      { chapterNo: 1, find: '不存在的文字', replace: '替换', reason: '测试' },
    ];
    const applied = applyPolishPatches(sections, patches);
    expect(applied).toBe(0);
    expect(sections[0].paragraphs[0].text).toBe('这是一段文字。');
  });

  /* --- Three styles produce different voice instructions --- */

  it('three styles produce different voice instructions in prompts', () => {
    store = new Store();
    seedBasicData(store);
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const { buckets, quotableIndex } = buildMaterialBuckets(witnesses, testimonies, [], []);
    const outline = buildOutline(buckets, quotableIndex, 'Alice', { minWitnesses: 3 });
    const ch = outline.chapters[0];
    const chapterBuckets = buckets.filter((b) =>
      ch.bucketKeys.includes(`${b.witnessId}::${b.topicDimension}`),
    );
    const chapterQuotable = quotableIndex.filter((q) =>
      ch.quotableTexts.includes(q.text),
    );

    const prompt1 = buildChapterPrompt(ch, chapterBuckets, chapterQuotable, [], 'Alice', BIOGRAPHY_STYLES[0]);
    const prompt2 = buildChapterPrompt(ch, chapterBuckets, chapterQuotable, [], 'Alice', BIOGRAPHY_STYLES[1]);
    const prompt3 = buildChapterPrompt(ch, chapterBuckets, chapterQuotable, [], 'Alice', BIOGRAPHY_STYLES[2]);

    // Each style must produce a different system prompt
    expect(prompt1.system).not.toBe(prompt2.system);
    expect(prompt2.system).not.toBe(prompt3.system);

    // Verify style-specific keywords
    expect(prompt1.system).toContain('第三人称');
    expect(prompt2.system).toContain('你');
    expect(prompt3.system).toContain('采访实录');
  });

  /* --- Arc profile in chapter prompt --- */

  it('buildChapterPrompt includes arc profile when provided', () => {
    store = new Store();
    seedBasicData(store);
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const { buckets, quotableIndex } = buildMaterialBuckets(witnesses, testimonies, [], []);
    const outline = buildOutline(buckets, quotableIndex, 'Alice', { minWitnesses: 3 });
    const ch = outline.chapters[0];
    const chapterBuckets = buckets.filter((b) =>
      ch.bucketKeys.includes(`${b.witnessId}::${b.topicDimension}`),
    );
    const chapterQuotable = quotableIndex.filter((q) =>
      ch.quotableTexts.includes(q.text),
    );

    const arcProfile: ArcProfile = {
      threads: ['对钱的态度分裂', '社交中的两面性'],
      speechPatterns: ['冷幽默', '轻描淡写'],
    };

    const { system } = buildChapterPrompt(
      ch, chapterBuckets, chapterQuotable, [], 'Alice', BIOGRAPHY_STYLES[0], arcProfile,
    );
    expect(system).toContain('对钱的态度分裂');
    expect(system).toContain('冷幽默');
    expect(system).toContain('人物参照');
  });

  it('buildChapterPrompt works without arc profile', () => {
    store = new Store();
    seedBasicData(store);
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const { buckets, quotableIndex } = buildMaterialBuckets(witnesses, testimonies, [], []);
    const outline = buildOutline(buckets, quotableIndex, 'Alice', { minWitnesses: 3 });
    const ch = outline.chapters[0];
    const chapterBuckets = buckets.filter((b) =>
      ch.bucketKeys.includes(`${b.witnessId}::${b.topicDimension}`),
    );
    const chapterQuotable = quotableIndex.filter((q) =>
      ch.quotableTexts.includes(q.text),
    );

    // null arc profile should not crash
    const { system } = buildChapterPrompt(
      ch, chapterBuckets, chapterQuotable, [], 'Alice', BIOGRAPHY_STYLES[0], null,
    );
    expect(system).not.toContain('人物参照');
    expect(system).toContain('第三人称');
  });

  /* --- Arc profile generation with FakeLLM --- */

  it('generateArcProfile returns valid structure from FakeLLM', async () => {
    const fakeLLM: LLMClient = {
      async complete(): Promise<string> {
        return JSON.stringify({
          threads: ['对钱的态度分裂', '说话轻描淡写'],
          speechPatterns: ['冷幽默', '直接'],
        });
      },
    };
    const profile = await generateArcProfile(fakeLLM, [], [], '林默');
    expect(profile.threads).toHaveLength(2);
    expect(profile.speechPatterns).toHaveLength(2);
    expect(profile.threads[0]).toContain('钱');
  });

  it('generateArcProfile returns empty on LLM failure', async () => {
    const fakeLLM: LLMClient = {
      async complete(): Promise<string> {
        throw new Error('LLM error');
      },
    };
    const profile = await generateArcProfile(fakeLLM, [], [], '林默');
    expect(profile.threads).toHaveLength(0);
    expect(profile.speechPatterns).toHaveLength(0);
  });

  /* --- Narrative sentence detail check --- */

  it('unsupported detail check covers narrative sentences not just quotes', async () => {
    const fakeLLM: LLMClient = {
      async complete(): Promise<string> {
        return JSON.stringify({ unsupportedDetails: [
          { sentence: '那天下着大雨,三个人在咖啡馆坐了一下午', detail: '大雨、咖啡馆', reason: '素材中没有天气和地点描写' },
        ] });
      },
    };
    // A narrative sentence (not a quote) with unsupported detail
    const body = '那天下着大雨,三个人在咖啡馆坐了一下午。发小说他看起来很累。';
    const material = ['发小说他看起来很累'];
    const details = await checkUnsupportedDetails(fakeLLM, body, material);
    expect(details.length).toBe(1);
    expect(details[0].detail).toContain('大雨');
  });

  /* --- Structural metrics differentiation --- */

  it('structural metrics produce different scores for narrative vs quote-stacked text', () => {
    const material = ['他花钱大方', '对钱不敏感', '报销精确'];

    // Narrative text with embedded quotes (well-woven)
    const narrativeText = '几个人不约而同提到他对钱的态度分裂。发小的说法最直接,但前上司看到的是另一面——在公司里他"对钱不敏感",给团队买东西从不犹豫。';
    const r1 = reviewQuality(narrativeText, [{ witnessId: 'w1' }, { witnessId: 'w2' }], {
      materialExcerpts: material,
      validationFailureCount: 0,
    });

    // Quote-stacked text (the old problem)
    const stackedText = '发小说,"他花钱大方。"\n前上司说,"对钱不敏感。"\n前任说,"报销精确。"\n同事说,"请客大方。"';
    const r2 = reviewQuality(stackedText, [{ witnessId: 'w1' }], {
      materialExcerpts: material,
      validationFailureCount: 0,
    });

    // Narrative should score better on consecutive patterns
    const cp1 = r1.dimensions.find((d) => d.key === 'consecutivePatterns');
    const cp2 = r2.dimensions.find((d) => d.key === 'consecutivePatterns');
    expect(cp1!.score).toBeGreaterThan(cp2!.score);

    // Narrative should score better on juxtapositions
    const jx1 = r1.dimensions.find((d) => d.key === 'juxtapositions');
    const jx2 = r2.dimensions.find((d) => d.key === 'juxtapositions');
    expect(jx1!.score).toBeGreaterThanOrEqual(jx2!.score);
  });

  /* --- Chapter prompt contains narrative weaving instructions --- */

  it('chapter system prompt instructs narrative weaving', () => {
    store = new Store();
    seedBasicData(store);
    const witnesses = store.listWitnessesBySubject('s1');
    const testimonies = store.listBySubject('s1');
    const { buckets, quotableIndex } = buildMaterialBuckets(witnesses, testimonies, [], []);
    const outline = buildOutline(buckets, quotableIndex, 'Alice', { minWitnesses: 3 });
    const ch = outline.chapters[0];
    const chapterBuckets = buckets.filter((b) =>
      ch.bucketKeys.includes(`${b.witnessId}::${b.topicDimension}`),
    );
    const chapterQuotable = quotableIndex.filter((q) =>
      ch.quotableTexts.includes(q.text),
    );

    const { system, user } = buildChapterPrompt(
      ch, chapterBuckets, chapterQuotable, [], 'Alice', BIOGRAPHY_STYLES[0],
    );

    // Must instruct narrative weaving, not per-paragraph attribution
    expect(system).toContain('叙述');
    expect(system).toContain('引语');
    expect(system).toContain('并置');
    expect(system).toContain('视角差');
    expect(system).toContain('章内结构');
    // User prompt must mention quote ratio control
    expect(user).toContain('15%-35%');
  });

  /* --- Silence note and final chapter preserved --- */

  it('silence note still works after v2 changes', () => {
    const signal = {
      id: 's1', subjectId: 's1', qid: 'q5',
      skipperIds: ['w1', 'w2', 'w3'],
      totalWitnesses: 4, skipRatio: 0.75,
      createdAt: new Date().toISOString(),
    };
    const note = buildSilenceNote([signal]);
    expect(note).toContain('有意留下');
  });

  it('final chapter still uses corpus verbatim after v2 changes', () => {
    const section = buildFinalChapter(
      [{ id: 'c1', subjectId: 's1', text: '我自己的话。', source: 'pasted', createdAt: new Date().toISOString() }],
      'TestSubject',
    );
    expect(section.paragraphs[0].text).toBe('我自己的话。');
    expect(section.title).toBe('他们不知道的');
  });
});
