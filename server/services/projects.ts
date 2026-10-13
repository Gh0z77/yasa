import { LIMITS } from '../../shared/constants';
import type { CommunityProject, FileEncoding, Project, ProjectSort, ProjectSummary, Visibility } from '../../shared/types';
import { all, get, run, tx } from '../db';
import { previewUrlFor, publishedUrlFor } from '../env';
import { newId, newPreviewToken } from '../lib/ids';
import { nowIso } from '../lib/time';
import { replaceAllFiles } from './files';
import { createVersion } from './versions';

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  description: string;
  visibility: string;
  custom_instructions: string;
  preview_token: string;
  published_slug: string | null;
  published_version_id: string | null;
  published_at: string | null;
  current_version_id: string | null;
  has_uncommitted_changes: number;
  name_locked: number;
  remixed_from_id: string | null;
  created_at: string;
  updated_at: string;
  current_version_number: number | null;
  published_version_number: number | null;
}

const SELECT = `
  SELECT p.*,
    (SELECT number FROM versions v WHERE v.id = p.current_version_id) AS current_version_number,
    (SELECT number FROM versions v WHERE v.id = p.published_version_id) AS published_version_number
  FROM projects p`;

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    ownerId: row.user_id,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    visibility: row.visibility === 'public' ? 'public' : 'private',
    publishedUrl: row.published_slug ? publishedUrlFor(row.published_slug) : null,
    remixedFromId: row.remixed_from_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Summary of a project that was shared with the reader. */
export function toSharedSummary(row: ProjectRow, role: 'editor' | 'viewer', ownerName: string): ProjectSummary {
  return { ...toSummary(row), role, ownerName };
}

export function toProjectDto(row: ProjectRow): Project {
  return {
    ...toSummary(row),
    customInstructions: row.custom_instructions,
    currentVersionNumber: row.current_version_number,
    publishedVersionNumber: row.published_version_number,
    previewUrl: previewUrlFor(row.preview_token),
    publishedSlug: row.published_slug,
    publishedAt: row.published_at,
    publishedVersionId: row.published_version_id,
    currentVersionId: row.current_version_id,
    hasUncommittedChanges: row.has_uncommitted_changes === 1,
  };
}

export function getProjectRow(id: string): ProjectRow | null {
  return get<ProjectRow>(`${SELECT} WHERE p.id = ?`, id) ?? null;
}

export function getProject(id: string): Project | null {
  const row = getProjectRow(id);
  return row ? toProjectDto(row) : null;
}

export function getProjectByPreviewToken(token: string): ProjectRow | null {
  return get<ProjectRow>(`${SELECT} WHERE p.preview_token = ?`, token) ?? null;
}

export function getProjectBySlug(slug: string): ProjectRow | null {
  return get<ProjectRow>(`${SELECT} WHERE p.published_slug = ?`, slug) ?? null;
}

