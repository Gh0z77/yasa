import { slugError } from '../../shared/slug';
import type { Project, PublishInfo } from '../../shared/types';
import { getConfig, publishedUrlFor } from '../env';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors';
import { getProjectBySlug, getProjectRow, setPublished } from '../services/projects';
import { deletePublishedBuild, savePublishedBuild } from '../services/publish';
import { createVersion, getVersionFiles, setVersionBuildOk } from '../services/versions';
import { buildProject } from './bundler';

/**
 * Publishes the current state of a project at <slug>.<SANDBOX_DOMAIN>.
 * Throws 400 (with details.errors) when the production build fails and 409 when the slug is taken.
 */
export async function publishProject(projectId: string, slug: string): Promise<{ project: Project; publish: PublishInfo }> {
  const error = slugError(slug);
  if (error) throw badRequest(error);
  let row = getProjectRow(projectId);
  if (!row) throw notFound('Project not found');
  const owner = getProjectBySlug(slug);
  if (owner && owner.id !== projectId) throw conflict('This address is already taken');

  // Publish exactly what a version contains, so "live shows vN" is always true.
  if (row.has_uncommitted_changes || !row.current_version_id) {
    createVersion(projectId, { summary: 'Changes before publishing', source: 'manual' });
    row = getProjectRow(projectId)!;
  }
  const versionId = row.current_version_id!;
  const output = await buildProject(getVersionFiles(versionId), {
    mode: 'publish',
    appOrigin: new URL(getConfig().appUrl).origin,
    project: { name: row.name, emoji: row.emoji, description: row.description },
  });
  if (!output.summary.ok || !output.html) {
    setVersionBuildOk(versionId, false);
    throw new HttpError(400, 'bad_request', 'The app does not build, so it cannot be published yet.', {
      errors: output.summary.errors,
    });
  }
  setVersionBuildOk(versionId, true);
  savePublishedBuild(projectId, versionId, output.html);
  const project = setPublished(projectId, { slug, versionId });
  return {
    project,
    publish: { slug, url: publishedUrlFor(slug), publishedAt: project.publishedAt ?? new Date().toISOString(), versionId },
  };
}

export function unpublishProject(projectId: string): Project {
  deletePublishedBuild(projectId);
  return setPublished(projectId, null);
}
