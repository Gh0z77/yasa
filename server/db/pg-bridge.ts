// Synchronous access to Postgres.
//
// The whole server is written against a synchronous database API (SQLite answers in microseconds, so nothing
// ever awaited a query). A hosted deployment has no disk for SQLite and uses Postgres instead. Rather than turn
// every service and the streaming agent asynchronous, the queries run in a worker thread and the calling thread
// sleeps on a shared flag until the answer is posted back: one round trip per statement, a few milliseconds when
// the database is in the same region as the server.
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import { PG_WORKER_SOURCE } from './pg-worker';

export interface BridgeOptions {
  kind: 'pg' | 'pglite';
  /** Connection string (kind "pg"). */
  url?: string;
  /** Directory of the embedded database (kind "pglite"); omitted = in memory. */
  dataDir?: string;
  /** Schema that holds the application's tables. */
  schema: string;
}

export interface BridgeResult {
  rows: Array<Record<string, unknown>>;
  changes: number;
}

export interface Bridge {
  query(sql: string, params: unknown[], inTransaction: boolean): BridgeResult;
  close(): void;
}

/** Later statements are bounded by the statement timeout; the first one also waits for the engine to start. */
const TIMEOUT_MS = 45_000;
const FIRST_TIMEOUT_MS = 180_000;

interface Reply {
  id: number;
  ok: boolean;
  rows?: Array<Record<string, unknown>>;
  changes?: number;
  message?: string;
  code?: string;
}

export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export function openBridge(options: BridgeOptions): Bridge {
  const signal = new SharedArrayBuffer(4);
  const flag = new Int32Array(signal);
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(PG_WORKER_SOURCE, {
    eval: true,
    workerData: { port: port2, signal, kind: options.kind, url: options.url, schema: options.schema, dataDir: options.dataDir },
    transferList: [port2],
  });
  // Neither the thread nor the port may keep the process alive on its own.
  worker.unref();
  port1.unref();
  let sequence = 0;
  let broken: string | null = null;
  worker.on('error', (err) => {
    broken = `The database thread stopped: ${err instanceof Error ? err.message : String(err)}`;
  });

  return {
    query(sql, params, inTransaction) {
      if (broken) throw new DatabaseError(broken);
      const id = ++sequence;
      Atomics.store(flag, 0, 0);
      port1.postMessage({ id, sql, params, inTransaction });
      if (Atomics.wait(flag, 0, 0, id === 1 ? FIRST_TIMEOUT_MS : TIMEOUT_MS) === 'timed-out') {
        // A late answer would be mistaken for the next statement's: this bridge is done.
        broken = 'The database did not answer in time.';
        void worker.terminate();
        throw new DatabaseError(broken);
      }
      const received = receiveMessageOnPort(port1)?.message as Reply | undefined;
      if (!received || received.id !== id) {
        broken = 'The database answer was lost.';
        void worker.terminate();
        throw new DatabaseError(broken);
      }
      if (!received.ok) throw new DatabaseError(received.message ?? 'Database error', received.code);
      return { rows: received.rows ?? [], changes: received.changes ?? 0 };
    },
    close() {
      broken = 'The database connection is closed.';
      void worker.terminate();
    },
  };
}
