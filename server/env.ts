import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { SANDBOX_PATH_PREFIX } from '../shared/constants';
import type { ModelId } from '../shared/types';

const boolish = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('::'),
  APP_URL: z.string().optional(),
  SANDBOX_DOMAIN: z.string().optional(),
  SANDBOX_PROTOCOL: z.enum(['http', 'https']).optional(),
  SANDBOX_MODE: z.enum(['subdomain', 'path']).optional(),
  GENERATION_TIME_LIMIT_SECONDS: z.coerce.number().int().min(0).max(3600).optional(),
  // Set by Vercel on its build and runtime machines.
  VERCEL: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  DATA_DIR: z.string().default('./data'),
  DATABASE_URL: z.string().optional(),
  APP_SECRET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  IMAGE_PROVIDER: z.enum(['auto', 'gemini', 'nvidia', 'pollinations', 'off']).optional(),
  MAX_CONCURRENT_GENERATIONS: z.coerce.number().int().min(1).max(500).default(32),
  MAX_GENERATIONS_PER_USER: z.coerce.number().int().min(1).max(20).default(2),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-5'),
  DEFAULT_MODEL: z.string().optional(),
  ENABLE_MOCK_PROVIDER: boolish,
  DAILY_MESSAGE_LIMIT: z.coerce.number().int().min(0).default(100),
  SIGNUPS_ENABLED: boolish,
  TRUST_PROXY: boolish,
  CLERK_SECRET_KEY: z.string().optional(),
  SUPABASE_OAUTH_CLIENT_ID: z.string().optional(),
  SUPABASE_OAUTH_CLIENT_SECRET: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  VITE_CLERK_PUBLISHABLE_KEY: z.string().optional(),
});

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  isProd: boolean;
  isTest: boolean;
  port: number;
  host: string;
  /** Builder origin without trailing slash, e.g. http://localhost:5173 */
  appUrl: string;
  /** Origins accepted by the CSRF guard. */
  allowedOrigins: string[];
  /** host[:port] under which sandbox subdomains live, lowercase. */
  sandboxDomain: string;
  sandboxProtocol: 'http' | 'https';
  /**
   * Where generated apps live: each on its own subdomain of the sandbox domain (needs wildcard DNS), or all on
   * the sandbox host itself with the app named by the first path segment (hosts without wildcard domains).
   */
  sandboxMode: 'subdomain' | 'path';
  /** Running on a serverless host: no disk, several short-lived instances, a limit on how long a request may run. */
  hosted: boolean;
  /** A generation is stopped (and what it built is saved) after this long; 0 = no limit. */
  generationTimeLimitMs: number;
  dataDir: string;
  /** ':memory:' in tests. */
  dbPath: string;
  /** Postgres connection string; when set it replaces the SQLite file (hosted deployments without a disk). */
  databaseUrl: string | null;
  appSecret: string;
  anthropicApiKey: string | null;
  anthropicEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  geminiApiKey: string | null;
  /** NVIDIA NIM (build.nvidia.com). */
  nvidiaApiKey: string | null;
  /** OpenRouter (openrouter.ai). */
  openrouterApiKey: string | null;
  /** Who creates AI images: auto = Gemini when its key has image quota, then FLUX on NVIDIA NIM, then a keyless public service. */
  imageProvider: 'auto' | 'gemini' | 'nvidia' | 'pollinations' | 'off';
  /** Generations that may run at the same time on this server / for one user. */
  maxJobsGlobal: number;
  maxJobsPerUser: number;
  openaiApiKey: string | null;
  openaiBaseUrl: string;
  openaiModel: string;
  defaultModel: ModelId | null;
  enableMockProvider: boolean;
  /** 0 = unlimited */
  dailyMessageLimit: number;
  signupsEnabled: boolean;
  trustProxy: boolean;
  /** Yasa's OAuth app at Supabase: lets users connect their Supabase account with one click. */
  supabaseOAuth: { clientId: string; clientSecret: string } | null;
  /** Clerk as the identity provider; null = built-in email + password accounts. */
  clerk: { secretKey: string; publishableKey: string } | null;
}

