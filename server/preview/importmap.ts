// Import map generation for previews / published apps (SPEC §9.3).
//
// ---------------------------------------------------------------------------------------------------------
// VERIFIED AGAINST THE REAL esm.sh (node fetch, redirects followed) — see .scratch/preview/verify-esm.mts
// ---------------------------------------------------------------------------------------------------------
// Date: 2026-10-11. Resolved at that time: react/react-dom 19.3.0, lucide-react 1.55.0, radix-ui 1.7.0, sonner 2.0.8.
//
// 1. Every URL this module generates for the starter dependencies answers 200 `application/javascript` with
//    `access-control-allow-origin: *` (preview and publish variants of: react, react/jsx-runtime,
//    react/jsx-dev-runtime, react/compiler-runtime, react-dom, react-dom/client, react-dom/server, lucide-react,
//    clsx, tailwind-merge, class-variance-authority, radix-ui, sonner).
// 2. Semver ranges work directly in the path: `https://esm.sh/react@^19.0.0` (the browser sends `^` as `%5E`;
//    both spellings return the same module). The range URL is NOT redirected: it answers 200 with a tiny wrapper
//    (`export * from "/react@19.3.0/es2022/react.mjs"`, cache-control max-age=600) that pins the exact version.
// 3. `?external=react,react-dom` really leaves bare imports in the built modules. Crawling the complete module
//    graphs (317 modules) of react-dom, lucide-react, sonner, radix-ui (all @radix-ui/* packages), clsx,
//    tailwind-merge, class-variance-authority, react-router 7, recharts 3, framer-motion 12, zustand 5,
//    @tanstack/react-query 5 and react-hook-form 7 found exactly three bare specifiers:
//        `react` (95 modules), `react/jsx-runtime` (47 modules), `react-dom` (10 modules)
//    → all are in REACT_SPECIFIERS, so they always resolve to the single React copy of the import map
//    (verified in a real browser: a useState counter + radix/sonner components share one React instance).
//    `react-dom…?external=react` leaves a bare `react`; its `scheduler` dependency stays an absolute esm.sh URL.
//    REACT_SPECIFIERS additionally lists `react/jsx-dev-runtime`, `react/compiler-runtime`, `react-dom/client` and
//    `react-dom/server`, which other libraries may import (all verified to exist, see 1).
// 4. `dev` combines with `external` as an ordinary extra query flag, in either order:
//    `…/react-dom@^19.0.0/client?external=react&dev` and `…?dev&external=react` both resolve to
//    `/react-dom@19.3.0/X-ZXJlYWN0/es2022/client.development.mjs` (X-<base64url("react")> = external set) and
//    propagate `dev` to dependencies (`/scheduler@^0.28.0?target=es2022&dev`).
//    `https://esm.sh/react@^19.0.0?dev` → `/react@19.3.0/es2022/react.development.mjs`.
//    Without `dev`, production builds are served (`react.mjs`, `client.mjs`). `react/jsx-dev-runtime` is served
//    from its development build even without `dev`.
//    Libraries are requested WITHOUT `dev` in both modes (per spec); their production builds import the bare
//    `react`, which the map points at the development build in preview mode — that combination works.
// 5. jsDelivr accepts the same ranges for stylesheets: `https://cdn.jsdelivr.net/npm/leaflet@^1.9.0/dist/leaflet.css`
//    → 200 text/css; `@fontsource/inter` → `/index.css`, `@fontsource/inter/400` → `/400.css` → 200 text/css.
// 6. An unknown bare import that is not in package.json gets no version (`https://esm.sh/pkg/sub?external=…` →
//    latest) and the bundler adds a warning.
// ---------------------------------------------------------------------------------------------------------
import type { ProjectFile } from '../../shared/types';

export interface ImportMap {
  imports: Record<string, string>;
}

export interface PackageJsonLike {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export const ESM_CDN = 'https://esm.sh';
export const CSS_CDN = 'https://cdn.jsdelivr.net/npm';

/**
 * Bare specifiers that modules served by esm.sh with `?external=react,react-dom` may still import.
 * They are ALWAYS present in the import map (an import map entry that is never imported costs nothing).
 */
export const REACT_SPECIFIERS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react/compiler-runtime',
  'react-dom',
  'react-dom/client',
  'react-dom/server',
] as const;

/** Parses the project's package.json; returns null when missing or invalid. */
export function readPackageJson(files: readonly ProjectFile[]): PackageJsonLike | null {
  const file = files.find((f) => f.path === 'package.json');
  if (!file) return null;
  try {
    const text = file.encoding === 'base64' ? Buffer.from(file.content, 'base64').toString('utf8') : file.content;
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as PackageJsonLike;
  } catch {
    return null;
  }
}

/** Splits a bare specifier into package name and subpath: `@scope/pkg/a/b` → { name: '@scope/pkg', subpath: 'a/b' }. */
export function parseSpecifier(specifier: string): { name: string; subpath: string } {
  const parts = specifier.split('/');
  const nameParts = specifier.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1);
  return { name: nameParts.join('/'), subpath: parts.slice(nameParts.length).join('/') };
}

/** True for specifiers that are neither relative, absolute, URL-like nor aliased (`@/`). */
export function isBareSpecifier(specifier: string): boolean {
  if (!specifier) return false;
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/') || specifier.startsWith('~/')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return false;
  return true;
}

