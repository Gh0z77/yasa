import { Hono } from 'hono';
import { z } from 'zod';
import type { ProjectFile, VersionDetail, VersionFileDiff, VersionSummary } from '../../shared/types';
import { isGenerating } from '../ai/jobs';
import { editProject, viewProject } from '../lib/access';
import { conflict, notFound } from '../lib/errors';
import { parseJson } from '../lib/validate';
import { listFiles } from '../services/files';
import { getProjectRow } from '../services/projects';
import { createVersion, diffVersion, getVersion, getVersionFiles, listVersions, restoreVersion } from '../services/versions';
import type { AppEnv } from '../types';

const CreateSchema = z.object({ summary: z.string().trim().max(200).optional() });

export const versionRoutes = new Hono<AppEnv>();

versionRoutes.get('/:id/versions', (c) => {
  const { row } = viewProject(c);
  return c.json<{ versions: VersionSummary[] }>({ versions: listVersions(row.id) });
});

versionRoutes.post('/:id/versions', async (c) => {
  const { row } = editProject(c);
  if (isGenerating(row.id)) throw conflict('Wait for the AI to finish first');
  const body = await parseJson(c, CreateSchema);
  // Re-read: the flag may have changed since access was checked.
  if (!getProjectRow(row.id)?.has_uncommitted_changes) throw conflict('There are no unsaved changes');
  const version = createVersion(row.id, { summary: body.summary || 'Manual edits', source: 'manual' });
  return c.json<{ version: VersionSummary }>({ version }, 201);
});

versionRoutes.get('/:id/versions/:vid', (c) => {
  const { row } = viewProject(c);
  const version = getVersion(row.id, c.req.param('vid'));
  if (!version) throw notFound('Version not found');
  return c.json<{ version: VersionDetail }>({ version: { ...version, files: getVersionFiles(version.id) } });
});

versionRoutes.get('/:id/versions/:vid/diff', (c) => {
  const { row } = viewProject(c);
  if (!getVersion(row.id, c.req.param('vid'))) throw notFound('Version not found');
  return c.json<{ diff: VersionFileDiff[] }>({ diff: diffVersion(row.id, c.req.param('vid')) });
});

versionRoutes.post('/:id/versions/:vid/restore', (c) => {
  const { row } = editProject(c);
  if (isGenerating(row.id)) throw conflict('Stop the running generation before restoring');
  if (!getVersion(row.id, c.req.param('vid'))) throw notFound('Version not found');
  const version = restoreVersion(row.id, c.req.param('vid'));
  return c.json<{ version: VersionSummary; files: ProjectFile[] }>({ version, files: listFiles(row.id) });
});
