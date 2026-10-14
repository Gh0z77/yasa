// Short memory of models that just failed. A model that reported "out of quota" a minute ago will say the same
// now, and a silent one costs the user a long wait: while a model is marked here, new turns start on the next
// healthy model straight away, and the model list hides it.
//
// The marks live in the database so that every server instance knows them (a serverless host runs several);
// each instance keeps a copy for a few seconds so that checking costs no query.
import type { ModelId } from '../../shared/types';
import { all, run } from '../db';
import type { ProviderErrorKind } from './providers/types';

/** How long a failure keeps a model out of rotation. */
const COOLDOWN_MS: Partial<Record<ProviderErrorKind, number>> = {
  rate_limit: 10 * 60_000,
  auth: 30 * 60_000,
  overloaded: 3 * 60_000,
  network: 2 * 60_000,
  bad_request: 10 * 60_000,
};
/** A model that needs credits the account does not have will not get them by itself. */
export const NO_CREDITS_COOLDOWN_MS = 6 * 60 * 60_000;
const REFRESH_MS = 5_000;

let cache = new Map<ModelId, { until: number; kind: ProviderErrorKind }>();
let loadedAt = 0;

function current(): Map<ModelId, { until: number; kind: ProviderErrorKind }> {
  if (Date.now() - loadedAt < REFRESH_MS) return cache;
  const rows = all<{ model_id: string; until: string; kind: string }>('SELECT model_id, until, kind FROM model_health WHERE until > ?', new Date().toISOString());
  cache = new Map(rows.map((row) => [row.model_id as ModelId, { until: Date.parse(row.until), kind: row.kind as ProviderErrorKind }]));
  loadedAt = Date.now();
  return cache;
}

export function markUnavailable(modelId: ModelId, kind: ProviderErrorKind, cooldownMs = COOLDOWN_MS[kind]): void {
  if (!cooldownMs) return;
  const until = Date.now() + cooldownMs;
  run(
    'INSERT INTO model_health (model_id, until, kind) VALUES (?, ?, ?) ON CONFLICT(model_id) DO UPDATE SET until = excluded.until, kind = excluded.kind',
    modelId,
    new Date(until).toISOString(),
    kind,
  );
  current().set(modelId, { until, kind });
}

export function markAvailable(modelId: ModelId): void {
  // Called after every answer: only a model that is actually marked costs a write.
  if (!current().has(modelId)) return;
  run('DELETE FROM model_health WHERE model_id = ?', modelId);
  cache.delete(modelId);
}

export function isUnavailable(modelId: ModelId): boolean {
  const entry = current().get(modelId);
  return Boolean(entry && entry.until > Date.now());
}

/** Test helper. */
export function resetModelHealth(): void {
  cache = new Map();
  loadedAt = 0;
  try {
    run('DELETE FROM model_health');
  } catch {
    // no database yet
  }
}
