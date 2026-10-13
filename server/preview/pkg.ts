// Locating packages installed next to the builder (its own node_modules), without relying on the
// packages' `exports` maps (several of them do not export ./package.json or their CSS files).
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function candidateRoots(): string[] {
  const roots: string[] = [];
  const push = (dir: string | undefined | null): void => {
    if (!dir) return;
    let cur = resolve(dir);
    for (let i = 0; i < 12; i++) {
      const nm = join(cur, 'node_modules');
      if (!roots.includes(nm)) roots.push(nm);
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  };
  try {
    // Works both from source (tsx/vitest) and from a bundled dist/server/index.js.
    push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* import.meta.url unavailable (exotic bundling) */
  }
  push(process.cwd());
  if (process.argv[1]) push(dirname(process.argv[1]));
  try {
    const req = createRequire(import.meta.url);
    for (const p of req.resolve.paths('x') ?? []) if (!roots.includes(p)) roots.push(p);
  } catch {
    /* ignore */
  }
  return roots;
}

let rootsCache: string[] | null = null;
const dirCache = new Map<string, string | null>();

/** Absolute directory of an installed package (`<…>/node_modules/<name>`), or null when not installed. */
export function findPackageDir(name: string): string | null {
  const hit = dirCache.get(name);
  if (hit !== undefined) return hit;
  rootsCache ??= candidateRoots();
  let found: string | null = null;
  for (const root of rootsCache) {
    const dir = join(root, ...name.split('/'));
    if (existsSync(join(dir, 'package.json'))) {
      found = dir;
      break;
    }
  }
  dirCache.set(name, found);
  return found;
}

export interface InstalledPackageInfo {
  dir: string;
  version: string;
  json: Record<string, unknown>;
}

const infoCache = new Map<string, InstalledPackageInfo | null>();

export function installedPackage(name: string): InstalledPackageInfo | null {
  const hit = infoCache.get(name);
  if (hit !== undefined) return hit;
  let info: InstalledPackageInfo | null = null;
  const dir = findPackageDir(name);
  if (dir) {
    try {
      const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
      if (typeof json.version === 'string') info = { dir, version: json.version, json };
    } catch {
      info = null;
    }
  }
  infoCache.set(name, info);
  return info;
}
