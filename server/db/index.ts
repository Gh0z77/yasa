import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import { getConfig } from '../env';
import { logger } from '../lib/logger';
import { ddlToPg, toPg } from './dialect';
import { MIGRATIONS } from './migrations';
import { openBridge, type Bridge } from './pg-bridge';

export type Param = SQLInputValue;

/**
 * What the rest of the server needs from a database. Two engines implement it: SQLite in a local file (the
 * default: development, tests, a single server with a disk) and Postgres (set DATABASE_URL: hosted deployments
 * without a disk, such as Vercel). The SQL is written for SQLite and translated for Postgres (see dialect.ts).
 */
interface Engine {
  run(sql: string, params: Param[]): { changes: number };
  get(sql: string, params: Param[]): unknown;
  all(sql: string, params: Param[]): unknown[];
  /** Statements without parameters: transaction control. */
  exec(sql: string): void;
  /** How a top-level transaction starts. */
  begin: string;
  close(): void;
}

// ------------------------------------------------------------------------------------------------ SQLite

function migrateSqlite(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const current = row?.user_version ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
      logger.info(`Applied database migration ${i + 1}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function openSqlite(dbPath: string): Engine {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA busy_timeout = 5000');
    // 64 MB page cache and memory-mapped reads: most requests are small lookups on a few hot tables.
    db.exec('PRAGMA cache_size = -65536');
    db.exec('PRAGMA mmap_size = 268435456');
    db.exec('PRAGMA temp_store = MEMORY');
  }
  migrateSqlite(db);

  // Compiled statements by SQL text: the same few dozen queries serve almost every request.
  const statements = new Map<string, StatementSync>();
  const STATEMENT_CACHE_MAX = 400;
  const statement = (sql: string): StatementSync => {
    let prepared = statements.get(sql);
    if (!prepared) {
      prepared = db.prepare(sql);
      // Dynamically built SQL (search, sort) could grow without bound: start over when the cache is full.
      if (statements.size >= STATEMENT_CACHE_MAX) statements.clear();
      statements.set(sql, prepared);
    }
    return prepared;
  };

  return {
    run: (sql, params) => ({ changes: Number(statement(sql).run(...params).changes) }),
    get: (sql, params) => statement(sql).get(...params),
    all: (sql, params) => statement(sql).all(...params),
    exec: (sql) => db.exec(sql),
    begin: 'BEGIN IMMEDIATE',
    close: () => {
      statements.clear();
      try {
        db.close();
      } catch {
        // already closed
      }
    },
  };
}

// ------------------------------------------------------------------------------------------------ Postgres

/** The application's tables live in their own schema, apart from whatever else the database holds. */
const PG_SCHEMA = 'yasa';

function migratePostgres(bridge: Bridge): void {
  bridge.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)', [], false);
  const row = bridge.query('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations', [], false).rows[0];
  const current = Number(row?.version ?? 0);
  for (let i = current; i < MIGRATIONS.length; i++) {
    bridge.query('BEGIN', [], false);
    try {
      bridge.query(ddlToPg(MIGRATIONS[i]!), [], true);
      bridge.query(`INSERT INTO schema_migrations (version) VALUES (${i + 1})`, [], true);
      bridge.query('COMMIT', [], true);
      logger.info(`Applied database migration ${i + 1}`);
    } catch (err) {
      try {
        bridge.query('ROLLBACK', [], true);
      } catch {
        // the connection is gone; nothing to roll back
      }
      throw err;
    }
  }
}

function postgresEngine(bridge: Bridge): Engine {
  migratePostgres(bridge);
  return {
    run: (sql, params) => ({ changes: bridge.query(toPg(sql), params, txDepth > 0).changes }),
    get: (sql, params) => bridge.query(toPg(sql), params, txDepth > 0).rows[0],
    all: (sql, params) => bridge.query(toPg(sql), params, txDepth > 0).rows,
    exec: (sql) => void bridge.query(sql, [], true),
    begin: 'BEGIN',
    close: () => bridge.close(),
  };
}

// ------------------------------------------------------------------------------------------------ the instance

let engine: Engine | null = null;
let txDepth = 0;
/** The embedded Postgres used to run the test suite against the Postgres code path (YASA_TEST_DB=pglite). */
let testBridge: Bridge | null = null;

const usePgliteInTests = (): boolean => process.env.YASA_TEST_DB === 'pglite';

function open(): Engine {
  const config = getConfig();
  if (config.isTest && usePgliteInTests()) {
    testBridge ??= openBridge({ kind: 'pglite', schema: PG_SCHEMA });
    return postgresEngine(testBridge);
  }
  if (config.databaseUrl) return postgresEngine(openBridge({ kind: 'pg', url: config.databaseUrl, schema: PG_SCHEMA }));
  return openSqlite(config.dbPath);
}

/** Opens the database (and applies pending migrations) if that has not happened yet. */
export function getDb(): void {
  engine ??= open();
}

function db(): Engine {
  engine ??= open();
  return engine;
}

export function closeDb(): void {
  if (!engine) return;
  // The embedded test database is one thread for the whole run: only its contents are reset.
  if (!testBridge) engine.close();
  engine = null;
  txDepth = 0;
}

/** Test helper: a fresh, empty database. */
export function resetDbForTests(): void {
  closeDb();
  if (usePgliteInTests()) {
    testBridge ??= openBridge({ kind: 'pglite', schema: PG_SCHEMA });
    testBridge.query(`DROP SCHEMA IF EXISTS "${PG_SCHEMA}" CASCADE; CREATE SCHEMA "${PG_SCHEMA}";`, [], false);
    engine = postgresEngine(testBridge);
    return;
  }
  engine = openSqlite(':memory:');
}

/** Statements sent since start-up: a cheap way to see how chatty a code path is (tests, diagnostics). */
export const queryStats = { count: 0, log: null as string[] | null };

export function run(sql: string, ...params: Param[]): { changes: number } {
  queryStats.count++;
  queryStats.log?.push(sql);
  return db().run(sql, params);
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  queryStats.count++;
  queryStats.log?.push(sql);
  return db().get(sql, params) as T | undefined;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  queryStats.count++;
  queryStats.log?.push(sql);
  return db().all(sql, params) as T[];
}

/** Runs fn in a transaction (nested calls join the outer one via savepoints). */
export function tx<T>(fn: () => T): T {
  const current = db();
  const name = `sp_${txDepth}`;
  current.exec(txDepth === 0 ? current.begin : `SAVEPOINT ${name}`);
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    current.exec(txDepth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return result;
  } catch (err) {
    txDepth--;
    try {
      current.exec(txDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    } catch {
      // ignore rollback failures
    }
    throw err;
  }
}
