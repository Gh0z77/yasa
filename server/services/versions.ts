import type { FileEncoding, ProjectFile, VersionFileDiff, VersionSource, VersionSummary } from '../../shared/types';
import { all, get, run, tx } from '../db';
import { sha256Hex } from '../lib/crypto';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';
import { replaceAllFiles } from './files';

interface VersionRow {
  id: string;
  project_id: string;
  number: number;
  summary: string;
  source: string;
  message_id: string | null;
  files_changed: number;
  build_ok: number | null;
  created_at: string;
}

interface VersionFileRow {
  path: string;
  blob_hash: string;
}

const COLS = 'id, project_id, number, summary, source, message_id, files_changed, build_ok, created_at';

function toVersion(row: VersionRow): VersionSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    summary: row.summary,
    source: row.source as VersionSource,
    messageId: row.message_id,
    filesChanged: row.files_changed,
    buildOk: row.build_ok === null ? null : row.build_ok === 1,
    createdAt: row.created_at,
  };
}

function blobHash(content: string, encoding: string): string {
  return sha256Hex(`${encoding}\n${content}`);
}

function versionFileMap(versionId: string): Map<string, string> {
  const rows = all<VersionFileRow>('SELECT path, blob_hash FROM version_files WHERE version_id = ?', versionId);
  return new Map(rows.map((r) => [r.path, r.blob_hash]));
}

function latestVersionRow(projectId: string): VersionRow | undefined {
  return get<VersionRow>(`SELECT ${COLS} FROM versions WHERE project_id = ? ORDER BY number DESC LIMIT 1`, projectId);
}

