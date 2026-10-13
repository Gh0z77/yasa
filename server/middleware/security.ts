import { getConnInfo } from '@hono/node-server/conninfo';
import type { MiddlewareHandler } from 'hono';
import { getConfig } from '../env';
import { forbidden } from '../lib/errors';
import { frontendApiFromPublishableKey } from '../services/clerk';
import type { AppEnv } from '../types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Resolves the client IP once per request (X-Forwarded-For only when TRUST_PROXY is on). */
export function clientIp(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let ip = 'unknown';
    if (getConfig().trustProxy) {
      const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (forwarded) ip = forwarded;
    }
    if (ip === 'unknown') {
      try {
        ip = getConnInfo(c).remote.address ?? 'unknown';
      } catch {
        // not running on the node adapter (tests)
      }
    }
    c.set('clientIp', ip);
    await next();
  };
}

/**
 * Cross-site request guard for /api.
 * - Requests initiated by another site or by a sibling subdomain (the sandbox hosts) are rejected.
 * - State-changing requests must come from an allowed Origin when the header is present.
 * No CORS headers are ever sent for /api, so other origins cannot read responses either.
 */
export function apiGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const site = c.req.header('sec-fetch-site');
    if (site === 'cross-site' || site === 'same-site') throw forbidden('Cross-site requests are not allowed');
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin && !getConfig().allowedOrigins.includes(origin)) throw forbidden('Origin not allowed');
    }
    await next();
  };
}

/** Content-Security-Policy for the builder UI (production static responses). */
export function builderCsp(): string {
  const { sandboxProtocol, sandboxDomain, clerk } = getConfig();
  const frames = `${sandboxProtocol}://*.${sandboxDomain}`;
  // Clerk's browser SDK is served by, and talks to, the instance's Frontend API; its bot and abuse checks use
  // Turnstile and *.protect.clerk.com (the latter on non-default ports, hence the port wildcard).
  const clerkApi = clerk ? frontendApiFromPublishableKey(clerk.publishableKey) : null;
  const clerkScripts = clerkApi ? ` https://${clerkApi} https://challenges.cloudflare.com https://*.protect.clerk.com` : '';
  const clerkConnect = clerkApi ? ` https://${clerkApi} https://clerk-telemetry.com https://*.protect.clerk.com:*` : '';
  const clerkFrames = clerkApi ? ' https://challenges.cloudflare.com https://*.protect.clerk.com' : '';
  return [
    "default-src 'self'",
    `script-src 'self'${clerkScripts}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${clerkConnect}`,
    `frame-src ${frames}${clerkFrames}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Baseline security headers for builder (non-sandbox) responses. */
export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    if (!h.has('X-Content-Type-Options')) h.set('X-Content-Type-Options', 'nosniff');
    if (!h.has('Referrer-Policy')) h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!h.has('X-Frame-Options')) h.set('X-Frame-Options', 'DENY');
    if (getConfig().isProd) {
      if (!h.has('Content-Security-Policy') && (h.get('Content-Type') ?? '').includes('text/html')) {
        h.set('Content-Security-Policy', builderCsp());
      }
      if (getConfig().appUrl.startsWith('https://')) {
        h.set('Strict-Transport-Security', 'max-age=31536000');
      }
    }
  };
}
