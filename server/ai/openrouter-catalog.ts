// OpenRouter's free models come and go (a model that answered yesterday may have "no endpoints" today). The
// public model list is fetched in the background, at most once an hour; a free model that is no longer on it is
// treated as unavailable, so nobody waits on it and the model picker does not offer it.
import { getConfig } from '../env';
import { logger } from '../lib/logger';

const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const REFRESH_MS = 60 * 60_000;

let live: Set<string> | null = null;
let fetchedAt = 0;
let pending: Promise<void> | null = null;

function refresh(): void {
  if (pending || Date.now() - fetchedAt < REFRESH_MS) return;
  fetchedAt = Date.now();
  pending = fetch(CATALOG_URL, { signal: AbortSignal.timeout(15_000) })
    .then(async (res) => {
      if (!res.ok) return;
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      if (Array.isArray(body.data) && body.data.length > 0) live = new Set(body.data.map((m) => m.id));
    })
    .catch((err) => logger.warn('OpenRouter model list could not be loaded', { error: err instanceof Error ? err.message : String(err) }))
    .finally(() => {
      pending = null;
    });
}

/** True when OpenRouter no longer lists this model. Unknown (list not loaded yet) counts as present. */
export function goneFromOpenRouter(model: string): boolean {
  const config = getConfig();
  if (config.isTest || !config.openrouterApiKey) return false;
  refresh();
  return live !== null && !live.has(model);
}

/** Test helper. */
export function setOpenRouterCatalogForTests(models: string[] | null): void {
  live = models ? new Set(models) : null;
  fetchedAt = models ? Date.now() : 0;
}
