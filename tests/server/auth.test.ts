import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { ApiErrorBody, ApiKeyInfo, ModelsResponse, UsageSummary, User } from '../../shared/types';
import type { AppEnv } from '../../server/types';
import { call, json, ORIGIN, setupTestApp, signup } from './helpers';

let app: Hono<AppEnv>;

beforeEach(() => {
  app = setupTestApp();
});

describe('auth', () => {
  it('signs up, returns the user and sets a host-only httpOnly cookie', async () => {
    const res = await call(app, 'POST', '/api/auth/signup', {
      body: { name: 'Aziza', email: 'Aziza@Example.com', password: 'correct-horse-battery' },
    });
    expect(res.status).toBe(201);
    const { user } = await json<{ user: User }>(res);
    expect(user.email).toBe('aziza@example.com');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('rejects duplicate emails, weak passwords and bad emails', async () => {
    await signup(app, 'dup@example.com');
    const dup = await call(app, 'POST', '/api/auth/signup', { body: { name: 'X', email: 'DUP@example.com', password: 'correct-horse-battery' } });
    expect(dup.status).toBe(409);
    const weak = await call(app, 'POST', '/api/auth/signup', { body: { name: 'X', email: 'weak@example.com', password: 'short' } });
    expect(weak.status).toBe(400);
    expect((await json<ApiErrorBody>(weak)).error.code).toBe('validation_error');
    const bad = await call(app, 'POST', '/api/auth/signup', { body: { name: 'X', email: 'not-an-email', password: 'correct-horse-battery' } });
    expect(bad.status).toBe(400);
  });

  it('logs in with the right password only and gives a generic error otherwise', async () => {
    await signup(app, 'login@example.com');
    const wrong = await call(app, 'POST', '/api/auth/login', { body: { email: 'login@example.com', password: 'nope-nope-nope' } });
    const unknown = await call(app, 'POST', '/api/auth/login', { body: { email: 'ghost@example.com', password: 'nope-nope-nope' } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await json<ApiErrorBody>(wrong)).error.message).toBe((await json<ApiErrorBody>(unknown)).error.message);
    const ok = await call(app, 'POST', '/api/auth/login', { body: { email: 'login@example.com', password: 'correct-horse-battery' } });
    expect(ok.status).toBe(200);
  });

  it('me returns null without a session and the user with one; logout ends the session', async () => {
    const anon = await json<{ user: User | null }>(await call(app, 'GET', '/api/auth/me'));
    expect(anon.user).toBeNull();
    const { cookie, user } = await signup(app);
    const me = await json<{ user: User | null }>(await call(app, 'GET', '/api/auth/me', { cookie }));
    expect(me.user?.id).toBe(user.id);
    await call(app, 'POST', '/api/auth/logout', { cookie });
    const after = await json<{ user: User | null }>(await call(app, 'GET', '/api/auth/me', { cookie }));
    expect(after.user).toBeNull();
  });

  it('rate limits repeated login attempts', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await call(app, 'POST', '/api/auth/login', { body: { email: 'a@example.com', password: 'whatever-123' } })).status;
    }
    expect(last).toBe(429);
  });

  it('changes the password, revoking other sessions', async () => {
    const { cookie } = await signup(app, 'pw@example.com');
    const other = await call(app, 'POST', '/api/auth/login', { body: { email: 'pw@example.com', password: 'correct-horse-battery' } });
    const otherCookie = (other.headers.get('set-cookie') ?? '').split(';')[0];
    // logging in rotated nothing for `cookie` (different browser), so both are valid now
    const bad = await call(app, 'POST', '/api/me/password', { cookie, body: { currentPassword: 'wrong-wrong', newPassword: 'new-password-123' } });
    expect(bad.status).toBe(401);
    const ok = await call(app, 'POST', '/api/me/password', { cookie, body: { currentPassword: 'correct-horse-battery', newPassword: 'new-password-123' } });
    expect(ok.status).toBe(200);
    expect((await json<{ user: User | null }>(await call(app, 'GET', '/api/auth/me', { cookie }))).user).not.toBeNull();
    expect((await json<{ user: User | null }>(await call(app, 'GET', '/api/auth/me', { cookie: otherCookie }))).user).toBeNull();
  });

  it('deletes the account only with the correct password', async () => {
    const { cookie } = await signup(app, 'bye@example.com');
    expect((await call(app, 'DELETE', '/api/me', { cookie, body: { password: 'wrong-password' } })).status).toBe(401);
    expect((await call(app, 'DELETE', '/api/me', { cookie, body: { password: 'correct-horse-battery' } })).status).toBe(200);
    expect((await call(app, 'POST', '/api/auth/login', { body: { email: 'bye@example.com', password: 'correct-horse-battery' } })).status).toBe(401);
  });
});

