import { Hono } from 'hono';
import { z } from 'zod';
import { LIMITS } from '../../shared/constants';
import type {
  SupabaseAccount,
  SupabaseConnectStart,
  ApiKeyInfo,
  ApiKeyTestResponse,
  ApiKeysResponse,
  AuthResponse,
  KeyProvider,
  ModelId,
  OkResponse,
  UsageSummary,
} from '../../shared/types';
import { listModelsForUser, testProviderKey } from '../ai/registry';
import { isGeneratingForUser } from '../ai/jobs';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors';
import { assertSafeBaseUrl } from '../lib/net';
import { parseJson, zModelId } from '../lib/validate';
import { clearSessionCookie, requireUser } from '../middleware/auth';
import { deleteApiKey, getUserApiKey, listApiKeys, setApiKey } from '../services/apiKeys';
import { setCookie } from 'hono/cookie';
import { connectSupabaseAccount, disconnectSupabaseAccount, getSupabaseAccount, startSupabaseOAuth, supabaseOAuthEnabled } from '../services/supabase-account';
import { getConfig } from '../env';
import { clerkEnabled, deleteClerkUser } from '../services/clerk';
import { deleteUserSessions } from '../services/sessions';
import { getUsageSummary } from '../services/usage';
import { deleteUser, getUserClerkId, getUserPasswordHash, updateUser } from '../services/users';
import type { AppEnv } from '../types';
import { authLimiter } from './auth';

const UpdateMeSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.nameMax).optional(),
  defaultModel: zModelId.nullable().optional(),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(LIMITS.passwordMax),
  newPassword: z.string().min(LIMITS.passwordMin, `Password must be at least ${LIMITS.passwordMin} characters`).max(LIMITS.passwordMax),
});

const DeleteAccountSchema = z.object({ password: z.string().max(LIMITS.passwordMax).default('') });

const SetApiKeySchema = z.object({
  apiKey: z.string().trim().min(8, 'API key looks too short').max(500),
  baseUrl: z.string().trim().max(300).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
});

const KEY_PROVIDERS: KeyProvider[] = ['anthropic', 'gemini', 'openai'];

function providerParam(value: string | undefined): KeyProvider {
  if (!value || !KEY_PROVIDERS.includes(value as KeyProvider)) throw notFound('Unknown provider');
  return value as KeyProvider;
}

/** Holds the sealed OAuth ticket between the consent page and the callback. */
export const SUPABASE_OAUTH_COOKIE = 'yasa_sb_oauth';

export const meRoutes = new Hono<AppEnv>();

meRoutes.patch('/', async (c) => {
  const user = requireUser(c);
  const body = await parseJson(c, UpdateMeSchema);
  if (body.defaultModel) {
    const known = listModelsForUser(user.id).models.some((m) => m.id === body.defaultModel);
    if (!known) throw badRequest('Unknown model');
  }
  const updated = updateUser(user.id, { name: body.name, defaultModel: body.defaultModel as ModelId | null | undefined });
  return c.json<AuthResponse>({ user: updated });
});

meRoutes.post('/password', async (c) => {
  const user = requireUser(c);
  authLimiter.check(`password:${user.id}`);
  if (clerkEnabled()) throw forbidden('Passwords are managed in your Clerk account');
  const body = await parseJson(c, ChangePasswordSchema);
  const hash = getUserPasswordHash(user.id);
  if (!hash || !(await verifyPassword(body.currentPassword, hash))) throw unauthorized('Current password is incorrect');
  updateUser(user.id, { passwordHash: await hashPassword(body.newPassword) });
  deleteUserSessions(user.id, c.get('sessionId') ?? undefined);
  return c.json<OkResponse>({ ok: true });
});

meRoutes.delete('/', async (c) => {
  const user = requireUser(c);
  authLimiter.check(`delete:${user.id}`);
  const body = await parseJson(c, DeleteAccountSchema);
  if (isGeneratingForUser(user.id)) throw conflict('Stop the running generation before deleting your account');
  if (clerkEnabled()) {
    // The Clerk session already proves who this is; remove the Clerk account first so it cannot come back.
    const clerkId = getUserClerkId(user.id);
    if (clerkId) await deleteClerkUser(clerkId);
  } else {
    const hash = getUserPasswordHash(user.id);
    if (!hash || !(await verifyPassword(body.password, hash))) throw unauthorized('Password is incorrect');
  }
  deleteUser(user.id);
  clearSessionCookie(c);
  return c.json<OkResponse>({ ok: true });
});

meRoutes.get('/usage', (c) => {
  const user = requireUser(c);
  return c.json<UsageSummary>(getUsageSummary(user.id));
});

// The user's own Supabase account: connected once, then every project can get a backend from it.
meRoutes.get('/supabase', async (c) => {
  const user = requireUser(c);
  return c.json<SupabaseAccount>(await getSupabaseAccount(user.id));
});

meRoutes.put('/supabase', async (c) => {
  const user = requireUser(c);
  const body = await parseJson(c, z.object({ accessToken: z.string().trim().min(20).max(400) }));
  return c.json<SupabaseAccount>(await connectSupabaseAccount(user.id, body.accessToken));
});

meRoutes.delete('/supabase', (c) => {
  const user = requireUser(c);
  disconnectSupabaseAccount(user.id);
  return c.json<SupabaseAccount>({ connected: false, canConnect: supabaseOAuthEnabled(), organizations: [], projects: [] });
});

/** One-click connection: the browser goes to Supabase's consent page with this URL and comes back to the callback. */
meRoutes.post('/supabase/connect', async (c) => {
  const user = requireUser(c);
  const body = await parseJson(c, z.object({ returnTo: z.string().max(500).optional() }));
  const { url, ticket } = startSupabaseOAuth(user.id, body.returnTo);
  setCookie(c, SUPABASE_OAUTH_COOKIE, ticket, {
    path: '/api/supabase/oauth',
    httpOnly: true,
    sameSite: 'Lax',
    secure: getConfig().appUrl.startsWith('https://'),
    maxAge: 600,
  });
  return c.json<SupabaseConnectStart>({ url });
});

meRoutes.get('/api-keys', (c) => {
  const user = requireUser(c);
  return c.json<ApiKeysResponse>({ keys: listApiKeys(user.id) });
});

meRoutes.put('/api-keys/:provider', async (c) => {
  const user = requireUser(c);
  const provider = providerParam(c.req.param('provider'));
  const body = await parseJson(c, SetApiKeySchema);
  let baseUrl: string | null = null;
  let model: string | null = null;
  if (provider === 'openai') {
    if (body.baseUrl) baseUrl = await assertSafeBaseUrl(body.baseUrl);
    model = body.model || null;
    const isOfficial = !baseUrl || new URL(baseUrl).hostname === 'api.openai.com';
    if (!isOfficial && !model) throw badRequest('Enter the model name to use with this provider');
  }
  const key: ApiKeyInfo = setApiKey(user.id, provider, body.apiKey, { baseUrl, model });
  return c.json<{ key: ApiKeyInfo }>({ key });
});

meRoutes.delete('/api-keys/:provider', (c) => {
  const user = requireUser(c);
  deleteApiKey(user.id, providerParam(c.req.param('provider')));
  return c.json<OkResponse>({ ok: true });
});

meRoutes.post('/api-keys/:provider/test', async (c) => {
  const user = requireUser(c);
  const provider = providerParam(c.req.param('provider'));
  authLimiter.check(`keytest:${user.id}`);
  const key = getUserApiKey(user.id, provider);
  if (!key) throw notFound('No API key saved for this provider');
  return c.json<ApiKeyTestResponse>(await testProviderKey(provider, key));
});
