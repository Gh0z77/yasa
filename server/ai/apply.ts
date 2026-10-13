// Applies parsed actions to an in-memory working tree. Pure (no DB): the agent persists the returned changes.
import { diffLines } from 'diff';
import { LIMITS } from '../../shared/constants';
import { normalizePath, pathError } from '../../shared/paths';
import type { FileChange, FileEncoding } from '../../shared/types';
import { relaxCaret } from '../preview/importmap';
import type { EditBlock, ParsedAction } from './parser';

export interface TreeFile {
  content: string;
  encoding: FileEncoding;
}

export type WorkingTree = Map<string, TreeFile>;

export interface ApplyResult {
  ok: boolean;
  error?: string;
  /** Normalized target path (when the action has one). */
  path?: string;
  changes: FileChange[];
  linesAdded: number;
  linesRemoved: number;
  /** For failed edits: the SEARCH text that could not be located. */
  failedSearch?: string;
}

function fail(error: string, extra: Partial<ApplyResult> = {}): ApplyResult {
  return { ok: false, error, changes: [], linesAdded: 0, linesRemoved: 0, ...extra };
}

function lineStats(before: string, after: string): { added: number; removed: number } {
  if (before === after) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const part of diffLines(before, after)) {
    if (part.added) added += part.count ?? 0;
    else if (part.removed) removed += part.count ?? 0;
  }
  return { added, removed };
}

function checkPath(raw: string): { path: string } | { error: string } {
  const path = normalizePath(raw ?? '');
  const error = pathError(path);
  return error ? { error: `Invalid path "${raw}": ${error}` } : { path };
}

function treeBytes(tree: WorkingTree): number {
  let total = 0;
  for (const file of tree.values()) total += file.content.length;
  return total;
}

function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? '';
}

interface Located {
  start: number;
  end: number;
  /** Replacement text adjusted to the indentation found in the file. */
  replacement: string;
}

/** Finds a SEARCH block: exact, then ignoring trailing whitespace, then ignoring indentation. */
export function locateBlock(content: string, block: EditBlock): Located | { error: string } {
  const search = block.search;
  const AMBIGUOUS = { error: 'SEARCH text matches more than one place; include more surrounding lines' };

  // 1. Exact match covering whole lines (the normal case).
  const wholeLine: number[] = [];
  const partial: number[] = [];
  for (let at = content.indexOf(search); at !== -1; at = content.indexOf(search, at + 1)) {
    const end = at + search.length;
    const startsLine = at === 0 || content[at - 1] === '\n';
    const endsLine = end === content.length || content[end] === '\n';
    (startsLine && endsLine ? wholeLine : partial).push(at);
  }
  if (wholeLine.length === 1) return { start: wholeLine[0], end: wholeLine[0] + search.length, replacement: block.replace };
  if (wholeLine.length > 1) return AMBIGUOUS;

  const contentLines = content.split('\n');
  const searchLines = search.split('\n');
  while (searchLines.length > 1 && searchLines[searchLines.length - 1].trim() === '') searchLines.pop();
  while (searchLines.length > 1 && searchLines[0].trim() === '') searchLines.shift();

  const offsets: number[] = [];
  let acc = 0;
  for (const line of contentLines) {
    offsets.push(acc);
    acc += line.length + 1;
  }

  const tryMatch = (normalize: (s: string) => string): number[] => {
    const wanted = searchLines.map(normalize);
    const hits: number[] = [];
    for (let i = 0; i + wanted.length <= contentLines.length; i++) {
      let ok = true;
      for (let j = 0; j < wanted.length; j++) {
        if (normalize(contentLines[i + j]) !== wanted[j]) {
          ok = false;
          break;
        }
      }
      if (ok) hits.push(i);
    }
    return hits;
  };

  const span = (lineIndex: number): { start: number; end: number } => {
    const last = lineIndex + searchLines.length - 1;
    return { start: offsets[lineIndex], end: offsets[last] + contentLines[last].length };
  };

  // 2. Ignore trailing whitespace.
  let hits = tryMatch((s) => s.replace(/\s+$/, ''));
  if (hits.length === 1) return { ...span(hits[0]), replacement: block.replace };
  if (hits.length > 1) return { error: 'SEARCH text matches more than one place; include more surrounding lines' };

  // 3. Ignore indentation; re-indent the replacement by the difference.
  hits = tryMatch((s) => s.trim());
  if (hits.length > 1) return { error: 'SEARCH text matches more than one place; include more surrounding lines' };
  if (hits.length === 1) {
    const fileLine = contentLines.slice(hits[0], hits[0] + searchLines.length).find((l) => l.trim() !== '') ?? '';
    const searchLine = searchLines.find((l) => l.trim() !== '') ?? '';
    const fileIndent = indentOf(fileLine);
    const searchIndent = indentOf(searchLine);
    let replacement = block.replace;
    if (fileIndent !== searchIndent) {
      replacement = block.replace
        .split('\n')
        .map((line) => {
          if (line.trim() === '') return line;
          if (fileIndent.length > searchIndent.length) return fileIndent.slice(0, fileIndent.length - searchIndent.length) + line;
          const strip = searchIndent.length - fileIndent.length;
          const lead = indentOf(line);
          return line.slice(Math.min(strip, lead.length));
        })
        .join('\n');
    }
    return { ...span(hits[0]), replacement };
  }

  // 4. Exact text inside a line (inline edits such as changing one word).
  if (partial.length === 1) return { start: partial[0], end: partial[0] + search.length, replacement: block.replace };
  if (partial.length > 1) return AMBIGUOUS;

  return { error: 'SEARCH text was not found in the file' };
}

