// What a hosted (serverless) deployment does differently: Postgres SQL, apps on one shared sandbox host,
// generations that may run on another instance.
import { describe, expect, it } from 'vitest';
import type { ChatEvent, ChatMessage, Project, PublishResponse } from '../../shared/types';
import { versionPreviewUrl } from '../../shared/paths';
import { remoteGeneration } from '../../server/ai/jobs';
import { ddlToPg, toPg } from '../../server/db/dialect';
import { run } from '../../server/db';
import { loadConfig } from '../../server/env';
import { builderCsp } from '../../server/middleware/security';
import { createMessage, markStreamingMessagesInterrupted, updateMessage } from '../../server/services/messages';
import { call, chat, createProject, json, readEvents, setupTestApp, signup } from './helpers';

const PATH_MODE = { sandboxMode: 'path' as const, sandboxDomain: 'sites.localhost:3000' };

describe('SQL for Postgres', () => {
  it('numbers the parameters and leaves string literals alone', () => {
    expect(toPg("SELECT * FROM t WHERE a = ? AND b = 'what?' AND c = ?")).toBe("SELECT * FROM t WHERE a = $1 AND b = 'what?' AND c = $2");
  });

  it('translates the few SQLite-only forms the server uses', () => {
    expect(toPg('INSERT OR IGNORE INTO blobs (hash, content) VALUES (?, ?)')).toBe('INSERT INTO blobs (hash, content) VALUES ($1, $2) ON CONFLICT DO NOTHING');
    expect(toPg('SELECT 1 FROM projects WHERE name LIKE ?')).toBe('SELECT 1 FROM projects WHERE name ILIKE $1');
    expect(toPg('INSERT INTO t (a) VALUES (?) ON CONFLICT(a) DO UPDATE SET a = excluded.a')).toBe('INSERT INTO t (a) VALUES ($1) ON CONFLICT(a) DO UPDATE SET a = excluded.a');
  });

  it('rewrites the schema: byte-wise text, no NOCASE, bytea for blobs', () => {
    expect(ddlToPg('CREATE TABLE u (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, n INTEGER, data BLOB NOT NULL);')).toBe(
      'CREATE TABLE u (id TEXT COLLATE "C" PRIMARY KEY, email TEXT COLLATE "C" NOT NULL UNIQUE, n INTEGER, data BYTEA NOT NULL);',
    );
  });
});

describe('hosted configuration', () => {
  it('takes its defaults from the Vercel environment and needs a secret', () => {
    const env = { NODE_ENV: 'production', VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'yasa.vercel.app', DATABASE_URL: 'postgresql://u:p@host:5432/postgres' };
    expect(() => loadConfig(env)).toThrow(/APP_SECRET/);
    const config = loadConfig({ ...env, APP_SECRET: 'x'.repeat(40), SANDBOX_DOMAIN: 'yasa-sites.vercel.app', SANDBOX_MODE: 'path' });
    expect(config).toMatchObject({
      hosted: true,
      appUrl: 'https://yasa.vercel.app',
      sandboxMode: 'path',
      sandboxProtocol: 'https',
      trustProxy: true,
      generationTimeLimitMs: 270_000,
      databaseUrl: 'postgresql://u:p@host:5432/postgres',
    });
    // a server with a disk keeps its old behaviour
    expect(loadConfig({ NODE_ENV: 'production', APP_SECRET: 'x'.repeat(40) })).toMatchObject({ hosted: false, sandboxMode: 'subdomain', generationTimeLimitMs: 0, databaseUrl: null });
  });
});

