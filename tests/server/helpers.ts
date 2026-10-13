import type { Hono } from 'hono';
import { SESSION_COOKIE } from '../../shared/constants';
import type { ChatEvent, Project, User } from '../../shared/types';
import { resetModelHealth } from '../../server/ai/health';
import { createApp } from '../../server/app';
import { resetDbForTests } from '../../server/db';
import { setConfigForTests, type Config } from '../../server/env';
import { authLimiter } from '../../server/routes/auth';
import type { AppEnv } from '../../server/types';

export const ORIGIN = 'http://localhost:3000';

export function setupTestApp(overrides: Partial<Config> = {}): Hono<AppEnv> {
  setConfigForTests({ appUrl: ORIGIN, allowedOrigins: [ORIGIN], sandboxDomain: 'localhost:3000', dailyMessageLimit: 100, ...overrides });
  resetDbForTests();
  authLimiter.reset();
  resetModelHealth();
  return createApp();
}

export interface CallOptions {
  cookie?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export function call(app: Hono<AppEnv>, method: string, path: string, opts: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: string | FormData | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  return Promise.resolve(app.request(`${ORIGIN}${path}`, { method, headers, body }));
}

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let counter = 0;

export async function signup(app: Hono<AppEnv>, email?: string): Promise<{ cookie: string; user: User }> {
  counter += 1;
  const res = await call(app, 'POST', '/api/auth/signup', {
    body: { name: `User ${counter}`, email: email ?? `user${counter}-${Date.now()}@example.com`, password: 'correct-horse-battery' },
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookie);
  if (!match) throw new Error('no session cookie');
  const { user } = await json<{ user: User }>(res);
  return { cookie: `${SESSION_COOKIE}=${match[1]}`, user };
}

export async function createProject(app: Hono<AppEnv>, cookie: string, body: Record<string, unknown> = {}): Promise<Project> {
  const res = await call(app, 'POST', '/api/projects', { cookie, body });
  if (res.status !== 201) throw new Error(`create project failed: ${res.status} ${await res.text()}`);
  return (await json<{ project: Project }>(res)).project;
}

/** Reads an SSE response to the end and returns the parsed events. */
export async function readEvents(res: Response): Promise<ChatEvent[]> {
  const text = await res.text();
  const events: ChatEvent[] = [];
  for (const block of text.split('\n\n')) {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (data) events.push(JSON.parse(data) as ChatEvent);
  }
  return events;
}

export async function chat(app: Hono<AppEnv>, cookie: string, projectId: string, body: Record<string, unknown>): Promise<ChatEvent[]> {
  const res = await call(app, 'POST', `/api/projects/${projectId}/chat`, { cookie, body: { model: 'mock:demo', ...body } });
  if (res.status !== 200) throw new Error(`chat failed: ${res.status} ${await res.text()}`);
  return readEvents(res);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
