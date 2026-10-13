// Server-side Tailwind CSS v4 compilation for previews and published apps (SPEC §9.4).
//
// Every CSS file that the app imports is compiled on its own with the pure-JS `tailwindcss` compiler — exactly
// like `@tailwindcss/vite` treats each CSS module — and the results are concatenated in import order.
// (A consequence, identical to real Vite: a second CSS file that uses `@apply` with theme tokens needs its own
// `@reference "./index.css"`.)
import * as esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { compile } from 'tailwindcss';
import type { BuildErrorInfo, ProjectFile } from '../../shared/types';
import { cssCdnUrl, isBareSpecifier, parseSpecifier, type PackageJsonLike } from './importmap';
import { findPackageDir } from './pkg';

export interface CssCompileInput {
  /** All project files (virtual file system). */
  files: readonly ProjectFile[];
  /** Project-relative paths of the local CSS files imported by the app, in import order. */
  cssPaths: readonly string[];
  mode: 'preview' | 'publish';
  /** Project package.json (version ranges for stylesheets loaded from the CDN). */
  pkg?: PackageJsonLike | null;
}

export interface CssCompileResult {
  css: string;
  /** Remote stylesheets to emit as `<link rel="stylesheet">` before the app style block, in order. */
  links: string[];
  errors: BuildErrorInfo[];
  warnings: BuildErrorInfo[];
}

/** Tailwind `Features` bit flags (a `declare const enum` in the package typings, unusable with isolatedModules). */
const FEATURE_UTILITIES = 16;

/** Browsers that Tailwind CSS v4 itself supports; CSS nesting etc. is lowered to this baseline. */
const CSS_TARGET = ['chrome111', 'safari16.4', 'firefox128'];

const CANDIDATE_SOURCE_RE = /\.(?:tsx?|jsx?|html|md)$/i;

/** Packages whose stylesheets are bundled with the builder: specifier → file relative to the package directory. */
const BUILTIN_STYLESHEETS: Record<string, [pkg: string, file: string]> = {
  tailwindcss: ['tailwindcss', 'index.css'],
  'tailwindcss/index': ['tailwindcss', 'index.css'],
  'tailwindcss/index.css': ['tailwindcss', 'index.css'],
  'tailwindcss/theme': ['tailwindcss', 'theme.css'],
  'tailwindcss/theme.css': ['tailwindcss', 'theme.css'],
  'tailwindcss/preflight': ['tailwindcss', 'preflight.css'],
  'tailwindcss/preflight.css': ['tailwindcss', 'preflight.css'],
  'tailwindcss/utilities': ['tailwindcss', 'utilities.css'],
  'tailwindcss/utilities.css': ['tailwindcss', 'utilities.css'],
  'tw-animate-css': ['tw-animate-css', 'dist/tw-animate.css'],
  'tw-animate-css/dist/tw-animate.css': ['tw-animate-css', 'dist/tw-animate.css'],
  'tw-animate-css/prefix': ['tw-animate-css', 'dist/tw-animate-prefix.css'],
};

const builtinCache = new Map<string, Promise<string>>();

function loadBuiltin(pkgName: string, file: string): Promise<string> {
  const key = `${pkgName}/${file}`;
  let hit = builtinCache.get(key);
  if (!hit) {
    hit = (async () => {
      const dir = findPackageDir(pkgName);
      if (!dir) throw new Error(`The "${pkgName}" package is not installed next to the builder`);
      return readFile(join(dir, file), 'utf8');
    })();
    hit.catch(() => builtinCache.delete(key));
    builtinCache.set(key, hit);
  }
  return hit;
}

