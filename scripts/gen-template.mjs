// Generates server/template/generated.ts from the real starter-template files in
// server/template/files/** and the localized marker values in server/template/locales.json.
//
//   node scripts/gen-template.mjs           write generated.ts
//   node scripts/gen-template.mjs --check   exit 1 when generated.ts is out of date
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES_DIR = join(ROOT, 'server', 'template', 'files');
const LOCALES_FILE = join(ROOT, 'server', 'template', 'locales.json');
const OUT_FILE = join(ROOT, 'server', 'template', 'generated.ts');

const DEFAULT_LOCALE = 'en';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.vite']);
const SKIP_FILES = new Set(['package-lock.json', '.DS_Store', 'Thumbs.db']);
const TEXT_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|html|css|md|txt|svg)$/;
const TEXT_NAMES = new Set(['.gitignore', '.npmrc', '.env.example']);
const MARKER_RE = /__YASA_[A-Z0-9_]+__/g;
// Line/paragraph separators: escaped in the output so the generated file stays single-line per entry.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(full));
    } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function readTemplateFiles() {
  const files = {};
  for (const full of walk(FILES_DIR)) {
    const path = relative(FILES_DIR, full).split(sep).join('/');
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (!TEXT_EXT.test(name) && !TEXT_NAMES.has(name)) {
      throw new Error(`gen-template: unsupported (non-text) template file: ${path}`);
    }
    // Normalize line endings so hashes do not depend on git autocrlf settings.
    files[path] = stripBom(readFileSync(full, 'utf8')).replace(/\r\n?/g, '\n');
  }
  return sortKeys(files);
}

function sortKeys(record) {
  const sorted = {};
  for (const key of Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    sorted[key] = record[key];
  }
  return sorted;
}

function readLocales(files) {
  const locales = JSON.parse(readFileSync(LOCALES_FILE, 'utf8'));
  const used = new Set();
  for (const content of Object.values(files)) {
    for (const marker of content.match(MARKER_RE) ?? []) used.add(marker);
  }
  if (!locales[DEFAULT_LOCALE]) throw new Error(`gen-template: locales.json has no "${DEFAULT_LOCALE}"`);
  for (const [locale, values] of Object.entries(locales)) {
    for (const marker of used) {
      if (typeof values[marker] !== 'string' || values[marker].length === 0) {
        throw new Error(`gen-template: locale "${locale}" has no value for ${marker}`);
      }
    }
    for (const [marker, value] of Object.entries(values)) {
      if (!used.has(marker)) throw new Error(`gen-template: ${marker} (${locale}) is not used by any file`);
      // Values are inserted verbatim into HTML attributes and JSX text.
      if (/[<>&"'{}\\\r\n]/.test(value) || value.includes('__YASA_')) {
        throw new Error(`gen-template: unsafe characters in ${marker} (${locale}): ${value}`);
      }
    }
  }
  return locales;
}

/** Replace every marker with its localized value (same logic as server/template/index.ts). */
export function renderContent(content, values) {
  let out = content;
  for (const [marker, value] of Object.entries(values)) out = out.split(marker).join(value);
  return out;
}

export function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Exported identifier names of a TS/TSX module ("default" for a default export). */
export function extractExports(source) {
  const names = new Set();
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const declRe =
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of code.matchAll(declRe)) names.add(match[1]);
  if (/^export\s+default\b/m.test(code)) names.add('default');
  const listRe = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;
  for (const match of code.matchAll(listRe)) {
    for (const part of match[1].split(',')) {
      const spec = part.trim().replace(/^type\s+/, '');
      if (!spec) continue;
      const alias = spec.split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(alias)) names.add(alias);
    }
  }
  return [...names];
}

function toLiteral(value) {
  return JSON.stringify(value).split(LS).join('\\u2028').split(PS).join('\\u2029');
}

function recordLiteral(record) {
  const lines = Object.entries(record).map(([key, value]) => `  ${toLiteral(key)}: ${toLiteral(value)},`);
  return `{\n${lines.join('\n')}\n}`;
}

export function buildGenerated() {
  const files = readTemplateFiles();
  const locales = readLocales(files);
  const hashes = {};
  const exportsByFile = {};
  for (const [path, content] of Object.entries(files)) {
    hashes[path] = sha256(renderContent(content, locales[DEFAULT_LOCALE]));
    if (/\.tsx?$/.test(path)) exportsByFile[path] = extractExports(content);
  }
  const localeNames = Object.keys(locales).map((name) => toLiteral(name)).join(' | ');
  return [
    '// AUTO-GENERATED by scripts/gen-template.mjs from server/template/files/** and locales.json.',
    '// Do not edit by hand — change the template files and run `npm run gen:template`.',
    '',
    '/** Raw template sources (path → utf8 content). Localized markers (__YASA_*__) are NOT replaced here. */',
    `export const TEMPLATE_FILES: Record<string, string> = ${recordLiteral(files)};`,
    '',
    `/** path → sha256 (hex) of the file as rendered for the default ("${DEFAULT_LOCALE}") locale. */`,
    `export const TEMPLATE_HASHES: Record<string, string> = ${recordLiteral(hashes)};`,
    '',
    '/** path → exported identifier names, for every .ts/.tsx template file. */',
    `export const TEMPLATE_EXPORTS: Record<string, string[]> = ${recordLiteral(exportsByFile)};`,
    '',
    '/** locale → marker → localized value. */',
    `export const TEMPLATE_LOCALES: Record<${localeNames}, Record<string, string>> = ${recordLiteral(locales)};`,
    '',
    `export const TEMPLATE_DEFAULT_LOCALE = ${toLiteral(DEFAULT_LOCALE)};`,
    '',
  ].join('\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const next = buildGenerated();
  const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8').replace(/\r\n?/g, '\n') : null;
  const outName = relative(ROOT, OUT_FILE).split(sep).join('/');
  if (process.argv.includes('--check')) {
    if (current !== next) {
      console.error(`${outName} is out of date — run: node scripts/gen-template.mjs`);
      process.exit(1);
    }
    console.log(`${outName} is up to date`);
  } else if (current === next) {
    console.log(`${outName} unchanged`);
  } else {
    writeFileSync(OUT_FILE, next, 'utf8');
    console.log(`${outName} written`);
  }
}