export function createProject(input: {
  userId: string;
  name: string;
  emoji?: string;
  description?: string;
  files: Record<string, { content: string; encoding: FileEncoding }>;
  remixedFromId?: string | null;
  initialSummary?: string;
}): Project {
  return tx(() => {
    const id = newId('prj');
    const now = nowIso();
    run(
      `INSERT INTO projects (id, user_id, name, emoji, description, preview_token, remixed_from_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.userId,
      input.name.trim().slice(0, LIMITS.projectNameMax) || 'New project',
      input.emoji ?? '✨',
      (input.description ?? '').slice(0, LIMITS.descriptionMax),
      newPreviewToken(),
      input.remixedFromId ?? null,
      now,
      now,
    );
    replaceAllFiles(
      id,
      Object.entries(input.files).map(([path, f]) => ({ path, content: f.content, encoding: f.encoding })),
    );
    createVersion(id, { summary: input.initialSummary ?? 'Starter template', source: 'initial' });
    return getProject(id)!;
  });
}

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function listUserProjects(userId: string, opts: { q?: string; sort?: ProjectSort } = {}): ProjectSummary[] {
  const order = opts.sort === 'name' ? 'p.name COLLATE NOCASE ASC' : opts.sort === 'created' ? 'p.created_at DESC' : 'p.updated_at DESC';
  const q = opts.q?.trim();
  const rows = q
    ? all<ProjectRow>(
        `${SELECT} WHERE p.user_id = ? AND (p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\') ORDER BY ${order}`,
        userId,
        `%${escapeLike(q)}%`,
        `%${escapeLike(q)}%`,
      )
    : all<ProjectRow>(`${SELECT} WHERE p.user_id = ? ORDER BY ${order}`, userId);
  return rows.map(toSummary);
}

export function listPublicProjects(
  opts: { q?: string; sort?: 'recent' | 'popular'; limit?: number; offset?: number } = {},
): CommunityProject[] {
  const limit = Math.min(Math.max(opts.limit ?? LIMITS.communityPageSize, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = opts.q?.trim();
  const where = q ? `AND (p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\')` : '';
  const order = opts.sort === 'popular' ? 'remix_count DESC, p.updated_at DESC' : 'p.updated_at DESC';
  const params: (string | number)[] = q ? [`%${escapeLike(q)}%`, `%${escapeLike(q)}%`, limit, offset] : [limit, offset];
  const rows = all<ProjectRow & { owner_name: string; remix_count: number }>(
    `SELECT p.*,
        (SELECT number FROM versions v WHERE v.id = p.current_version_id) AS current_version_number,
        (SELECT number FROM versions v WHERE v.id = p.published_version_id) AS published_version_number,
        u.name AS owner_name,
        (SELECT COUNT(*) FROM projects c WHERE c.remixed_from_id = p.id) AS remix_count
       FROM projects p JOIN users u ON u.id = p.user_id
      WHERE p.visibility = 'public' ${where}
      ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params,
  );
  return rows.map((row) => ({ ...toSummary(row), ownerName: row.owner_name, remixCount: row.remix_count }));
}

export function updateProject(
  id: string,
  patch: Partial<{
    name: string;
    emoji: string;
    description: string;
    visibility: Visibility;
    customInstructions: string;
    nameLocked: boolean;
  }>,
): Project {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name.trim().slice(0, LIMITS.projectNameMax) || 'Untitled');
  }
  if (patch.emoji !== undefined) {
    sets.push('emoji = ?');
    params.push(patch.emoji);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    params.push(patch.description.slice(0, LIMITS.descriptionMax));
  }
  if (patch.visibility !== undefined) {
    sets.push('visibility = ?');
    params.push(patch.visibility);
  }
  if (patch.customInstructions !== undefined) {
    sets.push('custom_instructions = ?');
    params.push(patch.customInstructions.slice(0, LIMITS.customInstructionsMax));
  }
  if (patch.nameLocked !== undefined) {
    sets.push('name_locked = ?');
    params.push(patch.nameLocked ? 1 : 0);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(nowIso());
    run(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  }
  return getProject(id)!;
}

export function touchProject(id: string): void {
  run('UPDATE projects SET updated_at = ? WHERE id = ?', nowIso(), id);
}

export function rotatePreviewToken(id: string): Project {
  run('UPDATE projects SET preview_token = ? WHERE id = ?', newPreviewToken(), id);
  return getProject(id)!;
}

/** Marks the project as published at a slug/version, or unpublished when null. */
export function setPublished(id: string, p: { slug: string; versionId: string } | null): Project {
  if (p) {
    run(
      'UPDATE projects SET published_slug = ?, published_version_id = ?, published_at = ? WHERE id = ?',
      p.slug,
      p.versionId,
      nowIso(),
      id,
    );
  } else {
    run('UPDATE projects SET published_slug = NULL, published_version_id = NULL, published_at = NULL WHERE id = ?', id);
  }
  return getProject(id)!;
}

export function deleteProject(id: string): void {
  run('DELETE FROM projects WHERE id = ?', id);
}

export function countUserProjects(userId: string): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?', userId)?.n ?? 0;
}
