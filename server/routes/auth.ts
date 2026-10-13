import { Hono } from 'hono';
import { z } from 'zod';
import { LIMITS, RATE_LIMITS } from '../../shared/constants';
import type { AuthResponse, MeResponse, OkResponse } from '../../shared/types';
import { getConfig } from '../env';
import { hashPassword, verifyDummyPassword, verifyPassword } from '../lib/crypto';
import { conflict, forbidden, unauthorized } from '../lib/errors';
import { RateLimiter } from '../lib/rate-limit';
import { parseJson } from '../lib/validate';
import { clearSessionCookie, sessionToken, setSessionCookie } from '../middleware/auth';
import { clerkEnabled } from '../services/clerk';
import { createSession, deleteSession } from '../services/sessions';
import { createUser, getUserAuthByEmail } from '../services/users';
import type { AppEnv } from '../types';

export const authLimiter = new RateLimiter(RATE_LIMITS.authPerMinute, 60_000);

const zEmail = z.string().trim().toLowerCase().min(3).max(LIMITS.emailMax).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address');
const zPassword = z.string().min(LIMITS.passwordMin, `Password must be at least ${LIMITS.passwordMin} characters`).max(LIMITS.passwordMax);

const SignupSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(LIMITS.nameMax),
  email: zEmail,
  password: zPassword,
});

const LoginSchema = z.object({
  email: zEmail,
  password: z.string().min(1).max(LIMITS.passwordMax),
});

export const authRoutes = new Hono<AppEnv>();

/** With Clerk, accounts are created and signed in on Clerk's side; the password endpoints are closed. */
function assertBuiltInAuth(): void {
  if (clerkEnabled()) throw forbidden('This server signs in with Clerk');
}

authRoutes.post('/signup', async (c) => {
  authLimiter.check(`signup:${c.get('clientIp')}`);
  assertBuiltInAuth();
  if (!getConfig().signupsEnabled) throw forbidden('Sign-ups are disabled on this server');
  const body = await parseJson(c, SignupSchema);
  if (getUserAuthByEmail(body.email)) throw conflict('An account with this email already exists');
  const user = createUser({ email: body.email, name: body.name, passwordHash: await hashPassword(body.password) });
  const session = createSession(user.id, { userAgent: c.req.header('user-agent'), ip: c.get('clientIp') });
  setSessionCookie(c, session.token);
  return c.json<AuthResponse>({ user }, 201);
});

authRoutes.post('/login', async (c) => {
  authLimiter.check(`login:${c.get('clientIp')}`);
  assertBuiltInAuth();
  const body = await parseJson(c, LoginSchema);
  const found = getUserAuthByEmail(body.email);
  const ok = found ? await verifyPassword(body.password, found.passwordHash) : await verifyDummyPassword(body.password);
  if (!found || !ok) throw unauthorized('Invalid email or password');
  // Rotate: drop the session this browser had, if any.
  const previous = sessionToken(c);
  if (previous) deleteSession(previous);
  const session = createSession(found.user.id, { userAgent: c.req.header('user-agent'), ip: c.get('clientIp') });
  setSessionCookie(c, session.token);
  return c.json<AuthResponse>({ user: found.user });
});

authRoutes.post('/logout', (c) => {
  const token = sessionToken(c);
  if (token) deleteSession(token);
  clearSessionCookie(c);
  return c.json<OkResponse>({ ok: true });
});

authRoutes.get('/me', (c) => c.json<MeResponse>({ user: c.get('user') }));
