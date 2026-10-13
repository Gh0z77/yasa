import type { FileChange, FileEncoding, ProjectFile } from '../../shared/types';
import { all, get, run, tx } from '../db';
import { nowIso } from '../lib/time';

interface FileRow {
  path: string;
  content: string;
  encoding: string;
  size: number;
  updated_at: string;
}

export interface FileInput {
  path: string;
  content: string;
  encoding?: FileEncoding;
}

function toFile(row: FileRow): ProjectFile {
  return {
    path: row.path,
    content: row.content,
    encoding: row.encoding === 'base64' ? 'base64' : 'utf8',
    size: row.size,
    updatedAt: row.updated_at,
  };
}

/** Size in bytes of the decoded content. */
export function contentSize(content: string, encoding: FileEncoding): number {
  if (encoding === 'base64') {
    const len = content.length;
    if (len === 0) return 0;
    const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((len * 3) / 4) - padding);
  }
  return Buffer.byteLength(content, 'utf8');
}

function markChanged(projectId: string, now: string): void {
  run('UPDATE projects SET has_uncommitted_changes = 1, updated_at = ? WHERE id = ?', now, projectId);
}

function writeRow(projectId: string, input: FileInput, now: string): void {
  const encoding = input.encoding ?? 'utf8';
  run(
    `INSERT INTO project_files (project_id, path, content, encoding, size, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, path) DO UPDATE SET content = excluded.content, encoding = excluded.encoding,
       size = excluded.size, updated_at = excluded.updated_at`,
    projectId,
    input.path,
    input.content,
    encoding,
    contentSize(input.content, encoding),
    now,
  );
}

export function listFiles(projectId: string): ProjectFile[] {
  return all<FileRow>(
    'SELECT path, content, encoding, size, updated_at FROM project_files WHERE project_id = ? ORDER BY path',
    projectId,
  ).map(toFile);
}

export function getFile(projectId: string, path: string): ProjectFile | null {
  const row = get<FileRow>(
    'SELECT path, content, encoding, size, updated_at FROM project_files WHERE project_id = ? AND path = ?',
    projectId,
    path,
  );
  return row ? toFile(row) : null;
}

export function upsertFile(projectId: string, path: string, content: string, encoding: FileEncoding = 'utf8'): ProjectFile {
  const now = nowIso();
  tx(() => {
    writeRow(projectId, { path, content, encoding }, now);
    markChanged(projectId, now);
  });
  return getFile(projectId, path)!;
}

export function deleteFile(projectId: string, path: string): boolean {
  const now = nowIso();
  return tx(() => {
    const { changes } = run('DELETE FROM project_files WHERE project_id = ? AND path = ?', projectId, path);
    if (changes > 0) markChanged(projectId, now);
    return changes > 0;
  });
}

/** Throws Error('not_found') / Error('exists') for the caller to map. */
export function renameFile(projectId: string, from: string, to: string): ProjectFile {
  const now = nowIso();
  tx(() => {
    const source = getFile(projectId, from);
    if (!source) throw new Error('not_found');
    if (from !== to && getFile(projectId, to)) throw new Error('exists');
    run('DELETE FROM project_files WHERE project_id = ? AND path = ?', projectId, from);
    writeRow(projectId, { path: to, content: source.content, encoding: source.encoding }, now);
    markChanged(projectId, now);
  });
  return getFile(projectId, to)!;
}

/** Applies a batch of changes atomically and marks the project as having uncommitted changes. */
export function applyFileChanges(projectId: string, changes: FileChange[]): void {
  if (changes.length === 0) return;
  const now = nowIso();
  tx(() => {
    for (const change of changes) {
      if (change.kind === 'delete') {
        run('DELETE FROM project_files WHERE project_id = ? AND path = ?', projectId, change.path);
      } else {
        writeRow(projectId, { path: change.path, content: change.content ?? '', encoding: change.encoding ?? 'utf8' }, now);
      }
    }
    markChanged(projectId, now);
  });
}

/** Replaces the whole working tree (used by restore). Does not touch the uncommitted flag. */
export function replaceAllFiles(projectId: string, files: FileInput[]): void {
  const now = nowIso();
  tx(() => {
    run('DELETE FROM project_files WHERE project_id = ?', projectId);
    for (const file of files) writeRow(projectId, file, now);
    run('UPDATE projects SET updated_at = ? WHERE id = ?', now, projectId);
  });
}

export function projectSize(projectId: string): { files: number; bytes: number } {
  const row = get<{ files: number; bytes: number | null }>(
    'SELECT COUNT(*) AS files, SUM(size) AS bytes FROM project_files WHERE project_id = ?',
    projectId,
  );
  return { files: row?.files ?? 0, bytes: row?.bytes ?? 0 };
}
