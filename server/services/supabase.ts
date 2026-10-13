// Supabase as the backend of a generated app. The owner connects a Supabase project (URL + publishable "anon"
// key); Yasa then keeps a ready-made client in the project, tells the AI to build on it, and tracks the SQL
// migrations the AI writes. With a Supabase access token the migrations can be applied from Yasa; without one
// the owner runs them in the Supabase SQL editor and marks them as applied.
import { createHash } from 'node:crypto';
import type { ProjectFile, SupabaseMigration, SupabaseOverview, SupabaseStatus } from '../../shared/types';
import { all, get, run } from '../db';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { HttpError, badRequest } from '../lib/errors';
import { logger } from '../lib/logger';
import { nowIso } from '../lib/time';
import { getFile, listFiles, upsertFile } from './files';
import { findReachableTarget, parseDbUrl, runSql, type DbTarget } from './pg-runner';

export const SUPABASE_CLIENT_PATH = 'src/integrations/supabase/client.ts';
export const MIGRATIONS_DIR = 'supabase/migrations/';
const SUPABASE_JS_RANGE = '^2.45.0';
const MANAGEMENT_API = 'https://api.supabase.com';
const HOSTED_URL = /^https:\/\/([a-z0-9]{12,40})\.supabase\.co$/;

type Fetch = typeof fetch;
let http: Fetch = (...args) => fetch(...args);

/** Test helper: replaces the HTTP client (pass null to restore the real one). */
export function setSupabaseFetchForTests(fake: Fetch | null): void {
  http = fake ?? ((...args) => fetch(...args));
}

interface ConnectionRow {
  url: string;
  anon_key: string;
  project_ref: string;
  encrypted_access_token: string | null;
  encrypted_db_target: string | null;
  created_at: string;
}

function connectionRow(projectId: string): ConnectionRow | null {
  return get<ConnectionRow>('SELECT * FROM project_supabase WHERE project_id = ?', projectId) ?? null;
}

export function isSupabaseConnected(projectId: string): boolean {
  return connectionRow(projectId) !== null;
}

/** How SQL reaches the project's database: a direct connection when one was given, else the management API. */
type SqlRunner = (sql: string, options?: { transaction?: boolean }) => Promise<Array<Record<string, unknown>>>;

class SqlError extends Error {}

function sqlRunner(row: ConnectionRow): SqlRunner | null {
  const stored = row.encrypted_db_target ? decryptSecret(row.encrypted_db_target) : null;
  if (stored) {
    const target = JSON.parse(stored) as DbTarget;
    return async (sql, options) => {
      try {
        return await runSql(target, sql, options);
      } catch (err) {
        throw new SqlError((err instanceof Error ? err.message : String(err)).slice(0, 600));
      }
    };
  }
  const token = row.encrypted_access_token ? decryptSecret(row.encrypted_access_token) : null;
  if (!token) return null;
  return async (sql) => {
    const res = await call(`${MANAGEMENT_API}/v1/projects/${row.project_ref}/database/query`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw badRequest('The access token no longer works for this project.', { supabase: 'bad_token' });
      const detail = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new SqlError((detail?.message ?? `Supabase answered ${res.status}`).slice(0, 600));
    }
    const data = (await res.json().catch(() => [])) as unknown;
    return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  };
}

const checksum = (content: string) => createHash('sha256').update(content).digest('hex').slice(0, 32);

