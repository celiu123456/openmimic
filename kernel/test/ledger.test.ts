import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Testimony } from '@openmimic/shared';
import { Store } from '@openmimic/kernel';

/**
 * Compile-time proof that the Store API exposes no testimony mutation method.
 *
 * If any of these names ever appears on `keyof Store`, `Extract<...>` stops
 * being `never` and the `AssertNever` constraint fails the typecheck.
 */
type ForbiddenTestimonyMutator =
  | 'updateTestimony'
  | 'deleteTestimony'
  | 'removeTestimony'
  | 'editTestimony'
  | 'deleteTestimonies'
  | 'clearTestimonies';
type AssertNever<T extends never> = T;
export type _NoTestimonyMutators = AssertNever<Extract<keyof Store, ForbiddenTestimonyMutator>>;

describe('append-only testimony ledger', () => {
  let directory: string;
  let databasePath: string;
  let store: Store;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'openmimic-ledger-'));
    databasePath = join(directory, 'ledger.sqlite');
    store = new Store({ path: databasePath });
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('appends, reads back and lists testimony by subject', () => {
    const testimony = store.addTestimony({
      id: 't1',
      witnessId: 'w1',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: 'She is generous.' }],
    });

    expect(testimony.createdAt).toBeTruthy();
    expect(store.getTestimony('t1')).toEqual(testimony);
    expect(store.listBySubject('s1')).toHaveLength(1);
    expect(store.listBySubject('s2')).toEqual([]);
  });

  it('registers both append-only guards as SQLite triggers', () => {
    const raw = new Database(databasePath);
    try {
      const triggers = raw
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'testimonies' ORDER BY name",
        )
        .all()
        .map((row) => row.name);
      expect(triggers).toEqual([
        'testimonies_append_only_delete',
        'testimonies_append_only_update',
      ]);
    } finally {
      raw.close();
    }
  });

  it('rejects raw SQL UPDATE on testimonies', () => {
    store.addTestimony({
      id: 't1',
      witnessId: 'w1',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: 'original words' }],
    });

    const raw = new Database(databasePath);
    try {
      expect(() =>
        raw
          .prepare<[string, string]>('UPDATE testimonies SET witness_id = ? WHERE id = ?')
          .run('w2', 't1'),
      ).toThrow(/append-only/i);
    } finally {
      raw.close();
    }

    expect(store.getTestimony('t1')?.witnessId).toBe('w1');
  });

  it('rejects raw SQL DELETE on testimonies', () => {
    store.addTestimony({
      id: 't1',
      witnessId: 'w1',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: 'original words' }],
    });

    const raw = new Database(databasePath);
    try {
      expect(() =>
        raw.prepare<[string]>('DELETE FROM testimonies WHERE id = ?').run('t1'),
      ).toThrow(/append-only/i);
    } finally {
      raw.close();
    }

    expect(store.listBySubject('s1')).toHaveLength(1);
  });

  it('exposes no update/delete/remove mutator on the Store surface', () => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(store) as object);
    const mutators = methods.filter((name) => /^(update|delete|remove|edit)/i.test(name));
    expect(mutators).toEqual([]);
  });

  it('emits testimony.added for every appended entry', () => {
    const seen: Testimony[] = [];
    const unsubscribe = store.events.on('testimony.added', (testimony) => seen.push(testimony));

    const testimony = store.addTestimony({
      id: 't1',
      witnessId: 'w1',
      subjectId: 's1',
      answers: [{ qid: 'q1', behindText: 'She is generous.' }],
    });

    expect(seen).toEqual([testimony]);
    expect(store.events.listenerCount('testimony.added')).toBe(1);

    unsubscribe();
    expect(store.events.listenerCount('testimony.added')).toBe(0);
  });
});
