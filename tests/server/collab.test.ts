import { afterEach, describe, expect, it } from 'vitest';
import type {
  DomainsResponse,
  MembersResponse,
  ProjectDetailResponse,
  ProjectDomain,
  ProjectSummary,
  SupabaseApplyResponse,
  SupabaseOverview,
  SupabaseStatus,
} from '../../shared/types';
import { buildSystemPrompt } from '../../server/ai/prompt';
import { collabLimiter } from '../../server/routes/collab';
import { setTxtResolverForTests } from '../../server/services/domains';
import { setSupabaseFetchForTests } from '../../server/services/supabase';
import { call, createProject, json, ORIGIN, setupTestApp, signup } from './helpers';

afterEach(() => {
  setSupabaseFetchForTests(null);
  setTxtResolverForTests(null);
  collabLimiter.reset();
});

// ---------------------------------------------------------------------------------------------- members
describe('project members', () => {
  async function shared(role: 'editor' | 'viewer') {
    const app = setupTestApp();
    const owner = await signup(app, 'owner@example.com');
    const guest = await signup(app, 'guest@example.com');
    const stranger = await signup(app, 'stranger@example.com');
    const project = await createProject(app, owner.cookie, { name: 'Team project' });
    const res = await call(app, 'POST', `/api/projects/${project.id}/members`, { cookie: owner.cookie, body: { email: 'Guest@Example.com', role } });
    expect(res.status).toBe(200);
    return { app, owner, guest, stranger, project };
  }

  it('lets an editor open, change and generate in a shared project', async () => {
    const { app, guest, project } = await shared('editor');

    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie: guest.cookie }));
    expect(detail).toMatchObject({ isOwner: false, canEdit: true, role: 'editor' });

    const write = await call(app, 'PUT', `/api/projects/${project.id}/files`, { cookie: guest.cookie, body: { path: 'NOTES.md', content: 'from the editor' } });
    expect(write.status).toBe(200);
    const chat = await call(app, 'POST', `/api/projects/${project.id}/chat`, { cookie: guest.cookie, body: { message: 'Add a pricing section', model: 'mock:demo' } });
    expect(chat.status).toBe(200);
    await chat.text();

    // Owner-only actions stay closed.
    expect((await call(app, 'DELETE', `/api/projects/${project.id}`, { cookie: guest.cookie })).status).toBe(404);
    expect((await call(app, 'PATCH', `/api/projects/${project.id}`, { cookie: guest.cookie, body: { name: 'Hijacked' } })).status).toBe(404);
    expect((await call(app, 'POST', `/api/projects/${project.id}/members`, { cookie: guest.cookie, body: { email: 'x@example.com' } })).status).toBe(404);
  });

  it('lets a viewer read but not change anything', async () => {
    const { app, guest, project } = await shared('viewer');
    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie: guest.cookie }));
    expect(detail).toMatchObject({ isOwner: false, canEdit: false, role: 'viewer' });
    expect((await call(app, 'PUT', `/api/projects/${project.id}/files`, { cookie: guest.cookie, body: { path: 'NOTES.md', content: 'x' } })).status).toBe(404);
    expect((await call(app, 'POST', `/api/projects/${project.id}/chat`, { cookie: guest.cookie, body: { message: 'Hi', model: 'mock:demo' } })).status).toBe(404);
  });

  it('keeps a private project hidden from everyone else and lists shared projects separately', async () => {
    const { app, owner, guest, stranger, project } = await shared('editor');
    expect((await call(app, 'GET', `/api/projects/${project.id}`, { cookie: stranger.cookie })).status).toBe(404);
    expect((await call(app, 'GET', `/api/projects/${project.id}/members`, { cookie: stranger.cookie })).status).toBe(404);

    const mine = await json<{ projects: ProjectSummary[]; shared: ProjectSummary[] }>(await call(app, 'GET', '/api/projects', { cookie: guest.cookie }));
    expect(mine.projects).toHaveLength(0);
    expect(mine.shared).toHaveLength(1);
    expect(mine.shared[0]).toMatchObject({ id: project.id, role: 'editor', ownerName: owner.user.name });

    const members = await json<MembersResponse>(await call(app, 'GET', `/api/projects/${project.id}/members`, { cookie: guest.cookie }));
    expect(members.owner.email).toBe('owner@example.com');
    expect(members.members).toEqual([expect.objectContaining({ email: 'guest@example.com', role: 'editor', joined: true })]);
  });

  it('accepts an invitation for someone who signs up later, and lets a member leave', async () => {
    const app = setupTestApp();
    const owner = await signup(app, 'owner@example.com');
    const project = await createProject(app, owner.cookie, { name: 'Team project' });
    await call(app, 'POST', `/api/projects/${project.id}/members`, { cookie: owner.cookie, body: { email: 'later@example.com', role: 'viewer' } });
    const pending = await json<MembersResponse>(await call(app, 'GET', `/api/projects/${project.id}/members`, { cookie: owner.cookie }));
    expect(pending.members[0]).toMatchObject({ email: 'later@example.com', joined: false, name: null });

    const later = await signup(app, 'later@example.com');
    expect((await call(app, 'GET', `/api/projects/${project.id}`, { cookie: later.cookie })).status).toBe(200);

    // A member cannot remove someone else, but can leave.
    await call(app, 'POST', `/api/projects/${project.id}/members`, { cookie: owner.cookie, body: { email: 'third@example.com' } });
    expect((await call(app, 'POST', `/api/projects/${project.id}/members/remove`, { cookie: later.cookie, body: { email: 'third@example.com' } })).status).toBe(403);
    expect((await call(app, 'POST', `/api/projects/${project.id}/members/remove`, { cookie: later.cookie, body: { email: 'later@example.com' } })).status).toBe(200);
    expect((await call(app, 'GET', `/api/projects/${project.id}`, { cookie: later.cookie })).status).toBe(404);
  });

  it('refuses to add the owner as a member', async () => {
    const app = setupTestApp();
    const owner = await signup(app, 'owner@example.com');
    const project = await createProject(app, owner.cookie, { name: 'Solo' });
    expect((await call(app, 'POST', `/api/projects/${project.id}/members`, { cookie: owner.cookie, body: { email: 'owner@example.com' } })).status).toBe(400);
  });
});

