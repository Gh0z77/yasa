// Short memory of models that just failed. A model that reported "out of quota" a minute ago will say the same
// now, and a silent one costs the user a long wait: while a model is marked here, new turns start on the next
// healthy model straight away instead of failing over again each time.
import type { ModelId } from '../../shared/types';
import type { ProviderErrorKind } from './providers/types';

/** How long a failure keeps a model out of rotation. */
const COOLDOWN_MS: Partial<Record<ProviderErrorKind, number>> = {
  rate_limit: 10 * 60_000,
  auth: 30 * 60_000,
  overloaded: 3 * 60_000,
  network: 2 * 60_000,
};

const down = new Map<ModelId, { until: number; kind: ProviderErrorKind }>();

export function markUnavailable(modelId: ModelId, kind: ProviderErrorKind): void {
  const cooldown = COOLDOWN_MS[kind];
  if (!cooldown) return;
  down.set(modelId, { until: Date.now() + cooldown, kind });
}

export function markAvailable(modelId: ModelId): void {
  down.delete(modelId);
}

export function isUnavailable(modelId: ModelId): boolean {
  const entry = down.get(modelId);
  if (!entry) return false;
  if (entry.until > Date.now()) return true;
  down.delete(modelId);
  return false;
}

/** Test helper. */
export function resetModelHealth(): void {
  down.clear();
}
