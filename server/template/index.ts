// Starter template: every new project begins as a copy of these files (SPEC §12, §15.11).
// Sources live in ./files/** and are compiled into ./generated.ts by scripts/gen-template.mjs.
import { createHash } from 'node:crypto';
import type { FileEncoding, Locale } from '../../shared/types';
import {
  TEMPLATE_DEFAULT_LOCALE,
  TEMPLATE_EXPORTS,
  TEMPLATE_FILES,
  TEMPLATE_HASHES,
  TEMPLATE_LOCALES,
} from './generated';

export { TEMPLATE_EXPORTS, TEMPLATE_HASHES };

export interface TemplateFile {
  content: string;
  encoding: FileEncoding;
}

/** Locales the template can be rendered in. */
export const TEMPLATE_LOCALE_NAMES = Object.keys(TEMPLATE_LOCALES) as Locale[];

/** Sorted POSIX paths of all template files. */
export const TEMPLATE_PATHS: readonly string[] = Object.keys(TEMPLATE_FILES);

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function markersFor(locale: Locale): Record<string, string> {
  const locales: Partial<Record<string, Record<string, string>>> = TEMPLATE_LOCALES;
  return locales[locale] ?? TEMPLATE_LOCALES[TEMPLATE_DEFAULT_LOCALE as keyof typeof TEMPLATE_LOCALES];
}

function render(content: string, markers: Record<string, string>): string {
  if (!content.includes('__YASA_')) return content;
  let out = content;
  for (const [marker, value] of Object.entries(markers)) out = out.split(marker).join(value);
  return out;
}

/**
 * The starter project for a locale: path → file. The placeholder text in `src/App.tsx` and
 * `<html lang>`, `<title>` and the description meta tags in `index.html` are localized.
 * Returns a fresh object on every call (safe to mutate).
 */
export function getTemplateFiles(locale: Locale = 'en'): Record<string, TemplateFile> {
  const markers = markersFor(locale);
  const out: Record<string, TemplateFile> = {};
  for (const [path, content] of Object.entries(TEMPLATE_FILES)) {
    out[path] = { content: render(content, markers), encoding: 'utf8' };
  }
  return out;
}

// path → sha256 of that file in every locale's rendering.
let knownHashes: Map<string, Set<string>> | null = null;

function getKnownHashes(): Map<string, Set<string>> {
  if (knownHashes) return knownHashes;
  const map = new Map<string, Set<string>>();
  for (const [path, content] of Object.entries(TEMPLATE_FILES)) {
    const set = new Set<string>();
    for (const markers of Object.values(TEMPLATE_LOCALES)) set.add(sha256(render(content, markers)));
    map.set(path, set);
  }
  knownHashes = map;
  return map;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(?:\.\/|\/)+/, '');
}

/**
 * True when `content` is byte-for-byte the pristine template file at `path`, in any locale's
 * rendering (line endings are normalized). Used to stub unchanged template files in AI context.
 */
export function isTemplateFile(path: string, content: string): boolean {
  const hashes = getKnownHashes().get(normalizePath(path));
  if (!hashes) return false;
  if (hashes.has(sha256(content))) return true;
  return content.includes('\r') && hashes.has(sha256(content.replace(/\r\n?/g, '\n')));
}
