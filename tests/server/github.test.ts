import { afterEach, describe, expect, it } from 'vitest';
import type { GithubConnectionResponse, GithubProjectResponse, GithubPushResult } from '../../shared/types';
import { githubLimiter } from '../../server/routes/github';
import { setGithubFetchForTests } from '../../server/services/github';
import { call, chat, createProject, json, setupTestApp, signup } from './helpers';

const TOKEN = 'github_pat_test_token_0123456789';

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

interface FakeRepo {
  /** branch → commit sha; a repository without branches is empty */
  branches: Map<string, string>;
  commits: Array<{ sha: string; tree: string; message: string; parents: string[] }>;
}

/** An in-memory stand-in for the parts of the GitHub REST API the sync uses. */
function fakeGithub(options: { login?: string; existingRepos?: string[]; emptyRepos?: string[]; canCreate?: boolean } = {}) {
  const login = options.login ?? 'octo';
  const calls: Call[] = [];
  const repos = new Map<string, FakeRepo>();
  for (const name of options.existingRepos ?? []) repos.set(`${login}/${name}`, { branches: new Map([['main', 'c0']]), commits: [] });
  for (const name of options.emptyRepos ?? []) repos.set(`${login}/${name}`, { branches: new Map(), commits: [] });
  const blobs = new Map<string, { content: string; encoding: string }>();
  const trees = new Map<string, Array<{ path: string; sha: string }>>();
  let counter = 0;
  const id = (prefix: string) => `${prefix}${++counter}`;
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

  setGithubFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== `Bearer ${TOKEN}`) return reply(401, { message: 'Bad credentials' });

    if (method === 'GET' && url.pathname === '/user') return reply(200, { login });
    if (method === 'POST' && url.pathname === '/user/repos') {
      if (options.canCreate === false) return reply(403, { message: 'Resource not accessible by personal access token' });
      const full = `${login}/${String(body?.name)}`;
      if (repos.has(full)) return reply(422, { message: 'name already exists on this account' });
      repos.set(full, { branches: new Map([['main', 'c0']]), commits: [] });
      return reply(201, { full_name: full, default_branch: 'main' });
    }
    const match = /^\/repos\/([^/]+\/[^/]+)(?:\/(.+))?$/.exec(url.pathname);
    const repo = match ? repos.get(match[1]!) : undefined;
    if (!match || !repo) return reply(404, { message: 'Not Found' });
    const full = match[1]!;
    const rest = match[2] ?? '';
    if (method === 'GET' && rest === '') return reply(200, { full_name: full, default_branch: 'main' });
    if (method === 'PUT' && rest === 'contents/README.md') {
      repo.branches.set('main', 'c0');
      return reply(201, { content: { path: 'README.md' } });
    }
    const ref = /^git\/refs?\/heads\/(.+)$/.exec(rest);
    if (method === 'GET' && ref) {
      if (repo.branches.size === 0) return reply(409, { message: 'Git Repository is empty.' });
      const sha = repo.branches.get(decodeURIComponent(ref[1]!));
      return sha ? reply(200, { object: { sha } }) : reply(404, { message: 'Not Found' });
    }
    if (method === 'PATCH' && ref) {
      repo.branches.set(decodeURIComponent(ref[1]!), String(body?.sha));
      return reply(200, { object: { sha: body?.sha } });
    }
    if (method === 'POST' && rest === 'git/refs') {
      repo.branches.set(String(body?.ref).replace('refs/heads/', ''), String(body?.sha));
      return reply(201, { ref: body?.ref });
    }
    if (method === 'POST' && rest === 'git/blobs') {
      const sha = id('b');
      blobs.set(sha, { content: String(body?.content), encoding: String(body?.encoding) });
      return reply(201, { sha });
    }
    if (method === 'POST' && rest === 'git/trees') {
      const sha = id('t');
      trees.set(sha, body?.tree as Array<{ path: string; sha: string }>);
      return reply(201, { sha });
    }
    if (method === 'POST' && rest === 'git/commits') {
      const sha = id('c');
      repo.commits.push({ sha, tree: String(body?.tree), message: String(body?.message), parents: body?.parents as string[] });
      return reply(201, { sha, html_url: `https://github.com/${full}/commit/${sha}` });
    }
    return reply(404, { message: 'Not Found' });
  }) as typeof fetch);

  return {
    calls,
    repos,
    /** path → content of the tree a branch points at */
    files(full: string, branch = 'main'): Record<string, string> {
      const repo = repos.get(full)!;
      const commit = repo.commits.find((c) => c.sha === repo.branches.get(branch))!;
      return Object.fromEntries(trees.get(commit.tree)!.map((entry) => [entry.path, blobs.get(entry.sha)!.content]));
    },
  };
}

async function connected(options: Parameters<typeof fakeGithub>[0] = {}, projectName = 'Shop') {
  const app = setupTestApp();
  const github = fakeGithub(options);
  const { cookie } = await signup(app);
  const project = await createProject(app, cookie, { name: projectName });
  await call(app, 'PUT', '/api/me/github', { cookie, body: { token: TOKEN } });
  const push = (body: Record<string, unknown> = {}) => call(app, 'POST', `/api/projects/${project.id}/github/push`, { cookie, body });
  return { app, github, cookie, project, push };
}

afterEach(() => {
  setGithubFetchForTests(null);
  githubLimiter.reset();
});

