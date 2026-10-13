import { Hono } from 'hono';
import { z } from 'zod';
import { slugError } from '../../shared/slug';
import type { BuildSummary, PreviewUrlResponse, Project, PublishResponse, SlugAvailabilityResponse } from '../../shared/types';
import { isGenerating } from '../ai/jobs';
import { getConfig } from '../env';
import { ownProject, viewProject } from '../lib/access';
import { conflict } from '../lib/errors';
import { parseJson } from '../lib/validate';
import { requireUser } from '../middleware/auth';
import { buildProject } from '../preview/bundler';
import { publishProject, unpublishProject } from '../preview/publish';
import { listFiles } from '../services/files';
import { getProjectBySlug, rotatePreviewToken } from '../services/projects';
import type { AppEnv } from '../types';

const PublishSchema = z.object({ slug: z.string().trim().toLowerCase().min(1).max(60) });

/** Mounted at /api/projects */
export const previewRoutes = new Hono<AppEnv>();

previewRoutes.get('/:id/build', async (c) => {
  const { row } = viewProject(c);
  const output = await buildProject(listFiles(row.id), {
    mode: 'preview',
    appOrigin: new URL(getConfig().appUrl).origin,
    project: { name: row.name, emoji: row.emoji, description: row.description },
  });
  return c.json<BuildSummary>(output.summary);
});

previewRoutes.post('/:id/preview-token', (c) => {
  const { row } = ownProject(c);
  return c.json<PreviewUrlResponse>({ previewUrl: rotatePreviewToken(row.id).previewUrl });
});

previewRoutes.post('/:id/publish', async (c) => {
  const { row } = ownProject(c);
  if (isGenerating(row.id)) throw conflict('Wait for the AI to finish before publishing');
  const body = await parseJson(c, PublishSchema);
  return c.json<PublishResponse>(await publishProject(row.id, body.slug));
});

previewRoutes.delete('/:id/publish', (c) => {
  const { row } = ownProject(c);
  return c.json<{ project: Project }>({ project: unpublishProject(row.id) });
});

/** Mounted at /api */
export const slugRoutes = new Hono<AppEnv>();

slugRoutes.get('/slug-available', (c) => {
  requireUser(c);
  const slug = (c.req.query('slug') ?? '').trim().toLowerCase();
  const projectId = c.req.query('projectId');
  const error = slugError(slug);
  if (error) return c.json<SlugAvailabilityResponse>({ available: false, reason: error });
  const owner = getProjectBySlug(slug);
  if (owner && owner.id !== projectId) return c.json<SlugAvailabilityResponse>({ available: false, reason: 'This address is already taken' });
  return c.json<SlugAvailabilityResponse>({ available: true });
});