function applyWrite(tree: WorkingTree, rawPath: string, content: string): ApplyResult {
  const checked = checkPath(rawPath);
  if ('error' in checked) return fail(checked.error);
  const { path } = checked;
  if (Buffer.byteLength(content, 'utf8') > LIMITS.fileBytesMax) {
    return fail(`${path} is larger than ${LIMITS.fileBytesMax / 1024} KB; split it into smaller files`, { path });
  }
  const existing = tree.get(path);
  if (!existing && tree.size >= LIMITS.projectFilesMax) return fail(`The project already has ${LIMITS.projectFilesMax} files`, { path });
  if (treeBytes(tree) - (existing?.content.length ?? 0) + content.length > LIMITS.projectBytesMax) {
    return fail('The project would become too large', { path });
  }
  if (path === 'package.json') {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    } catch {
      return fail('package.json must stay valid JSON', { path });
    }
  }
  const before = existing && existing.encoding === 'utf8' ? existing.content : '';
  if (existing && existing.encoding === 'utf8' && existing.content === content) {
    return { ok: true, path, changes: [], linesAdded: 0, linesRemoved: 0 };
  }
  const stats = lineStats(before, content);
  tree.set(path, { content, encoding: 'utf8' });
  return {
    ok: true,
    path,
    changes: [{ path, kind: 'upsert', content, encoding: 'utf8' }],
    linesAdded: stats.added,
    linesRemoved: stats.removed,
  };
}

function applyEdit(tree: WorkingTree, rawPath: string, blocks: EditBlock[], parseError?: string): ApplyResult {
  const checked = checkPath(rawPath);
  if ('error' in checked) return fail(checked.error);
  const { path } = checked;
  if (parseError) return fail(parseError, { path });
  const existing = tree.get(path);
  if (!existing) return fail(`${path} does not exist; use yasa-write to create it`, { path });
  if (existing.encoding !== 'utf8') return fail(`${path} is a binary file and cannot be edited`, { path });

  // Line endings are normalized so SEARCH blocks (always \n) can match.
  let content = existing.content.replace(/\r\n/g, '\n');
  for (const block of blocks) {
    const located = locateBlock(content, block);
    if ('error' in located) {
      const firstLine = block.search.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
      return fail(`${located.error} (starting at: "${firstLine.slice(0, 80)}")`, { path, failedSearch: block.search });
    }
    content = content.slice(0, located.start) + located.replacement + content.slice(located.end);
  }
  if (Buffer.byteLength(content, 'utf8') > LIMITS.fileBytesMax) {
    return fail(`${path} would be larger than ${LIMITS.fileBytesMax / 1024} KB`, { path });
  }
  if (path === 'package.json') {
    try {
      JSON.parse(content);
    } catch {
      return fail('package.json must stay valid JSON', { path });
    }
  }
  if (content === existing.content) return { ok: true, path, changes: [], linesAdded: 0, linesRemoved: 0 };
  const stats = lineStats(existing.content, content);
  tree.set(path, { content, encoding: 'utf8' });
  return {
    ok: true,
    path,
    changes: [{ path, kind: 'upsert', content, encoding: 'utf8' }],
    linesAdded: stats.added,
    linesRemoved: stats.removed,
  };
}