function fileText(file: ProjectFile): string {
  return file.encoding === 'base64' ? Buffer.from(file.content, 'base64').toString('utf8') : file.content;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function lineTextAt(text: string, line: number): string | null {
  const lines = text.split('\n');
  const t = lines[line - 1];
  return t === undefined ? null : t.replace(/\r$/, '');
}

/**
 * Extracts Tailwind class candidates from source text: tokens split on whitespace, quotes and backticks
 * (plus, as additional variants, on `<>{}` and with surrounding punctuation trimmed). Tailwind ignores
 * everything that is not a valid utility, so over-collecting is harmless.
 */
export function extractCandidates(text: string, into: Set<string> = new Set()): Set<string> {
  for (const raw of text.split(/[\s"'`]+/)) {
    if (!raw || raw.length > 200) continue;
    addCandidate(raw, into);
    if (/[<>{}]/.test(raw)) {
      // `<div`, `className={cn(`, `${x}` … but keep the whole token too for arbitrary variants like `[&>svg]:size-4`
      for (const part of raw.split(/[<>{}]+/)) if (part) addCandidate(part, into);
    }
  }
  return into;
}

function addCandidate(token: string, into: Set<string>): void {
  // A candidate must contain a letter or digit and cannot contain these characters at all.
  if (!/[A-Za-z0-9]/.test(token)) return;
  into.add(token);
  // Trim punctuation that surrounds class names in code: `flex,` `(hidden)` `block:` `[x]:` `=flex`
  const trimmed = token.replace(/^[^A-Za-z0-9@!*\-[_]+/, '').replace(/[^A-Za-z0-9\])%!*]+$/, '');
  if (trimmed && trimmed !== token) into.add(trimmed);
  if (/[(),;=]/.test(token)) {
    for (const part of token.split(/[(),;=]+/)) {
      if (!part || !/[A-Za-z0-9]/.test(part)) continue;
      into.add(part);
      const t = part.replace(/^[^A-Za-z0-9@!*\-[_]+/, '').replace(/[^A-Za-z0-9\])%!*]+$/, '');
      if (t && t !== part) into.add(t);
    }
  }
}

/** Collects candidates from `src/**` sources and `index.html`. */
export function collectCandidates(files: readonly ProjectFile[]): string[] {
  const set = new Set<string>();
  for (const f of files) {
    if (f.encoding !== 'utf8') continue;
    if (f.path === 'index.html' || (f.path.startsWith('src/') && CANDIDATE_SOURCE_RE.test(f.path))) {
      extractCandidates(f.content, set);
    }
  }
  return [...set];
}

interface Preprocessed {
  css: string;
  links: string[];
  warnings: BuildErrorInfo[];
}

const IMPORT_RE = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)|"([^"]*)"|'([^']*)')([^;{}]*);?/g;
const URL_RE = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi;
const DROPPED_RE =/@(plugin|config|source)\b(?:[^;{}"']|"[^"]*"|'[^']*')*(?:;|\{[^{}]*\}|$)/g;

function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

/** Blanks out CSS comments (keeping offsets) so that at-rules inside comments are not touched. */
function maskCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (m) => blank(m));
}

/**
 * Source-level rewrites applied to every project stylesheet before Tailwind sees it:
 *  - `@import url(https://…)` / `@import "https://…"` → hoisted to a `<link>`
 *  - `@import "<npm package css>"` that is not bundled with the builder → hoisted to a jsDelivr `<link>`
 *  - `@plugin` / `@config` / `@source` → dropped with a warning (no JS plugins / file scanning in the sandbox)
 * Offsets and line numbers are preserved (removed text is replaced by spaces).
 */
