import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import { DEMO_SUBJECT_ID, seedDemo } from '@openmimic/fixtures';
import type { Claim } from '@openmimic/shared';
import {
  IMPORT_RECEIPT_TEXT,
  IMPORT_SUBJECT_SUFFIX,
  PERSONA_FORMAT,
  PERSONA_NOTICE,
  PERSONA_VERSION,
  buildPersonaPackage,
  importPersonaPackage,
  isImportedSubject,
  runImportedRoom,
  startServer,
  type PersonaPackage,
  type RunningServer,
} from '@openmimic/server';

const NOW = '2026-10-05T00:00:00.000Z';
const SECRET = '紫色大象在凌晨三点独自跳探戈且无人知晓';

interface ApiResponse {
  status: number;
  text: string;
  body: Record<string, unknown>;
  contentDisposition: string | null;
}

async function api(
  base: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
    contentDisposition: response.headers.get('content-disposition'),
  };
}

/** A subject whose only long answer comes from a `synthesis_only` witness. */
function seedSynthesisOnlyStore(): { store: Store; subjectId: string } {
  const store = new Store();
  const subjectId = 'subj-secret';
  store.putSubject({ id: subjectId, displayName: '密语' });
  store.putWitness({
    id: 'w-quotable',
    subjectId,
    relation: '朋友',
    consentLevel: 'quotable',
  });
  store.putWitness({
    id: 'w-secret',
    subjectId,
    relation: '同事',
    consentLevel: 'synthesis_only',
  });
  store.addTestimony({
    id: 't-quotable',
    witnessId: 'w-quotable',
    subjectId,
    createdAt: NOW,
    answers: [{ qid: 'q1', behindText: '他平时话不多,但答应的事一定办。' }],
  });
  store.addTestimony({
    id: 't-secret',
    witnessId: 'w-secret',
    subjectId,
    createdAt: NOW,
    answers: [{ qid: 'q1', behindText: SECRET }],
  });
  store.putClaim({
    id: 'c-secret-1',
    subjectId,
    text: '他在压力下倾向独自消化情绪。',
    conviction: 0.8,
    evidence: ['t-quotable', 't-secret'],
    status: 'surviving',
    courtSessionId: 'sess-secret',
  });
  return { store, subjectId };
}

/** Compare claims while ignoring the ids that import necessarily regenerates. */
const normalizeClaims = (claims: readonly Claim[]) =>
  claims.map(({ id: _id, subjectId: _subjectId, evidence: _evidence, ...rest }) => rest);