describe('cross-site guard', () => {
  it('rejects requests from sibling subdomains and other sites', async () => {
    const { cookie } = await signup(app);
    const sameSite = await call(app, 'GET', '/api/projects', { cookie, headers: { 'sec-fetch-site': 'same-site' } });
    expect(sameSite.status).toBe(403);
    const crossSite = await call(app, 'GET', '/api/projects', { cookie, headers: { 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.status).toBe(403);
    const sameOrigin = await call(app, 'GET', '/api/projects', { cookie, headers: { 'sec-fetch-site': 'same-origin' } });
    expect(sameOrigin.status).toBe(200);
  });

  it('rejects state-changing requests with a foreign Origin and never sends CORS headers', async () => {
    const { cookie } = await signup(app);
    const foreign = await call(app, 'POST', '/api/projects', { cookie, body: {}, headers: { origin: 'http://pv-abc.localhost:3000' } });
    expect(foreign.status).toBe(403);
    const own = await call(app, 'POST', '/api/projects', { cookie, body: {}, headers: { origin: ORIGIN } });
    expect(own.status).toBe(201);
    expect(own.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('settings', () => {
  it('requires auth', async () => {
    expect((await call(app, 'GET', '/api/me/usage')).status).toBe(401);
    expect((await call(app, 'GET', '/api/projects')).status).toBe(401);
  });

  it('lists models with the demo model available and as default when no keys exist', async () => {
    const { cookie } = await signup(app);
    const models = await json<ModelsResponse>(await call(app, 'GET', '/api/models', { cookie }));
    expect(models.defaultModel).toBe('mock:demo');
    expect(models.models.find((m) => m.id === 'anthropic:claude-opus-5')?.available).toBe(false);
  });

  it('stores API keys encrypted, exposes only last4, and makes the provider available', async () => {
    const { cookie } = await signup(app);
    const put = await call(app, 'PUT', '/api/me/api-keys/gemini', { cookie, body: { apiKey: 'AIzaSyTEST-KEY-0000000000001234' } });
    expect(put.status).toBe(200);
    const { key } = await json<{ key: ApiKeyInfo }>(put);
    expect(key.last4).toBe('1234');
    expect(JSON.stringify(key)).not.toContain('AIzaSyTEST');
    const models = await json<ModelsResponse>(await call(app, 'GET', '/api/models', { cookie }));
    const gemini = models.models.find((m) => m.id === 'gemini:gemini-pro-latest');
    expect(gemini?.available).toBe(true);
    expect(gemini?.keySource).toBe('user');
    expect(models.defaultModel).toBe('gemini:gemini-flash-latest');
    expect((await call(app, 'DELETE', '/api/me/api-keys/gemini', { cookie })).status).toBe(200);
    expect((await json<{ keys: ApiKeyInfo[] }>(await call(app, 'GET', '/api/me/api-keys', { cookie }))).keys).toHaveLength(0);
  });

  it('validates OpenAI-compatible base URLs and requires a model for third-party hosts', async () => {
    const { cookie } = await signup(app);
    const http = await call(app, 'PUT', '/api/me/api-keys/openai', { cookie, body: { apiKey: 'sk-test-12345678', baseUrl: 'http://example.com/v1', model: 'x' } });
    expect(http.status).toBe(400);
    const noModel = await call(app, 'PUT', '/api/me/api-keys/openai', { cookie, body: { apiKey: 'sk-test-12345678', baseUrl: 'https://openrouter.ai/api/v1' } });
    expect(noModel.status).toBe(400);
    const ok = await call(app, 'PUT', '/api/me/api-keys/openai', {
      cookie,
      body: { apiKey: 'sk-test-12345678', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' },
    });
    expect(ok.status).toBe(200);
    const models = await json<ModelsResponse>(await call(app, 'GET', '/api/models', { cookie }));
    expect(models.models.find((m) => m.id === 'openai:deepseek/deepseek-chat')?.available).toBe(true);
  });

  it('reports usage with limits', async () => {
    const { cookie } = await signup(app);
    const usage = await json<UsageSummary>(await call(app, 'GET', '/api/me/usage', { cookie }));
    expect(usage.dailyMessageLimit).toBe(100);
    expect(usage.remainingToday).toBe(100);
    expect(usage.freeFixesRemaining).toBe(10);
  });
});
