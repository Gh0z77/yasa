// The user's own Supabase account: connected once, then the AI creates a backend for an app and Yasa runs its SQL.
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent, ChatMessage, MessagePart, ProjectDetailResponse, SupabaseAccount, SupabaseStatus } from '../../shared/types';
import { buildSystemPrompt } from '../../server/ai/prompt';
import { setProviderForTests } from '../../server/ai/registry';
import type { Provider } from '../../server/ai/providers/types';
import { run } from '../../server/db';
import { setSupabaseFetchForTests } from '../../server/services/supabase';
import { call, chat, createProject, json, setupTestApp, signup } from './helpers';

const TOKEN = 'sbp_account_0123456789abcdef0123456789';
const NEW_REF = 'newprojectref0000001';
const OLD_REF = 'oldprojectref0000002';

/** A fake Supabase Management API for one account. */
function fakeAccount(options: { limit?: boolean; failSql?: string; startingPolls?: number; token?: string } = {}) {
  const queries: string[] = [];
  const created: Array<Record<string, unknown>> = [];
  const tokenRequests: Array<Record<string, string>> = [];
  let keyPolls = 0;
  let token = options.token ?? TOKEN;
  setSupabaseFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url === 'https://api.supabase.com/v1/oauth/token') {
      const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
      tokenRequests.push(form);
      if (new Headers(init?.headers).get('authorization') !== `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`) return reply(401, { message: 'bad client' });
      if (form.grant_type === 'authorization_code' && form.code === 'good-code' && form.code_verifier) {
        token = 'oauth-access-1';
        return reply(201, { access_token: token, refresh_token: 'refresh-1', expires_in: 3600, token_type: 'Bearer' });
      }
      if (form.grant_type === 'refresh_token' && form.refresh_token === 'refresh-1') {
        token = 'oauth-access-2';
        return reply(201, { access_token: token, refresh_token: 'refresh-2', expires_in: 3600, token_type: 'Bearer' });
      }
      return reply(400, { message: 'invalid_grant' });
    }
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${token}`) return reply(401, { message: 'Unauthorized' });
    if (url === 'https://api.supabase.com/v1/organizations') return reply(200, [{ id: 'org-one', name: 'My org' }]);
    if (url === 'https://api.supabase.com/v1/projects' && method === 'GET') {
      return reply(200, [{ id: OLD_REF, name: 'Old app', region: 'ap-northeast-1', status: 'ACTIVE_HEALTHY', organization_id: 'org-one' }]);
    }
    if (url === 'https://api.supabase.com/v1/projects' && method === 'POST') {
      if (options.limit) return reply(402, { message: 'The following organization members have reached their maximum limits for the number of active free projects' });
      created.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return reply(201, { id: NEW_REF, name: 'Notes', region: 'eu-central-1', status: 'COMING_UP' });
    }
    const keys = /^https:\/\/api\.supabase\.com\/v1\/projects\/([a-z0-9]+)\/api-keys$/.exec(url);
    if (keys) {
      // A new project hands out its keys only after it has started for a moment.
      if (keys[1] === NEW_REF && keyPolls++ < (options.startingPolls ?? 0)) return reply(503, { message: 'starting' });
      return reply(200, [{ name: 'anon', api_key: `anon-key-of-${keys[1]}` }, { name: 'service_role', api_key: 'never-used' }]);
    }
    if (/^https:\/\/api\.supabase\.com\/v1\/projects\/[a-z0-9]+$/.test(url)) return reply(200, { status: 'ACTIVE_HEALTHY' });
    if (/\/database\/query$/.test(url)) {
      const query = String((JSON.parse(String(init?.body)) as { query: string }).query);
      if (options.failSql && query.includes(options.failSql)) return reply(400, { message: 'syntax error at or near "tabel"' });
      queries.push(query);
      return reply(201, []);
    }
    return reply(404, { message: 'not found' });
  }) as typeof fetch);
  return { queries, created, tokenRequests };
}

/** A model that plays the given replies in order (the last one repeats). */
function scripted(replies: string[]): Provider & { prompts: string[] } {
  const provider = {
    id: 'gemini' as const,
    prompts: [] as string[],
    async *stream(req: { messages: Array<{ content: Array<{ text?: string }> }> }) {
      provider.prompts.push(req.messages[req.messages.length - 1]!.content.map((c) => c.text ?? '').join('\n'));
      yield { type: 'text' as const, delta: replies[Math.min(provider.prompts.length, replies.length) - 1]! };
      yield { type: 'stop' as const, reason: 'end' as const };
    },
    async test() {},
  };
  return provider as unknown as Provider & { prompts: string[] };
}

const write = (path: string, content: string) => `\n<yasa-write path="${path}">\n${content}\n</yasa-write>\n`;
const APP = `import { supabase } from "@/integrations/supabase/client";