function preprocess(
  path: string,
  source: string,
  exists: (p: string) => boolean,
  pkg: PackageJsonLike | null,
  assets?: (p: string) => string | undefined,
): Preprocessed {
  const links: string[] = [];
  const warnings: BuildErrorInfo[] = [];
  const masked = maskCssComments(source);
  const edits: Array<{ start: number; end: number; text?: string }> = [];
  const dir = posix.dirname(path);

  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(masked))) {
    const isUrlFn = m[1] !== undefined || m[2] !== undefined || m[3] !== undefined;
    const target = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').trim();
    if (!target) continue;
    let href: string | null = null;
    if (/^(?:https?:)?\/\//i.test(target)) {
      href = target.startsWith('//') ? `https:${target}` : target;
    } else if (/^data:/i.test(target)) {
      continue;
    } else if (!isUrlFn && isBareSpecifier(target) && !(target in BUILTIN_STYLESHEETS)) {
      // CSS resolves `@import "foo.css"` relative to the file first; only then is it an npm package.
      const rel = posix.normalize(posix.join(dir, target));
      const { name } = parseSpecifier(target);
      if (!exists(rel) && !exists(`${rel}.css`) && name !== 'tailwindcss' && name !== 'tw-animate-css') {
        href = cssCdnUrl(/\.css$/i.test(target.replace(/[?#].*$/, '')) || name.startsWith('@fontsource') ? target : `${target}/index.css`, pkg);
      }
    }
    if (href) {
      if (!links.includes(href)) links.push(href);
      edits.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  DROPPED_RE.lastIndex = 0;
  while ((m = DROPPED_RE.exec(masked))) {
    // `@source` must be an at-rule at statement level, not e.g. part of a longer identifier.
    const before = masked[m.index - 1];
    if (before !== undefined && /[\w-]/.test(before)) continue;
    const line = lineOf(source, m.index);
    edits.push({ start: m.index, end: m.index + m[0].length });
    warnings.push({
      file: path,
      line,
      column: null,
      message: `@${m[1]} is not supported in the Yasa preview and was ignored (Tailwind is compiled without JS plugins, config files or file scanning)`,
      lineText: lineTextAt(source, line),
    });
  }

  // url(./asset.png) → data URL (the compiled CSS is inlined in the page, so relative URLs would not resolve).
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(masked))) {
    if (edits.some((e) => m !== null && m.index >= e.start && m.index < e.end)) continue;
    if (/@import\s+$/i.test(masked.slice(Math.max(0, m.index - 12), m.index))) continue;
    const target = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
    const clean = target.replace(/[?#].*$/, '');
    let resolved: string;
    if (clean.startsWith('@/')) resolved = posix.join('src', clean.slice(2));
    else if (clean.startsWith('/')) {
      if (exists(`public${clean}`)) continue; // served by the sandbox at the same URL
      resolved = clean.replace(/^\/+/, '');
    } else resolved = posix.join(dir, clean);
    resolved = posix.normalize(resolved);
    const asset = resolved.startsWith('..') ? undefined : assets?.(resolved);
    if (!asset) continue;
    edits.push({ start: m.index, end: m.index + m[0].length, text: `url("${asset}")` });
  }

  if (edits.length === 0) return { css: source, links, warnings };
  let css = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    css = css.slice(0, e.start) + (e.text ?? blank(css.slice(e.start, e.end))) + css.slice(e.end);
  }
  return { css, links, warnings };
}

const ASSET_MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

function assetDataUrl(file: ProjectFile | undefined): string | undefined {
  if (!file) return undefined;
  const ext = file.path.slice(file.path.lastIndexOf('.') + 1).toLowerCase();
  const mime = ASSET_MIME[ext];
  if (!mime) return undefined;
  const base64 = file.encoding === 'base64' ? file.content.replace(/\s+/g, '') : Buffer.from(file.content, 'utf8').toString('base64');
  return `data:${mime};base64,${base64}`;
}

function resolveVirtual(id: string, base: string, exists: (p: string) => boolean): string | null {
  const baseDir = base.replace(/^\/+/, '');
  let target: string;
  if (id.startsWith('@/')) target = posix.join('src', id.slice(2));
  else if (id.startsWith('/')) target = id.replace(/^\/+/, '');
  else target = posix.join(baseDir, id);
  target = posix.normalize(target);
  if (target.startsWith('..')) return null;
  for (const cand of [target, `${target}.css`, posix.join(target, 'index.css')]) {
    if (exists(cand)) return cand;
  }
  return null;
}

interface CssErrorLocation {
  file: string | null;
  line: number | null;
  column: number | null;
  lineText: string | null;
  message: string;
}

function errorLocation(message: string, cssPath: string, byPath: Map<string, ProjectFile>): CssErrorLocation {
  // Parser errors carry a location prefix: "src/index.css:2:1: Missing closing } at .x".
  const prefixed = /^\/?(.+?):(\d+):(\d+):\s*(.*)$/s.exec(message);
  if (prefixed && prefixed[1] && prefixed[4]) {
    const path = prefixed[1].replace(/^\/+/, '');
    const file = byPath.get(path);
    const line = Number(prefixed[2]);
    return {
      file: file ? path : cssPath,
      line,
      column: Number(prefixed[3]),
      lineText: file ? lineTextAt(fileText(file), line) : null,
      message: prefixed[4],
    };
  }
  // Other messages quote the offending token in backticks: "Cannot apply unknown utility class `foo`".
  const quoted = /`([^`]+)`/.exec(message)?.[1];
  const file = byPath.get(cssPath);
  if (quoted && file) {
    const source = fileText(file);
    const idx = source.indexOf(quoted);
    if (idx !== -1) {
      const line = lineOf(source, idx);
      return { file: cssPath, line, column: null, lineText: lineTextAt(source, line), message };
    }
  }
  return { file: cssPath, line: null, column: null, lineText: null, message };
}

/**
 * Compiles the app's stylesheets. Never throws: failures are returned as `errors`
 * (file = the CSS file that failed to compile).
 */
export async function compileCss(input: CssCompileInput): Promise<CssCompileResult> {
  const { files, cssPaths, mode } = input;
  const pkg = input.pkg ?? null;
  const byPath = new Map<string, ProjectFile>();
  for (const f of files) byPath.set(f.path, f);
  const exists = (p: string): boolean => byPath.has(p);

  const links: string[] = [];
  const errors: BuildErrorInfo[] = [];
  const warnings: BuildErrorInfo[] = [];
  const chunks: string[] = [];
  let candidates: string[] | null = null;
  const warned = new Set<string>();

  const prep = (path: string): string => {
    const file = byPath.get(path);
    if (!file) return '';
    const res = preprocess(path, fileText(file), exists, pkg, (p) => assetDataUrl(byPath.get(p)));
    for (const l of res.links) if (!links.includes(l)) links.push(l);
    for (const w of res.warnings) {
      const key = `${w.file}:${w.line}:${w.message}`;
      if (!warned.has(key)) {
        warned.add(key);
        warnings.push(w);
      }
    }
    return res.css;
  };

  for (const cssPath of cssPaths) {
    const file = byPath.get(cssPath);
    if (!file) continue;
    const source = prep(cssPath);
    if (!source.trim()) continue;
    try {
      const compiler = await compile(source, {
        base: `/${posix.dirname(cssPath)}`,
        from: cssPath,
        loadStylesheet: async (id: string, base: string) => {
          const builtin = BUILTIN_STYLESHEETS[id];
          if (builtin) {
            const content = await loadBuiltin(builtin[0], builtin[1]);
            return { path: `/node_modules/${builtin[0]}/${builtin[1]}`, base: `/node_modules/${builtin[0]}`, content };
          }
          const resolved = resolveVirtual(id, base, exists);
          if (resolved) {
            return { path: `/${resolved}`, base: `/${posix.dirname(resolved)}`, content: prep(resolved) };
          }
          throw new Error(`Could not resolve stylesheet "${id}" imported from ${base.replace(/^\/+/, '') || '.'}/`);
        },
        loadModule: async (id: string, _base: string, hint: 'plugin' | 'config') => {
          throw new Error(`@${hint} "${id}" is not supported in the Yasa preview (no JS plugins or config files)`);
        },
      });
      let css: string;
      if (compiler.features === 0) {
        // Plain CSS without any Tailwind feature: keep it as written.
        css = source;
      } else {
        const needsCandidates = (compiler.features & FEATURE_UTILITIES) !== 0;
        if (needsCandidates) candidates ??= collectCandidates(files);
        css = compiler.build(needsCandidates ? (candidates ?? []) : []);
      }
      chunks.push(`/* ${cssPath.replace(/\*\//g, '')} */\n${css}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const loc = errorLocation(message, cssPath, byPath);
      errors.push({ file: loc.file, line: loc.line, column: loc.column, message: `CSS: ${loc.message}`, lineText: loc.lineText });
    }
  }

  let css = chunks.join('\n');
  if (css && errors.length === 0) {
    try {
      const out = await esbuild.transform(css, {
        loader: 'css',
        minify: mode === 'publish',
        target: CSS_TARGET,
        legalComments: 'none',
        logLevel: 'silent',
      });
      css = out.code;
    } catch (err) {
      const failure = err as { errors?: esbuild.Message[]; message?: string };
      const first = failure.errors?.[0];
      errors.push({
        file: cssPaths[0] ?? null,
        line: null,
        column: null,
        message: `CSS: ${first?.text ?? failure.message ?? 'failed to process the stylesheet'}`,
        lineText: first?.location?.lineText ?? null,
      });
    }
  }

  return { css: errors.length ? '' : css, links, errors, warnings };
}
