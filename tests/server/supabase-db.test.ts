import { afterEach, describe, expect, it } from 'vitest';
import type { SupabaseApplyResponse, SupabaseOverview, SupabaseStatus } from '../../shared/types';
import { collabLimiter } from '../../server/routes/collab';
import { parseDbUrl, setPgQueryForTests, type DbTarget } from '../../server/services/pg-runner';
import { setSupabaseFetchForTests } from '../../server/services/supabase';
import { call, createProject, json, setupTestApp, signup } from './helpers';

const REF = 'abcdefghijklmnopqrst';
const SB_URL = `https://${REF}.supabase.co`;
const ANON = 'sb_publishable_test_key_0123456789';
const PASSWORD = 'pa$$w0rd';
const DB_URL = `postgresql://postgres:[${PASSWORD}]@db.${REF}.supabase.co:5432/postgres`;
const POOLER = 'aws-0-eu-central-1.pooler.supabase.com';

/** A database that is only reachable through one regional pooler, like a Supabase project on an IPv4 network. */
function fakeDatabase(options: { failOn?: string } = {}) {
  const executed: Array<{ host: string; sql: string }> = [];
  setSupabaseFetchForTests((async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch);
  setPgQueryForTests(async (target: DbTarget, sql: string) => {
    if (target.host.startsWith('db.')) throw Object.assign(new Error('connect ENETUNREACH'), { code: 'ENETUNREACH' });
    if (target.host !== POOLER) throw new Error('Tenant or user not found');
    if (target.user !== `postgres.${REF}` || target.password !== PASSWORD) throw Object.assign(new Error('password authentication failed for user "postgres"'), { code: '28P01' });
    if (options.failOn && sql.includes(options.failOn)) throw new Error('syntax error at or near "tabel"');
    executed.push({ host: target.host, sql });
    if (sql.includes('from pg_class')) return [{ name: 'notes', rows: '3', rls: true, columns: 5 }];
    if (sql.includes('from auth.users')) return [{ count: 2, recent: [{ email: 'a@example.com', created_at: '2026-10-01T10:00:00Z' }] }];
    if (sql.includes('from storage.buckets')) return [{ name: 'files', public: false }];
    return [];
  });
  return executed;
}

async function ready() {
  const app = setupTestApp();
  const { cookie } = await signup(app);
  const project = await createProject(app, cookie, { name: 'Notes' });
  const base = `/api/projects/${project.id}`;
  return { app, cookie, base };
}

afterEach(() => {
  setPgQueryForTests(null);
  setSupabaseFetchForTests(null);
  collabLimiter.reset();
});

describe('parseDbUrl', () => {
  it('reads direct and pooler strings and unwraps a bracketed password', () => {
    expect(parseDbUrl(DB_URL, REF)).toEqual({ user: 'postgres', password: PASSWORD, host: `db.${REF}.supabase.co`, port: 5432, database: 'postgres' });
    expect(parseDbUrl(`postgres://postgres.${REF}:p%40ss@${POOLER}:6543/postgres?sslmode=require`, REF)).toMatchObject({ user: `postgres.${REF}`, password: 'p@ss', host: POOLER, port: 6543 });
  });

  it('refuses anything that is not this project on a Supabase host', () => {
    const bad = [
      'postgresql://postgres:x@db.otherprojectref000.supabase.co:5432/postgres',
      'postgresql://postgres:x@127.0.0.1:5432/postgres',
      'postgresql://postgres:x@db.internal.example.com:5432/postgres',
      `postgresql://postgres:x@db.${REF}.supabase.co:22/postgres`,
      `postgresql://postgres.someoneelse:x@${POOLER}:5432/postgres`,
      'not a url',
    ];
    for (const value of bad) expect(() => parseDbUrl(value, REF), value).toThrow();
  });
});

describe('Supabase through a database connection', () => {
  it('finds the reachable pooler, applies migrations in a transaction and shows the overview', async () => {
    const executed = fakeDatabase();
    const { app, cookie, base } = await ready();

    const connect = await call(app, 'PUT', `${base}/supabase`, { cookie, body: { url: SB_URL, anonKey: ANON, dbUrl: DB_URL } });
    expect(connect.status).toBe(200);
    const text = await connect.text();
    expect(text).not.toContain(PASSWORD);
    expect((JSON.parse(text) as SupabaseStatus).connection).toMatchObject({ projectRef: REF, canRunSql: true });

    await call(app, 'PUT', `${base}/files`, { cookie, body: { path: 'supabase/migrations/20260101000001_notes.sql', content: 'create table if not exists notes (id uuid primary key);' } });
    const applied = await json<SupabaseApplyResponse>(await call(app, 'POST', `${base}/supabase/migrations/apply`, { cookie, body: {} }));
    expect(applied.failed).toBeNull();
    expect(applied.applied).toEqual(['supabase/migrations/20260101000001_notes.sql']);
    const migration = executed.find((e) => e.sql.includes('create table if not exists notes'));
    expect(migration?.host).toBe(POOLER);
    expect(migration?.sql.startsWith('begin;')).toBe(true);
    expect(migration?.sql.trimEnd().endsWith('commit;')).toBe(true);

    const overview = await json<SupabaseOverview>(await call(app, 'GET', `${base}/supabase/overview`, { cookie }));
    expect(overview.tables).toEqual([{ name: 'notes', rows: 3, columns: 5, rls: true }]);
    expect(overview.users.count).toBe(2);
    expect(overview.buckets).toEqual([{ name: 'files', public: false }]);
  });

  it('reports a failing migration with the database message and leaves it pending', async () => {
    fakeDatabase({ failOn: 'create tabel' });
    const { app, cookie, base } = await ready();
    await call(app, 'PUT', `${base}/supabase`, { cookie, body: { url: SB_URL, anonKey: ANON, dbUrl: DB_URL } });
    await call(app, 'PUT', `${base}/files`, { cookie, body: { path: 'supabase/migrations/20260101000001_bad.sql', content: 'create tabel notes;' } });
    const result = await json<SupabaseApplyResponse>(await call(app, 'POST', `${base}/supabase/migrations/apply`, { cookie, body: {} }));
    expect(result.applied).toEqual([]);
    expect(result.failed?.message).toContain('syntax error');
    expect(result.status.pending).toBe(1);
  });

  it('rejects a wrong password and a string for another project without connecting the backend', async () => {
    fakeDatabase();
    const { app, cookie, base } = await ready();
    const attempt = async (dbUrl: string) => {
      const res = await call(app, 'PUT', `${base}/supabase`, { cookie, body: { url: SB_URL, anonKey: ANON, dbUrl } });
      return ((await res.json()) as { error?: { details?: { supabase?: string } } }).error?.details?.supabase;
    };
    expect(await attempt(`postgresql://postgres:wrong@db.${REF}.supabase.co:5432/postgres`)).toBe('bad_db_password');
    expect(await attempt('postgresql://postgres:x@db.otherprojectref000.supabase.co:5432/postgres')).toBe('bad_db_url');
    expect((await json<SupabaseStatus>(await call(app, 'GET', `${base}/supabase`, { cookie }))).connection).toBeNull();
  });
});
