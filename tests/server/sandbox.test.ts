import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { ApiErrorBody, BuildSummary, Project, PublishResponse, SlugAvailabilityResponse } from '../../shared/types';
import { versionPreviewUrl } from '../../shared/paths';
import type { AppEnv } from '../../server/types';
import { call, chat, createProject, json, setupTestApp, signup } from './helpers';

let app: Hono<AppEnv>;

beforeEach(() => {
  app = setupTestApp();
});

/** Sandbox hosts are reached through the Host header (Node cannot resolve *.localhost on Windows). */
function onHost(host: string, path = '/', headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(app.request(`http://${host}${path}`, { headers: { host, ...headers } }));
}

function hostOf(url: string): string {
  return new URL(url).host;
}

describe('preview hosts', () => {
  it('serves the built app on the preview subdomain with framing limited to the builder', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const res = await onHost(hostOf(project.previewUrl));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toBe('frame-ancestors http://localhost:3000');
    const html = await res.text();
    expect(html).toContain('<script type="importmap">');
    expect(html).toContain('https://esm.sh/react');
    expect(html).toContain('yasa-preview'); // runtime bridge present in drafts
  });

  it('falls back to the app for client-side routes and 404s for missing files', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const host = hostOf(project.previewUrl);
    expect((await onHost(host, '/pricing/pro')).status).toBe(200);
    expect((await onHost(host, '/missing.png')).status).toBe(404);
    // encoded traversal never reaches files outside public/
    expect((await onHost(host, '/..%2fsrc/App.tsx')).status).toBe(404);
    expect((await onHost(host, '/src/App.tsx')).status).toBe(404);
  });

  it('serves files from public/', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    await call(app, 'PUT', `/api/projects/${project.id}/files`, { cookie, body: { path: 'public/robots.txt', content: 'User-agent: *\n' } });
    const res = await onHost(hostOf(project.previewUrl), '/robots.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('User-agent: *\n');
  });

  it('never exposes the API or sessions on sandbox hosts', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const host = hostOf(project.previewUrl);
    const res = await onHost(host, '/api/projects', { cookie });
    expect(res.headers.get('content-type')).toContain('text/html'); // the generated app, not JSON
    const post = await app.request(`http://${host}/api/auth/logout`, { method: 'POST', headers: { host, cookie } });
    expect(post.status).toBe(405);
  });

  it('returns a 404 page for unknown tokens and nested subdomains', async () => {
    expect((await onHost('pv-aaaaaaaaaaaaaaaaaaaa.localhost:3000')).status).toBe(404);
    expect((await onHost('pv-short.localhost:3000')).status).toBe(404);
    expect((await onHost('a.b.localhost:3000')).status).toBe(404);
  });

  it('shows an error page (still 200, with the bridge) when the build is broken', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    await call(app, 'PUT', `/api/projects/${project.id}/files`, { cookie, body: { path: 'src/App.tsx', content: 'export default function App() { return <div> }' } });
    const build = await json<BuildSummary>(await call(app, 'GET', `/api/projects/${project.id}/build`, { cookie }));
    expect(build.ok).toBe(false);
    expect(build.errors[0].file).toBe('src/App.tsx');
    const res = await onHost(hostOf(project.previewUrl));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('src/App.tsx');
  });

  it('previews an older version on the --v<N> host', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    await chat(app, cookie, project.id, { message: 'Bakery landing page' });
    const current = await (await onHost(hostOf(project.previewUrl))).text();
    const v1 = await (await onHost(hostOf(versionPreviewUrl(project.previewUrl, 1)))).text();
    expect(current).toContain('Bakery landing page');
    expect(v1).not.toContain('Bakery landing page');
    expect((await onHost(hostOf(versionPreviewUrl(project.previewUrl, 99)))).status).toBe(404);
  });

  it('invalidates the old preview link when the token is rotated', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const rotated = await json<{ previewUrl: string }>(await call(app, 'POST', `/api/projects/${project.id}/preview-token`, { cookie }));
    expect(rotated.previewUrl).not.toBe(project.previewUrl);
    expect((await onHost(hostOf(project.previewUrl))).status).toBe(404);
    expect((await onHost(hostOf(rotated.previewUrl))).status).toBe(200);
  });
});

