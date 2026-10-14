import { DEFAULT_MODEL_PREFERENCE, MODEL_CATALOG, type ModelCatalogEntry } from '../../shared/constants';
import type { KeyProvider, KeySource, ModelId, ModelInfo, ModelsResponse, ProviderId } from '../../shared/types';
import { getConfig } from '../env';
import { HttpError } from '../lib/errors';
import { getUserApiKey } from '../services/apiKeys';
import { getUserById } from '../services/users';
import { anthropicProvider } from './providers/anthropic';
import { geminiProvider } from './providers/gemini';
import { mockProvider } from './providers/mock';
import { NVIDIA_DEFAULT_MODEL, nvidiaProvider } from './providers/nvidia';
import { OPENROUTER_DEFAULT_MODEL, openrouterProvider } from './providers/openrouter';
import { isUnavailable } from './health';
import { goneFromOpenRouter } from './openrouter-catalog';
import { openaiProvider } from './providers/openai';
import { ProviderError, type Provider } from './providers/types';

const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  openai: openaiProvider,
  nvidia: nvidiaProvider,
  openrouter: openrouterProvider,
  mock: mockProvider,
};

const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'gemini', 'nvidia', 'openrouter', 'openai', 'mock'];

interface ResolvedKey {
  apiKey: string;
  baseUrl: string | null;
  keySource: KeySource;
  /** Model forced by a user key (OpenAI-compatible). */
  model: string | null;
}

function serverKey(provider: ProviderId): string | null {
  const config = getConfig();
  if (provider === 'anthropic') return config.anthropicApiKey;
  if (provider === 'gemini') return config.geminiApiKey;
  if (provider === 'openai') return config.openaiApiKey;
  if (provider === 'nvidia') return config.nvidiaApiKey;
  if (provider === 'openrouter') return config.openrouterApiKey;
  return null;
}

/** User key first, then the server's key. */
function resolveKey(userId: string | null, provider: ProviderId): ResolvedKey | null {
  if (provider === 'mock') {
    return getConfig().enableMockProvider ? { apiKey: 'mock', baseUrl: null, keySource: 'none', model: null } : null;
  }
  if (userId && provider !== 'nvidia' && provider !== 'openrouter') {
    const own = getUserApiKey(userId, provider as KeyProvider);
    if (own) return { apiKey: own.apiKey, baseUrl: own.baseUrl, keySource: 'user', model: own.model };
  }
  const key = serverKey(provider);
  if (!key) return null;
  return { apiKey: key, baseUrl: provider === 'openai' ? getConfig().openaiBaseUrl : null, keySource: 'server', model: null };
}

function catalogFor(userId: string | null): ModelCatalogEntry[] {
  const config = getConfig();
  const entries = MODEL_CATALOG.filter((m) => m.provider !== 'mock');
  const openaiModels = new Set<string>();
  const userOpenai = userId ? getUserApiKey(userId, 'openai') : null;
  if (userOpenai?.model) openaiModels.add(userOpenai.model);
  if (config.openaiApiKey || (userOpenai && !userOpenai.model)) openaiModels.add(config.openaiModel);
  if (openaiModels.size === 0) openaiModels.add(config.openaiModel);
  for (const model of openaiModels) {
    entries.push({
      id: `openai:${model}` as ModelId,
      provider: 'openai',
      model,
      label: model,
      description: 'OpenAI-compatible provider',
      tier: 'balanced',
    });
  }
  if (config.enableMockProvider) entries.push(...MODEL_CATALOG.filter((m) => m.provider === 'mock'));
  return entries;
}

function splitModelId(id: string): { provider: ProviderId; model: string } | null {
  const i = id.indexOf(':');
  if (i <= 0) return null;
  const provider = id.slice(0, i) as ProviderId;
  if (!(provider in PROVIDERS)) return null;
  return { provider, model: id.slice(i + 1) };
}

function pickDefault(models: ModelInfo[], preferred: (string | null | undefined)[]): ModelId | null {
  for (const id of [...preferred, ...DEFAULT_MODEL_PREFERENCE]) {
    if (id && models.some((m) => m.id === id && m.available)) return id as ModelId;
  }
  for (const provider of PROVIDER_ORDER) {
    const first = models.find((m) => m.provider === provider && m.available);
    if (first) return first.id;
  }
  return null;
}

export function listModelsForUser(userId: string | null): ModelsResponse {
  const models: ModelInfo[] = catalogFor(userId).map((entry) => {
    const key = resolveKey(userId, entry.provider);
    // A user's OpenAI-compatible key only serves the model saved with it.
    const usable =
      Boolean(key) &&
      !(entry.provider === 'openai' && key?.keySource === 'user' && key.model && key.model !== entry.model) &&
      // A free OpenRouter model that has been withdrawn would only fail.
      !(entry.provider === 'openrouter' && goneFromOpenRouter(entry.model));
    return { ...entry, available: usable, keySource: usable ? key!.keySource : null };
  });
  const user = userId ? getUserById(userId) : null;
  return { models, defaultModel: pickDefault(models, [user?.defaultModel, getConfig().defaultModel]) };
}

export interface ResolvedModel {
  modelId: ModelId;
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string | null;
  keySource: KeySource;
}

