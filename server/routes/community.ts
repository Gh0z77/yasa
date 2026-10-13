import { Hono } from 'hono';
import { z } from 'zod';
import type { CommunityProject } from '../../shared/types';
import { parseQuery } from '../lib/validate';
import { listPublicProjects } from '../services/projects';
import type { AppEnv } from '../types';

const Query = z.object({
  q: z.string().max(100).optional(),
  sort: z.enum(['recent', 'popular']).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

export const communityRoutes = new Hono<AppEnv>();

communityRoutes.get('/', (c) => {
  const query = parseQuery(c, Query);
  return c.json<{ projects: CommunityProject[] }>({ projects: listPublicProjects(query) });
});
