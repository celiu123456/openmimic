/**
 * Minimal ambient types for `better-sqlite3`.
 *
 * The package ships no TypeScript declarations and `@types/better-sqlite3` is
 * outside the W1 dependency whitelist, so we declare only the surface the
 * kernel actually uses. Kept intentionally small: the ledger's guarantees are
 * enforced by SQLite triggers, not by these types.
 */
declare module 'better-sqlite3' {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface Statement<BindParameters extends unknown[] = unknown[], Row = unknown> {
    run(...params: BindParameters): RunResult;
    get(...params: BindParameters): Row | undefined;
    all(...params: BindParameters): Row[];
    iterate(...params: BindParameters): IterableIterator<Row>;
  }

  export interface DatabaseOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
  }

  export interface Database {
    prepare<BindParameters extends unknown[] = unknown[], Row = unknown>(
      source: string,
    ): Statement<BindParameters, Row>;
    exec(source: string): this;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    close(): this;
    readonly open: boolean;
  }

  interface DatabaseConstructor {
    new (filename: string, options?: DatabaseOptions): Database;
    (filename: string, options?: DatabaseOptions): Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}