/** Snapshots the working tree into a new version and clears the uncommitted flag. */
export function createVersion(
  projectId: string,
  input: { summary: string; source: VersionSource; messageId?: string | null; buildOk?: boolean | null },
): VersionSummary {
  return tx(() => {
    const now = nowIso();
    const previous = latestVersionRow(projectId);
    const previousFiles = previous ? versionFileMap(previous.id) : new Map<string, string>();
    const id = newId('ver');
    const number = (previous?.number ?? 0) + 1;
    const files = all<{ path: string; content: string; encoding: string; size: number }>(
      'SELECT path, content, encoding, size FROM project_files WHERE project_id = ?',
      projectId,
    );

    run(
      `INSERT INTO versions (id, project_id, number, summary, source, message_id, files_changed, build_ok, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id,
      projectId,
      number,
      input.summary.trim().slice(0, 200) || 'Changes',
      input.source,
      input.messageId ?? null,
      input.buildOk === undefined || input.buildOk === null ? null : input.buildOk ? 1 : 0,
      now,
    );

    let changed = 0;
    const seen = new Set<string>();
    for (const file of files) {
      const hash = blobHash(file.content, file.encoding);
      run('INSERT OR IGNORE INTO blobs (hash, content, encoding, size) VALUES (?, ?, ?, ?)', hash, file.content, file.encoding, file.size);
      run('INSERT INTO version_files (version_id, path, blob_hash) VALUES (?, ?, ?)', id, file.path, hash);
      seen.add(file.path);
      if (previousFiles.get(file.path) !== hash) changed++;
    }
    for (const path of previousFiles.keys()) if (!seen.has(path)) changed++;

    run('UPDATE versions SET files_changed = ? WHERE id = ?', changed, id);
    run('UPDATE projects SET current_version_id = ?, has_uncommitted_changes = 0, updated_at = ? WHERE id = ?', id, now, projectId);
    return toVersion(get<VersionRow>(`SELECT ${COLS} FROM versions WHERE id = ?`, id)!);
  });
}

export function listVersions(projectId: string): VersionSummary[] {
  return all<VersionRow>(`SELECT ${COLS} FROM versions WHERE project_id = ? ORDER BY number DESC`, projectId).map(toVersion);
}

export function getVersion(projectId: string, versionId: string): VersionSummary | null {
  const row = get<VersionRow>(`SELECT ${COLS} FROM versions WHERE id = ? AND project_id = ?`, versionId, projectId);
  return row ? toVersion(row) : null;
}

export function getVersionById(versionId: string): VersionSummary | null {
  const row = get<VersionRow>(`SELECT ${COLS} FROM versions WHERE id = ?`, versionId);
  return row ? toVersion(row) : null;
}

export function getVersionByNumber(projectId: string, number: number): VersionSummary | null {
  const row = get<VersionRow>(`SELECT ${COLS} FROM versions WHERE project_id = ? AND number = ?`, projectId, number);
  return row ? toVersion(row) : null;
}

export function getLatestVersion(projectId: string): VersionSummary | null {
  const row = latestVersionRow(projectId);
  return row ? toVersion(row) : null;
}

/** Newest version whose build is known to be good. */
export function getLatestGoodVersion(projectId: string): VersionSummary | null {
  const row = get<VersionRow>(
    `SELECT ${COLS} FROM versions WHERE project_id = ? AND build_ok = 1 ORDER BY number DESC LIMIT 1`,
    projectId,
  );
  return row ? toVersion(row) : null;
}

export function setVersionBuildOk(versionId: string, ok: boolean): void {
  run('UPDATE versions SET build_ok = ? WHERE id = ?', ok ? 1 : 0, versionId);
}

/** One file of a version (static assets are requested one at a time; loading the whole snapshot for each is wasteful). */
export function getVersionFile(versionId: string, path: string): ProjectFile | null {
  const row = get<{ content: string; encoding: string; size: number; created_at: string }>(
    `SELECT b.content AS content, b.encoding AS encoding, b.size AS size, v.created_at AS created_at
       FROM version_files vf JOIN blobs b ON b.hash = vf.blob_hash JOIN versions v ON v.id = vf.version_id
      WHERE vf.version_id = ? AND vf.path = ?`,
    versionId,
    path,
  );
  if (!row) return null;
  return { path, content: row.content, encoding: (row.encoding === 'base64' ? 'base64' : 'utf8') as FileEncoding, size: row.size, updatedAt: row.created_at };
}

export function getVersionFiles(versionId: string): ProjectFile[] {
  const version = get<{ created_at: string }>('SELECT created_at FROM versions WHERE id = ?', versionId);
  const rows = all<{ path: string; content: string; encoding: string; size: number }>(
    `SELECT vf.path AS path, b.content AS content, b.encoding AS encoding, b.size AS size
       FROM version_files vf JOIN blobs b ON b.hash = vf.blob_hash
      WHERE vf.version_id = ? ORDER BY vf.path`,
    versionId,
  );
  return rows.map((r) => ({
    path: r.path,
    content: r.content,
    encoding: (r.encoding === 'base64' ? 'base64' : 'utf8') as FileEncoding,
    size: r.size,
    updatedAt: version?.created_at ?? nowIso(),
  }));
}

/** Changes of a version relative to the previous one (or to an empty tree). */
export function diffVersion(projectId: string, versionId: string): VersionFileDiff[] {
  const version = getVersion(projectId, versionId);
  if (!version) return [];
  const previous = get<{ id: string }>(
    'SELECT id FROM versions WHERE project_id = ? AND number < ? ORDER BY number DESC LIMIT 1',
    projectId,
    version.number,
  );
  const after = versionFileMap(versionId);
  const before = previous ? versionFileMap(previous.id) : new Map<string, string>();
  const readBlob = (hash: string) =>
    get<{ content: string; encoding: string }>('SELECT content, encoding FROM blobs WHERE hash = ?', hash);

  const diffs: VersionFileDiff[] = [];
  const paths = new Set<string>([...before.keys(), ...after.keys()]);
  for (const path of [...paths].sort()) {
    const b = before.get(path);
    const a = after.get(path);
    if (a === b) continue;
    const beforeBlob = b ? readBlob(b) : undefined;
    const afterBlob = a ? readBlob(a) : undefined;
    const encoding = ((afterBlob ?? beforeBlob)?.encoding === 'base64' ? 'base64' : 'utf8') as FileEncoding;
    diffs.push({
      path,
      status: !b ? 'added' : !a ? 'deleted' : 'modified',
      encoding,
      // Binary payloads are not useful in a diff view.
      before: beforeBlob ? (beforeBlob.encoding === 'base64' ? '' : beforeBlob.content) : null,
      after: afterBlob ? (afterBlob.encoding === 'base64' ? '' : afterBlob.content) : null,
    });
  }
  return diffs;
}

/**
 * Restores the working tree to a version. Unsaved manual edits are snapshotted first so nothing is lost.
 * Returns the new 'restore' version.
 */
export function restoreVersion(projectId: string, versionId: string): VersionSummary {
  return tx(() => {
    const target = getVersion(projectId, versionId);
    if (!target) throw new Error('not_found');
    const project = get<{ has_uncommitted_changes: number }>('SELECT has_uncommitted_changes FROM projects WHERE id = ?', projectId);
    if (project?.has_uncommitted_changes) {
      createVersion(projectId, { summary: `Unsaved edits (before restoring v${target.number})`, source: 'manual' });
    }
    replaceAllFiles(projectId, getVersionFiles(versionId));
    return createVersion(projectId, {
      summary: `Restored version ${target.number}`,
      source: 'restore',
      buildOk: target.buildOk,
    });
  });
}

/** Paths that differ between the working tree and the latest version. */
export function uncommittedPaths(projectId: string): string[] {
  const latest = latestVersionRow(projectId);
  const committed = latest ? versionFileMap(latest.id) : new Map<string, string>();
  const files = all<{ path: string; content: string; encoding: string }>(
    'SELECT path, content, encoding FROM project_files WHERE project_id = ?',
    projectId,
  );
  const changed: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    seen.add(f.path);
    if (committed.get(f.path) !== blobHash(f.content, f.encoding)) changed.push(f.path);
  }
  for (const path of committed.keys()) if (!seen.has(path)) changed.push(path);
  return changed.sort();
}

/** Paths changed by a version relative to its predecessor (cheap: hashes only). */
export function versionChangedPaths(projectId: string, versionId: string): string[] {
  const version = getVersion(projectId, versionId);
  if (!version) return [];
  const previous = get<{ id: string }>(
    'SELECT id FROM versions WHERE project_id = ? AND number < ? ORDER BY number DESC LIMIT 1',
    projectId,
    version.number,
  );
  const after = versionFileMap(versionId);
  const before = previous ? versionFileMap(previous.id) : new Map<string, string>();
  const out: string[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(path) !== after.get(path)) out.push(path);
  }
  return out.sort();
}