export default function App() {
  return <main onClick={() => void supabase.from("notes").select("*")}>Notes</main>;
}`;
const done = (events: ChatEvent[]): ChatMessage => {
  const event = events.find((e) => e.type === 'done');
  if (!event || event.type !== 'done') throw new Error('no done event');
  return event.message;
};
const partsOf = (message: ChatMessage, type: MessagePart['type']) => message.parts.filter((p) => p.type === type);

afterEach(() => {
  setSupabaseFetchForTests(null);
  setProviderForTests('gemini', null);
});

describe('Supabase account', () => {
  it('connects with an access token, lists projects and never returns the token', async () => {
    const app = setupTestApp();
    fakeAccount();
    const { cookie } = await signup(app);

    expect(await json<SupabaseAccount>(await call(app, 'GET', '/api/me/supabase', { cookie }))).toEqual({ connected: false, canConnect: false, organizations: [], projects: [] });
    const bad = await call(app, 'PUT', '/api/me/supabase', { cookie, body: { accessToken: 'sbp_wrong_0123456789abcdef0123' } });
    expect(bad.status).toBe(400);

    const res = await call(app, 'PUT', '/api/me/supabase', { cookie, body: { accessToken: TOKEN } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    const account = JSON.parse(text) as SupabaseAccount;
    expect(account).toMatchObject({ connected: true, organizations: [{ id: 'org-one', name: 'My org' }] });
    expect(account.projects).toEqual([{ ref: OLD_REF, name: 'Old app', region: 'ap-northeast-1', status: 'ACTIVE_HEALTHY', organizationId: 'org-one', ready: true }]);

    expect((await call(app, 'DELETE', '/api/me/supabase', { cookie })).status).toBe(200);
    expect((await json<SupabaseAccount>(await call(app, 'GET', '/api/me/supabase', { cookie }))).connected).toBe(false);
  });

  it('links an existing project or creates a new one for an app', async () => {
    const app = setupTestApp();
    const fake = fakeAccount({ startingPolls: 1 });
    const { cookie } = await signup(app);
    await call(app, 'PUT', '/api/me/supabase', { cookie, body: { accessToken: TOKEN } });

    const first = await createProject(app, cookie, { name: 'First' });
    const linked = await json<SupabaseStatus>(await call(app, 'POST', `/api/projects/${first.id}/supabase/link`, { cookie, body: { ref: OLD_REF } }));
    expect(linked.connection).toMatchObject({ url: `https://${OLD_REF}.supabase.co`, canRunSql: true });
    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${first.id}`, { cookie }));
    expect(detail.files.find((f) => f.path === 'src/integrations/supabase/client.ts')?.content).toContain(`anon-key-of-${OLD_REF}`);

    const second = await createProject(app, cookie, { name: 'Second' });
    const created = await call(app, 'POST', `/api/projects/${second.id}/supabase/create`, { cookie, body: {} });
    expect(await created.json()).toMatchObject({ ref: NEW_REF, ready: false });
    expect(fake.created[0]).toMatchObject({ name: 'Second', organization_id: 'org-one', region: 'eu-central-1' });
    // still starting: the client is told to try again
    const early = await call(app, 'POST', `/api/projects/${second.id}/supabase/link`, { cookie, body: { ref: NEW_REF } });
    expect(early.status).toBe(400);
    expect(((await early.json()) as { error: { details: { supabase: string } } }).error.details.supabase).toBe('not_ready');
    expect((await call(app, 'POST', `/api/projects/${second.id}/supabase/link`, { cookie, body: { ref: NEW_REF } })).status).toBe(200);
  });

  it('explains the free-plan project limit', async () => {
    const app = setupTestApp();
    fakeAccount({ limit: true });
    const { cookie } = await signup(app);
    await call(app, 'PUT', '/api/me/supabase', { cookie, body: { accessToken: TOKEN } });
    const project = await createProject(app, cookie, { name: 'Third' });
    const res = await call(app, 'POST', `/api/projects/${project.id}/supabase/create`, { cookie, body: {} });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { details: { supabase: string } } }).error.details.supabase).toBe('project_limit');
  });
});

describe('a backend made by the AI', () => {
  const KEYS = { geminiApiKey: 'gemini-test-key', enableMockProvider: false };
  const MIGRATION = 'create table if not exists public.notes (id uuid primary key default gen_random_uuid(), body text);';

  it('is offered only when the account is connected and nothing is linked yet', () => {
    expect(buildSystemPrompt({ mode: 'build', backend: 'offer' })).toContain('<yasa-backend />');
    expect(buildSystemPrompt({ mode: 'build', backend: 'auto' })).toContain('Yasa runs new migrations on the database right after your reply');
    expect(buildSystemPrompt({ mode: 'build', backend: 'manual' })).toContain('apply it from the Supabase panel');
    expect(buildSystemPrompt({ mode: 'build' })).toContain('no backend connected');
  });

  it('creates the Supabase project, installs the client and runs the migrations without the user doing anything', async () => {
    const app = setupTestApp(KEYS);
    const fake = fakeAccount();
    const provider = scripted([`Notes with a database.\n<yasa-backend />${write('supabase/migrations/20260101000000_notes.sql', MIGRATION)}${write('src/App.tsx', APP)}`]);
    setProviderForTests('gemini', provider);
    const { cookie } = await signup(app);
    await call(app, 'PUT', '/api/me/supabase', { cookie, body: { accessToken: TOKEN } });
    const project = await createProject(app, cookie, { name: 'Notes' });

    const message = done(await chat(app, cookie, project.id, { message: 'A notes app that keeps notes in a database', model: 'gemini:gemini-flash-latest', skipQuestions: true }));

    expect(provider.prompts).toHaveLength(1);
    expect(message.status).toBe('done');
    expect(partsOf(message, 'backend')).toEqual([{ type: 'backend', status: 'ready', name: 'Notes', ref: NEW_REF }]);
    expect(partsOf(message, 'migrations')).toEqual([{ type: 'migrations', applied: ['supabase/migrations/20260101000000_notes.sql'], failed: null }]);
    expect(fake.queries.some((q) => q.includes('create table if not exists public.notes'))).toBe(true);
    const status = await json<SupabaseStatus>(await call(app, 'GET', `/api/projects/${project.id}/supabase`, { cookie }));
    expect(status.connection?.projectRef).toBe(NEW_REF);
    expect(status.migrations.every((m) => m.applied)).toBe(true);
  });

  it('sends a failing migration back to the model, which fixes it', async () => {
    const app = setupTestApp(KEYS);
    const fake = fakeAccount({ failSql: 'tabel' });
    const provider = scripted([
      `Here.${write('supabase/migrations/20260101000000_notes.sql', 'create tabel notes (id int);')}${write('src/App.tsx', APP)}`,
      `Fixed the SQL.${write('supabase/migrations/20260101000000_notes.sql', MIGRATION)}`,
    ]);
    setProviderForTests('gemini', provider);
    const { cookie } = await signup(app);
    await call(app, 'PUT', '/api/me/supabase', { cookie, body: { accessToken: TOKEN } });
    const project = await createProject(app, cookie, { name: 'Notes' });
    await call(app, 'POST', `/api/projects/${project.id}/supabase/link`, { cookie, body: { ref: OLD_REF } });

    const message = done(await chat(app, cookie, project.id, { message: 'Store notes', model: 'gemini:gemini-flash-latest', skipQuestions: true }));

    expect(provider.prompts).toHaveLength(2);
    expect(provider.prompts[1]).toContain('<failed_migration path="supabase/migrations/20260101000000_notes.sql">');
    expect(provider.prompts[1]).toContain('syntax error at or near');
    const runs = partsOf(message, 'migrations');
    expect(runs.map((p) => (p.type === 'migrations' ? Boolean(p.failed) : null))).toEqual([true, false]);
    expect(fake.queries.some((q) => q.includes('create table if not exists public.notes'))).toBe(true);
    expect(message.status).toBe('done');
  });

  it('tells the model to do without a backend when the project cannot be created', async () => {
    const app = setupTestApp(KEYS);
    fakeAccount({ limit: true });
    const provider = scripted([`Here.\n<yasa-backend />${write('src/App.tsx', APP)}`, `Without a database.${write('src/App.tsx', 'export default function App() {\n  return <main>Notes</main>;\n}')}`]);
    setProviderForTests('gemini', provider);
    const { cookie } = await signup(app);
    await call(app, 'PUT', '/api/me/supabase', { cookie, body: { accessToken: TOKEN } });
    const project = await createProject(app, cookie, { name: 'Notes' });

    const message = done(await chat(app, cookie, project.id, { message: 'A notes app', model: 'gemini:gemini-flash-latest', skipQuestions: true }));

    expect(partsOf(message, 'backend')[0]).toMatchObject({ status: 'failed' });
    expect(provider.prompts[1]).toContain('the Supabase backend could not be created');
    expect(message.status).toBe('done');
  });
});

describe('one-click connection (OAuth)', () => {
  const OAUTH = { supabaseOAuth: { clientId: 'client-id', clientSecret: 'client-secret' } };

  async function connected() {
    const app = setupTestApp(OAUTH);
    const fake = fakeAccount({ token: 'nobody-yet' });
    const { cookie } = await signup(app);
    const start = await call(app, 'POST', '/api/me/supabase/connect', { cookie, body: { returnTo: '/project/abc' } });
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const ticket = /yasa_sb_oauth=([^;]+)/.exec(start.headers.get('set-cookie') ?? '')?.[1];
    return { app, fake, cookie, url: new URL(url), ticket };
  }

  it('sends the user to Supabase and stores the account when they come back', async () => {
    const { app, fake, cookie, url, ticket } = await connected();
    expect(url.origin + url.pathname).toBe('https://api.supabase.com/v1/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-id',
      redirect_uri: 'http://localhost:3000/api/supabase/oauth/callback',
      response_type: 'code',
      code_challenge_method: 'S256',
    });
    expect(ticket).toBeTruthy();

    const back = await call(app, 'GET', `/api/supabase/oauth/callback?code=good-code&state=${url.searchParams.get('state')}`, { headers: { cookie: `yasa_sb_oauth=${ticket}` } });
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('http://localhost:3000/project/abc?supabase=connected');
    // the code was exchanged with the verifier whose hash was sent before
    expect(fake.tokenRequests[0]).toMatchObject({ grant_type: 'authorization_code', code: 'good-code', redirect_uri: 'http://localhost:3000/api/supabase/oauth/callback' });

    const account = await json<SupabaseAccount>(await call(app, 'GET', '/api/me/supabase', { cookie }));
    expect(account).toMatchObject({ connected: true, canConnect: true, organizations: [{ id: 'org-one', name: 'My org' }] });
  });

  it('refuses a callback without the matching ticket or state', async () => {
    const { app, cookie, url, ticket } = await connected();
    const forged = await call(app, 'GET', '/api/supabase/oauth/callback?code=good-code&state=other', { headers: { cookie: `yasa_sb_oauth=${ticket}` } });
    expect(forged.headers.get('location')).toContain('supabase=error');
    const noTicket = await call(app, 'GET', `/api/supabase/oauth/callback?code=good-code&state=${url.searchParams.get('state')}`);
    expect(noTicket.headers.get('location')).toBe('http://localhost:3000/settings?tab=integrations&supabase=error');
    expect((await json<SupabaseAccount>(await call(app, 'GET', '/api/me/supabase', { cookie }))).connected).toBe(false);
  });

  it('refreshes an expired token and runs a linked project\'s SQL with the account', async () => {
    const { app, fake, cookie, url, ticket } = await connected();
    await call(app, 'GET', `/api/supabase/oauth/callback?code=good-code&state=${url.searchParams.get('state')}`, { headers: { cookie: `yasa_sb_oauth=${ticket}` } });
    const project = await createProject(app, cookie, { name: 'Notes' });
    const linked = await json<SupabaseStatus>(await call(app, 'POST', `/api/projects/${project.id}/supabase/link`, { cookie, body: { ref: OLD_REF } }));
    expect(linked.connection?.canRunSql).toBe(true);

    // an hour later the access token has expired
    run("UPDATE supabase_accounts SET expires_at = '2000-01-01T00:00:00.000Z'");
    await call(app, 'PUT', `/api/projects/${project.id}/files`, { cookie, body: { path: 'supabase/migrations/20260101000000_notes.sql', content: 'create table if not exists notes (id int);' } });
    const applied = await call(app, 'POST', `/api/projects/${project.id}/supabase/migrations/apply`, { cookie });
    expect(((await applied.json()) as { applied: string[] }).applied).toEqual(['supabase/migrations/20260101000000_notes.sql']);
    expect(fake.tokenRequests.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-1' });
    expect(fake.queries.some((q) => q.includes('create table if not exists notes'))).toBe(true);
  });

  it('is not offered when the server has no OAuth app', async () => {
    const app = setupTestApp();
    const { cookie } = await signup(app);
    expect((await call(app, 'POST', '/api/me/supabase/connect', { cookie, body: {} })).status).toBe(400);
  });
});
