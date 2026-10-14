// Source of the worker thread that talks to Postgres (see pg-bridge.ts). It is kept as a string and started with
// `new Worker(source, { eval: true })`, so it survives bundling and needs no file next to the server bundle.
// Plain CommonJS: `require` resolves from the working directory, where node_modules lives.
export const PG_WORKER_SOURCE = String.raw`
const { workerData } = require('node:worker_threads');
const { port, signal, kind, url, schema, dataDir } = workerData;
const flag = new Int32Array(signal);

// 64-bit integers (COUNT, SUM) and numerics arrive as JavaScript numbers, like they do from SQLite.
const INT8 = 20;
const NUMERIC = 1700;
const SETUP = 'CREATE SCHEMA IF NOT EXISTS "' + schema + '"; SET search_path TO "' + schema + '";';

async function openPg() {
  const pg = require('pg');
  pg.types.setTypeParser(INT8, Number);
  pg.types.setTypeParser(NUMERIC, Number);
  let client = null;
  const connect = async () => {
    const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
    const next = new pg.Client({
      connectionString: url,
      // Hosted Postgres (Supabase) signs its certificates with its own CA.
      ssl: local ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      application_name: 'yasa',
    });
    // A connection dropped while idle (a paused serverless instance) must not crash the thread.
    next.on('error', () => { if (client === next) client = null; });
    await next.connect();
    await next.query(SETUP);
    client = next;
    return next;
  };
  return async (sql, params, inTransaction) => {
    for (let attempt = 0; ; attempt++) {
      const active = client || (await connect());
      try {
        const result = params.length > 0 ? await active.query(sql, params) : await active.query(sql);
        const last = Array.isArray(result) ? result[result.length - 1] : result;
        return { rows: last.rows || [], changes: last.rowCount || 0 };
      } catch (err) {
        const dropped = !err.code && /terminat|ECONNRESET|EPIPE|ETIMEDOUT|ended|not queryable|socket|closed/i.test(String(err.message));
        // Statements inside a transaction cannot be replayed on a new connection: the caller sees the failure.
        if (dropped && attempt === 0 && !inTransaction) {
          client = null;
          active.end().catch(() => {});
          continue;
        }
        throw err;
      }
    }
  };
}

async function openPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dataDir || undefined, { parsers: { [INT8]: Number, [NUMERIC]: Number } });
  await db.exec(SETUP);
  return async (sql, params) => {
    if (params.length > 0) {
      const result = await db.query(sql, params);
      return { rows: result.rows || [], changes: result.affectedRows || 0 };
    }
    const results = await db.exec(sql);
    const last = results[results.length - 1];
    return { rows: (last && last.rows) || [], changes: (last && last.affectedRows) || 0 };
  };
}

const ready = kind === 'pglite' ? openPglite() : openPg();
ready.catch(() => {});

port.on('message', async (message) => {
  let reply;
  try {
    const query = await ready;
    const result = await query(message.sql, message.params, message.inTransaction);
    reply = { id: message.id, ok: true, rows: result.rows, changes: result.changes };
  } catch (err) {
    reply = { id: message.id, ok: false, message: String((err && err.message) || err), code: err && err.code };
  }
  port.postMessage(reply);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
`;
