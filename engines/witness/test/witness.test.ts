import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginHost, Store } from '@openmimic/kernel';
import {
  DEFAULT_INVITE_TTL_MS,
  FRIEND_V1,
  InviteInvalidError,
  WITNESS_COLLECTOR_MANIFEST,
  createInvite,
  registerWitnessCollector,
  resolveInvite,
  submitTestimony,
  type WitnessCollector,
  type WitnessCollectorContext,
} from '@openmimic/engine-witness';

describe('friend questionnaire v1', () => {
  it('ships ten questions, each demanding one concrete incident', () => {
    expect(FRIEND_V1.id).toBe('friend-v1');
    expect(FRIEND_V1.questions).toHaveLength(10);
    expect(FRIEND_V1.frontPrompt).toContain('当他面说');

    const qids = FRIEND_V1.questions.map((question) => question.qid);
    expect(new Set(qids).size).toBe(10);
    for (const question of FRIEND_V1.questions) {
      expect(question.prompt).toContain('请举一个具体的事');
      expect(question.prompt.length).toBeGreaterThan(10);
      expect(question.followupHint.length).toBeGreaterThan(0);
    }
  });
});

describe('reusable invites', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('issues a 22-character URL-safe token that expires in 14 days', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const invite = createInvite(store, 's1', { now });

    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(invite.expiresAt).toBe(
      new Date(now.getTime() + DEFAULT_INVITE_TTL_MS).toISOString(),
    );
    expect(store.getInvite(invite.token)?.subjectId).toBe('s1');
  });

  it('resolves the same token again and again (one link, many friends)', () => {
    const { token } = createInvite(store, 's1');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const resolved = resolveInvite(store, token);
      expect(resolved.subjectId).toBe('s1');
      expect(resolved.questionnaire.id).toBe('friend-v1');
    }
  });

  it('rejects unknown and expired tokens with InviteInvalidError', () => {
    expect(() => resolveInvite(store, 'does-not-exist')).toThrow(InviteInvalidError);

    const { token } = createInvite(store, 's1', { ttlMs: -1000 });
    expect(() => resolveInvite(store, token)).toThrow(InviteInvalidError);
  });
});

describe('testimony intake', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  afterEach(() => {
    store.close();
  });

  it('appends one witness and one testimony through the kernel ledger', () => {
    const { token } = createInvite(store, 's1');

    const result = submitTestimony(store, token, {
      relation: '大学同学',
      stance: '偏正面',
      consentLevel: 'quotable',
      answers: [{ qid: 'q1', behindText: '上次吃饭她悄悄把单买了。' }],
      freeText: '她不太爱说自己的好。',
    });

    expect(result.count).toBe(1);
    const witness = store.getWitness(result.witnessId);
    expect(witness?.relation).toBe('大学同学');
    expect(witness?.consentLevel).toBe('quotable');
    expect(witness?.subjectId).toBe('s1');

    const testimonies = store.listBySubject('s1');
    expect(testimonies).toHaveLength(1);
    expect(testimonies[0]?.id).toBe(result.testimonyId);
    expect(testimonies[0]?.witnessId).toBe(result.witnessId);
    expect(testimonies[0]?.answers[0]?.behindText).toBe('上次吃饭她悄悄把单买了。');
  });

  it('lets two friends share one token and reports a growing count', () => {
    const { token } = createInvite(store, 's1');

    const first = submitTestimony(store, token, {
      relation: '同事',
      consentLevel: 'quotable',
      answers: [{ qid: 'q1', behindText: 'first' }],
    });
    const second = submitTestimony(store, token, {
      relation: '发小',
      consentLevel: 'synthesis_only',
      answers: [{ qid: 'q1', behindText: 'second' }],
    });

    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(first.witnessId).not.toBe(second.witnessId);
    expect(store.listBySubject('s1')).toHaveLength(2);
    expect(store.listWitnessesBySubject('s1')).toHaveLength(2);
  });

  it('writes nothing when the body is invalid', () => {
    const { token } = createInvite(store, 's1');

    expect(() =>
      submitTestimony(store, token, {
        relation: '同事',
        consentLevel: 'quotable',
        answers: [{ qid: 'q1' } as never],
      }),
    ).toThrow();

    expect(() =>
      submitTestimony(store, token, {
        relation: '同事',
        consentLevel: 'public' as never,
        answers: [{ qid: 'q1', behindText: 'words' }],
      }),
    ).toThrow();

    expect(store.listBySubject('s1')).toEqual([]);
    expect(store.listWitnessesBySubject('s1')).toEqual([]);
  });

  it('refuses an expired token before writing anything', () => {
    const { token } = createInvite(store, 's1', { ttlMs: -1 });

    expect(() =>
      submitTestimony(store, token, {
        relation: '同事',
        consentLevel: 'quotable',
        answers: [{ qid: 'q1', behindText: 'words' }],
      }),
    ).toThrow(InviteInvalidError);
    expect(store.listBySubject('s1')).toEqual([]);
  });
});

describe('WitnessEngine plugin assembly', () => {
  it('registers as a collector through the shared plugin path', async () => {
    const store = new Store();
    try {
      const context: WitnessCollectorContext = { store, collectors: {} };
      const host = new PluginHost<WitnessCollectorContext>(context);
      await registerWitnessCollector(host);

      expect(host.has(WITNESS_COLLECTOR_MANIFEST.name)).toBe(true);
      expect(host.get('witness')?.kind).toBe('collector');

      const collector = context.collectors.witness as WitnessCollector;
      const invite = collector.createInvite('s1');
      expect(collector.resolveInvite(invite.token).subjectId).toBe('s1');
      expect(collector.questionnaire.questions).toHaveLength(10);
    } finally {
      store.close();
    }
  });
});
