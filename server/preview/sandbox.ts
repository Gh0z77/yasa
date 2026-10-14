// Host-based router for generated apps (docs/SPEC.md §9.1, §15.5).
//   pv-<token>.<SANDBOX_DOMAIN>          → live draft preview of a project
//   pv-<token>--v<N>.<SANDBOX_DOMAIN>    → read-only preview of version N
//   <slug>.<SANDBOX_DOMAIN>              → published app
// Sandbox hosts never reach /api and never read the builder's cookies.
//
// Hosts without wildcard domains (SANDBOX_MODE=path) put every app on the sandbox host itself:
//   <SANDBOX_DOMAIN>/~pv-<token>/        → draft preview        <SANDBOX_DOMAIN>/~<slug>/ → published app
// The page drops the prefix from its address before the app starts (client-side routers expect to own the
// path), and a cookie remembers which app the tab is showing so its absolute asset URLs still resolve.
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { PREVIEW_HOST_PREFIX, PREVIEW_VERSION_SEPARATOR, SANDBOX_PATH_PREFIX } from '../../shared/constants';
import { mimeFor } from '../../shared/paths';
import { isValidSlug } from '../../shared/slug';
import type { ProjectFile } from '../../shared/types';
import { getConfig } from '../env';
import { sha256Hex } from '../lib/crypto';
import { logger } from '../lib/logger';
import { listFiles, getFile } from '../services/files';
import { projectIdForDomain } from '../services/domains';
import { getProjectByPreviewToken, getProjectBySlug, getProjectRow, type ProjectRow } from '../services/projects';
import { getPublishedBuild } from '../services/publish';
import { getVersionByNumber, getVersionFiles, getVersionFile } from '../services/versions';
import type { AppEnv } from '../types';
import { buildProject } from './bundler';
import { errorPageHtml, escapeHtml } from './html';

const TOKEN_RE = /^[a-z2-7]{20}$/;

function baseHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

