import type { ModelId, ModelTier, ProviderId } from './types';

export const APP_NAME = 'Yasa';
export const APP_VERSION = '1.0.0';

export const SESSION_COOKIE = 'yasa_session';
export const SESSION_TTL_DAYS = 30;

export const LIMITS = {
  nameMax: 80,
  emailMax: 254,
  passwordMin: 8,
  passwordMax: 200,
  projectNameMax: 80,
  descriptionMax: 500,
  customInstructionsMax: 8000,
  messageMax: 20_000,
  attachmentsMax: 4,
  uploadBytesMax: 5 * 1024 * 1024,
  fileBytesMax: 512 * 1024,
  binaryFileBytesMax: 5 * 1024 * 1024,
  projectFilesMax: 400,
  projectBytesMax: 20 * 1024 * 1024,
  pathMax: 200,
  runtimeErrorsMax: 10,
  autoFixAttempts: 2,
  freeFixesPerDay: 10,
  selectedElementHtmlMax: 1200,
  selectedElementTextMax: 300,
  maxJobsPerUser: 2,
  maxJobsGlobal: 16,
  maxParallelBuilds: 4,
  buildTimeoutMs: 20_000,
  historyMessages: 20,
  contextFileBytesMax: 100 * 1024,
  contextTotalBytesMax: 600 * 1024,
  maxOutputTokens: 64_000,
  communityPageSize: 24,
} as const;

export const RATE_LIMITS = {
  authPerMinute: 10,
  chatPerMinute: 20,
  uploadsPerMinute: 30,
} as const;

export const PREVIEW_HOST_PREFIX = 'pv-';
/** pv-<token>--v<N>.<SANDBOX_DOMAIN> serves version N read-only. */
export const PREVIEW_VERSION_SEPARATOR = '--v';
/** Marks the first path segment as a sandbox label when generated apps share one host (SANDBOX_MODE=path). */
export const SANDBOX_PATH_PREFIX = '~';

export const RESERVED_SLUGS = [
  'www', 'api', 'app', 'admin', 'static', 'assets', 'mail', 'preview', 'yasa', 'help', 'docs', 'status',
] as const;

export const ALLOWED_UPLOAD_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export interface ModelCatalogEntry {
  id: ModelId;
  provider: ProviderId;
  model: string;
  label: string;
  description: string;
  tier: ModelTier;
}

/** Static catalog. The OpenAI-compatible entry is added at runtime from OPENAI_MODEL. */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: 'anthropic:claude-opus-5',
    provider: 'anthropic',
    model: 'claude-opus-5',
    label: 'Claude Opus 5',
    description: 'Most capable — best for complex apps',
    tier: 'best',
  },
  {
    id: 'anthropic:claude-sonnet-5',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    description: 'Fast and smart — great default for iterating',
    tier: 'balanced',
  },
  {
    id: 'anthropic:claude-haiku-4-5',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    description: 'Fastest — small tweaks',
    tier: 'fast',
  },
  {
    id: 'openrouter:nvidia/nemotron-3-super-120b-a12b:free',
    provider: 'openrouter',
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    label: 'Nemotron 3 Super (free)',
    description: 'OpenRouter free model — fast and steady',
    tier: 'balanced',
  },
  {
    id: 'openrouter:cohere/north-mini-code:free',
    provider: 'openrouter',
    model: 'cohere/north-mini-code:free',
    label: 'North Mini Code (free)',
    description: 'OpenRouter free model — careful, slower',
    tier: 'balanced',
  },
  {
    id: 'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free',
    provider: 'openrouter',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    label: 'Nemotron 3 Ultra (free)',
    description: 'OpenRouter free model — largest, slowest',
    tier: 'best',
  },
  {
    id: 'openrouter:anthropic/claude-sonnet-5.5',
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-5.5',
    label: 'Claude Sonnet 5.5 (OpenRouter)',
    description: 'Top quality — needs OpenRouter credits',
    tier: 'best',
  },
  {
    id: 'openrouter:anthropic/claude-haiku-5.5',
    provider: 'openrouter',
    model: 'anthropic/claude-haiku-5.5',
    label: 'Claude Haiku 5.5 (OpenRouter)',
    description: 'Fast and inexpensive — needs OpenRouter credits',
    tier: 'balanced',
  },
  {
    id: 'openrouter:google/gemini-3.8-flash',
    provider: 'openrouter',
    model: 'google/gemini-3.8-flash',
    label: 'Gemini 3.8 Flash (OpenRouter)',
    description: 'Fast — needs OpenRouter credits',
    tier: 'balanced',
  },
  {
    id: 'nvidia:nvidia/nemotron-3-ultra-550b-a55b',
    provider: 'nvidia',
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    label: 'Nemotron 3 Ultra',
    description: 'NVIDIA NIM — largest model, noticeably slower',
    tier: 'best',
  },
  {
    id: 'nvidia:nvidia/nemotron-3-super-120b-a12b',
    provider: 'nvidia',
    model: 'nvidia/nemotron-3-super-120b-a12b',
    label: 'Nemotron 3 Super',
    description: 'NVIDIA NIM — fast, the automatic fallback',
    tier: 'balanced',
  },
  {
    id: 'nvidia:deepseek-ai/deepseek-v4.1-flash',
    provider: 'nvidia',
    model: 'deepseek-ai/deepseek-v4.1-flash',
    label: 'DeepSeek V4.1 Flash',
    description: 'NVIDIA NIM — DeepSeek, can queue at busy times',
    tier: 'balanced',
  },
  {
    id: 'gemini:gemini-pro-latest',
    provider: 'gemini',
    model: 'gemini-pro-latest',
    label: 'Gemini Pro',
    description: 'Google’s most capable model (latest)',
    tier: 'best',
  },
  {
    id: 'gemini:gemini-3.1-pro-preview',
    provider: 'gemini',
    model: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro',
    description: 'Strong reasoning and coding',
    tier: 'best',
  },
  {
    id: 'gemini:gemini-flash-latest',
    provider: 'gemini',
    model: 'gemini-flash-latest',
    label: 'Gemini Flash',
    description: 'Very fast (latest)',
    tier: 'fast',
  },
  {
    id: 'mock:demo',
    provider: 'mock',
    model: 'demo',
    label: 'Demo mode',
    description: 'No AI — canned responses for trying the product',
    tier: 'demo',
  },
];

/** Order used to pick a default model when none is configured. */
export const DEFAULT_MODEL_PREFERENCE: ModelId[] = [
  'anthropic:claude-opus-5',
  // Without a paid key the free OpenRouter models come first: they answer when free Gemini is overloaded.
  'openrouter:nvidia/nemotron-3-super-120b-a12b:free',
  'openrouter:cohere/north-mini-code:free',
  // Flash works on free Gemini keys; the Pro models usually need a paid quota.
  'gemini:gemini-flash-latest',
];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google Gemini',
  openai: 'OpenAI-compatible',
  nvidia: 'NVIDIA NIM',
  openrouter: 'OpenRouter',
  mock: 'Demo',
};
