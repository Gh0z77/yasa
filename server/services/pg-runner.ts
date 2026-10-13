// Direct SQL access to a Supabase project's Postgres database, used to apply migrations and to read the
// overview shown in the Cloud tab when the owner supplied the database connection string.
//
// Supabase's direct host (db.<ref>.supabase.co) only has an IPv6 address, which many networks cannot reach.
// When that happens the same database is reachable over IPv4 through Supabase's connection pooler, whose host
// depends on the project's region: the right one is found by asking all of them at once.
import { Client } from 'pg';
import { HttpError, badRequest } from '../lib/errors';

export interface DbTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const DIRECT_HOST = /^db\.([a-z0-9]{12,40})\.supabase\.co$/;
const POOLER_HOST = /^aws-\d-[a-z]{2}-[a-z]+-\d\.pooler\.supabase\.com$/;
const POOLER_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'sa-east-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1',
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
];
const URL_SHAPE = /^postgres(?:ql)?:\/\/([^:@/]+):(.*)@([^@/:]+)(?::(\d+))?\/([^?]*)(?:\?.*)?$/;

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Parses a Supabase connection string and makes sure it points at THIS project's database on a Supabase host,
 * so the server can never be told to open connections to arbitrary machines.
 */
export function parseDbUrl(input: string, projectRef: string): DbTarget {
  const match = URL_SHAPE.exec(input.trim());
  if (!match) throw badRequest('Paste the connection string from Supabase: Project Settings → Database → Connection string (URI).', { supabase: 'bad_db_url' });
  let password = match[2]!;
  // Supabase shows the placeholder as [YOUR-PASSWORD]; people often keep the brackets around the real one.
  if (password.startsWith('[') && password.endsWith(']')) password = password.slice(1, -1);
  const target: DbTarget = {
    user: decode(match[1]!),
    password: decode(password),
    host: match[3]!.toLowerCase(),
    port: Number(match[4] ?? 5432),
    database: decode(match[5] || 'postgres'),
  };
  const direct = DIRECT_HOST.exec(target.host);
  const sameProject = direct ? direct[1] === projectRef : POOLER_HOST.test(target.host) && target.user === `postgres.${projectRef}`;
  if (!sameProject || (target.port !== 5432 && target.port !== 6543) || !target.password) {
    throw badRequest('This connection string does not belong to the Supabase project above.', { supabase: 'bad_db_url' });
  }
  return target;
}

type Row = Record<string, unknown>;

/** Opens a connection, runs the SQL (multi-statement allowed) and closes it. */
async function realQuery(target: DbTarget, sql: string, connectTimeoutMs = 10_000): Promise<Row[]> {
  const client = new Client({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    // Supabase certificates are signed by its own CA; the host is restricted to Supabase domains above.
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: connectTimeoutMs,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: 'yasa',
  });
  // An unhandled 'error' event on an idle client would crash the process.
  client.on('error', () => undefined);
  await client.connect();
  try {
    const result = await client.query(sql);
    const last = Array.isArray(result) ? result[result.length - 1] : result;
    return (last?.rows ?? []) as Row[];
  } finally {
    await client.end().catch(() => undefined);
  }
}

let query: typeof realQuery = realQuery;

/** Test helper: replaces the database driver (pass null to restore the real one). */
export function setPgQueryForTests(fake: ((target: DbTarget, sql: string) => Promise<Row[]>) | null): void {
  query = fake ?? realQuery;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const isWrongPassword = (err: unknown) => /password authentication failed|28P01/i.test(messageOf(err) + ((err as { code?: string })?.code ?? ''));

/**
 * Returns a target that actually accepts connections: the given one if it works, otherwise the pooler in the
 * project's region. Throws a readable error for a wrong password or an unreachable database.
 */
export async function findReachableTarget(target: DbTarget, projectRef: string): Promise<DbTarget> {
  try {
    await query(target, 'select 1', 6_000);
    return target;
  } catch (err) {
    if (isWrongPassword(err)) throw badRequest('The database password in the connection string is wrong.', { supabase: 'bad_db_password' });
    if (!DIRECT_HOST.test(target.host)) throw new HttpError(502, 'provider_error', 'Could not connect to the database.', { supabase: 'db_unreachable' });
  }
  const candidates: DbTarget[] = POOLER_REGIONS.flatMap((region) =>
    [0, 1].map((n) => ({ ...target, host: `aws-${n}-${region}.pooler.supabase.com`, port: 5432, user: `postgres.${projectRef}` })),
  );
  let wrongPassword = false;
  const attempts = candidates.map(async (candidate) => {
    try {
      await query(candidate, 'select 1', 8_000);
      return candidate;
    } catch (err) {
      if (isWrongPassword(err)) wrongPassword = true;
      throw err;
    }
  });
  try {
    return await Promise.any(attempts);
  } catch {
    if (wrongPassword) throw badRequest('The database password in the connection string is wrong.', { supabase: 'bad_db_password' });
    throw new HttpError(502, 'provider_error', 'Could not connect to the database. Use the "Session pooler" connection string from Supabase.', {
      supabase: 'db_unreachable',
    });
  }
}

/** Runs SQL against the project's database. `transaction` wraps it so a failing migration leaves nothing half-applied. */
export async function runSql(target: DbTarget, sql: string, options: { transaction?: boolean } = {}): Promise<Row[]> {
  return query(target, options.transaction ? `begin;\n${sql}\n;commit;` : sql);
}
