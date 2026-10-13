// Project file path helpers shared by server and web. No Node or DOM APIs.
import { LIMITS, PREVIEW_VERSION_SEPARATOR } from './constants';

const SEGMENT_RE = /^[A-Za-z0-9._@()+\[\]\- ]+$/;
const FORBIDDEN_ROOTS = ['node_modules', '.git', 'dist'];

/** Converts backslashes, trims, removes leading "./" and "/". Does not validate. */
export function normalizePath(input: string): string {
  let p = input.trim().replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  while (p.startsWith('/')) p = p.slice(1);
  return p.replace(/\/{2,}/g, '/');
}

/** Returns an error message, or null when the (already normalized) path is acceptable. */
export function pathError(path: string): string | null {
  if (!path) return 'Path is empty';
  if (path.length > LIMITS.pathMax) return `Path is longer than ${LIMITS.pathMax} characters`;
  if (path.includes('\\')) return 'Backslashes are not allowed';
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return 'Absolute paths are not allowed';
  if (path.endsWith('/')) return 'Path must point to a file';
  const segments = path.split('/');
  for (const seg of segments) {
    if (!seg) return 'Empty path segment';
    if (seg === '.' || seg === '..') return 'Relative segments are not allowed';
    if (!SEGMENT_RE.test(seg)) return `Invalid characters in "${seg}"`;
    if (seg.endsWith('.') || seg.endsWith(' ') || seg.startsWith(' ')) return `Invalid segment "${seg}"`;
  }
  if (FORBIDDEN_ROOTS.includes(segments[0])) return `Writing to ${segments[0]}/ is not allowed`;
  return null;
}

export function isValidPath(path: string): boolean {
  return pathError(path) === null;
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Lowercased extension without the dot ("" when none). */
export function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase();
}

export type EditorLanguage = 'typescript' | 'javascript' | 'css' | 'html' | 'json' | 'markdown' | 'text';

export function languageFor(path: string): EditorLanguage {
  switch (extname(path)) {
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'css':
      return 'css';
    case 'html':
    case 'htm':
    case 'svg':
      return 'html';
    case 'json':
      return 'json';
    case 'md':
    case 'mdx':
      return 'markdown';
    default:
      return 'text';
  }
}

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'webm', 'ogg', 'wav', 'pdf', 'zip',
]);

export function isBinaryPath(path: string): boolean {
  return BINARY_EXT.has(extname(path));
}

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  webmanifest: 'application/manifest+json',
};

export function mimeFor(path: string): string {
  return MIME[extname(path)] ?? 'application/octet-stream';
}

/** http://pv-abc.localhost:3000/ + 7 → http://pv-abc--v7.localhost:3000/ */
export function versionPreviewUrl(previewUrl: string, versionNumber: number): string {
  const m = /^(https?:\/\/)([^./]+)(\..*)$/.exec(previewUrl);
  if (!m) return previewUrl;
  return `${m[1]}${m[2]}${PREVIEW_VERSION_SEPARATOR}${versionNumber}${m[3]}`;
}

/** Counts lines the way editors do (empty string → 0). */
export function countLines(text: string): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return text.endsWith('\n') ? n - 1 : n;
}
