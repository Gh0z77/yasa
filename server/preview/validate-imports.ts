// Named-import validation (SPEC §15.5).
//
// The preview bundle marks npm packages as external (they are loaded from esm.sh in the browser), so esbuild
// cannot tell that `import { Github } from 'lucide-react'` names an export that does not exist — the browser
// would only fail at link time with an opaque SyntaxError and a blank page. For the packages that are installed
// next to the builder we therefore compare named imports with the real export list.
//
// How type-only imports are ignored: every candidate file is first passed through `esbuild.transform`, which
// (exactly like the real bundle) drops `import type`, inline `type` specifiers and — in .ts/.tsx files — imported
// names that are never used as values (`import { ReactNode } from 'react'`). Only the names that survive, i.e. the
// ones the browser will really link, are validated. The original source is then searched for file/line info.
import * as esbuild from 'esbuild';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { BuildErrorInfo } from '../../shared/types';
import { declaredVersion, parseSpecifier, type PackageJsonLike } from './importmap';
import { installedPackage } from './pkg';

/** Packages whose named imports are validated (root specifier only, plus the listed subpaths). */
export const VALIDATED_PACKAGES = [
  'lucide-react',
  'react',
  'react-dom',
  'clsx',
  'tailwind-merge',
  'class-variance-authority',
  'sonner',
  'radix-ui',
  // The libraries the system prompt recommends: a wrong named import is the usual way they break a preview.
  'recharts',
  '@tanstack/react-table',
  '@tanstack/react-query',
  'react-hook-form',
  '@hookform/resolvers',
  'date-fns',
  'react-router-dom',
  'motion',
  'zustand',
  'zod',
] as const;

const VALIDATED_SPECIFIERS = new Set<string>([...VALIDATED_PACKAGES, 'react-dom/client', '@hookform/resolvers/zod', 'motion/react', 'zustand/middleware']);

/** Brand / logo icons that existed in lucide < 1 and were removed in v1. */
const LUCIDE_BRANDS = new Set(
  [
    'Github', 'Gitlab', 'Twitter', 'Facebook', 'Instagram', 'Linkedin', 'Youtube', 'Twitch', 'Chrome', 'Figma',
    'Slack', 'Codepen', 'Codesandbox', 'Dribbble', 'Framer', 'Pocket', 'Trello', 'Telegram', 'Whatsapp', 'Tiktok',
    'Discord', 'Pinterest', 'Reddit', 'Snapchat', 'Spotify', 'Apple', 'Google', 'Microsoft', 'Amazon', 'Paypal',
    'Behance', 'Medium', 'Skype', 'Vimeo', 'Wechat', 'Line', 'Messenger', 'Threads', 'Mastodon', 'Bluesky', 'Xing',
    'GithubSquare', 'TwitterSquare', 'FacebookSquare', 'InstagramSquare', 'LinkedinSquare', 'YoutubeSquare',
  ].map((n) => n.toLowerCase()),
);

export interface ValidateSource {
  path: string;
  content: string;
}

interface ExportInfo {
  names: Set<string>;
  list: string[];
}

const exportCache = new Map<string, Promise<ExportInfo | null>>();

/** Compatible release line: same major, and for 0.x also the same minor. */
function releaseLine(version: string | null): string | null {
  if (!version) return null;
  const m = /^[~^]?v?(\d+)(?:\.(\d+|x|\*))?/.exec(version);
  if (!m) return null;
  if (m[1] !== '0') return m[1] ?? null;
  return m[2] !== undefined && /^\d+$/.test(m[2]) ? `0.${m[2]}` : '0';
}

