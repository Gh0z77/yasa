// Housekeeping the agent does itself after a pass, so a forgetful model does not cost another round-trip (or a
// blank page): declaring the packages the code imports, and spotting screens that were written but never rendered.
import type { BuildErrorInfo, FileChange } from '../../shared/types';
import { applyDependency, type WorkingTree } from './apply';

/** Version ranges for the packages the system prompt recommends; anything else is declared as "latest". */
const KNOWN_RANGES: Record<string, string> = {
  recharts: '^3',
  '@tanstack/react-table': '^8',
  '@tanstack/react-query': '^5',
  'react-hook-form': '^7',
  zod: '^4',
  '@hookform/resolvers': '^5',
  'date-fns': '^4',
  'react-day-picker': '^9',
  motion: '^12',
  'framer-motion': '^12',
  'embla-carousel-react': '^8',
  '@dnd-kit/core': '^6',
  '@dnd-kit/sortable': '^10',
  '@dnd-kit/utilities': '^3',
  zustand: '^5',
  'react-router': '^7',
  'react-router-dom': '^7',
  'react-markdown': '^10',
  leaflet: '^1.9',
  'react-leaflet': '^5',
  'qrcode.react': '^4',
  'canvas-confetti': '^1',
  'react-number-format': '^5',
  '@tiptap/react': '^3',
  '@tiptap/starter-kit': '^3',
  '@supabase/supabase-js': '^2',
};

/**
 * Adds the given packages to package.json. Returns the resulting file change (empty when nothing was added), so
 * the exported project installs with `npm install` and the preview loads a pinned major version.
 */
export function declareDependencies(tree: WorkingTree, names: readonly string[]): FileChange[] {
  let last: FileChange | null = null;
  for (const name of names) {
    const result = applyDependency(tree, name, KNOWN_RANGES[name] ?? 'latest');
    if (result.ok && result.changes.length > 0) last = result.changes[result.changes.length - 1]!;
  }
  return last ? [last] : [];
}

/** Puts the working tree back to an earlier state and returns the file changes that does. */
export function restoreTree(tree: WorkingTree, snapshot: WorkingTree): FileChange[] {
  const changes: FileChange[] = [];
  for (const path of [...tree.keys()]) {
    if (snapshot.has(path)) continue;
    tree.delete(path);
    changes.push({ path, kind: 'delete' });
  }
  for (const [path, file] of snapshot) {
    const current = tree.get(path);
    if (current && current.content === file.content && current.encoding === file.encoding) continue;
    tree.set(path, file);
    changes.push({ path, kind: 'upsert', content: file.content, encoding: file.encoding });
  }
  return changes;
}

const RE_POLICY_IF_NOT_EXISTS = /create\s+policy\s+if\s+not\s+exists\s+("[^"]+"|[\w$]+)\s+on\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/gi;

/** True for the SQL migrations the Supabase panel applies. */
export const isMigrationPath = (path: string): boolean => /^supabase\/migrations\/[^/]+\.sql$/.test(path);

/**
 * Postgres has no `create policy if not exists`, yet models keep writing it and the whole migration then fails.
 * It is rewritten to the form that works and can be applied twice: drop if exists, then create.
 */
export function fixMigrationSql(sql: string): string {
  return sql.replace(RE_POLICY_IF_NOT_EXISTS, (_match, name: string, table: string) => `drop policy if exists ${name} on ${table};\ncreate policy ${name} on ${table}`);
}

/** Screens and components; the UI kit is a library, so unused parts of it are expected. */
const VISIBLE_SOURCE = /^src\/(?!components\/ui\/).+\.(?:tsx|jsx)$/;
const NOT_APP_CODE = /\.(?:test|spec|stories)\.[jt]sx$/;

const ANY_SOURCE = /^src\/(?!components\/ui\/).+\.(?:tsx?|jsx?)$/;

/**
 * Files written in this turn that the bundle does not contain: nothing imports them, so the user never sees them.
 * Screens and components are always reported. Plain modules (types, stores, helpers) are reported only when
 * nothing at all of what was written is in use — the sign of an answer that stopped after its first files.
 */
export function unusedFiles(bundled: readonly string[], written: Iterable<string>, tree: WorkingTree): string[] {
  const inBundle = new Set(bundled);
  const paths = [...new Set(written)].filter((path) => tree.has(path) && !NOT_APP_CODE.test(path) && !path.endsWith('.d.ts'));
  const screens = paths.filter((path) => VISIBLE_SOURCE.test(path) && !inBundle.has(path)).sort();
  if (screens.length > 0) return screens;
  const sources = paths.filter((path) => ANY_SOURCE.test(path));
  return sources.length > 0 && !sources.some((path) => inBundle.has(path)) ? sources.sort() : [];
}

export function unusedFileError(path: string): BuildErrorInfo {
  return { file: path, line: null, column: null, message: 'This file is not imported anywhere, so it never appears in the app.', lineText: '' };
}