const SIMPLE_RANGE = /^[~^]?v?\d+(?:\.(?:\d+|x|\*)){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DIST_TAG = /^[a-z][a-z0-9._-]*$/i;

/**
 * Returns the declared version range of a package in a form that is safe to put in a CDN URL
 * (`^19.0.0`, `~1.2`, `1.2.3`, `next`), or null when undeclared / not expressible (→ latest).
 */
export function declaredVersion(pkg: PackageJsonLike | null, name: string): string | null {
  if (!pkg) return null;
  const raw = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? pkg.peerDependencies?.[name];
  if (typeof raw !== 'string') return null;
  return normalizeRange(raw);
}

export function isDeclared(pkg: PackageJsonLike | null, name: string): boolean {
  if (!pkg) return false;
  return (
    typeof pkg.dependencies?.[name] === 'string' ||
    typeof pkg.devDependencies?.[name] === 'string' ||
    typeof pkg.peerDependencies?.[name] === 'string'
  );
}

export function normalizeRange(raw: string): string | null {
  let range = raw.trim();
  if (range.startsWith('workspace:')) range = range.slice('workspace:'.length).trim();
  // npm alias: "npm:other-pkg@^1.0.0" → keep the range only (the alias target is not supported).
  if (range.startsWith('npm:')) {
    const at = range.lastIndexOf('@');
    range = at > 4 ? range.slice(at + 1) : '';
  }
  if (!range || range === '*' || range === 'x' || range === 'latest' || range === '^' || range === '~') return null;
  // ">=1.2.3" on its own is a very common "at least" declaration.
  if (/^>=\s*\d/.test(range) && !/\s/.test(range.replace(/^>=\s*/, ''))) return null;
  if (SIMPLE_RANGE.test(range)) return range.replace(/^([~^]?)v/, '$1');
  if (DIST_TAG.test(range) && !range.includes(':')) return range;
  // Compound ranges ("1.x || 2.x", ">=1 <3"), git/file/http URLs → latest.
  return null;
}

/** Major version of a simple range (`^19.0.0` → 19); null when unknown. */
export function majorOf(range: string | null): number | null {
  if (!range) return null;
  const m = /^[~^]?v?(\d+)/.exec(range);
  return m ? Number(m[1]) : null;
}

/**
 * `^8.22.0` → `^8`. Both resolve to the newest 8.x, but the short form also resolves when the stated minor was
 * never published — models invent those — instead of answering 404 and leaving the page blank.
 */
export function relaxCaret(range: string | null): string | null {
  const m = range ? /^\^(\d+)\.\d+(?:\.\d+)?$/.exec(range) : null;
  return m && m[1] !== '0' ? `^${m[1]}` : range;
}

function pkgAt(name: string, version: string | null): string {
  return version ? `${name}@${version}` : name;
}

function esmUrl(name: string, version: string | null, subpath: string, query: string[]): string {
  const base = `${ESM_CDN}/${pkgAt(name, version)}${subpath ? `/${subpath}` : ''}`;
  return query.length ? `${base}?${query.join('&')}` : base;
}

/** esm.sh URL for one exact bare specifier. */
export function cdnUrlFor(specifier: string, pkg: PackageJsonLike | null, mode: 'preview' | 'publish'): string {
  const { name, subpath } = parseSpecifier(specifier);
  const dev = mode === 'preview';
  if (name === 'react') {
    return esmUrl('react', declaredVersion(pkg, 'react'), subpath, dev ? ['dev'] : []);
  }
  if (name === 'react-dom') {
    // react-dom must be the same release line as react; fall back to react's range when undeclared.
    const version = declaredVersion(pkg, 'react-dom') ?? declaredVersion(pkg, 'react');
    return esmUrl('react-dom', version, subpath, dev ? ['external=react', 'dev'] : ['external=react']);
  }
  return esmUrl(name, relaxCaret(declaredVersion(pkg, name)), subpath, ['external=react,react-dom']);
}

/**
 * Builds the import map: one exact entry per external specifier (no prefix/trailing-slash maps) plus the
 * React entries, which are always present so that esm.sh modules built with `?external=react,react-dom`
 * resolve their bare `react` / `react/jsx-runtime` / `react-dom` imports to the single shared copy.
 */
export function buildImportMap(
  externals: Iterable<string>,
  pkg: PackageJsonLike | null,
  mode: 'preview' | 'publish',
): ImportMap {
  const imports: Record<string, string> = {};
  for (const spec of REACT_SPECIFIERS) imports[spec] = cdnUrlFor(spec, pkg, mode);
  const rest = [...new Set(externals)].filter((s) => isBareSpecifier(s) && !(s in imports)).sort();
  for (const spec of rest) imports[spec] = cdnUrlFor(spec, pkg, mode);
  return { imports };
}

/** True when a bare specifier refers to a stylesheet of an npm package (`pkg/dist/x.css`, `@fontsource/inter`). */
export function isCssSpecifier(specifier: string): boolean {
  if (!isBareSpecifier(specifier)) return false;
  const clean = specifier.replace(/[?#].*$/, '');
  if (/\.css$/i.test(clean)) return true;
  const { name } = parseSpecifier(clean);
  return name.startsWith('@fontsource/') || name.startsWith('@fontsource-variable/');
}

/** jsDelivr URL of a package stylesheet: `https://cdn.jsdelivr.net/npm/<pkg>@<ver>/<sub>`. */
export function cssCdnUrl(specifier: string, pkg: PackageJsonLike | null): string {
  const clean = specifier.replace(/[?#].*$/, '');
  const { name, subpath } = parseSpecifier(clean);
  let sub = subpath;
  if (name.startsWith('@fontsource/') || name.startsWith('@fontsource-variable/')) {
    // `@fontsource/inter` → index.css, `@fontsource/inter/400` → 400.css
    if (!sub) sub = 'index.css';
    else if (!/\.css$/i.test(sub)) sub = `${sub}.css`;
  }
  return `${CSS_CDN}/${pkgAt(name, declaredVersion(pkg, name))}${sub ? `/${sub}` : ''}`;
}