function nonEmpty(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function resolveSecret(explicit: string | null, dataDir: string, isTest: boolean, hosted: boolean): string {
  if (explicit) return explicit;
  if (isTest) return 'test-secret-test-secret-test-secret';
  // Without a disk there is nowhere to keep a generated secret, and a new one on every start would make the
  // stored API keys and tokens unreadable.
  if (hosted) throw new Error('APP_SECRET must be set (a random string of 32+ characters) when DATABASE_URL is used.');
  const file = path.join(dataDir, 'secret.key');
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }
  mkdirSync(dataDir, { recursive: true });
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';
  const isTest = e.NODE_ENV === 'test';
  const hosted = !isTest && Boolean(nonEmpty(e.VERCEL));
  const vercelHost = hosted ? nonEmpty(e.VERCEL_PROJECT_PRODUCTION_URL) : null;
  const appUrl = (
    nonEmpty(e.APP_URL) ??
    (vercelHost ? `https://${vercelHost}` : isProd || isTest ? `http://localhost:${e.PORT}` : 'http://localhost:5173')
  ).replace(/\/+$/, '');
  const sandboxDomain = (nonEmpty(e.SANDBOX_DOMAIN) ?? `localhost:${e.PORT}`).toLowerCase();
  const sandboxProtocol = e.SANDBOX_PROTOCOL ?? (appUrl.startsWith('https://') ? 'https' : 'http');
  const dataDir = path.resolve(e.DATA_DIR);
  const databaseUrl = isTest ? null : nonEmpty(e.DATABASE_URL);
  // Tests never use real provider keys from the machine environment.
  const anthropicApiKey = isTest ? null : nonEmpty(e.ANTHROPIC_API_KEY);
  const geminiApiKey = isTest ? null : (nonEmpty(e.GEMINI_API_KEY) ?? nonEmpty(e.GOOGLE_API_KEY));
  const openaiApiKey = isTest ? null : nonEmpty(e.OPENAI_API_KEY);
  const nvidiaApiKey = isTest ? null : nonEmpty(e.NVIDIA_API_KEY);
  const openrouterApiKey = isTest ? null : nonEmpty(e.OPENROUTER_API_KEY);
  const hasRealProvider = Boolean(anthropicApiKey || geminiApiKey || openaiApiKey || nvidiaApiKey || openrouterApiKey);
  // Both keys are needed; tests always run on the built-in accounts.
  const clerkSecretKey = isTest ? null : nonEmpty(e.CLERK_SECRET_KEY);
  const clerkPublishableKey = isTest ? null : (nonEmpty(e.CLERK_PUBLISHABLE_KEY) ?? nonEmpty(e.VITE_CLERK_PUBLISHABLE_KEY));

  const allowedOrigins = new Set<string>([new URL(appUrl).origin]);
  if (!isProd) {
    allowedOrigins.add(`http://localhost:${e.PORT}`);
    allowedOrigins.add(`http://127.0.0.1:${e.PORT}`);
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
  }

  return {
    nodeEnv: e.NODE_ENV,
    isProd,
    isTest,
    port: e.PORT,
    host: e.HOST,
    appUrl,
    allowedOrigins: [...allowedOrigins],
    sandboxDomain,
    sandboxProtocol,
    sandboxMode: e.SANDBOX_MODE ?? 'subdomain',
    hosted,
    // A serverless request may run for five minutes: stop a little earlier so the result can still be saved.
    generationTimeLimitMs: (e.GENERATION_TIME_LIMIT_SECONDS ?? (hosted ? 270 : 0)) * 1000,
    dataDir,
    dbPath: isTest ? ':memory:' : path.join(dataDir, 'yasa.db'),
    databaseUrl,
    appSecret: resolveSecret(nonEmpty(e.APP_SECRET), dataDir, isTest, databaseUrl !== null),
    anthropicApiKey,
    anthropicEffort: e.ANTHROPIC_EFFORT,
    geminiApiKey,
    nvidiaApiKey,
    openrouterApiKey,
    // Tests never call out to image services unless they install a fake generator and switch this on.
    imageProvider: isTest ? 'off' : (e.IMAGE_PROVIDER ?? 'auto'),
    maxJobsGlobal: e.MAX_CONCURRENT_GENERATIONS,
    maxJobsPerUser: e.MAX_GENERATIONS_PER_USER,
    openaiApiKey,
    openaiBaseUrl: e.OPENAI_BASE_URL.replace(/\/+$/, ''),
    openaiModel: e.OPENAI_MODEL,
    defaultModel: (nonEmpty(e.DEFAULT_MODEL) as ModelId | null) ?? null,
    enableMockProvider: e.ENABLE_MOCK_PROVIDER ?? (!isProd || !hasRealProvider),
    dailyMessageLimit: e.DAILY_MESSAGE_LIMIT,
    signupsEnabled: e.SIGNUPS_ENABLED ?? true,
    trustProxy: e.TRUST_PROXY ?? hosted,
    supabaseOAuth:
      !isTest && nonEmpty(e.SUPABASE_OAUTH_CLIENT_ID) && nonEmpty(e.SUPABASE_OAUTH_CLIENT_SECRET)
        ? { clientId: nonEmpty(e.SUPABASE_OAUTH_CLIENT_ID)!, clientSecret: nonEmpty(e.SUPABASE_OAUTH_CLIENT_SECRET)! }
        : null,
    clerk: clerkSecretKey && clerkPublishableKey ? { secretKey: clerkSecretKey, publishableKey: clerkPublishableKey } : null,
  };
}

let cached: Config | null = null;

export function getConfig(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test helper: replaces the cached config (merged over a fresh load). */
export function setConfigForTests(overrides: Partial<Config> = {}): Config {
  cached = { ...loadConfig({ ...process.env, NODE_ENV: 'test' }), ...overrides };
  return cached;
}

/** URL of the draft preview for a preview token. */
export function previewUrlFor(token: string, config: Config = getConfig()): string {
  return sandboxUrl(`pv-${token}`, config);
}

/** Public URL of a published app. */
export function publishedUrlFor(slug: string, config: Config = getConfig()): string {
  return sandboxUrl(slug, config);
}

/** Address of a generated app, given its sandbox label (a preview token label or a published slug). */
function sandboxUrl(label: string, config: Config): string {
  return config.sandboxMode === 'path'
    ? `${config.sandboxProtocol}://${config.sandboxDomain}/${SANDBOX_PATH_PREFIX}${label}/`
    : `${config.sandboxProtocol}://${label}.${config.sandboxDomain}/`;
}
