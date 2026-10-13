import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { getConfig } from '../env';
import { logger } from '../lib/logger';
import { MIGRATIONS } from './migrations';

let instance: DatabaseSync | null = null;
let txDepth = 0;

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const current = row?.user_version ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
      logger.info(`Applied database migration ${i + 1}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function openDb(dbPath: string = getConfig().dbPath): DatabaseSync {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
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
  migrate(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!instance) instance = openDb();
  return instance;
}

export function closeDb(): void {
  statements.clear();
  if (instance) {
    try {
      instance.close();
    } catch {
      // already closed
    }
    instance = null;
    txDepth = 0;
    statements.clear();
  }
}

/** Test helper: fresh in-memory database. */
export function resetDbForTests(): DatabaseSync {
  closeDb();
  instance = openDb(':memory:');
  return instance;
}

export type Param = SQLInputValue;

/** Compiled statements by SQL text: the same few dozen queries serve almost every request. */
const statements = new Map<string, StatementSync>();
const STATEMENT_CACHE_MAX = 400;

function statement(sql: string): StatementSync {
  let prepared = statements.get(sql);
  if (!prepared) {
    prepared = getDb().prepare(sql);
    // Dynamically built SQL (search, sort) could grow without bound: start over when the cache is full.
    if (statements.size >= STATEMENT_CACHE_MAX) statements.clear();
    statements.set(sql, prepared);
  }
  return prepared;
}

export function run(sql: string, ...params: Param[]): { changes: number } {
  const result = statement(sql).run(...params);
  return { changes: Number(result.changes) };
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return statement(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return statement(sql).all(...params) as T[];
}

/** Runs fn in a transaction (nested calls join the outer one via savepoints). */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  const name = `sp_${txDepth}`;
  db.exec(txDepth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    db.exec(txDepth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return result;
  } catch (err) {
    txDepth--;
    try {
      db.exec(txDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    } catch {
      // ignore rollback failures
    }
    throw err;
  }
}