// --------------------------------------------------------------------------------------------- Supabase
const SB_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon-key-for-tests';
const TOKEN = 'sbp_0123456789abcdef0123456789abcdef';

function fakeSupabase(options: { failOn?: string } = {}) {
  const queries: string[] = [];
  setSupabaseFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url === `${SB_URL}/auth/v1/settings`) return headers.get('apikey') === ANON ? reply(200, { external: {} }) : reply(401, { message: 'Invalid API key' });
    if (url === 'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst') {
      return headers.get('authorization') === `Bearer ${TOKEN}` ? reply(200, { id: 'abcdefghijklmnopqrst' }) : reply(401, { message: 'Unauthorized' });
    }
    if (url === 'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query') {
      const query = String((JSON.parse(String(init?.body)) as { query: string }).query);
      if (options.failOn && query.includes(options.failOn)) return reply(400, { message: 'syntax error at or near "brokn"' });
      if (query.includes('from pg_class')) return reply(201, [{ name: 'notes', rows: '12', rls: true, columns: 4 }, { name: 'tags', rows: 0, rls: false, columns: 2 }]);
      if (query.includes('from auth.users')) return reply(201, [{ count: 3, recent: [{ email: 'a@example.com', created_at: '2026-10-01T10:00:00Z' }] }]);
      if (query.includes('from storage.buckets')) return reply(201, [{ name: 'avatars', public: true }]);
      queries.push(query);
      return reply(201, []);
    }
    return reply(404, { message: 'not found' });
  }) as typeof fetch);
  return { queries };
}