describe('GitHub sync', () => {
  it('connects an account with a valid token and never returns the token', async () => {
    const app = setupTestApp();
    fakeGithub({ login: 'gh0z77' });
    const { cookie } = await signup(app);

    const res = await call(app, 'PUT', '/api/me/github', { cookie, body: { token: TOKEN } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect((JSON.parse(text) as GithubConnectionResponse).connection?.login).toBe('gh0z77');

    const status = await json<GithubConnectionResponse>(await call(app, 'GET', '/api/me/github', { cookie }));
    expect(status.connection?.login).toBe('gh0z77');

    expect((await call(app, 'DELETE', '/api/me/github', { cookie })).status).toBe(200);
    expect((await json<GithubConnectionResponse>(await call(app, 'GET', '/api/me/github', { cookie }))).connection).toBeNull();
  });

  it('rejects a token GitHub does not accept', async () => {
    const app = setupTestApp();
    fakeGithub();
    const { cookie } = await signup(app);
    const res = await call(app, 'PUT', '/api/me/github', { cookie, body: { token: 'github_pat_wrong_token_000000000' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { details: { github: 'token_invalid' } } });
  });

  it('creates a private repository on the first push and commits on top of it afterwards', async () => {
    const { app, github, cookie, project, push } = await connected({}, 'Coffee Shop');
    await chat(app, cookie, project.id, { message: 'Coffee shop landing page' });

    const before = await json<GithubProjectResponse>(await call(app, 'GET', `/api/projects/${project.id}/github`, { cookie }));
    expect(before).toMatchObject({ connection: { login: 'octo' }, link: null });
    expect(before.suggestedRepo).toMatch(/^[a-z0-9-]+$/);

    const first = await push({ repo: 'coffee-shop' });
    expect(first.status).toBe(200);
    const pushed = await json<GithubPushResult>(first);
    expect(pushed.created).toBe(true);
    expect(pushed.link).toMatchObject({ repo: 'octo/coffee-shop', branch: 'main', url: 'https://github.com/octo/coffee-shop' });
    expect(github.calls.find((c) => c.path === '/user/repos')?.body).toMatchObject({ name: 'coffee-shop', private: true, auto_init: true });

    const tree = github.files('octo/coffee-shop');
    expect(Object.keys(tree)).toContain('package.json');
    expect(Object.keys(tree)).toContain('src/App.tsx');
    expect(Object.keys(tree).length).toBe(pushed.files);
    // The commit sits on top of the repository's initial commit.
    expect(github.repos.get('octo/coffee-shop')!.commits[0]).toMatchObject({ parents: ['c0'] });

    // A file removed in the project disappears from the next commit, and no second repository is created.
    expect((await call(app, 'POST', `/api/projects/${project.id}/files/delete`, { cookie, body: { path: 'README.md' } })).status).toBe(200);
    const second = await json<GithubPushResult>(await push());
    expect(second.created).toBe(false);
    expect(github.calls.filter((c) => c.path === '/user/repos')).toHaveLength(1);
    expect(github.repos.get('octo/coffee-shop')!.commits).toHaveLength(2);
    expect(second.link.lastCommitUrl).toContain('/octo/coffee-shop/commit/');
    expect(Object.keys(github.files('octo/coffee-shop'))).not.toContain('README.md');
  });

  it('reuses an existing repository on a branch of its own, leaving the default branch alone', async () => {
    const { github, push } = await connected({ existingRepos: ['shop'] });
    const res = await push({ repo: 'shop' });
    expect(res.status).toBe(200);
    const pushed = await json<GithubPushResult>(res);
    expect(pushed.created).toBe(false);
    expect(pushed.link).toMatchObject({ repo: 'octo/shop', branch: 'yasa', url: 'https://github.com/octo/shop/tree/yasa' });
    const repo = github.repos.get('octo/shop')!;
    expect(repo.branches.get('main')).toBe('c0');
    expect(repo.commits[0]).toMatchObject({ parents: ['c0'] });
    expect(Object.keys(github.files('octo/shop', 'yasa'))).toContain('package.json');
    expect(github.calls.some((c) => c.path === '/user/repos')).toBe(false);
  });

  it('gives an empty repository its first commit before pushing', async () => {
    const { github, push } = await connected({ emptyRepos: ['blank'] });
    const res = await push({ repo: 'blank' });
    expect(res.status).toBe(200);
    expect(github.calls.some((c) => c.method === 'PUT' && c.path.endsWith('/contents/README.md'))).toBe(true);
    expect(Object.keys(github.files('octo/blank', 'yasa'))).toContain('src/App.tsx');
  });

  it('explains what to do when the token cannot create repositories', async () => {
    const { app, cookie, project, push } = await connected({ canCreate: false });
    const res = await push({ repo: 'brand-new' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { details: { github: 'cannot_create' } } });
    expect((await json<GithubProjectResponse>(await call(app, 'GET', `/api/projects/${project.id}/github`, { cookie }))).link).toBeNull();
  });

  it('requires a connection and ownership', async () => {
    const app = setupTestApp();
    fakeGithub();
    const owner = await signup(app);
    const other = await signup(app);
    const project = await createProject(app, owner.cookie, { name: 'Mine' });

    const unconnected = await call(app, 'POST', `/api/projects/${project.id}/github/push`, { cookie: owner.cookie, body: { repo: 'mine' } });
    expect(unconnected.status).toBe(400);
    expect(await unconnected.json()).toMatchObject({ error: { details: { github: 'not_connected' } } });

    await call(app, 'PUT', '/api/me/github', { cookie: other.cookie, body: { token: TOKEN } });
    const foreign = await call(app, 'POST', `/api/projects/${project.id}/github/push`, { cookie: other.cookie, body: { repo: 'mine' } });
    expect([403, 404]).toContain(foreign.status);
    expect((await call(app, 'GET', '/api/me/github')).status).toBe(401);
  });

  it('refuses unsafe repository names', async () => {
    const { push } = await connected();
    expect((await push({ repo: '../evil/repo' })).status).toBe(400);
  });
});
