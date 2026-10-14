import { Hono } from 'hono';
import type { ModelId, ModelsResponse } from '../../shared/types';
import { isUnavailable } from '../ai/health';
import { listModelsForUser } from '../ai/registry';
import type { AppEnv } from '../types';

export const modelRoutes = new Hono<AppEnv>();

// Models that just ran out of quota (or credits) are left out while they rest: picking one would only make the
// next turn start somewhere else.
modelRoutes.get('/', (c) => {
  const { models, defaultModel } = listModelsForUser(c.get('user')?.id ?? null);
  const shown = models.filter((m) => !(m.available && isUnavailable(m.id)));
  const usable = (id: ModelId | null) => (id && shown.some((m) => m.id === id && m.available) ? id : null);
  return c.json<ModelsResponse>({ models: shown, defaultModel: usable(defaultModel) ?? shown.find((m) => m.available)?.id ?? null });
});