function notFoundPage(message: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · Yasa</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:ui-sans-serif,system-ui,sans-serif;background:#0b0b10;color:#f4f4f5}
main{text-align:center;padding:24px}h1{font-size:64px;margin:0;background:linear-gradient(90deg,#7c3aed,#ec4899,#f97316);-webkit-background-clip:text;background-clip:text;color:transparent}
p{color:#a1a1aa;margin:12px 0 0}</style></head><body><main><h1>404</h1><p>${escapeHtml(message)}</p></main></body></html>`;
  return new Response(html, { status: 404, headers: { ...baseHeaders(), 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function hasFileExtension(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  return /\.[A-Za-z0-9]{1,8}$/.test(last) && !last.endsWith('.html');
}

function decodePath(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes('\0') || decoded.split('/').some((s) => s === '..')) return null;
    return decoded;
  } catch {
    return null;
  }
}

/** Serves a file from the project's public/ folder, if it exists. */
function publicAsset(files: ProjectFile[], pathname: string, cacheControl: string): Response | null {
  if (pathname === '/' || pathname.endsWith('/')) return null;
  const file = files.find((f) => f.path === `public${pathname}`);
  return file ? assetResponse(file, cacheControl) : null;
}

function assetResponse(file: ProjectFile, cacheControl: string): Response {
  const body = file.encoding === 'base64' ? new Uint8Array(Buffer.from(file.content, 'base64')) : file.content;
  return new Response(body, { headers: { ...baseHeaders(), 'Content-Type': mimeFor(file.path), 'Cache-Control': cacheControl } });
}

function htmlResponse(html: string, headers: Record<string, string>, status = 200): Response {
  return new Response(html, { status, headers: { ...baseHeaders(), 'Content-Type': 'text/html; charset=utf-8', ...headers } });
}

async function servePreview(label: string, pathname: string): Promise<Response> {
  const config = getConfig();
  const appOrigin = new URL(config.appUrl).origin;
  let token = label.slice(PREVIEW_HOST_PREFIX.length);
  let versionNumber: number | null = null;
  const sep = token.indexOf(PREVIEW_VERSION_SEPARATOR);
  if (sep !== -1) {
    const n = Number(token.slice(sep + PREVIEW_VERSION_SEPARATOR.length));
    token = token.slice(0, sep);
    if (!Number.isInteger(n) || n < 1) return notFoundPage('This preview does not exist.');
    versionNumber = n;
  }
  if (!TOKEN_RE.test(token)) return notFoundPage('This preview does not exist.');
  const project = getProjectByPreviewToken(token);
  if (!project) return notFoundPage('This preview does not exist or its link was reset.');

  const version = versionNumber !== null ? getVersionByNumber(project.id, versionNumber) : null;
  if (versionNumber !== null && !version) return notFoundPage('This version does not exist.');

  // Pictures, fonts and other static files: one row, not the whole project.
  if (hasFileExtension(pathname)) {
    const file = version ? getVersionFile(version.id, `public${pathname}`) : getFile(project.id, `public${pathname}`);
    return file ? assetResponse(file, 'no-store') : notFoundPage('File not found.');
  }

  const files: ProjectFile[] = version ? getVersionFiles(version.id) : listFiles(project.id);

  const asset = publicAsset(files, pathname, 'no-store');
  if (asset) return asset;
  if (hasFileExtension(pathname)) return notFoundPage('File not found.');

  // Only the builder may frame draft previews.
  const headers = { 'Cache-Control': 'no-store', 'Content-Security-Policy': `frame-ancestors ${appOrigin}` };
  const output = await buildProject(files, {
    mode: 'preview',
    appOrigin,
    project: { name: project.name, emoji: project.emoji, description: project.description },
  });
  if (!output.html) return htmlResponse(errorPageHtml(output.summary.errors, appOrigin), headers);
  return htmlResponse(output.html, headers);
}

function servePublished(slug: string, pathname: string, ifNoneMatch: string | undefined): Response {
  if (!isValidSlug(slug)) return notFoundPage('This app does not exist.');
  return servePublishedProject(getProjectBySlug(slug), pathname, ifNoneMatch);
}

function servePublishedProject(project: ProjectRow | null, pathname: string, ifNoneMatch: string | undefined): Response {
  const build = project ? getPublishedBuild(project.id) : null;
  if (!project || !build) return notFoundPage('This app does not exist or was unpublished.');

  if (hasFileExtension(pathname)) {
    const file = project.published_version_id ? getVersionFile(project.published_version_id, `public${pathname}`) : null;
    return file ? assetResponse(file, 'public, max-age=300') : notFoundPage('File not found.');
  }
  if (project.published_version_id) {
    const asset = publicAsset(getVersionFiles(project.published_version_id), pathname, 'public, max-age=300');
    if (asset) return asset;
  }

  const etag = `"${sha256Hex(`${build.versionId}:${build.builtAt}`).slice(0, 24)}"`;
  const headers = { 'Cache-Control': 'no-cache', ETag: etag, 'Content-Security-Policy': 'frame-ancestors *' };
  if (ifNoneMatch === etag) return new Response(null, { status: 304, headers: { ...baseHeaders(), ...headers } });
  return htmlResponse(build.html, headers);
}

const KNOWN_LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Remembers which app a browser tab on the shared sandbox host is showing. */
const SITE_COOKIE = 'yasa_site';
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const PATH_LABEL = new RegExp(`^/${SANDBOX_PATH_PREFIX}([a-z0-9][a-z0-9-]{0,80})(/.*)?$`);
/** Runs before the app: takes the sandbox prefix out of the address, so routers see the path they expect. */
const PATH_BOOT = `<script>(function(){try{var m=/^\\/${SANDBOX_PATH_PREFIX}[a-z0-9-]+(\\/.*)?$/.exec(location.pathname);if(m)history.replaceState(history.state,"",(m[1]||"/")+location.search+location.hash)}catch(e){}})()</script>`;

/** Adds the address fix and the app cookie to a page served under a path label. */
async function inPathMode(response: Response, label: string, secure: boolean): Promise<Response> {
  const headers = new Headers(response.headers);
  // Previews sit in a frame on the builder's site: the cookie has to be allowed there (partitioned per site).
  headers.append('Set-Cookie', `${SITE_COOKIE}=${label}; Path=/; Max-Age=86400; HttpOnly; ${secure ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax'}`);
  if (response.status !== 200 || !(headers.get('Content-Type') ?? '').includes('text/html')) {
    return new Response(response.body, { status: response.status, headers });
  }
  const html = await response.text();
  const at = html.search(/<head[^>]*>/i);
  const end = at === -1 ? -1 : html.indexOf('>', at) + 1;
  return new Response(end > 0 ? html.slice(0, end) + PATH_BOOT + html.slice(end) : PATH_BOOT + html, { status: 200, headers });
}

async function serveLabel(label: string, pathname: string, ifNoneMatch: string | undefined): Promise<Response> {
  if (label.startsWith(PREVIEW_HOST_PREFIX)) return servePreview(label, pathname);
  return servePublished(label, pathname, ifNoneMatch);
}

export function sandboxMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const config = getConfig();
    const host = (c.req.header('host') ?? '').toLowerCase();
    const suffix = `.${config.sandboxDomain}`;

    // Apps on one shared host. That host must not be the builder's own: generated code would run on its origin.
    if (config.sandboxMode === 'path' && host === config.sandboxDomain && host !== new URL(config.appUrl).host.toLowerCase()) {
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { ...baseHeaders(), Allow: 'GET, HEAD' } });
      }
      const full = decodePath(new URL(c.req.url).pathname);
      if (full === null) return notFoundPage('File not found.');
      const named = PATH_LABEL.exec(full);
      const remembered = getCookie(c, SITE_COOKIE) ?? '';
      const label = named ? named[1]! : LABEL_RE.test(remembered) ? remembered : '';
      if (!label) return notFoundPage('Open this app with its full link.');
      try {
        const response = await serveLabel(label, named ? named[2] || '/' : full, c.req.header('if-none-match'));
        return named ? await inPathMode(response, label, config.sandboxProtocol === 'https') : response;
      } catch (err) {
        logger.error('Sandbox request failed', { host, error: err });
        return htmlResponse('<!doctype html><title>Error</title><p>Something went wrong while building this app.</p>', { 'Cache-Control': 'no-store' }, 500);
      }
    }

    if (!host.endsWith(suffix)) {
      // The bare sandbox domain is user-content territory: never serve the builder there in production.
      const appHost = new URL(config.appUrl).host.toLowerCase();
      if (config.isProd && host === config.sandboxDomain && host !== appHost) {
        return c.redirect(config.appUrl, 302);
      }
      // A verified custom domain serves its project's published app; the builder's own hosts fall through.
      if (host !== appHost && !KNOWN_LOCAL_HOST.test(host)) {
        const projectId = projectIdForDomain(host);
        if (projectId) {
          if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
            return new Response('Method not allowed', { status: 405, headers: { ...baseHeaders(), Allow: 'GET, HEAD' } });
          }
          const pathname = decodePath(new URL(c.req.url).pathname);
          if (pathname === null) return notFoundPage('File not found.');
          // The certificate gate must stay reachable on every host the proxy may ask through.
          if (pathname !== '/api/tls-check') return servePublishedProject(getProjectRow(projectId), pathname, c.req.header('if-none-match'));
        }
      }
      return next();
    }

    const label = host.slice(0, -suffix.length);
    if (!label || label.includes('.')) return notFoundPage('This address does not exist.');
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { ...baseHeaders(), Allow: 'GET, HEAD' } });
    }
    const pathname = decodePath(new URL(c.req.url).pathname);
    if (pathname === null) return notFoundPage('File not found.');

    try {
      return await serveLabel(label, pathname, c.req.header('if-none-match'));
    } catch (err) {
      logger.error('Sandbox request failed', { host, error: err });
      return htmlResponse('<!doctype html><title>Error</title><p>Something went wrong while building this app.</p>', { 'Cache-Control': 'no-store' }, 500);
    }
  };
}