async function importInstalled(specifier: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(specifier)) as Record<string, unknown>;
  } catch {
    /* fall through to a file-URL import (bundled server whose cwd differs from the install location) */
  }
  try {
    const { name, subpath } = parseSpecifier(specifier);
    const info = installedPackage(name);
    if (!info) return null;
    const candidates: string[] = [];
    if (subpath) candidates.push(join(info.dir, `${subpath}.js`), join(info.dir, subpath, 'index.js'));
    else {
      const main = typeof info.json.main === 'string' ? info.json.main : 'index.js';
      candidates.push(join(info.dir, main));
    }
    for (const file of candidates) {
      if (existsSync(file)) return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Real export names of an installed package (dynamic import, cached for the process lifetime).
 * Returns null when the package cannot be loaded — validation is then skipped for it.
 */
export function getPackageExports(specifier: string): Promise<ExportInfo | null> {
  let hit = exportCache.get(specifier);
  if (!hit) {
    hit = (async (): Promise<ExportInfo | null> => {
      const ns = await importInstalled(specifier);
      if (!ns) return null;
      const names = new Set<string>(Object.keys(ns));
      // CommonJS packages: named exports that the static CJS lexer missed still exist on the default export,
      // and esm.sh exposes all of them as named ESM exports.
      const def = ns.default;
      if (def && (typeof def === 'object' || typeof def === 'function')) {
        for (const k of Object.keys(def as object)) names.add(k);
      }
      names.delete('__esModule');
      names.delete('module.exports');
      if (names.size === 0) return null;
      return { names, list: [...names] };
    })();
    exportCache.set(specifier, hit);
  }
  return hit;
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length] ?? max + 1;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** Closest existing export name, or null when nothing is reasonably close. */
export function suggestName(name: string, candidates: readonly string[]): string | null {
  const wantsIconSuffix = /Icon$/.test(name);
  const wantsLucidePrefix = /^Lucide[A-Z]/.test(name);
  const lower = name.toLowerCase();
  const max = Math.max(2, Math.ceil(name.length * 0.6));
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const cand of candidates) {
    if (cand === name || cand === 'default') continue;
    // lucide exports every icon three times (Foo, FooIcon, LucideFoo): suggest the form the author used.
    if (!wantsIconSuffix && /[a-z0-9]Icon$/.test(cand)) continue;
    if (!wantsLucidePrefix && /^Lucide[A-Z]/.test(cand)) continue;
    const candLower = cand.toLowerCase();
    if (candLower === lower) return cand;
    const dist = levenshtein(lower, candLower, max);
    if (dist > max) continue;
    // Only close matches: a small typo, or a different ending of the same word stem — at least half of the name
    // must be a shared prefix (Github → GitFork, but not useNope → useMemo or Twitter → Theater).
    if (dist > 2 && commonPrefix(lower, candLower) < Math.max(3, Math.ceil(name.length / 2))) continue;
    const score = dist - Math.min(commonPrefix(lower, candLower), 4) * 0.5 + Math.abs(cand.length - name.length) * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

export interface NamedImportRef {
  specifier: string;
  /** Exported name as written in the import (`A` in `import { A as B }`). */
  name: string;
}

const IMPORT_RE = /(?:^|[;}\n])\s*(import|export)\s*([^"'`;()]*?)\s*from\s*(["'])([^"'\n]+)\3/g;

function parseClauseNames(clause: string): string[] {
  let c = clause.trim();
  // `import type { … }` / `export type { … }` — erased by TypeScript.
  if (/^type\s*\{/.test(c)) return [];
  const open = c.indexOf('{');
  const close = c.lastIndexOf('}');
  if (open === -1 || close < open) return [];
  c = c.slice(open + 1, close);
  const out: string[] = [];
  for (const part of c.split(',')) {
    const spec = part.trim();
    if (!spec) continue;
    // inline type-only specifier: `type Foo`, `type Foo as Bar` (but not a value that is named "type": `type as T`)
    if (/^type\s+[A-Za-z_$]/.test(spec) && !/^type\s+as\s+[\w$]+$/.test(spec)) continue;
    // `A as B`: the name that must exist in the source module is A, for imports and re-exports alike.
    const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+[A-Za-z_$"'][^,]*)?$/.exec(spec);
    if (!m || !m[1]) continue;
    if (m[1] === 'default') continue;
    out.push(m[1]);
  }
  return out;
}

/** Named imports / re-exports of ES import declarations in `code` (comments must already be stripped). */
export function parseNamedImports(code: string): NamedImportRef[] {
  const out: NamedImportRef[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(code))) {
    const names = parseClauseNames(m[2] ?? '');
    for (const name of names) out.push({ specifier: m[4] ?? '', name });
    // allow the terminating character of this match to start the next statement
    IMPORT_RE.lastIndex = Math.max(IMPORT_RE.lastIndex - 1, m.index + 1);
  }
  return out;
}

/** Replaces comments by spaces (same length, newlines kept) so offsets and line numbers stay valid. */
export function maskComments(code: string): string {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i] as string;
    const next = code[i + 1];
    if (ch === '/' && next === '/') {
      let j = i;
      while (j < n && code[j] !== '\n') j++;
      out += ' '.repeat(j - i);
      i = j;
    } else if (ch === '/' && next === '*') {
      let j = code.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      out += code.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
    } else if (ch === '"' || ch === "'") {
      // ordinary string: ends at the matching quote or at the end of the line (tolerates apostrophes in JSX text)
      let j = i + 1;
      while (j < n && code[j] !== ch && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, n);
      out += code.slice(i, j);
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function loaderFor(path: string): esbuild.Loader | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'tsx') return 'tsx';
  if (ext === 'ts' || ext === 'mts' || ext === 'cts') return 'ts';
  if (ext === 'jsx' || ext === 'js') return 'jsx';
  if (ext === 'mjs' || ext === 'cjs') return 'js';
  return null;
}

function locate(source: string, specifier: string, name: string): { line: number; column: number; lineText: string } | null {
  const masked = maskComments(source);
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const nameRe = new RegExp(`(^|[^\\w$])(${name.replace(/[$]/g, '\\$')})(?![\\w$])`);
  while ((m = IMPORT_RE.exec(masked))) {
    const next = Math.max(IMPORT_RE.lastIndex - 1, m.index + 1);
    if (m[4] === specifier) {
      const clause = m[2] ?? '';
      const clauseStart = m.index + m[0].indexOf(clause, (m[1] ?? '').length);
      const hit = nameRe.exec(clause);
      if (hit) {
        const offset = clauseStart + hit.index + (hit[1] ?? '').length;
        const before = source.slice(0, offset);
        const line = before.split('\n').length;
        const lineStart = before.lastIndexOf('\n') + 1;
        let lineEnd = source.indexOf('\n', offset);
        if (lineEnd === -1) lineEnd = source.length;
        return { line, column: offset - lineStart + 1, lineText: source.slice(lineStart, lineEnd).replace(/\r$/, '') };
      }
    }
    IMPORT_RE.lastIndex = next;
  }
  return null;
}

function describeMissing(pkgName: string, specifier: string, name: string, exports: ExportInfo, home: string | null): string {
  // The name is real, only imported from the wrong package (`useState` from a form library).
  if (home) return `${specifier} has no export "${name}": it is exported by "${home}". Import it from there.`;
  const suggestion = suggestName(name, exports.list);
  const didYouMean = suggestion ? ` Did you mean "${suggestion}"?` : '';
  if (pkgName === 'lucide-react') {
    const base = name.replace(/^Lucide(?=[A-Z])/, '').replace(/Icon$/, '').toLowerCase();
    if (LUCIDE_BRANDS.has(base)) {
      return `lucide-react has no export "${name}" (brand icons were removed in lucide v1). Use "@/components/brand-icons" or a generic icon.${didYouMean}`;
    }
    return `lucide-react has no export "${name}" (this icon does not exist in the installed lucide version).${didYouMean}`;
  }
  return `${specifier} has no export "${name}".${didYouMean}`;
}

/**
 * Validates named imports of the known packages in the given source files.
 * `pkg` is the project's package.json — a package is validated only when the project declares a version of the
 * same release line (major) as the copy installed next to the builder.
 */
export async function validateImports(sources: readonly ValidateSource[], pkg: PackageJsonLike | null): Promise<BuildErrorInfo[]> {
  const errors: BuildErrorInfo[] = [];
  if (!pkg) return errors;

  // Which packages are eligible for this project?
  const eligible = new Set<string>();
  for (const name of VALIDATED_PACKAGES) {
    const declared = releaseLine(declaredVersion(pkg, name));
    const installed = installedPackage(name);
    if (!declared || !installed) continue;
    if (declared === releaseLine(installed.version)) eligible.add(name);
  }
  if (eligible.size === 0) return errors;

  for (const src of sources) {
    const loader = loaderFor(src.path);
    if (!loader) continue;
    let mentions = false;
    for (const name of eligible) {
      if (src.content.includes(name)) {
        mentions = true;
        break;
      }
    }
    if (!mentions) continue;

    let code: string;
    try {
      const res = await esbuild.transform(src.content, {
        loader,
        jsx: 'preserve',
        format: 'esm',
        target: 'esnext',
        minifyWhitespace: true,
        logLevel: 'silent',
        sourcefile: src.path,
      });
      code = res.code;
    } catch {
      continue; // syntax errors are reported by the bundler itself
    }

    const seen = new Set<string>();
    for (const ref of parseNamedImports(code)) {
      if (!VALIDATED_SPECIFIERS.has(ref.specifier)) continue;
      const pkgName = parseSpecifier(ref.specifier).name;
      if (!eligible.has(pkgName)) continue;
      const key = `${ref.specifier}\n${ref.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const exports = await getPackageExports(ref.specifier);
      if (!exports || exports.names.has(ref.name)) continue;
      const react = pkgName === 'react' ? null : await getPackageExports('react');
      const home = react?.names.has(ref.name) ? 'react' : null;
      const loc = locate(src.content, ref.specifier, ref.name);
      errors.push({
        file: src.path,
        line: loc?.line ?? null,
        column: loc?.column ?? null,
        message: describeMissing(pkgName, ref.specifier, ref.name, exports, home),
        lineText: loc?.lineText ?? null,
      });
    }
  }
  return errors;
}