describe('.persona package export / import', () => {
  let store: Store | undefined;
  let server: RunningServer | undefined;

  afterEach(async () => {
    if (server) await server.close();
    if (store) store.close();
    server = undefined;
    store = undefined;
  });

  it('exports a consent-filtered package with an attachment header', async () => {
    store = new Store();
    seedDemo(store);
    server = await startServer({ port: 0, store, webDistDir: '' });

    const response = await api(
      server.url, 'GET',
      `/api/subjects/${DEMO_SUBJECT_ID}/export?acknowledgeRealPerson=true`,
    );
    expect(response.status).toBe(200);
    expect(response.contentDisposition).toContain('attachment');
    expect(response.contentDisposition).toContain('.persona');

    const pkg = response.body as unknown as PersonaPackage;
    expect(pkg.format).toBe(PERSONA_FORMAT);
    expect(pkg.version).toBe(PERSONA_VERSION);
    expect(pkg.notice).toBe(PERSONA_NOTICE);
    expect(pkg.subject.displayName).toBe('林默');
    // The subject's own account never travels in the package.
    expect('selfReport' in pkg.subject).toBe(false);
    // Surviving claims only: 5 of the demo's 7 (2 are contested).
    expect(pkg.claims).toHaveLength(5);
    expect(pkg.claims.every((claim) => claim.status === 'surviving')).toBe(true);
    // Six witnesses, metadata only.
    expect(pkg.witnesses).toHaveLength(6);
    for (const witness of pkg.witnesses) {
      expect('answers' in witness).toBe(false);
      expect(Array.isArray(witness.evidenceIds)).toBe(true);
    }
    // v2: style samples come from corpus items (subject's own words).
    // Privacy filter may reduce the count (corpus-limo-5 contains "你可别")
    expect(pkg.styleSamples.length).toBeGreaterThanOrEqual(1);
    // v2: episodes and divergences are included.
    expect(pkg.episodes!.length).toBeGreaterThanOrEqual(1);
    expect(pkg.divergences!.length).toBeGreaterThanOrEqual(1);
    // The raw testimony entry is not shipped.
    expect(response.text).not.toContain('借了两万');
  });

  it('privacy filter: no amounts or confidential markers in demo export', () => {
    store = new Store();
    seedDemo(store);
    const pkg = buildPersonaPackage(DEMO_SUBJECT_ID, store, {
      acknowledgeRealPerson: true,
    })!;
    expect(pkg).toBeDefined();

    const fullJson = JSON.stringify(pkg);

    // No Chinese amount patterns from private sentences
    expect(fullJson).not.toContain('两万');
    // No confidential marker phrases
    expect(fullJson).not.toContain('你可别');
    expect(fullJson).not.toContain('别跟');
    // The divergence position "已辞职,半夜借过两万" must not appear
    expect(fullJson).not.toContain('已辞职');
    // Corpus item "你可别跟我妈说" must not appear
    expect(fullJson).not.toContain('你可别跟我妈说');
    // Divergence summaries are stripped (redacted placeholder)
    for (const div of pkg.divergences ?? []) {
      for (const pos of div.positions) {
        expect(pos.summary).toBe('[redacted]');
      }
    }
  });

  it('real-person gate: export without acknowledge throws 403', async () => {
    store = new Store();
    seedDemo(store);
    server = await startServer({ port: 0, store, webDistDir: '' });

    const response = await api(server.url, 'GET', `/api/subjects/${DEMO_SUBJECT_ID}/export`);
    expect(response.status).toBe(403);
    expect((response.body.error as Record<string, unknown>).code).toBe('real_person_gate');
  });

  it('real-person gate: acknowledge=true allows export', async () => {
    store = new Store();
    seedDemo(store);
    server = await startServer({ port: 0, store, webDistDir: '' });

    const response = await api(
      server.url, 'GET',
      `/api/subjects/${DEMO_SUBJECT_ID}/export?acknowledgeRealPerson=true`,
    );
    expect(response.status).toBe(200);
  });

  it('real-person gate: not required for imported subjects', () => {
    store = new Store();
    seedDemo(store);
    const pkg = buildPersonaPackage(DEMO_SUBJECT_ID, store, {
      acknowledgeRealPerson: true,
    })!;
    const imported = importPersonaPackage(store, pkg);
    // Imported subject should export without acknowledgeRealPerson
    const reimport = buildPersonaPackage(imported.subject.id, store);
    expect(reimport).toBeDefined();
  });

  it('omits synthesis_only raw words from the export', async () => {
    const seeded = seedSynthesisOnlyStore();
    store = seeded.store;
    server = await startServer({ port: 0, store, webDistDir: '', skipDemo: true });

    const response = await api(
      server.url, 'GET',
      `/api/subjects/${seeded.subjectId}/export?acknowledgeRealPerson=true`,
    );
    expect(response.status).toBe(200);
    expect(response.text).not.toContain(SECRET);

    const pkg = response.body as unknown as PersonaPackage;
    // v2: style samples come from corpus (subject's own words).
    // No corpus was added, so style samples are empty.
    expect(pkg.styleSamples).toEqual([]);
  });

  it('imports a package into an anchored new subject with placeholder receipts', () => {
    store = new Store();
    seedDemo(store);
    const pkg = buildPersonaPackage(DEMO_SUBJECT_ID, store, {
      now: () => new Date(NOW),
      acknowledgeRealPerson: true,
    });
    expect(pkg).toBeDefined();

    const result = importPersonaPackage(store, pkg, { now: () => new Date(NOW) });
    expect(result.subject.displayName).toBe(`林默${IMPORT_SUBJECT_SUFFIX}`);
    expect(result.claimCount).toBe(5);
    expect(result.witnessCount).toBe(6);
    expect(isImportedSubject(store, result.subject.id)).toBe(true);

    // Every ledger entry for the imported persona is a receipt, not evidence.
    const testimonies = store.listBySubject(result.subject.id);
    expect(testimonies.length).toBeGreaterThan(0);
    for (const testimony of testimonies) {
      expect(testimony.answers).toEqual([]);
      expect(testimony.freeText).toBe(IMPORT_RECEIPT_TEXT);
    }

    // No-anchor iron law: every imported claim has an existing anchor.
    const claims = store.listClaimsBySubject(result.subject.id);
    expect(claims).toHaveLength(5);
    for (const claim of claims) {
      expect(claim.evidence.length).toBeGreaterThan(0);
      for (const evidenceId of claim.evidence) {
        expect(store.getTestimony(evidenceId)).toBeDefined();
      }
    }

    // Receipts inherit the package's declared consent levels.
    const levels = new Set(
      store.listWitnessesBySubject(result.subject.id).map((witness) => witness.consentLevel),
    );
    expect(levels.has('quotable')).toBe(true);
  });

  it('round-trips claims and style samples through export/import/export', () => {
    store = new Store();
    seedDemo(store);

    const first = buildPersonaPackage(DEMO_SUBJECT_ID, store, {
      now: () => new Date(NOW),
      acknowledgeRealPerson: true,
    });
    expect(first).toBeDefined();
    const imported = importPersonaPackage(store, first, { now: () => new Date(NOW) });
    const second = buildPersonaPackage(imported.subject.id, store, { now: () => new Date(NOW) });
    expect(second).toBeDefined();

    expect(normalizeClaims(second!.claims)).toEqual(normalizeClaims(first!.claims));
    // v2: style samples come from corpus; import does not copy corpus items
    // into the new subject's store, so the re-exported package has none.
    expect(second!.styleSamples).toEqual([]);
    // An imported subject's report says so: coverage is nominal, not real.
    expect(second!.report?.imported).toBe(true);
  });

  it('rejects a body that is not an openmimic.persona package', async () => {
    store = new Store();
    server = await startServer({ port: 0, store, webDistDir: '', skipDemo: true });

    const response = await api(server.url, 'POST', '/api/import', { format: 'nope' });
    expect(response.status).toBe(400);
    expect((response.body.error as Record<string, unknown>).code).toBe('validation_error');
  });

  it('serves an imported persona through /v1/models', async () => {
    store = new Store();
    seedDemo(store);
    server = await startServer({ port: 0, store, webDistDir: '' });

    const exported = await api(
      server.url, 'GET',
      `/api/subjects/${DEMO_SUBJECT_ID}/export?acknowledgeRealPerson=true`,
    );
    const imported = await api(server.url, 'POST', '/api/import', exported.body);
    expect(imported.status).toBe(201);
    const newId = (imported.body.subject as Record<string, unknown>).id as string;

    const models = await api(server.url, 'GET', '/v1/models');
    const ids = (models.body.data as Array<Record<string, unknown>>).map((model) => model.id);
    expect(ids).toContain(`persona/${newId}`);
  });

  it('runs a claims-driven room for an imported persona and marks it imported', async () => {
    store = new Store();
    seedDemo(store);
    const pkg = buildPersonaPackage(DEMO_SUBJECT_ID, store, {
      acknowledgeRealPerson: true,
    })!;
    const imported = importPersonaPackage(store, pkg);

    const room = await runImportedRoom(imported.subject.id, store, undefined, {
      newId: () => 'room-imported-1',
      now: () => NOW,
    });
    expect(room.imported).toBe(true);
    expect(room.behindTranscript).toHaveLength(5);
    expect(room.behindTranscript.every((utterance) => utterance.kind === 'speech')).toBe(true);
    expect(room.behindTranscript.every((utterance) => utterance.text.length > 0)).toBe(true);
    // The flag survives a store round trip.
    expect(store.getRoom('room-imported-1')?.imported).toBe(true);
  });
});