describe('Supabase backend', () => {
  async function ready() {
    const app = setupTestApp();
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Notes app' });
    const base = `/api/projects/${project.id}`;
    const putFile = (path: string, content: string) => call(app, 'PUT', `${base}/files`, { cookie, body: { path, content } });
    return { app, cookie, project, base, putFile };
  }

  it('connects a project, writes the client and declares the dependency', async () => {
    fakeSupabase();
    const { app, cookie, base } = await ready();
    const res = await call(app, 'PUT', `${base}/supabase`, { cookie, body: { url: `${SB_URL}/`, anonKey: ANON, accessToken: TOKEN } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text) as SupabaseStatus).toMatchObject({ connection: { url: SB_URL, projectRef: 'abcdefghijklmnopqrst', canRunSql: true }, pending: 0 });

    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', base, { cookie }));
    const client = detail.files.find((f) => f.path === 'src/integrations/supabase/client.ts');
    expect(client?.content).toContain(`"${SB_URL}"`);
    expect(client?.content).toContain("from '@supabase/supabase-js'");
    const pkg = JSON.parse(detail.files.find((f) => f.path === 'package.json')!.content) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@supabase/supabase-js']).toBeTruthy();
  });

  it('rejects a wrong key, a wrong token and a URL that is not a Supabase project', async () => {
    fakeSupabase();
    const { app, cookie, base } = await ready();
    const attempt = async (body: Record<string, unknown>) => {
      const res = await call(app, 'PUT', `${base}/supabase`, { cookie, body });
      return { status: res.status, body: (await res.json()) as { error?: { details?: { supabase?: string } } } };
    };
    expect((await attempt({ url: SB_URL, anonKey: 'eyJ-this-is-not-the-right-key-at-all' })).body.error?.details?.supabase).toBe('bad_key');
    expect((await attempt({ url: SB_URL, anonKey: ANON, accessToken: 'sbp_wrong_token_000000000000' })).body.error?.details?.supabase).toBe('bad_token');
    expect((await attempt({ url: 'http://169.254.169.254/latest', anonKey: ANON })).body.error?.details?.supabase).toBe('bad_url');
    expect((await attempt({ url: 'https://evil.example.com', anonKey: ANON })).body.error?.details?.supabase).toBe('bad_url');
    expect((await json<SupabaseStatus>(await call(app, 'GET', `${base}/supabase`, { cookie }))).connection).toBeNull();
  });

  it('applies pending migrations in order and stops at the first failure', async () => {
    const supabase = fakeSupabase({ failOn: 'brokn' });
    const { app, cookie, base, putFile } = await ready();
    await call(app, 'PUT', `${base}/supabase`, { cookie, body: { url: SB_URL, anonKey: ANON, accessToken: TOKEN } });
    await putFile('supabase/migrations/20260101000002_policies.sql', 'alter table notes enable row level security;');
    await putFile('supabase/migrations/20260101000001_notes.sql', 'create table if not exists notes (id uuid primary key);');
    await putFile('supabase/migrations/20260101000003_broken.sql', 'create tabel brokn;');
    await putFile('supabase/migrations/20260101000004_after.sql', 'select 1;');

    expect((await json<SupabaseStatus>(await call(app, 'GET', `${base}/supabase`, { cookie }))).pending).toBe(4);

    const result = await json<SupabaseApplyResponse>(await call(app, 'POST', `${base}/supabase/migrations/apply`, { cookie, body: {} }));
    expect(result.applied).toEqual(['supabase/migrations/20260101000001_notes.sql', 'supabase/migrations/20260101000002_policies.sql']);
    expect(result.failed).toMatchObject({ path: 'supabase/migrations/20260101000003_broken.sql' });
    expect(result.failed?.message).toContain('syntax error');
    expect(supabase.queries).toEqual(['create table if not exists notes (id uuid primary key);', 'alter table notes enable row level security;']);
    expect(result.status.pending).toBe(2);

    // Editing a migration that already ran makes it pending again.
    await putFile('supabase/migrations/20260101000001_notes.sql', 'create table if not exists notes (id uuid primary key, body text);');
    const after = await json<SupabaseStatus>(await call(app, 'GET', `${base}/supabase`, { cookie }));
    expect(after.migrations.find((m) => m.name === '20260101000001_notes.sql')?.applied).toBe(false);
  });

  it('lets the owner mark a migration as run by hand when there is no access token', async () => {
    fakeSupabase();
    const { app, cookie, base, putFile } = await ready();
    await call(app, 'PUT', `${base}/supabase`, { cookie, body: { url: SB_URL, anonKey: ANON } });
    await putFile('supabase/migrations/20260101000001_notes.sql', 'create table if not exists notes (id uuid primary key);');

    const apply = await call(app, 'POST', `${base}/supabase/migrations/apply`, { cookie, body: {} });
    expect(apply.status).toBe(400);
    expect(await apply.json()).toMatchObject({ error: { details: { supabase: 'no_token' } } });

    const marked = await json<SupabaseStatus>(
      await call(app, 'POST', `${base}/supabase/migrations/mark`, { cookie, body: { path: 'supabase/migrations/20260101000001_notes.sql' } }),
    );
    expect(marked.pending).toBe(0);
    expect((await json<SupabaseStatus>(await call(app, 'DELETE', `${base}/supabase`, { cookie }))).connection).toBeNull();
  });

  it('lists tables, users and buckets for the Cloud tab when an access token is present', async () => {
    fakeSupabase();
    const { app, cookie, base } = await ready();
    await call(app, 'PUT', `${base}/supabase`, { cookie, body: { url: SB_URL, anonKey: ANON } });
    const without = await call(app, 'GET', `${base}/supabase/overview`, { cookie });
    expect(without.status).toBe(400);
    expect(await without.json()).toMatchObject({ error: { details: { supabase: 'no_token' } } });

    await call(app, 'PUT', `${base}/supabase`, { cookie, body: { url: SB_URL, anonKey: ANON, accessToken: TOKEN } });
    const overview = await json<SupabaseOverview>(await call(app, 'GET', `${base}/supabase/overview`, { cookie }));
    expect(overview.tables).toEqual([
      { name: 'notes', rows: 12, columns: 4, rls: true },
      { name: 'tags', rows: 0, columns: 2, rls: false },
    ]);
    expect(overview.users).toEqual({ count: 3, recent: [{ email: 'a@example.com', createdAt: '2026-10-01T10:00:00Z' }] });
    expect(overview.buckets).toEqual([{ name: 'avatars', public: true }]);
    expect(overview.dashboardUrl).toBe('https://supabase.com/dashboard/project/abcdefghijklmnopqrst');
  });

  it('is owner-only and tells the AI about the backend only when one is connected', async () => {
    fakeSupabase();
    const { app, base } = await ready();
    const other = await signup(app);
    expect((await call(app, 'GET', `${base}/supabase`, { cookie: other.cookie })).status).toBe(404);
    expect((await call(app, 'PUT', `${base}/supabase`, { cookie: other.cookie, body: { url: SB_URL, anonKey: ANON } })).status).toBe(404);

    expect(buildSystemPrompt({ mode: 'build' })).toContain('no backend connected');
    const withBackend = buildSystemPrompt({ mode: 'build', supabase: true });
    expect(withBackend).toContain("from '@/integrations/supabase/client'");
    expect(withBackend).toContain('supabase/migrations/');
    expect(withBackend).toContain('row level security');
  });
});

