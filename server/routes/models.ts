import { Hono } from 'hono';
import type { ModelsResponse } from '../../shared/types';
import { listModelsForUser } from '../ai/registry';
import type { AppEnv } from '../types';

export const modelRoutes = new Hono<AppEnv>();

modelRoutes.get('/', (c) => c.json<ModelsResponse>(listModelsForUser(c.get('user')?.id ?? null)));
