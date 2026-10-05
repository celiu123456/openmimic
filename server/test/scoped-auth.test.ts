/**
 * Tests for scoped access tokens, capability directory, and callback signing.
 *
 * Covers: scope whitelist, token lifecycle, subject binding, route scope
 * enforcement, fail-closed default, admin token backward compatibility,
 * rate limiting, capability directory, stable error codes, and webhook
 * signature verification.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@openmimic/kernel';
import { startServer, type RunningServer } from '@openmimic/server';
import {
  validateScopes,
  KNOWN_SCOPES,
  TOKEN_PREFIX,
  hashToken,
  generateToken,
  tokenPrefix,
  deriveTokenSalt,
  AUTH_ERROR_CODES,
} from '@openmimic/server';
import { signPayload, verifySignature } from '@openmimic/example-bridge';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function api(
  base: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
  };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/* ------------------------------------------------------------------ */
/* Scope validation                                                    */
/* ------------------------------------------------------------------ */

describe('scope validation', () => {
  it('accepts known scopes', () => {
    const result = validateScopes(['persona.chat', 'persona.read']);
    expect(result).toEqual(['persona.chat', 'persona.read']);
  });

  it('rejects unknown scopes', () => {
    expect(() => validateScopes(['persona.chat', 'unknown.scope']))
      .toThrow('unknown scope: unknown.scope');
  });

  it('rejects wildcard scope', () => {
    expect(() => validateScopes(['*'])).toThrow('wildcard scope is not allowed');
  });

  it('rejects empty scope', () => {
    expect(() => validateScopes([''])).toThrow('empty scope is not allowed');
  });

  it('deduplicates and sorts', () => {
    const result = validateScopes(['room.read', 'persona.chat', 'room.read']);
    expect(result).toEqual(['persona.chat', 'room.read']);
  });

  it('has all expected scopes defined', () => {
    const expected = [
      'persona.chat', 'persona.read', 'testimony.read', 'testimony.write',
      'court.run', 'room.run', 'room.read', 'export', 'admin',
    ];
    for (const scope of expected) {
      expect(KNOWN_SCOPES.has(scope)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Token format and hashing                                            */
/* ------------------------------------------------------------------ */

describe('token format', () => {
  it('generates tokens with the omk_ prefix', () => {
    const token = generateToken();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(token).toMatch(/^omk_[0-9a-f]{64}$/);
  });

  it('generates unique tokens', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateToken());
    }
    expect(tokens.size).toBe(100);
  });

  it('extracts a display prefix', () => {
    const token = 'omk_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    expect(tokenPrefix(token)).toBe('omk_abcdef12');
  });

  it('hashes tokens with salt', () => {
    const token = generateToken();
    const salt = deriveTokenSalt('test-admin-token');
    const hash1 = hashToken(token, salt);
    const hash2 = hashToken(token, salt);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);

    // Different salt produces different hash
    const salt2 = deriveTokenSalt('different-admin-token');
    const hash3 = hashToken(token, salt2);
    expect(hash3).not.toBe(hash1);
  });
});

/* ------------------------------------------------------------------ */
/* Token lifecycle (server integration)                                */
/* ------------------------------------------------------------------ */

describe('token lifecycle', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  const ADMIN = 'test-admin-secret-lifecycle';

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0, store, skipDemo: true, webDistDir: '', adminToken: ADMIN,
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('creates a token with plaintext shown once', async () => {
    const res = await api(base, 'POST', '/api/tokens', {
      name: 'test-token',
      scopes: ['persona.chat'],
    }, bearer(ADMIN));

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect((res.body.token as string).startsWith(TOKEN_PREFIX)).toBe(true);
    expect(res.body.name).toBe('test-token');
    expect(res.body.scopes).toEqual(['persona.chat']);
    expect(res.body.prefix).toBeDefined();
  });

  it('lists tokens without plaintext', async () => {
    await api(base, 'POST', '/api/tokens', {
      name: 'list-test',
      scopes: ['persona.read'],
    }, bearer(ADMIN));

    const res = await api(base, 'GET', '/api/tokens', undefined, bearer(ADMIN));
    expect(res.status).toBe(200);
    const tokens = res.body.tokens as unknown[];
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    // No plaintext in list
    for (const t of tokens as Record<string, unknown>[]) {
      expect(t.token).toBeUndefined();
      expect(t.hash).toBeUndefined();
      expect(t.prefix).toBeDefined();
    }
  });

  it('deletes a token', async () => {
    const created = await api(base, 'POST', '/api/tokens', {
      name: 'delete-me',
      scopes: ['persona.chat'],
    }, bearer(ADMIN));
    const tokenId = created.body.id as string;

    const delRes = await api(base, 'DELETE', `/api/tokens/${tokenId}`, undefined, bearer(ADMIN));
    expect(delRes.status).toBe(200);

    // Token no longer in list
    const listRes = await api(base, 'GET', '/api/tokens', undefined, bearer(ADMIN));
    const tokens = listRes.body.tokens as Record<string, unknown>[];
    expect(tokens.find((t) => t.id === tokenId)).toBeUndefined();
  });

  it('revoked token is rejected immediately', async () => {
    // Create subject first
    await api(base, 'POST', '/api/subjects', { displayName: 'RevokeTest' }, bearer(ADMIN));

    const created = await api(base, 'POST', '/api/tokens', {
      name: 'revoke-test',
      scopes: ['persona.read'],
    }, bearer(ADMIN));
    const scopedToken = created.body.token as string;

    // Token works
    const ok = await api(base, 'GET', '/api/subjects', undefined, bearer(scopedToken));
    expect(ok.status).toBe(200);

    // Delete (revoke) the token
    await api(base, 'DELETE', `/api/tokens/${created.body.id}`, undefined, bearer(ADMIN));

    // Token is rejected
    const fail = await api(base, 'GET', '/api/subjects', undefined, bearer(scopedToken));
    expect(fail.status).toBe(401);
  });

  it('expired token is rejected', async () => {
    const created = await api(base, 'POST', '/api/tokens', {
      name: 'expired',
      scopes: ['persona.read'],
      expiresAt: '2020-01-01T00:00:00.000Z', // already expired
    }, bearer(ADMIN));
    const scopedToken = created.body.token as string;

    const res = await api(base, 'GET', '/api/subjects', undefined, bearer(scopedToken));
    expect(res.status).toBe(401);
  });

  it('rejects token creation with unknown scope', async () => {
    const res = await api(base, 'POST', '/api/tokens', {
      name: 'bad-scope',
      scopes: ['persona.chat', 'invalid.scope'],
    }, bearer(ADMIN));
    expect(res.status).toBe(400);
  });

  it('rejects token creation without admin', async () => {
    const res = await api(base, 'POST', '/api/tokens', {
      name: 'unauthorized',
      scopes: ['persona.chat'],
    });
    expect(res.status).toBe(401);
  });

  it('stores only hash, never plaintext', async () => {
    const created = await api(base, 'POST', '/api/tokens', {
      name: 'hash-check',
      scopes: ['persona.chat'],
    }, bearer(ADMIN));
    const plaintext = created.body.token as string;

    // Check list does not contain plaintext
    const list = await api(base, 'GET', '/api/tokens', undefined, bearer(ADMIN));
    const tokens = list.body.tokens as Record<string, unknown>[];
    for (const t of tokens) {
      expect(JSON.stringify(t)).not.toContain(plaintext);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Scope enforcement: allow / deny matrix                              */
/* ------------------------------------------------------------------ */

describe('scope enforcement matrix', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  const ADMIN = 'test-admin-matrix';
  let subjectId: string;
  let chatToken: string;
  let readToken: string;
  let testimonyReadToken: string;
  let courtToken: string;
  let roomToken: string;
  let exportToken: string;

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0, store, skipDemo: true, webDistDir: '', adminToken: ADMIN,
    });
    base = server.url;

    // Create a subject
    const subRes = await api(base, 'POST', '/api/subjects', { displayName: 'Matrix' }, bearer(ADMIN));
    subjectId = subRes.body.id as string;

    // Create tokens with different scopes
    const mkToken = async (name: string, scopes: string[], subjectIds?: string[]) => {
      const res = await api(base, 'POST', '/api/tokens', {
        name, scopes, ...(subjectIds ? { subjectIds } : {}),
      }, bearer(ADMIN));
      return res.body.token as string;
    };

    chatToken = await mkToken('chat', ['persona.chat']);
    readToken = await mkToken('read', ['persona.read']);
    testimonyReadToken = await mkToken('testimony-read', ['testimony.read']);
    courtToken = await mkToken('court', ['court.run']);
    roomToken = await mkToken('room', ['room.run', 'room.read']);
    exportToken = await mkToken('export', ['export']);
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  // persona.chat token: can use /v1/chat/completions but NOT read testimony, run court, export
  it('chat token can access /v1/models via persona.read? No -- needs persona.read', async () => {
    const res = await api(base, 'GET', '/v1/models', undefined, bearer(chatToken));
    expect(res.status).toBe(403);
  });

  it('read token can access /v1/models', async () => {
    const res = await api(base, 'GET', '/v1/models', undefined, bearer(readToken));
    expect(res.status).toBe(200);
  });

  it('read token can list subjects', async () => {
    const res = await api(base, 'GET', '/api/subjects', undefined, bearer(readToken));
    expect(res.status).toBe(200);
  });

  it('chat token cannot list subjects', async () => {
    const res = await api(base, 'GET', '/api/subjects', undefined, bearer(chatToken));
    expect(res.status).toBe(403);
  });

  it('read token cannot read corpus (needs testimony.read)', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/corpus`, undefined, bearer(readToken));
    expect(res.status).toBe(403);
  });

  it('read token cannot read claims (needs testimony.read)', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/claims`, undefined, bearer(readToken));
    expect(res.status).toBe(403);
  });

  it('testimony.read token can read claims', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/claims`, undefined, bearer(testimonyReadToken));
    expect(res.status).toBe(200);
  });

  it('testimony.read token can read corpus', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/corpus`, undefined, bearer(testimonyReadToken));
    expect(res.status).toBe(200);
  });

  it('testimony.read token can read episodes', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/episodes`, undefined, bearer(testimonyReadToken));
    expect(res.status).toBe(200);
  });

  it('testimony.read token can read divergences', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/divergences`, undefined, bearer(testimonyReadToken));
    expect(res.status).toBe(200);
  });

  it('chat token cannot read testimony data', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/corpus`, undefined, bearer(chatToken));
    expect(res.status).toBe(403);
  });

  it('chat token cannot run court', async () => {
    const res = await api(base, 'POST', `/api/subjects/${subjectId}/court`, undefined, bearer(chatToken));
    expect(res.status).toBe(403);
  });

  it('court token can run court (will fail with 501 since no LLM, but passes auth)', async () => {
    const res = await api(base, 'POST', `/api/subjects/${subjectId}/court`, undefined, bearer(courtToken));
    // 501 = LLM not configured, which means auth passed
    expect(res.status).toBe(501);
  });

  it('chat token cannot export', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/export`, undefined, bearer(chatToken));
    expect(res.status).toBe(403);
  });

  it('export token can export', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/export`, undefined, bearer(exportToken));
    // 404 = no data yet, but auth passed
    expect([200, 404]).toContain(res.status);
  });

  it('read token cannot create subjects (needs admin)', async () => {
    const res = await api(base, 'POST', '/api/subjects', { displayName: 'Nope' }, bearer(readToken));
    expect(res.status).toBe(403);
  });

  it('room token can list rooms', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/rooms`, undefined, bearer(roomToken));
    expect(res.status).toBe(200);
  });

  it('read token cannot list rooms (needs room.read)', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/rooms`, undefined, bearer(readToken));
    expect(res.status).toBe(403);
  });

  it('chat token cannot manage tokens', async () => {
    const res = await api(base, 'GET', '/api/tokens', undefined, bearer(chatToken));
    expect(res.status).toBe(403);
  });
});

/* ------------------------------------------------------------------ */
/* Subject binding                                                     */
/* ------------------------------------------------------------------ */

describe('subject binding', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  const ADMIN = 'test-admin-subject-binding';

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0, store, skipDemo: true, webDistDir: '', adminToken: ADMIN,
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('subject-bound token can only access its bound subjects', async () => {
    const sub1 = await api(base, 'POST', '/api/subjects', { displayName: 'S1' }, bearer(ADMIN));
    const sub2 = await api(base, 'POST', '/api/subjects', { displayName: 'S2' }, bearer(ADMIN));
    const id1 = sub1.body.id as string;
    const id2 = sub2.body.id as string;

    // Token bound to sub1 only
    const created = await api(base, 'POST', '/api/tokens', {
      name: 'bound',
      scopes: ['persona.read'],
      subjectIds: [id1],
    }, bearer(ADMIN));
    const token = created.body.token as string;

    // Can access sub1
    const ok = await api(base, 'GET', `/api/subjects/${id1}/progress`, undefined, bearer(token));
    expect(ok.status).toBe(200);

    // Cannot access sub2
    const denied = await api(base, 'GET', `/api/subjects/${id2}/progress`, undefined, bearer(token));
    expect(denied.status).toBe(403);
    expect((denied.body.error as Record<string, unknown>).code).toBe(AUTH_ERROR_CODES.FORBIDDEN_SUBJECT);
  });

  it('unbound token can access any subject', async () => {
    const sub1 = await api(base, 'POST', '/api/subjects', { displayName: 'U1' }, bearer(ADMIN));
    const sub2 = await api(base, 'POST', '/api/subjects', { displayName: 'U2' }, bearer(ADMIN));

    const created = await api(base, 'POST', '/api/tokens', {
      name: 'unbound',
      scopes: ['persona.read'],
    }, bearer(ADMIN));
    const token = created.body.token as string;

    const r1 = await api(base, 'GET', `/api/subjects/${sub1.body.id}/progress`, undefined, bearer(token));
    const r2 = await api(base, 'GET', `/api/subjects/${sub2.body.id}/progress`, undefined, bearer(token));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* Fail-closed default                                                 */
/* ------------------------------------------------------------------ */

describe('fail-closed default', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  const ADMIN = 'test-admin-fail-closed';

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0, store, skipDemo: true, webDistDir: '', adminToken: ADMIN,
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('routes without scope declaration require admin', async () => {
    // Create a token with all non-admin scopes
    const created = await api(base, 'POST', '/api/tokens', {
      name: 'non-admin',
      scopes: ['persona.chat', 'persona.read', 'testimony.read', 'testimony.write',
               'court.run', 'room.run', 'room.read', 'export'],
    }, bearer(ADMIN));
    const token = created.body.token as string;

    // /api/import requires admin (scope declaration is 'admin')
    const res = await api(base, 'POST', '/api/import', { version: 1 }, bearer(token));
    expect(res.status).toBe(403);

    // But admin token works
    const adminRes = await api(base, 'POST', '/api/import', { version: 1 }, bearer(ADMIN));
    // 400 or other non-403 status means auth passed
    expect(adminRes.status).not.toBe(403);
    expect(adminRes.status).not.toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/* Admin token backward compatibility                                  */
/* ------------------------------------------------------------------ */

describe('admin token backward compatibility', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  const ADMIN = 'test-admin-compat';

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0, store, skipDemo: true, webDistDir: '', adminToken: ADMIN,
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('admin token accesses all routes', async () => {
    // Create a subject
    const sub = await api(base, 'POST', '/api/subjects', { displayName: 'Admin' }, bearer(ADMIN));
    expect(sub.status).toBe(201);

    // List subjects
    const list = await api(base, 'GET', '/api/subjects', undefined, bearer(ADMIN));
    expect(list.status).toBe(200);

    // List models (v1)
    const models = await api(base, 'GET', '/v1/models', undefined, bearer(ADMIN));
    expect(models.status).toBe(200);

    // Token management
    const tokens = await api(base, 'GET', '/api/tokens', undefined, bearer(ADMIN));
    expect(tokens.status).toBe(200);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await api(base, 'POST', '/api/subjects', { displayName: 'Nope' });
    expect(res.status).toBe(401);
  });

  it('rejects wrong admin token', async () => {
    const res = await api(base, 'POST', '/api/subjects', { displayName: 'Nope' }, bearer('wrong'));
    expect(res.status).toBe(401);
  });

  it('allows health check without token', async () => {
    const res = await api(base, 'GET', '/api/health');
    expect(res.status).toBe(200);
  });

  it('allows invite routes without admin token', async () => {
    const sub = await api(base, 'POST', '/api/subjects', { displayName: 'Inv' }, bearer(ADMIN));
    const inv = await api(base, 'POST', `/api/subjects/${sub.body.id}/invites`, undefined, bearer(ADMIN));
    const token = inv.body.token as string;

    const resolve = await api(base, 'GET', `/api/invites/${token}`);
    expect(resolve.status).toBe(200);
  });

  it('admin token in query parameter works', async () => {
    const res = await api(base, 'POST', `/api/subjects?_token=${ADMIN}`, { displayName: 'QP' });
    expect(res.status).toBe(201);
  });

  it('protects OpenAI endpoint', async () => {
    const res = await api(base, 'GET', '/v1/models');
    expect(res.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/* Per-token rate limiting                                             */
/* ------------------------------------------------------------------ */

describe('per-token rate limiting', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  const ADMIN = 'test-admin-rate-limit';

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0, store, skipDemo: true, webDistDir: '', adminToken: ADMIN,
      tokenRateLimit: { maxRequests: 5, windowMs: 60_000 },
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('rate-limits scoped tokens', async () => {
    const created = await api(base, 'POST', '/api/tokens', {
      name: 'rate-test',
      scopes: ['persona.read'],
    }, bearer(ADMIN));
    const token = created.body.token as string;

    const results: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await api(base, 'GET', '/api/subjects', undefined, bearer(token));
      results.push(res.status);
    }

    expect(results).toContain(429);
    expect(results[0]).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* Capability directory                                                */
/* ------------------------------------------------------------------ */

describe('capability directory', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  const ADMIN = 'test-admin-capabilities';

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0, store, skipDemo: true, webDistDir: '', adminToken: ADMIN,
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('returns capabilities without auth', async () => {
    const res = await api(base, 'GET', '/api/capabilities');
    expect(res.status).toBe(200);
    expect(res.body.capabilities).toBeDefined();
    expect(res.body.scopes).toBeDefined();
  });

  it('capabilities have required fields', async () => {
    const res = await api(base, 'GET', '/api/capabilities');
    const capabilities = res.body.capabilities as Record<string, unknown>[];
    expect(capabilities.length).toBeGreaterThan(0);
    for (const cap of capabilities) {
      expect(cap.id).toBeDefined();
      expect(cap.description).toBeDefined();
      expect(cap.requiredScope).toBeDefined();
      expect(cap.route).toBeDefined();
      expect(typeof cap.idempotent).toBe('boolean');
      expect(Array.isArray(cap.errorCodes)).toBe(true);
    }
  });

  it('scopes table has all defined scopes', async () => {
    const res = await api(base, 'GET', '/api/capabilities');
    const scopes = res.body.scopes as Record<string, string>;
    for (const scopeName of KNOWN_SCOPES) {
      expect(scopes[scopeName]).toBeDefined();
    }
  });

  it('does not expose data in the directory', async () => {
    // Create some subjects
    await api(base, 'POST', '/api/subjects', { displayName: 'Secret' }, bearer(ADMIN));

    const res = await api(base, 'GET', '/api/capabilities');
    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain('Secret');
  });
});

/* ------------------------------------------------------------------ */
/* Stable error codes                                                  */
/* ------------------------------------------------------------------ */

describe('stable error codes', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  const ADMIN = 'test-admin-error-codes';

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0, store, skipDemo: true, webDistDir: '', adminToken: ADMIN,
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('returns unauthorized code for missing token', async () => {
    const res = await api(base, 'GET', '/api/subjects');
    expect(res.status).toBe(401);
    expect((res.body.error as Record<string, unknown>).code).toBe('unauthorized');
  });

  it('returns forbidden_scope for insufficient scope', async () => {
    const created = await api(base, 'POST', '/api/tokens', {
      name: 'limited',
      scopes: ['persona.chat'],
    }, bearer(ADMIN));
    const token = created.body.token as string;

    const res = await api(base, 'GET', '/api/subjects', undefined, bearer(token));
    expect(res.status).toBe(403);
    expect((res.body.error as Record<string, unknown>).code).toBe('forbidden_scope');
  });

  it('returns forbidden_subject for subject binding violation', async () => {
    const sub1 = await api(base, 'POST', '/api/subjects', { displayName: 'S1' }, bearer(ADMIN));
    const sub2 = await api(base, 'POST', '/api/subjects', { displayName: 'S2' }, bearer(ADMIN));

    const created = await api(base, 'POST', '/api/tokens', {
      name: 'bound',
      scopes: ['persona.read'],
      subjectIds: [sub1.body.id as string],
    }, bearer(ADMIN));
    const token = created.body.token as string;

    const res = await api(base, 'GET', `/api/subjects/${sub2.body.id}/progress`, undefined, bearer(token));
    expect(res.status).toBe(403);
    expect((res.body.error as Record<string, unknown>).code).toBe('forbidden_subject');
  });

  it('returns rate_limited code', async () => {
    await server.close();
    store.close();

    store = new Store();
    server = await startServer({
      port: 0, store, skipDemo: true, webDistDir: '', adminToken: ADMIN,
      tokenRateLimit: { maxRequests: 1, windowMs: 60_000 },
    });
    base = server.url;

    const created = await api(base, 'POST', '/api/tokens', {
      name: 'rl',
      scopes: ['persona.read'],
    }, bearer(ADMIN));
    const token = created.body.token as string;

    await api(base, 'GET', '/api/subjects', undefined, bearer(token));
    const res = await api(base, 'GET', '/api/subjects', undefined, bearer(token));
    expect(res.status).toBe(429);
    expect((res.body.error as Record<string, unknown>).code).toBe('rate_limited');
  });
});

/* ------------------------------------------------------------------ */
/* Callback signature (example-bridge)                                 */
/* ------------------------------------------------------------------ */

describe('callback signature', () => {
  const SECRET = 'test-webhook-secret-do-not-use';

  it('signs a payload with HMAC-SHA256', () => {
    const body = JSON.stringify({ event: 'court.finished', subjectId: 'test' });
    const sig = signPayload(body, SECRET);

    expect(sig.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(sig.timestamp).toMatch(/^\d+$/);
    expect(sig.eventId).toBeDefined();
  });

  it('verifies a valid signature', () => {
    const body = JSON.stringify({ event: 'test' });
    const sig = signPayload(body, SECRET);

    const valid = verifySignature(body, sig.timestamp, sig.signature, SECRET);
    expect(valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ event: 'test' });
    const sig = signPayload(body, SECRET);

    const valid = verifySignature('tampered', sig.timestamp, sig.signature, SECRET);
    expect(valid).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const body = JSON.stringify({ event: 'test' });
    const sig = signPayload(body, SECRET);

    const valid = verifySignature(body, sig.timestamp, sig.signature, 'wrong-secret');
    expect(valid).toBe(false);
  });

  it('rejects an expired timestamp', () => {
    const body = JSON.stringify({ event: 'test' });
    const oldTimestamp = Math.floor(Date.now() / 1000 - 600).toString(); // 10 min old
    const sig = signPayload(body, SECRET);

    const valid = verifySignature(body, oldTimestamp, sig.signature, SECRET, 300);
    expect(valid).toBe(false);
  });

  it('generates unique event IDs', () => {
    const body = JSON.stringify({ event: 'test' });
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(signPayload(body, SECRET).eventId);
    }
    expect(ids.size).toBe(100);
  });
});

/* ------------------------------------------------------------------ */
/* Embedding protection                                                */
/* ------------------------------------------------------------------ */

describe('embedding protection', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  const ADMIN = 'test-admin-embed';

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0, store, skipDemo: false, webDistDir: '', adminToken: ADMIN,
    });
    base = server.url;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('chat token can only access /v1/chat/completions, not /v1/models', async () => {
    const created = await api(base, 'POST', '/api/tokens', {
      name: 'chat-only',
      scopes: ['persona.chat'],
    }, bearer(ADMIN));
    const token = created.body.token as string;

    // Cannot list models (needs persona.read)
    const models = await api(base, 'GET', '/v1/models', undefined, bearer(token));
    expect(models.status).toBe(403);
  });

  it('/v1/models does not expose system prompt text', async () => {
    const res = await api(base, 'GET', '/v1/models', undefined, bearer(ADMIN));
    expect(res.status).toBe(200);
    const data = (res.body as Record<string, unknown>).data as unknown[];
    if (data && data.length > 0) {
      const model = data[0] as Record<string, unknown>;
      // Should not contain systemPrompt or any prompt text
      expect(model.systemPrompt).toBeUndefined();
      expect(model.system_prompt).toBeUndefined();
    }
  });

  it('subject-bound chat token only sees bound personas in /v1/models (with persona.read)', async () => {
    const subjects = await api(base, 'GET', '/api/subjects', undefined, bearer(ADMIN));
    const allSubjects = subjects.body.subjects as Record<string, unknown>[];
    if (allSubjects.length === 0) return; // skip if no demo data

    const firstId = allSubjects[0]!.id as string;

    const created = await api(base, 'POST', '/api/tokens', {
      name: 'bound-read',
      scopes: ['persona.read'],
      subjectIds: [firstId],
    }, bearer(ADMIN));
    const token = created.body.token as string;

    const models = await api(base, 'GET', '/v1/models', undefined, bearer(token));
    expect(models.status).toBe(200);
    const data = (models.body as Record<string, unknown>).data as Record<string, unknown>[];
    for (const model of data) {
      expect((model.id as string).endsWith(firstId)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Route scan: every route must have an explicit scope declaration      */
/* ------------------------------------------------------------------ */

describe('route scope coverage', () => {
  let store: Store;
  let server: RunningServer;

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0, store, skipDemo: true, webDistDir: '', adminToken: 'test-admin-scan',
    });
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('every route has an explicit scope or open declaration (zero undeclared)', () => {
    const router = server._router;
    expect(router).toBeDefined();
    const routes = router!.listRoutes();
    expect(routes.length).toBeGreaterThan(0);

    const undeclared = routes.filter((r) => !r.open && r.scope === undefined);
    if (undeclared.length > 0) {
      const list = undeclared.map((r) => `${r.method} ${r.pattern}`).join('\n  ');
      throw new Error(
        `${undeclared.length} route(s) have no explicit scope declaration (relying on admin fallback):\n  ${list}\n` +
        'Add { scope: "..." } or { open: true } to each route registration.',
      );
    }
    expect(undeclared.length).toBe(0);
  });

  it('claims and court session routes require testimony.read', () => {
    const router = server._router!;
    const routes = router.listRoutes();
    const claimsRoute = routes.find((r) => r.pattern === '/api/subjects/:id/claims');
    expect(claimsRoute?.scope).toBe('testimony.read');

    const courtRoute = routes.find((r) => r.pattern === '/api/court/:sessionId');
    expect(courtRoute?.scope).toBe('testimony.read');
  });

  it('ASR routes are open (friends need voice input)', () => {
    const router = server._router!;
    const routes = router.listRoutes();
    const asrAvail = routes.find((r) => r.pattern === '/api/asr/available');
    expect(asrAvail?.open).toBe(true);

    const asrPost = routes.find((r) => r.pattern === '/api/asr' && r.method === 'POST');
    expect(asrPost?.open).toBe(true);
  });

  it('short code route is open', () => {
    const router = server._router!;
    const routes = router.listRoutes();
    const shortCode = routes.find((r) => r.pattern === '/api/i/:code');
    expect(shortCode?.open).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Three-identity status code matrix                                   */
/* ------------------------------------------------------------------ */

describe('three-identity status code matrix', () => {
  let store: Store;
  let server: RunningServer;
  let base: string;
  const ADMIN = 'test-admin-three-identity';
  let subjectId: string;
  let chatToken: string;
  let inviteToken: string;

  beforeEach(async () => {
    store = new Store();
    server = await startServer({
      port: 0, store, skipDemo: true, webDistDir: '', adminToken: ADMIN,
    });
    base = server.url;

    // Create a subject
    const sub = await api(base, 'POST', '/api/subjects', { displayName: 'ThreeID' }, bearer(ADMIN));
    subjectId = sub.body.id as string;

    // Create invite
    const inv = await api(base, 'POST', `/api/subjects/${subjectId}/invites`, undefined, bearer(ADMIN));
    inviteToken = inv.body.token as string;

    // Create chat-only scoped token
    const tok = await api(base, 'POST', '/api/tokens', {
      name: 'chat-only',
      scopes: ['persona.chat'],
    }, bearer(ADMIN));
    chatToken = tok.body.token as string;
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  /* --- Friend path (no token) --- */

  it('friend: invite resolve works without token', async () => {
    const res = await api(base, 'GET', `/api/invites/${inviteToken}`);
    expect(res.status).toBe(200);
  });

  it('friend: short code route is open', async () => {
    const inv = await api(base, 'POST', `/api/subjects/${subjectId}/invites`, undefined, bearer(ADMIN));
    const shortCode = inv.body.shortCode as string | undefined;
    if (shortCode) {
      const res = await api(base, 'GET', `/api/i/${shortCode}`);
      expect(res.status).toBe(200);
    }
  });

  it('friend: interview start works without token', async () => {
    const res = await api(base, 'POST', `/api/invites/${inviteToken}/interview`);
    expect(res.status).toBe(201);
  });

  it('friend: ASR availability check is open', async () => {
    const res = await api(base, 'GET', '/api/asr/available');
    expect(res.status).toBe(200);
  });

  it('friend: cannot list subjects', async () => {
    const res = await api(base, 'GET', '/api/subjects');
    expect(res.status).toBe(401);
  });

  /* --- Chat-only token --- */

  it('chat token: cannot list subjects (needs persona.read)', async () => {
    const res = await api(base, 'GET', '/api/subjects', undefined, bearer(chatToken));
    expect(res.status).toBe(403);
  });

  it('chat token: cannot read claims (needs testimony.read)', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/claims`, undefined, bearer(chatToken));
    expect(res.status).toBe(403);
  });

  it('chat token: cannot create subjects (needs admin)', async () => {
    const res = await api(base, 'POST', '/api/subjects', { displayName: 'No' }, bearer(chatToken));
    expect(res.status).toBe(403);
  });

  it('chat token: cannot manage tokens (needs admin)', async () => {
    const res = await api(base, 'GET', '/api/tokens', undefined, bearer(chatToken));
    expect(res.status).toBe(403);
  });

  /* --- Admin token --- */

  it('admin: can list subjects', async () => {
    const res = await api(base, 'GET', '/api/subjects', undefined, bearer(ADMIN));
    expect(res.status).toBe(200);
  });

  it('admin: can create subjects', async () => {
    const res = await api(base, 'POST', '/api/subjects', { displayName: 'New' }, bearer(ADMIN));
    expect(res.status).toBe(201);
  });

  it('admin: can manage tokens', async () => {
    const res = await api(base, 'GET', '/api/tokens', undefined, bearer(ADMIN));
    expect(res.status).toBe(200);
  });

  it('admin: can read claims', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/claims`, undefined, bearer(ADMIN));
    expect(res.status).toBe(200);
  });

  it('admin: can read coverage', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/coverage`, undefined, bearer(ADMIN));
    expect(res.status).toBe(200);
  });

  /* --- New pages: chatlog, meta-perception, character card --- */

  it('no token: chatlog imports list blocked', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/chatlog/imports`);
    expect(res.status).toBe(401);
  });

  // Plugin routes: when plugin is loaded, scope enforcement applies.
  // When plugin is not loaded (skipDemo), 404 is returned before scope check.
  // Both 403 and 404 mean the chat token cannot access the resource.

  it('chat token: chatlog imports list blocked (needs admin or not loaded)', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/chatlog/imports`, undefined, bearer(chatToken));
    expect([403, 404]).toContain(res.status);
  });

  it('admin: chatlog imports list allowed or not loaded', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/chatlog/imports`, undefined, bearer(ADMIN));
    // 200 or 404 (plugin may not be loaded), but not 401/403
    expect([200, 404]).toContain(res.status);
  });

  it('no token: meta-perception blocked or not loaded', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/meta-perception/questions`);
    expect([401, 404]).toContain(res.status);
  });

  it('chat token: meta-perception blocked (needs admin or not loaded)', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/meta-perception/questions`, undefined, bearer(chatToken));
    expect([403, 404]).toContain(res.status);
  });

  it('no token: character card export blocked or not loaded', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/export/character-card`);
    expect([401, 404]).toContain(res.status);
  });

  it('chat token: character card export blocked (needs export or not loaded)', async () => {
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/export/character-card`, undefined, bearer(chatToken));
    expect([403, 404]).toContain(res.status);
  });

  it('testimony.read token: can read claims', async () => {
    const tok = await api(base, 'POST', '/api/tokens', {
      name: 'testimony-reader',
      scopes: ['testimony.read'],
    }, bearer(ADMIN));
    const tToken = tok.body.token as string;
    const res = await api(base, 'GET', `/api/subjects/${subjectId}/claims`, undefined, bearer(tToken));
    expect(res.status).toBe(200);
  });
});