// ------------------------------------------------------------------------------------------ custom domains
describe('custom domains', () => {
  async function published() {
    const app = setupTestApp();
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Bakery' });
    const chat = await call(app, 'POST', `/api/projects/${project.id}/chat`, { cookie, body: { message: 'Bakery landing page', model: 'mock:demo' } });
    await chat.text();
    const publish = await call(app, 'POST', `/api/projects/${project.id}/publish`, { cookie, body: { slug: 'bakery-test' } });
    expect(publish.status).toBe(200);
    const base = `/api/projects/${project.id}/domains`;
    const visit = (host: string, path = '/') => app.request(`http://${host}${path}`, { headers: { host } });
    return { app, cookie, project, base, visit };
  }

  it('serves the published app on a domain only after its TXT record is verified', async () => {
    const { app, cookie, base, visit } = await published();
    const added = await json<{ domain: ProjectDomain }>(await call(app, 'POST', base, { cookie, body: { domain: 'https://Shop.Example.com/' } }));
    expect(added.domain).toMatchObject({ domain: 'shop.example.com', verified: false, txtName: '_yasa-verify.shop.example.com', target: 'localhost' });
    expect(added.domain.txtValue).toMatch(/^yasa-verify=[a-z2-7]{20}$/);

    // Not verified yet: the host is unknown and no certificate may be issued for it.
    expect((await app.request(`${ORIGIN}/api/tls-check?domain=shop.example.com`)).status).toBe(404);
    setTxtResolverForTests(async () => [['something-else']]);
    const early = await call(app, 'POST', `${base}/verify`, { cookie, body: { domain: 'shop.example.com' } });
    expect(early.status).toBe(400);
    expect(await early.json()).toMatchObject({ error: { details: { domain: 'not_verified' } } });

    setTxtResolverForTests(async (name) => (name === '_yasa-verify.shop.example.com' ? [[added.domain.txtValue]] : []));
    const verified = await json<{ domain: ProjectDomain }>(await call(app, 'POST', `${base}/verify`, { cookie, body: { domain: 'shop.example.com' } }));
    expect(verified.domain.verified).toBe(true);
    expect((await app.request(`${ORIGIN}/api/tls-check?domain=shop.example.com`)).status).toBe(200);

    const page = await visit('shop.example.com');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('<div id="root">');
    // The builder's API is not reachable through a custom domain.
    expect((await visit('shop.example.com', '/api/auth/me')).headers.get('content-type')).toContain('text/html');

    expect((await call(app, 'POST', `${base}/remove`, { cookie, body: { domain: 'shop.example.com' } })).status).toBe(200);
    expect((await app.request(`${ORIGIN}/api/tls-check?domain=shop.example.com`)).status).toBe(404);
    expect((await json<DomainsResponse>(await call(app, 'GET', base, { cookie }))).domains).toEqual([]);
  });

  it('rejects invalid, reserved and already-claimed domains', async () => {
    const { app, cookie, base } = await published();
    const add = async (domain: string, as = cookie, to = base) => {
      const res = await call(app, 'POST', to, { cookie: as, body: { domain } });
      return { status: res.status, body: (await res.json()) as { error?: { details?: { domain?: string } } } };
    };
    expect((await add('not a domain')).body.error?.details?.domain).toBe('invalid');
    expect((await add('localhost')).body.error?.details?.domain).toBe('invalid');
    expect((await add('127.0.0.1')).body.error?.details?.domain).toBe('invalid');

    const first = await json<{ domain: ProjectDomain }>(await call(app, 'POST', base, { cookie, body: { domain: 'taken.example.com' } }));
    setTxtResolverForTests(async () => [[first.domain.txtValue]]);
    await call(app, 'POST', `${base}/verify`, { cookie, body: { domain: 'taken.example.com' } });

    const other = await signup(app);
    const theirs = await createProject(app, other.cookie, { name: 'Other' });
    const clash = await add('taken.example.com', other.cookie, `/api/projects/${theirs.id}/domains`);
    expect(clash.status).toBe(409);
    expect(clash.body.error?.details?.domain).toBe('taken');
    expect((await call(app, 'GET', base, { cookie: other.cookie })).status).toBe(404);
  });
});
