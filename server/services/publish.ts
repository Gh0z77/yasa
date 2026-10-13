import { get, run } from '../db';
import { nowIso } from '../lib/time';

export function savePublishedBuild(projectId: string, versionId: string, html: string): void {
  run(
    `INSERT INTO published_builds (project_id, version_id, html, built_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET version_id = excluded.version_id, html = excluded.html, built_at = excluded.built_at`,
    projectId,
    versionId,
    html,
    nowIso(),
  );
}

export function getPublishedBuild(projectId: string): { versionId: string; html: string; builtAt: string } | null {
  const row = get<{ version_id: string; html: string; built_at: string }>(
    'SELECT version_id, html, built_at FROM published_builds WHERE project_id = ?',
    projectId,
  );
  return row ? { versionId: row.version_id, html: row.html, builtAt: row.built_at } : null;
}

export function deletePublishedBuild(projectId: string): void {
  run('DELETE FROM published_builds WHERE project_id = ?', projectId);
}