describe('publishing', () => {
  it('publishes to a slug host without the bridge, updates, and unpublishes', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Choyxona' });
    await chat(app, cookie, project.id, { message: 'Tea house menu' });

    const available = await json<SlugAvailabilityResponse>(await call(app, 'GET', '/api/slug-available?slug=choyxona', { cookie }));
    expect(available.available).toBe(true);

    const res = await call(app, 'POST', `/api/projects/${project.id}/publish`, { cookie, body: { slug: 'choyxona' } });
    expect(res.status).toBe(200);
    const published = await json<PublishResponse>(res);
    expect(published.publish.url).toBe('http://choyxona.localhost:3000/');
    expect(published.project.publishedVersionNumber).toBe(published.project.currentVersionNumber);

    const live = await onHost('choyxona.localhost:3000');
    expect(live.status).toBe(200);
    expect(live.headers.get('content-security-policy')).toBe('frame-ancestors *');
    const html = await live.text();
    expect(html).toContain('Tea house menu');
    expect(html).not.toContain('yasa-preview');
    expect(html).toContain('rel="icon"');
    const etag = live.headers.get('etag')!;
    expect((await onHost('choyxona.localhost:3000', '/', { 'if-none-match': etag })).status).toBe(304);

    // later edits do not go live until the next publish
    await chat(app, cookie, project.id, { message: 'Add opening hours' });
    expect(await (await onHost('choyxona.localhost:3000')).text()).not.toContain('Section1');
    await call(app, 'POST', `/api/projects/${project.id}/publish`, { cookie, body: { slug: 'choyxona' } });
    expect(await (await onHost('choyxona.localhost:3000')).text()).toContain('Add opening hours');

    const un = await json<{ project: Project }>(await call(app, 'DELETE', `/api/projects/${project.id}/publish`, { cookie }));
    expect(un.project.publishedUrl).toBeNull();
    expect((await onHost('choyxona.localhost:3000')).status).toBe(404);
  });

  it('rejects invalid, reserved and taken slugs', async () => {
    const a = await signup(app);
    const b = await signup(app);
    const pa = await createProject(app, a.cookie);
    const pb = await createProject(app, b.cookie);
    for (const slug of ['ab', 'pv-test', 'admin', 'Has Space', '-lead']) {
      const res = await call(app, 'POST', `/api/projects/${pa.id}/publish`, { cookie: a.cookie, body: { slug } });
      expect(res.status, slug).toBe(400);
    }
    expect((await call(app, 'POST', `/api/projects/${pa.id}/publish`, { cookie: a.cookie, body: { slug: 'mine' } })).status).toBe(200);
    expect((await call(app, 'POST', `/api/projects/${pb.id}/publish`, { cookie: b.cookie, body: { slug: 'mine' } })).status).toBe(409);
    const taken = await json<SlugAvailabilityResponse>(await call(app, 'GET', '/api/slug-available?slug=mine', { cookie: b.cookie }));
    expect(taken.available).toBe(false);
    const own = await json<SlugAvailabilityResponse>(await call(app, 'GET', `/api/slug-available?slug=mine&projectId=${pa.id}`, { cookie: a.cookie }));
    expect(own.available).toBe(true);
  });

  it('refuses to publish a project that does not build and lists the errors', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    await call(app, 'PUT', `/api/projects/${project.id}/files`, { cookie, body: { path: 'src/App.tsx', content: 'export default function App() { return <div> }' } });
    const res = await call(app, 'POST', `/api/projects/${project.id}/publish`, { cookie, body: { slug: 'broken-app' } });
    expect(res.status).toBe(400);
    const body = await json<ApiErrorBody>(res);
    expect((body.error.details as { errors: unknown[] }).errors.length).toBeGreaterThan(0);
    expect((await onHost('broken-app.localhost:3000')).status).toBe(404);
  });
});
