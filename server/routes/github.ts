import { Hono } from 'hono';
import { z } from 'zod';
import type { GithubConnectionResponse, GithubProjectResponse, GithubPushResult, OkResponse } from '../../shared/types';
import { slugify } from '../../shared/slug';
import { isGeneratingForUser } from '../ai/jobs';
import { ownProject } from '../lib/access';
import { conflict } from '../lib/errors';
import { RateLimiter } from '../lib/rate-limit';
import { parseJson } from '../lib/validate';
import { requireUser } from '../middleware/auth';
import { listFiles } from '../services/files';
import {
  connectGithub,
  disconnectGithub,
  getGithubConnection,
  getGithubLink,
  pushProjectToGithub,
  REPO_NAME_PATTERN,
  unlinkGithub,
} from '../services/github';
import { getLatestVersion } from '../services/versions';
import type { AppEnv } from '../types';

/** Pushes are a handful of GitHub API calls each: a small per-user budget keeps one account from hammering it. */
export const githubLimiter = new RateLimiter(12, 60_000);

const ConnectSchema = z.object({ token: z.string().trim().min(20, 'The token looks too short').max(400) });
const PushSchema = z.object({
  repo: z.string().trim().regex(REPO_NAME_PATTERN, 'Use letters, digits, dots, dashes and underscores').optional(),
  private: z.boolean().optional(),
  message: z.string().trim().max(200).optional(),
});

// ---- /api/me/github: the user's connection ------------------------------------------------------------------
export const githubAccountRoutes = new Hono<AppEnv>();

githubAccountRoutes.get('/', (c) => {
  const user = requireUser(c);
  return c.json<GithubConnectionResponse>({ connection: getGithubConnection(user.id) });
});

githubAccountRoutes.put('/', async (c) => {
  const user = requireUser(c);
  githubLimiter.check(`connect:${user.id}`);
  const body = await parseJson(c, ConnectSchema);
  return c.json<GithubConnectionResponse>({ connection: await connectGithub(user.id, body.token) });
});

githubAccountRoutes.delete('/', (c) => {
  const user = requireUser(c);
  disconnectGithub(user.id);
  return c.json<OkResponse>({ ok: true });
});

// ---- /api/projects/:id/github: the project's repository -----------------------------------------------------
export const githubProjectRoutes = new Hono<AppEnv>();

githubProjectRoutes.get('/:id/github', (c) => {
  const { row, user } = ownProject(c);
  return c.json<GithubProjectResponse>({
    connection: getGithubConnection(user.id),
    link: getGithubLink(row.id),
    suggestedRepo: slugify(row.name).slice(0, 80) || 'yasa-project',
  });
});

githubProjectRoutes.post('/:id/github/push', async (c) => {
  const { row, user } = ownProject(c);
  githubLimiter.check(`push:${user.id}`);
  const body = await parseJson(c, PushSchema);
  if (isGeneratingForUser(user.id)) throw conflict('Wait for the running generation to finish before pushing.');
  const version = getLatestVersion(row.id);
  const result = await pushProjectToGithub(user.id, {
    projectId: row.id,
    projectName: row.name,
    description: row.description ?? '',
    files: listFiles(row.id),
    message: body.message || (version ? `${version.summary} (Yasa v${version.number})` : 'Update from Yasa'),
    repoName: body.repo,
    isPrivate: body.private,
  });
  return c.json<GithubPushResult>(result);
});

githubProjectRoutes.delete('/:id/github', (c) => {
  const { row } = ownProject(c);
  unlinkGithub(row.id);
  return c.json<OkResponse>({ ok: true });
});
