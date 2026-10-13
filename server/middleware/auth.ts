import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SESSION_COOKIE, SESSION_TTL_DAYS } from '../../shared/constants';
import type { User } from '../../shared/types';
import { getConfig } from '../env';
import { unauthorized } from '../lib/errors';
import { clerkEnabled, userFromClerkToken } from '../services/clerk';
import { getSessionUser } from '../services/sessions';
import type { AppEnv } from '../types';

/** Cookie that Clerk's browser SDK keeps the current session token in. */
const CLERK_SESSION_COOKIE = '__session';

/** Clerk session token of the request: the Authorization header (always fresh), else the cookie. */
function clerkToken(c: Context<AppEnv>): string | undefined {
  const header = c.req.header('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || undefined;
  return getCookie(c, CLERK_SESSION_COOKIE);
}

/** Loads the session (if any) into c.var.user. Never rejects. */
export function sessionLoader(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('user', null);
    c.set('sessionId', null);
    if (clerkEnabled()) {
      c.set('user', await userFromClerkToken(clerkToken(c)));
      await next();
      return;
    }
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const session = getSessionUser(token);
      if (session) {
        c.set('user', session.user);
        c.set('sessionId', session.sessionId);
      }
    }
    await next();
  };
}

export function requireUser(c: Context<AppEnv>): User {
  const user = c.get('user');
  if (!user) throw unauthorized();
  return user;
}

export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  // Host-only cookie (no Domain attribute) so it is never sent to sandbox subdomains.
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: getConfig().appUrl.startsWith('https://'),
    path: '/',
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export function sessionToken(c: Context<AppEnv>): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}
