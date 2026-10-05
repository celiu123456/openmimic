/**
 * Token store: manages scoped API tokens in the kernel's SQLite database.
 *
 * Tokens are stored as salted SHA-256 hashes. The plaintext is returned
 * exactly once at creation time and never persisted.
 *
 * The store adds its table via the kernel Store's registerPluginTable API,
 * but since auth is a core server concern (not a third-party plugin), we
 * use a direct `api_tokens` table managed here.
 */
import { randomUUID } from 'node:crypto';
import type { Store } from '@openmimic/kernel';
import {
  generateToken,
  tokenPrefix,
  hashToken,
  validateScopes,
  generateInstanceSalt,
  type TokenRecord,
  type TokenCreateResult,
  type TokenListItem,
} from './scopes';

/* ------------------------------------------------------------------ */
/* SQL schema                                                          */
/* ------------------------------------------------------------------ */

const TOKEN_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS api_tokens (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  prefix      TEXT NOT NULL,
  hash        TEXT NOT NULL,
  scopes      TEXT NOT NULL,
  subject_ids TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  expires_at  TEXT,
  last_used_at TEXT,
  use_count   INTEGER NOT NULL DEFAULT 0,
  revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens (hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens (prefix);
`;

/**
 * Stores instance-level settings (currently just the token salt).
 *
 * The salt is generated once and persisted so that:
 * 1. Changing the admin password does not invalidate existing tokens.
 * 2. The salt survives process restarts (tokens remain valid).
 */
const SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS api_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Stable error code returned when a token was hashed with a different salt. */
export const SALT_MIGRATED_ERROR = 'token_salt_migrated' as const;

/* ------------------------------------------------------------------ */
/* Row ↔ record mapping                                                */
/* ------------------------------------------------------------------ */

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: string;
  subject_ids: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  use_count: number;
  revoked: number;
}

function rowToRecord(row: TokenRow): TokenRecord {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    hash: row.hash,
    scopes: JSON.parse(row.scopes) as string[],
    subjectIds: JSON.parse(row.subject_ids) as string[],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
    revoked: row.revoked === 1,
  };
}

function recordToListItem(record: TokenRecord): TokenListItem {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    scopes: record.scopes,
    subjectIds: record.subjectIds,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    useCount: record.useCount,
    revoked: record.revoked,
  };
}

/* ------------------------------------------------------------------ */
/* TokenStore                                                          */
/* ------------------------------------------------------------------ */

export class TokenStore {
  private readonly salt: string;
  private readonly db: ReturnType<typeof getDb>;

  /**
   * Create a TokenStore.
   *
   * The salt is loaded from the database on construction. If no salt exists
   * yet (fresh instance), one is generated and persisted. The `legacySalt`
   * parameter (if provided) is only used as a fallback explanation in error
   * messages -- it is never used for hashing. Tokens created under the old
   * admin-derived salt will fail to resolve with error code
   * `token_salt_migrated`.
   */
  constructor(
    private readonly store: Store,
    _legacySalt?: string,
  ) {
    this.db = getDb(store);
    this.ensureTable();
    this.salt = this.loadOrCreateSalt();
  }

  /** The instance-level salt (exposed for testing only). */
  get instanceSalt(): string {
    return this.salt;
  }

  private ensureTable(): void {
    // Use the raw DB handle from the store to create our table.
    // The store exposes execRaw for server-level schema additions.
    this.db.exec(TOKEN_TABLE_SQL);
    this.db.exec(SETTINGS_TABLE_SQL);
  }

  /**
   * Load the persisted salt, or generate and store a new one.
   *
   * The salt is stored in the `api_settings` table under the key
   * `token_salt`. Once written, it never changes -- even if the admin
   * password is rotated.
   */
  private loadOrCreateSalt(): string {
    const row = this.db
      .prepare('SELECT value FROM api_settings WHERE key = ?')
      .get('token_salt') as { value: string } | undefined;

    if (row) return row.value;

    const salt = generateInstanceSalt();
    this.db
      .prepare('INSERT INTO api_settings (key, value) VALUES (?, ?)')
      .run('token_salt', salt);
    return salt;
  }

  /**
   * Create a new scoped token.
   *
   * Returns the token record including the plaintext token. The plaintext
   * is never stored or returned again.
   */
  create(input: {
    name: string;
    scopes: string[];
    subjectIds?: string[];
    expiresAt?: string | null;
  }): TokenCreateResult {
    const validatedScopes = validateScopes(input.scopes);
    const plaintext = generateToken();
    const id = randomUUID();
    const prefix = tokenPrefix(plaintext);
    const hash = hashToken(plaintext, this.salt);
    const now = new Date().toISOString();
    const subjectIds = input.subjectIds ?? [];

    this.db.prepare(`
      INSERT INTO api_tokens (id, name, prefix, hash, scopes, subject_ids, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      prefix,
      hash,
      JSON.stringify(validatedScopes),
      JSON.stringify(subjectIds),
      now,
      input.expiresAt ?? null,
    );

    return {
      id,
      name: input.name,
      prefix,
      scopes: validatedScopes,
      subjectIds,
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
      token: plaintext,
    };
  }

  /** List all tokens (no plaintext, no hash). */
  list(): TokenListItem[] {
    const rows = this.db
      .prepare('SELECT * FROM api_tokens ORDER BY created_at DESC')
      .all() as TokenRow[];
    return rows.map((row) => recordToListItem(rowToRecord(row)));
  }

  /** Get a token record by ID (no plaintext). */
  getById(id: string): TokenRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM api_tokens WHERE id = ?')
      .get(id) as TokenRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  /** Revoke a token by ID. Immediately effective. */
  revoke(id: string): boolean {
    const result = this.db
      .prepare('UPDATE api_tokens SET revoked = 1 WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  /** Delete a token record entirely. */
  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM api_tokens WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  /**
   * Resolve a plaintext token to its record.
   *
   * Returns undefined if the token is not found, is revoked, or is expired.
   * On success, updates the last-used timestamp and use count.
   */
  resolve(plaintext: string): TokenRecord | undefined {
    const hash = hashToken(plaintext, this.salt);
    const row = this.db
      .prepare('SELECT * FROM api_tokens WHERE hash = ?')
      .get(hash) as TokenRow | undefined;

    if (!row) return undefined;

    const record = rowToRecord(row);

    // Check revocation
    if (record.revoked) return undefined;

    // Check expiry
    if (record.expiresAt) {
      const now = new Date();
      const expiry = new Date(record.expiresAt);
      if (now >= expiry) return undefined;
    }

    // Update usage tracking
    this.db
      .prepare('UPDATE api_tokens SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?')
      .run(new Date().toISOString(), record.id);

    return record;
  }
}

/* ------------------------------------------------------------------ */
/* DB access helper                                                    */
/* ------------------------------------------------------------------ */

/**
 * Get the raw database handle from a Store instance.
 *
 * The Store class does not expose its DB handle publicly, but the server
 * (which owns the Store) needs to add the api_tokens table. We use the
 * same pattern as the plugin table registration: access the internal DB.
 */
function getDb(store: Store): any {
  // Access the private db field. This is an intentional coupling between
  // the server auth layer and the kernel store — the server IS the layer
  // that owns both.
  return (store as any).db;
}