function applyDelete(tree: WorkingTree, rawPath: string): ApplyResult {
  const checked = checkPath(rawPath);
  if ('error' in checked) return fail(checked.error);
  const { path } = checked;
  const existing = tree.get(path);
  // Deleting something that is already gone is not an error worth a repair pass.
  if (!existing) return { ok: true, path, changes: [], linesAdded: 0, linesRemoved: 0 };
  if (path === 'package.json' || path === 'index.html') return fail(`${path} cannot be deleted`, { path });
  tree.delete(path);
  const removed = existing.encoding === 'utf8' ? lineStats(existing.content, '').removed : 0;
  return { ok: true, path, changes: [{ path, kind: 'delete' }], linesAdded: 0, linesRemoved: removed };
}

function applyRename(tree: WorkingTree, rawFrom: string, rawTo: string): ApplyResult {
  const from = checkPath(rawFrom);
  if ('error' in from) return fail(from.error);
  const to = checkPath(rawTo);
  if ('error' in to) return fail(to.error);
  const source = tree.get(from.path);
  if (!source) return fail(`${from.path} does not exist`, { path: to.path });
  if (from.path === to.path) return { ok: true, path: to.path, changes: [], linesAdded: 0, linesRemoved: 0 };
  if (tree.has(to.path)) return fail(`${to.path} already exists`, { path: to.path });
  tree.delete(from.path);
  tree.set(to.path, source);
  return {
    ok: true,
    path: to.path,
    changes: [
      { path: from.path, kind: 'delete' },
      { path: to.path, kind: 'upsert', content: source.content, encoding: source.encoding },
    ],
    linesAdded: 0,
    linesRemoved: 0,
  };
}

const RE_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const RE_VERSION = /^[\w.^~<>=*|\- ]{1,60}$/;

export function applyDependency(tree: WorkingTree, name: string, version: string): ApplyResult {
  if (!RE_PACKAGE_NAME.test(name) || name.length > 214) return fail(`"${name}" is not a valid npm package name`);
  // The major is what a model reliably knows; a made-up minor (`^8.22.0`) would not install.
  const range = version && RE_VERSION.test(version) ? (relaxCaret(version.trim()) ?? 'latest') : 'latest';
  const pkgFile = tree.get('package.json');
  let pkg: Record<string, unknown> = {};
  if (pkgFile && pkgFile.encoding === 'utf8') {
    try {
      pkg = JSON.parse(pkgFile.content) as Record<string, unknown>;
    } catch {
      return fail('package.json is not valid JSON', { path: 'package.json' });
    }
  }
  const deps = { ...((pkg.dependencies as Record<string, string> | undefined) ?? {}) };
  if (deps[name] === range) return { ok: true, path: 'package.json', changes: [], linesAdded: 0, linesRemoved: 0 };
  deps[name] = range;
  pkg.dependencies = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
  const content = `${JSON.stringify(pkg, null, 2)}\n`;
  tree.set('package.json', { content, encoding: 'utf8' });
  return {
    ok: true,
    path: 'package.json',
    changes: [{ path: 'package.json', kind: 'upsert', content, encoding: 'utf8' }],
    linesAdded: 1,
    linesRemoved: 0,
  };
}

/** Applies one action to the tree (mutating it on success only). */
export function applyAction(tree: WorkingTree, action: ParsedAction): ApplyResult {
  if (action.incomplete) return fail('The response was cut off before this change was complete');
  switch (action.kind) {
    case 'write':
      return applyWrite(tree, action.path, action.content);
    case 'edit':
      return applyEdit(tree, action.path, action.blocks, action.parseError);
    case 'delete':
      return applyDelete(tree, action.path);
    case 'rename':
      return applyRename(tree, action.from, action.to);
    case 'dependency':
      return applyDependency(tree, action.name, action.version);
    case 'image':
      // Generated asynchronously by the agent, which writes the file when the picture arrives.
      return fail('Images are generated by the agent');
  }
}

export function treeFromFiles(files: Array<{ path: string; content: string; encoding: FileEncoding }>): WorkingTree {
  return new Map(files.map((f) => [f.path, { content: f.content, encoding: f.encoding }]));
}