function migrationFiles(files: ProjectFile[]): ProjectFile[] {
  return files
    .filter((f) => f.path.startsWith(MIGRATIONS_DIR) && f.path.endsWith('.sql') && f.encoding === 'utf8')
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function getSupabaseStatus(projectId: string, files: ProjectFile[] = listFiles(projectId)): SupabaseStatus {
  const row = connectionRow(projectId);
  const applied = new Map(
    all<{ path: string; checksum: string; applied_at: string }>('SELECT path, checksum, applied_at FROM supabase_migrations WHERE project_id = ?', projectId).map(
      (m) => [m.path, m] as const,
    ),
  );
  const migrations: SupabaseMigration[] = migrationFiles(files).map((file) => {
    const record = applied.get(file.path);
    // A file edited after it ran is shown as pending again: the database no longer matches it.
    const isApplied = Boolean(record && record.checksum === checksum(file.content));
    return { path: file.path, name: file.path.slice(MIGRATIONS_DIR.length), sql: file.content, applied: isApplied, appliedAt: isApplied ? record!.applied_at : null };
  });
  return {
    connection: row ? { url: row.url, projectRef: row.project_ref, canRunSql: row.encrypted_access_token !== null || row.encrypted_db_target !== null, connectedAt: row.created_at } : null,
    migrations,
    pending: migrations.filter((m) => !m.applied).length,
  };
}

function clientSource(url: string, anonKey: string): string {
  return [
    '// Supabase client for this app. Managed by Yasa: it is rewritten when the Supabase connection changes.',
    '// The key below is the publishable (anon) key. It is safe in the browser as long as every table has',
    '// row level security policies.',
    "import { createClient } from '@supabase/supabase-js';",
    '',
    `const SUPABASE_URL = ${JSON.stringify(url)};`,
    `const SUPABASE_ANON_KEY = ${JSON.stringify(anonKey)};`,
    '',
    'export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {',
    '  auth: { persistSession: true, autoRefreshToken: true, storage: localStorage },',
    '});',
    '',
  ].join('\n');
}

/** Writes the client file and declares the SDK dependency in the project. */
function installClient(projectId: string, url: string, anonKey: string): void {
  upsertFile(projectId, SUPABASE_CLIENT_PATH, clientSource(url, anonKey));
  const pkgFile = getFile(projectId, 'package.json');
  if (!pkgFile) return;
  try {
    const pkg = JSON.parse(pkgFile.content) as { dependencies?: Record<string, string> };
    if (pkg.dependencies?.['@supabase/supabase-js']) return;
    pkg.dependencies = { ...(pkg.dependencies ?? {}), '@supabase/supabase-js': SUPABASE_JS_RANGE };
    upsertFile(projectId, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  } catch {
    logger.warn('package.json could not be updated for Supabase', { projectId });
  }
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await http(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new HttpError(502, 'provider_error', 'Could not reach Supabase. Try again in a moment.', { supabase: 'unreachable' });
  }
}

export interface ConnectInput {
  url: string;
  anonKey: string;
  /** Supabase personal access token (optional): lets Yasa run the migrations itself. */
  accessToken?: string | null;
  /** Database connection string (optional): the other way to let Yasa run the migrations. */
  dbUrl?: string | null;
}

/** Checks the credentials against Supabase, stores them and prepares the project to use them. */
export async function connectSupabase(projectId: string, input: ConnectInput): Promise<SupabaseStatus> {
  const url = input.url.trim().replace(/\/+$/, '').toLowerCase();
  const match = HOSTED_URL.exec(url);
  if (!match) throw badRequest('Use the project URL from Supabase, for example https://abcdefgh.supabase.co', { supabase: 'bad_url' });
  const projectRef = match[1]!;
  const anonKey = input.anonKey.trim();
  const accessToken = input.accessToken?.trim() || null;

  const settings = await call(`${url}/auth/v1/settings`, { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } });
  if (!settings.ok) throw badRequest('Supabase rejected this URL and key. Copy both from Project Settings → API.', { supabase: 'bad_key' });

  if (accessToken) {
    const project = await call(`${MANAGEMENT_API}/v1/projects/${projectRef}`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!project.ok) {
      throw badRequest('The access token cannot manage this Supabase project. Check the token, or leave the field empty.', { supabase: 'bad_token' });
    }
  }

  // The connection string is checked by actually connecting; the working host (direct or pooler) is what gets stored.
  const dbUrl = input.dbUrl?.trim() || null;
  const dbTarget = dbUrl ? await findReachableTarget(parseDbUrl(dbUrl, projectRef), projectRef) : null;

  const now = nowIso();
  run(
    `INSERT INTO project_supabase (project_id, url, anon_key, project_ref, encrypted_access_token, encrypted_db_target, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET url = excluded.url, anon_key = excluded.anon_key, project_ref = excluded.project_ref,
       encrypted_access_token = excluded.encrypted_access_token, encrypted_db_target = excluded.encrypted_db_target, created_at = excluded.created_at`,
    projectId,
    url,
    anonKey,
    projectRef,
    accessToken ? encryptSecret(accessToken) : null,
    dbTarget ? encryptSecret(JSON.stringify(dbTarget)) : null,
    now,
  );
  installClient(projectId, url, anonKey);
  return getSupabaseStatus(projectId);
}

export function disconnectSupabase(projectId: string): void {
  run('DELETE FROM project_supabase WHERE project_id = ?', projectId);
  run('DELETE FROM supabase_migrations WHERE project_id = ?', projectId);
}

function markApplied(projectId: string, file: ProjectFile): void {
  run(
    `INSERT INTO supabase_migrations (project_id, path, checksum, applied_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, path) DO UPDATE SET checksum = excluded.checksum, applied_at = excluded.applied_at`,
    projectId,
    file.path,
    checksum(file.content),
    nowIso(),
  );
}

/** Records that the owner ran a migration by hand in the Supabase SQL editor. */
export function markMigrationApplied(projectId: string, path: string): SupabaseStatus {
  const file = migrationFiles(listFiles(projectId)).find((f) => f.path === path);
  if (!file) throw badRequest('Migration not found.');
  markApplied(projectId, file);
  return getSupabaseStatus(projectId);
}

/**
 * Runs the pending migrations in file-name order through Supabase's management API. Stops at the first failure:
 * later files usually depend on earlier ones.
 */
export async function applyPendingMigrations(projectId: string): Promise<{ status: SupabaseStatus; applied: string[]; failed: { path: string; message: string } | null }> {
  const row = connectionRow(projectId);
  if (!row) throw badRequest('Connect Supabase first.', { supabase: 'not_connected' });
  const execute = sqlRunner(row);
  if (!execute) {
    throw badRequest('Add a Supabase access token or the database connection string to run migrations from here, or run the SQL in the Supabase SQL editor.', {
      supabase: 'no_token',
    });
  }

  const files = listFiles(projectId);
  const pending = new Set(getSupabaseStatus(projectId, files).migrations.filter((m) => !m.applied).map((m) => m.path));
  const applied: string[] = [];
  let failed: { path: string; message: string } | null = null;
  for (const file of migrationFiles(files)) {
    if (!pending.has(file.path)) continue;
    try {
      await execute(file.content, { transaction: true });
    } catch (err) {
      if (!(err instanceof SqlError)) throw err;
      failed = { path: file.path, message: err.message };
      logger.warn('Supabase migration failed', { projectId, path: file.path });
      break;
    }
    markApplied(projectId, file);
    applied.push(file.path);
  }
  return { status: getSupabaseStatus(projectId), applied, failed };
}

// ---- overview ("Cloud") -------------------------------------------------------------------------------------

const TABLES_SQL = `
select c.relname as name,
       greatest(c.reltuples, 0)::bigint as rows,
       c.relrowsecurity as rls,
       (select count(*) from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname)::int as columns
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname limit 100`;
const USERS_SQL = `
select (select count(*) from auth.users)::int as count,
       coalesce((select json_agg(u) from (select email, created_at from auth.users order by created_at desc limit 5) u), '[]'::json) as recent`;
const BUCKETS_SQL = 'select name, public from storage.buckets order by name limit 50';

/** What lives in the connected Supabase project: tables, accounts and storage buckets. Needs the access token. */
export async function getSupabaseOverview(projectId: string): Promise<SupabaseOverview> {
  const row = connectionRow(projectId);
  if (!row) throw badRequest('Connect Supabase first.', { supabase: 'not_connected' });
  const execute = sqlRunner(row);
  if (!execute) throw badRequest('Add a Supabase access token or the database connection string to see the database here.', { supabase: 'no_token' });

  const query = async <T>(sql: string): Promise<T[]> => {
    try {
      return (await execute(sql)) as T[];
    } catch (err) {
      if (!(err instanceof SqlError)) throw err;
      throw new HttpError(502, 'provider_error', 'Supabase could not answer. Try again in a moment.', { supabase: 'unreachable' });
    }
  };

  const [tables, users, buckets] = await Promise.all([
    query<{ name: string; rows: number | string; rls: boolean; columns: number }>(TABLES_SQL),
    query<{ count: number; recent: Array<{ email: string | null; created_at: string }> | string }>(USERS_SQL),
    query<{ name: string; public: boolean }>(BUCKETS_SQL),
  ]);
  const recentRaw = users[0]?.recent ?? [];
  const recent = typeof recentRaw === 'string' ? (JSON.parse(recentRaw) as Array<{ email: string | null; created_at: string }>) : recentRaw;
  return {
    tables: tables.map((t) => ({ name: String(t.name), rows: Number(t.rows) || 0, columns: Number(t.columns) || 0, rls: Boolean(t.rls) })),
    users: { count: Number(users[0]?.count) || 0, recent: recent.map((u) => ({ email: u.email ?? '', createdAt: u.created_at })) },
    buckets: buckets.map((b) => ({ name: String(b.name), public: Boolean(b.public) })),
    dashboardUrl: `https://supabase.com/dashboard/project/${row.project_ref}`,
  };
}
