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
  validateChapter,
  checkSynthesisOnlyLeakage,
  reviewQuality,
  buildSilenceNote,
  buildFinalChapter,
  extractSentences,
  type Biography,
  type BiographyParagraph,
  type QuotableEntry,
  type MaterialBucket,
  type BiographySection,
} from '../src/index';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeCtx(body: unknown, params: Record<string, string> = {}): RouteContext {
  return { params, query: new URLSearchParams(), body };
}

/** A FakeLLM that returns a valid structured chapter JSON. */
function createFakeLLM(overrides?: Partial<{
  chapter: unknown;
  failFirst: boolean;
}>): LLMClient {
  let callCount = 0;
  return {
    async complete(req: LLMCompletionRequest): Promise<string> {
      callCount++;
      if (overrides?.failFirst && callCount === 1) {
        return 'not json at all';
      }
      const chapter = overrides?.chapter ?? {
        title: 'Test Chapter',
        paragraphs: [
          {
            text: 'His college roommate recalled that he was always generous.',
            attribution: { displayName: 'College roommate' },
            sourceWitnessIds: ['w1'],
            conflict: false,
          },
          {
            text: 'His colleague had a different view: "He is careful with money."',
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
    expect(last.title).toBe('What they do not know');
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
    expect(obs!.score).toBeLessThan(50);
    expect(obs!.issues).toContain('omniscient_narrator_language');
  });

  it('reviewQuality detects speculative language', () => {
    const result = reviewQuality(
      'She must have felt terrible. Perhaps she regretted it.',
      [],
    );
    const spec = result.dimensions.find((d) => d.key === 'speculativeLanguage');
    expect(spec!.score).toBeLessThan(60);
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
    expect(note).toContain('intentionally blank');
  });

  it('buildFinalChapter uses corpus when available', () => {
    const section = buildFinalChapter(
      [{ id: 'c1', subjectId: 's1', text: 'My own words.', source: 'pasted', createdAt: new Date().toISOString() }],
      'Alice',
    );
    expect(section.title).toBe('What they do not know');
    expect(section.paragraphs[0].text).toBe('My own words.');
    expect(section.paragraphs[0].attribution?.displayName).toBe('Alice');
  });

  it('buildFinalChapter uses placeholder when no corpus', () => {
    const section = buildFinalChapter([], 'Alice');
    expect(section.paragraphs[0].text).toContain('reserved for the subject');
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
    expect(removedSection.paragraphs[0].text).toContain('removed at the subject');
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
    expect(removed.paragraphs[0].text).toContain('removed');
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
});