/** Picks the model for a request. Throws 503 no_provider when nothing usable is configured. */
export function resolveModel(userId: string, requested?: ModelId | null): ResolvedModel {
  const { models, defaultModel } = listModelsForUser(userId);
  let chosen = requested ? models.find((m) => m.id === requested && m.available) : undefined;
  if (!chosen && requested) {
    // Ad-hoc model names are allowed for providers the user has a key for (e.g. a newer Gemini id).
    const parts = splitModelId(requested);
    if (parts && parts.provider !== 'mock' && resolveKey(userId, parts.provider)) {
      const key = resolveKey(userId, parts.provider)!;
      return {
        modelId: requested,
        provider: PROVIDERS[parts.provider],
        model: parts.model,
        apiKey: key.apiKey,
        baseUrl: key.baseUrl,
        keySource: key.keySource,
      };
    }
  }
  chosen ??= models.find((m) => m.id === defaultModel);
  if (!chosen) {
    throw new HttpError(503, 'no_provider', 'No AI provider is configured. Add an API key in Settings.', { chatCode: 'no_provider' });
  }
  const key = resolveKey(userId, chosen.provider)!;
  return {
    modelId: chosen.id,
    provider: PROVIDERS[chosen.provider],
    model: chosen.model,
    apiKey: key.apiKey,
    baseUrl: key.baseUrl,
    keySource: key.keySource,
  };
}

/** Model each provider falls back to when the requested one is failing. */
const FALLBACK_MODELS: Partial<Record<ProviderId, string[]>> = {
  anthropic: ['claude-sonnet-5'],
  gemini: ['gemini-flash-latest'],
  nvidia: [NVIDIA_DEFAULT_MODEL, 'nvidia/nemotron-3-ultra-550b-a55b'],
  // Free models only (the paid ones are picked by the user, not silently as a fallback), in the order they did
  // on real builds: fastest first. Each has its own upstream limits, so one being busy says little about the next.
  openrouter: [OPENROUTER_DEFAULT_MODEL, 'cohere/north-mini-code:free', 'nvidia/nemotron-3-ultra-550b-a55b:free'],
};
/** Paid quality first, then the free tiers by how reliably they answer. */
const FALLBACK_ORDER: ProviderId[] = ['anthropic', 'openrouter', 'nvidia', 'gemini', 'openai'];

/**
 * Other models to try, in order, when `primary` cannot serve a request (quota used up, overloaded, unreachable):
 * first the other models of the same provider (a busy or exhausted model often has a sibling that still answers),
 * then the preferred models of the other providers the user can use. Empty when nothing else is configured.
 */
export function resolveFallbacks(userId: string, primary: ResolvedModel): ResolvedModel[] {
  if (primary.provider.id === 'mock') return [];
  const { models } = listModelsForUser(userId);
  const out: ResolvedModel[] = [];
  const add = (provider: ProviderId, wanted: string | null): void => {
    const key = resolveKey(userId, provider);
    if (!key) return;
    const entry = models.find((m) => m.provider === provider && m.available && (wanted ? m.model === wanted : true));
    if (!entry || entry.id === primary.modelId || out.some((m) => m.modelId === entry.id)) return;
    out.push({ modelId: entry.id, provider: PROVIDERS[provider], model: entry.model, apiKey: key.apiKey, baseUrl: key.baseUrl, keySource: key.keySource });
  };
  const own = primary.provider.id;
  for (const model of FALLBACK_MODELS[own] ?? []) add(own, model);
  for (const provider of FALLBACK_ORDER) {
    if (provider === own) continue;
    const wanted = FALLBACK_MODELS[provider];
    if (wanted) for (const model of wanted) add(provider, model);
    else add(provider, null);
  }
  return out;
}

/**
 * The model a turn should start on and the ones to fall back to. Models that failed moments ago are moved to
 * the back, so a turn does not begin by waiting on a provider that is known to be out of quota or silent;
 * `skipped` names the requested model when it was passed over.
 */
export function planModels(userId: string, requested?: ModelId | null): { model: ResolvedModel; fallbacks: ResolvedModel[]; skipped: ModelId | null } {
  const primary = resolveModel(userId, requested);
  const candidates = [primary, ...resolveFallbacks(userId, primary)];
  const healthy = candidates.filter((m) => !isUnavailable(m.modelId));
  // Everything is marked down: try in the normal order anyway rather than refusing.
  if (healthy.length === 0 || healthy[0] === primary) return { model: primary, fallbacks: candidates.slice(1), skipped: null };
  const resting = candidates.filter((m) => isUnavailable(m.modelId));
  return { model: healthy[0]!, fallbacks: [...healthy.slice(1), ...resting], skipped: primary.modelId };
}

/** Test helper: replaces a provider implementation (pass null to restore the built-in one). */
const BUILT_IN: Record<ProviderId, Provider> = { ...PROVIDERS };
export function setProviderForTests(id: ProviderId, provider: Provider | null): void {
  PROVIDERS[id] = provider ?? BUILT_IN[id];
}

export async function testProviderKey(
  provider: KeyProvider,
  key: { apiKey: string; baseUrl: string | null; model: string | null },
): Promise<{ ok: boolean; message: string }> {
  try {
    await PROVIDERS[provider].test(key);
    return { ok: true, message: 'The key works.' };
  } catch (err) {
    if (err instanceof ProviderError) return { ok: false, message: err.message };
    return { ok: false, message: 'The key could not be verified.' };
  }
}
