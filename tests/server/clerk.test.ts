import { afterEach, describe, expect, it } from 'vitest';
import type { User } from '../../shared/types';
import { createApp } from '../../server/app';
import { setConfigForTests } from '../../server/env';
import { builderCsp } from '../../server/middleware/security';
import { frontendApiFromPublishableKey, setClerkAdapterForTests, type ClerkIdentity } from '../../server/services/clerk';
import { ORIGIN, call, createProject, json, setupTestApp, signup } from './helpers';

// "example.clerk.accounts.dev$" in base64, as Clerk encodes the Frontend API host into the key.
const PUBLISHABLE_KEY = `pk_test_${Buffer.from('example.clerk.accounts.dev$').toString('base64')}`;
const CLERK = { clerk: { secretKey: 'sk_test_fake', publishableKey: PUBLISHABLE_KEY } };

/** A stand-in for Clerk: tokens are `tok:<clerk id>`, identities come from the given directory. */
function fakeClerk(directory: Record<string, Partial<ClerkIdentity>>) {
  const deleted: string[] = [];
  let lookups = 0;
  setClerkAdapterForTests({
    verify: async (token) => (token.startsWith('tok:') && directory[token.slice(4)] ? token.slice(4) : null),
    identity: async (clerkId) => {
      lookups += 1;
      const entry = directory[clerkId];
      if (!entry) throw new Error('unknown user');
      return { clerkId, email: null, emailVerified: false, name: null, ...entry };
    },
    deleteUser: async (clerkId) => {
      deleted.push(clerkId);
    },
  });
  return { deleted, lookups: () => lookups };
}

const bearer = (clerkId: string) => ({ headers: { authorization: `Bearer tok:${clerkId}` } });

afterEach(() => setClerkAdapterForTests(null));

describe('frontendApiFromPublishableKey', () => {
  it('decodes the Frontend API host', () => {
    expect(frontendApiFromPublishableKey(PUBLISHABLE_KEY)).toBe('example.clerk.accounts.dev');
  });

  it('rejects malformed keys', () => {
    expect(frontendApiFromPublishableKey('sk_test_abc')).toBeNull();
    expect(frontendApiFromPublishableKey(`pk_test_${Buffer.from('no-terminator.dev').toString('base64')}`)).toBeNull();
    expect(frontendApiFromPublishableKey(`pk_live_${Buffer.from("evil.dev' 'unsafe-inline$").toString('base64')}`)).toBeNull();
  });
});

describe('Clerk accounts', () => {
  it('creates a local account on the first verified request and reuses it afterwards', async () => {
    const app = setupTestApp(CLERK);
    const clerk = fakeClerk({ user_alice: { email: 'Alice@Example.com', emailVerified: true, name: 'Alice Doe' } });

    const first = await json<{ user: User | null }>(await call(app, 'GET', '/api/auth/me', bearer('user_alice')));
    expect(first.user).toMatchObject({ email: 'alice@example.com', name: 'Alice Doe' });

    const second = await json<{ user: User | null }>(await call(app, 'GET', '/api/auth/me', bearer('user_alice')));
    expect(second.user?.id).toBe(first.user?.id);
    expect(clerk.lookups()).toBe(1);

    // The account owns data like any other.
    const res = await call(app, 'POST', '/api/projects', { ...bearer('user_alice'), body: { name: 'Shop' } });
    expect(res.status).toBe(201);
  });

  it('accepts the session cookie when there is no Authorization header', async () => {
    const app = setupTestApp(CLERK);
    fakeClerk({ user_bob: { email: 'bob@example.com', emailVerified: true } });
    const me = await json<{ user: User | null }>(await call(app, 'GET', '/api/auth/me', { cookie: '__session=tok:user_bob' }));
    expect(me.user).toMatchObject({ email: 'bob@example.com', name: 'bob' });
  });

  it('treats missing and invalid tokens as signed out', async () => {
    const app = setupTestApp(CLERK);
    fakeClerk({});
    expect((await json<{ user: User | null }>(await call(app, 'GET', '/api/auth/me'))).user).toBeNull();
    expect((await json<{ user: User | null }>(await call(app, 'GET', '/api/auth/me', bearer('user_ghost')))).user).toBeNull();
    expect((await call(app, 'GET', '/api/projects', bearer('user_ghost'))).status).toBe(401);
  });

  it('closes the password endpoints', async () => {
    const app = setupTestApp(CLERK);
    fakeClerk({});
    const body = { name: 'Eve', email: 'eve@example.com', password: 'correct-horse-battery' };
    expect((await call(app, 'POST', '/api/auth/signup', { body })).status).toBe(403);
    expect((await call(app, 'POST', '/api/auth/login', { body })).status).toBe(403);
  });

  it('adopts an existing account only when Clerk has verified the same email', async () => {
    // The account exists from before Clerk was switched on.
    const before = setupTestApp();
    const { cookie, user } = await signup(before, 'carol@example.com');
    const project = await createProject(before, cookie, { name: 'Old project' });

    setConfigForTests({ appUrl: ORIGIN, allowedOrigins: [ORIGIN], sandboxDomain: 'localhost:3000', ...CLERK });
    const app = createApp();
    fakeClerk({
      user_unverified: { email: 'carol@example.com', emailVerified: false },
      user_carol: { email: 'carol@example.com', emailVerified: true },
    });

    expect((await json<{ user: User | null }>(await call(app, 'GET', '/api/auth/me', bearer('user_unverified')))).user).toBeNull();

    const me = await json<{ user: User | null }>(await call(app, 'GET', '/api/auth/me', bearer('user_carol')));
    expect(me.user?.id).toBe(user.id);
    expect((await call(app, 'GET', `/api/projects/${project.id}`, bearer('user_carol'))).status).toBe(200);
  });

  it('deletes the Clerk user together with the account, without asking for a password', async () => {
    const app = setupTestApp(CLERK);
    const clerk = fakeClerk({ user_dave: { email: 'dave@example.com', emailVerified: true } });
    await call(app, 'GET', '/api/auth/me', bearer('user_dave'));

    expect((await call(app, 'POST', '/api/me/password', { ...bearer('user_dave'), body: { currentPassword: 'x', newPassword: 'another-long-password' } })).status).toBe(403);

    const res = await call(app, 'DELETE', '/api/me', { ...bearer('user_dave'), body: {} });
    expect(res.status).toBe(200);
    expect(clerk.deleted).toEqual(['user_dave']);
  });

  it('allows the Clerk hosts in the builder CSP only when Clerk is on', () => {
    setupTestApp(CLERK);
    expect(builderCsp()).toContain('https://example.clerk.accounts.dev');
    expect(builderCsp()).toContain('https://challenges.cloudflare.com');
    expect(builderCsp()).toContain('https://*.protect.clerk.com:*');
    setupTestApp();
    expect(builderCsp()).not.toContain('clerk');
    expect(builderCsp()).toContain("script-src 'self';");
  });
});