describe('apps on one shared sandbox host', () => {
  const onHost = (app: ReturnType<typeof setupTestApp>, host: string, path: string, headers: Record<string, string> = {}) =>
    Promise.resolve(app.request(`http://${host}${path}`, { headers: { host, ...headers } }));

  it('serves a preview under its label, fixes the address and remembers the app for absolute URLs', async () => {
    const app = setupTestApp(PATH_MODE);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    expect(project.previewUrl).toMatch(/^http:\/\/sites\.localhost:3000\/~pv-[a-z2-7]{20}\/$/);
    expect(versionPreviewUrl(project.previewUrl, 3)).toBe(`${project.previewUrl.slice(0, -1)}--v3/`);
    expect(builderCsp()).toContain('frame-src http://sites.localhost:3000');
    await call(app, 'PUT', `/api/projects/${project.id}/files`, { cookie, body: { path: 'public/robots.txt', content: 'User-agent: *\n' } });

    const label = new URL(project.previewUrl).pathname.slice(2, -1);
    const page = await onHost(app, 'sites.localhost:3000', `/~${label}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toBe('frame-ancestors http://localhost:3000');
    expect(page.headers.get('set-cookie')).toBe(`yasa_site=${label}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`);
    const html = await page.text();
    // the address fix runs before anything else in the page
    expect(html.indexOf('history.replaceState')).toBeGreaterThan(-1);
    expect(html.indexOf('history.replaceState')).toBeLessThan(html.indexOf('<script type="importmap">'));

    // a file under the label, and the same file by its absolute URL once the tab is known by its cookie
    expect(await (await onHost(app, 'sites.localhost:3000', `/~${label}/robots.txt`)).text()).toBe('User-agent: *\n');
    expect(await (await onHost(app, 'sites.localhost:3000', '/robots.txt', { cookie: `yasa_site=${label}` })).text()).toBe('User-agent: *\n');
    // a client-side route after the prefix was dropped (a reload of /pricing)
    expect((await onHost(app, 'sites.localhost:3000', '/pricing', { cookie: `yasa_site=${label}` })).status).toBe(200);

    // without a label nothing is served, the API is not reachable there, and the builder host serves no apps
    expect((await onHost(app, 'sites.localhost:3000', '/')).status).toBe(404);
    expect((await onHost(app, 'sites.localhost:3000', '/api/models')).status).toBe(404);
    expect((await onHost(app, 'sites.localhost:3000', '/~pv-aaaaaaaaaaaaaaaaaaaa/')).status).toBe(404);
    expect((await onHost(app, 'localhost:3000', `/~${label}/robots.txt`)).headers.get('content-type') ?? '').not.toContain('text/plain');
  });

  it('publishes to a path on the shared host', async () => {
    const app = setupTestApp(PATH_MODE);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Choyxona' });
    await chat(app, cookie, project.id, { message: 'Tea house menu' });
    const published = await json<PublishResponse>(await call(app, 'POST', `/api/projects/${project.id}/publish`, { cookie, body: { slug: 'choyxona' } }));
    expect(published.publish.url).toBe('http://sites.localhost:3000/~choyxona/');
    const live = await onHost(app, 'sites.localhost:3000', '/~choyxona/');
    expect(live.status).toBe(200);
    expect(await live.text()).toContain('Tea house menu');
  });
});

describe('generations on another instance', () => {
  const HOSTED = { hosted: true, generationTimeLimitMs: 270_000 };

  function running(project: Project, parts: ChatMessage['parts'] = []): ChatMessage {
    createMessage({ projectId: project.id, role: 'user', content: 'Build it', mode: 'build', status: 'done' });
    const message = createMessage({ projectId: project.id, role: 'assistant', content: '', mode: 'build', status: 'streaming', model: 'mock:demo' });
    return parts.length ? updateMessage(message.id, { parts }) : message;
  }

  it('is known from the database, blocks a second one and can be followed until it ends', async () => {
    const app = setupTestApp(HOSTED);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    expect(remoteGeneration(project.id)).toBeNull();
    const message = running(project, [{ type: 'text', text: 'Working on it' }]);
    expect(remoteGeneration(project.id)?.id).toBe(message.id);

    const second = await call(app, 'POST', `/api/projects/${project.id}/chat`, { cookie, body: { message: 'Another one' } });
    expect(second.status).toBe(409);

    const stream = await call(app, 'GET', `/api/projects/${project.id}/chat/active`, { cookie });
    expect(stream.status).toBe(200);
    // the other instance finishes while this one is watching
    setTimeout(() => updateMessage(message.id, { status: 'done', content: 'Done', parts: [{ type: 'text', text: 'Done' }] }), 300);
    const events: ChatEvent[] = await readEvents(stream);
    expect(events.map((e) => e.type)).toEqual(['snapshot', 'files_changed', 'done']);
    const first = events[0]!;
    expect(first.type === 'snapshot' && first.userMessage?.content).toBe('Build it');
    const last = events[2]!;
    expect(last.type === 'done' && last.message.status).toBe('done');
    expect(remoteGeneration(project.id)).toBeNull();
  });

  it('only gives up on generations older than any request can last', async () => {
    const app = setupTestApp(HOSTED);
    const { cookie } = await signup(app);
    const fresh = running(await createProject(app, cookie));
    const old = running(await createProject(app, cookie));
    run('UPDATE messages SET created_at = ? WHERE id = ?', new Date(Date.now() - 20 * 60_000).toISOString(), old.id);

    expect(markStreamingMessagesInterrupted(7 * 60_000)).toBe(1);
    expect(remoteGeneration(fresh.projectId)?.id).toBe(fresh.id);
    expect(remoteGeneration(old.projectId)).toBeNull();
    // a single server that restarted knows that everything unfinished is dead
    expect(markStreamingMessagesInterrupted(0)).toBe(1);
  });

  it('does not exist on a server with a disk', async () => {
    const app = setupTestApp();
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    running(project);
    expect(remoteGeneration(project.id)).toBeNull();
    expect((await call(app, 'GET', `/api/projects/${project.id}/chat/active`, { cookie })).status).toBe(204);
  });
});
