// A user's own Supabase account. The user clicks "Connect Supabase", approves Yasa on Supabase's own page (OAuth),
// and comes back connected: no keys to copy. With the account Yasa lists the user's Supabase projects, creates a
// new one for an app that needs a backend, links it to the Yasa project and runs the app's migrations.
//
// OAuth needs Yasa to be registered once at Supabase (SUPABASE_OAUTH_CLIENT_ID / _SECRET, see docs/VERCEL.md).
// A personal access token is still accepted by the API (scripts, servers without the OAuth app) but never asked
// for in the interface.
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseAccount, SupabaseAccountProject, SupabaseOrganization } from '../../shared/types';
import { getConfig } from '../env';
import { get, run } from '../db';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { badRequest, HttpError } from '../lib/errors';
import { logger } from '../lib/logger';
import { nowIso } from '../lib/time';
import { connectSupabase, supabaseCall } from './supabase';

const API = 'https://api.supabase.com';
/** Where new backends are created: the region closest to most of Yasa's users (Central Asia). */
const DEFAULT_REGION = 'eu-central-1';
export const SUPABASE_REGIONS = ['eu-central-1', 'eu-west-2', 'ap-south-1', 'ap-northeast-1', 'ap-southeast-1', 'us-east-1', 'us-west-1'] as const;
/** The OAuth round trip must finish within this time. */
const OAUTH_WINDOW_MS = 10 * 60_000;
/** Refresh an access token this long before it runs out. */
const REFRESH_MARGIN_MS = 60_000;

const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const NOT_CONNECTED: Omit<SupabaseAccount, 'canConnect'> = { connected: false, organizations: [], projects: [] };

interface AccountRow {
  encrypted_token: string;
  encrypted_refresh_token: string | null;
  expires_at: string | null;
}

export const supabaseOAuthEnabled = (): boolean => getConfig().supabaseOAuth !== null;
const redirectUri = (): string => `${getConfig().appUrl}/api/supabase/oauth/callback`;

export function hasSupabaseAccount(userId: string): boolean {
  return Boolean(get<{ user_id: string }>('SELECT user_id FROM supabase_accounts WHERE user_id = ?', userId));
}

function saveTokens(userId: string, access: string, refresh: string | null, expiresInSeconds: number | null): void {
  run(
    `INSERT INTO supabase_accounts (user_id, encrypted_token, encrypted_refresh_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET encrypted_token = excluded.encrypted_token, encrypted_refresh_token = excluded.encrypted_refresh_token,
       expires_at = excluded.expires_at, created_at = excluded.created_at`,
    userId,
    encryptSecret(access),
    refresh ? encryptSecret(refresh) : null,
    expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null,
    nowIso(),
  );
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

/** POST /v1/oauth/token with the app's credentials (basic auth), form-encoded as OAuth requires. */
async function tokenRequest(params: Record<string, string>): Promise<{ ok: boolean; status: number; body: TokenResponse }> {
  const app = getConfig().supabaseOAuth;
  if (!app) throw badRequest('Supabase sign-in is not set up on this server.', { supabase: 'no_account' });
  const res = await supabaseCall(`${API}/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams(params).toString(),
  });
  return { ok: res.ok, status: res.status, body: ((await res.json().catch(() => ({}))) as TokenResponse) ?? {} };
}

/**
 * A working access token for the user's connected account, refreshed when it is about to expire; null when the
 * account is not connected or Supabase no longer accepts it (the connection is then forgotten).
 */
export async function accountAccessToken(userId: string): Promise<string | null> {
  const row = get<AccountRow>('SELECT encrypted_token, encrypted_refresh_token, expires_at FROM supabase_accounts WHERE user_id = ?', userId);
  if (!row) return null;
  const access = decryptSecret(row.encrypted_token);
  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : null;
  if (access && (expiresAt === null || expiresAt - Date.now() > REFRESH_MARGIN_MS)) return access;
  const refresh = row.encrypted_refresh_token ? decryptSecret(row.encrypted_refresh_token) : null;
  if (!refresh || !supabaseOAuthEnabled()) return access;
  const result = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
  if (!result.ok || !result.body.access_token) {
    logger.warn('Supabase token could not be refreshed', { userId, status: result.status });
    // Revoked by the user, or the refresh token expired: the account has to be connected again.
    if (result.status === 400 || result.status === 401) disconnectSupabaseAccount(userId);
    return null;
  }
  saveTokens(userId, result.body.access_token, result.body.refresh_token ?? refresh, result.body.expires_in ?? null);
  return result.body.access_token;
}

// ------------------------------------------------------------------------------------------------ OAuth

interface OAuthTicket {
  userId: string;
  state: string;
  verifier: string;
  returnTo: string;
  at: number;
}

/** Only paths of this site may be returned to. */
function safeReturnPath(value: string | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value.slice(0, 500) : '/settings?tab=integrations';
}

/**
 * Starts the one-click connection: the URL of Supabase's consent page, and a sealed ticket (kept in a short-lived
 * cookie) that ties the answer to this user and proves the code exchange (PKCE).
 */
export function startSupabaseOAuth(userId: string, returnTo?: string): { url: string; ticket: string } {
  const app = getConfig().supabaseOAuth;
  if (!app) throw badRequest('Supabase sign-in is not set up on this server.', { supabase: 'no_account' });
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL(`${API}/v1/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  const ticket: OAuthTicket = { userId, state, verifier, returnTo: safeReturnPath(returnTo), at: Date.now() };
  return { url: url.toString(), ticket: encryptSecret(JSON.stringify(ticket)) };
}

/** Finishes the connection on Supabase's redirect. Returns where to send the browser. */
export async function finishSupabaseOAuth(sealed: string | undefined, params: { code?: string; state?: string; error?: string }): Promise<string> {
  const opened = sealed ? decryptSecret(sealed) : null;
  const ticket = opened ? (JSON.parse(opened) as OAuthTicket) : null;
  const back = (path: string, outcome: 'connected' | 'error') => `${path}${path.includes('?') ? '&' : '?'}supabase=${outcome}`;
  if (!ticket || Date.now() - ticket.at > OAUTH_WINDOW_MS || !params.state || params.state !== ticket.state) {
    return back(ticket?.returnTo ?? '/settings?tab=integrations', 'error');
  }
  if (params.error || !params.code) return back(ticket.returnTo, 'error');
  const result = await tokenRequest({ grant_type: 'authorization_code', code: params.code, redirect_uri: redirectUri(), code_verifier: ticket.verifier });
  if (!result.ok || !result.body.access_token) {
    logger.warn('Supabase OAuth code exchange failed', { userId: ticket.userId, status: result.status });
    return back(ticket.returnTo, 'error');
  }
  saveTokens(ticket.userId, result.body.access_token, result.body.refresh_token ?? null, result.body.expires_in ?? null);
  return back(ticket.returnTo, 'connected');
}

// ------------------------------------------------------------------------------------------------ the account

async function organizations(token: string): Promise<SupabaseOrganization[] | null> {
  const res = await supabaseCall(`${API}/v1/organizations`, { headers: auth(token) });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new HttpError(502, 'provider_error', 'Supabase could not answer. Try again in a moment.', { supabase: 'unreachable' });
  const list = (await res.json()) as Array<{ id: string; slug?: string; name: string }>;
  return list.map((org) => ({ id: org.slug ?? org.id, name: org.name }));
}

async function projects(token: string): Promise<SupabaseAccountProject[]> {
  const res = await supabaseCall(`${API}/v1/projects`, { headers: auth(token) });
  if (!res.ok) throw new HttpError(502, 'provider_error', 'Supabase could not answer. Try again in a moment.', { supabase: 'unreachable' });
  const list = (await res.json()) as Array<{ id?: string; ref?: string; name: string; region: string; status: string; organization_id?: string; organization_slug?: string }>;
  return list.map((p) => ({
    ref: p.ref ?? p.id ?? '',
    name: p.name,
    region: p.region,
    status: p.status,
    organizationId: p.organization_slug ?? p.organization_id ?? '',
    ready: p.status === 'ACTIVE_HEALTHY',
  }));
}

/** Connects with a personal access token (API only; the interface uses OAuth). */
export async function connectSupabaseAccount(userId: string, token: string): Promise<SupabaseAccount> {
  const trimmed = token.trim();
  const orgs = await organizations(trimmed);
  if (!orgs) throw badRequest('Supabase did not accept this access token.', { supabase: 'bad_account_token' });
  saveTokens(userId, trimmed, null, null);
  return { connected: true, canConnect: supabaseOAuthEnabled(), organizations: orgs, projects: await projects(trimmed) };
}

export function disconnectSupabaseAccount(userId: string): void {
  run('DELETE FROM supabase_accounts WHERE user_id = ?', userId);
}

export async function getSupabaseAccount(userId: string): Promise<SupabaseAccount> {
  const canConnect = supabaseOAuthEnabled();
  const token = await accountAccessToken(userId);
  if (!token) return { ...NOT_CONNECTED, canConnect };
  const orgs = await organizations(token);
  // Access revoked in Supabase: forget the connection rather than fail every time.
  if (!orgs) {
    disconnectSupabaseAccount(userId);
    return { ...NOT_CONNECTED, canConnect };
  }
  return { connected: true, canConnect, organizations: orgs, projects: await projects(token) };
}

async function requireToken(userId: string): Promise<string> {
  const token = await accountAccessToken(userId);
  if (!token) throw badRequest('Connect your Supabase account first.', { supabase: 'no_account' });
  return token;
}

/** Creates a Supabase project in the user's account and returns its reference (it takes a minute or two to start). */
export async function createSupabaseProject(userId: string, input: { name: string; organizationId?: string; region?: string }): Promise<SupabaseAccountProject> {
  const token = await requireToken(userId);
  const orgs = await organizations(token);
  if (!orgs) throw badRequest('Supabase no longer accepts this connection. Connect the account again.', { supabase: 'bad_account_token' });
  const organizationId = input.organizationId ?? orgs[0]?.id;
  if (!organizationId) throw badRequest('This Supabase account has no organization. Create one at supabase.com first.', { supabase: 'no_account' });
  const region = input.region && (SUPABASE_REGIONS as readonly string[]).includes(input.region) ? input.region : DEFAULT_REGION;
  const name = input.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'yasa-app';
  const body = { name, organization_id: organizationId, region, db_pass: randomBytes(24).toString('base64url') };
  const res = await supabaseCall(`${API}/v1/projects`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { message?: string } | null;
    const message = detail?.message ?? `Supabase answered ${res.status}`;
    logger.warn('Supabase project could not be created', { userId, status: res.status, message });
    // The free plan allows two active projects per organization.
    if (/limit|maximum|free projects|upgrade/i.test(message)) {
      throw badRequest('Your Supabase plan allows no more projects. Pause or delete one in Supabase, or choose an existing project.', { supabase: 'project_limit' });
    }
    throw new HttpError(502, 'provider_error', `Supabase could not create the project: ${message.slice(0, 200)}`, { supabase: 'unreachable' });
  }
  const created = (await res.json()) as { id?: string; ref?: string; name: string; region: string; status?: string };
  const ref = created.ref ?? created.id ?? '';
  return { ref, name: created.name, region: created.region, status: created.status ?? 'COMING_UP', organizationId, ready: false };
}

async function projectKey(token: string, ref: string): Promise<string | null> {
  const res = await supabaseCall(`${API}/v1/projects/${ref}/api-keys`, { headers: auth(token) });
  if (!res.ok) return null;
  const keys = (await res.json()) as Array<{ name?: string; type?: string; api_key?: string | null }>;
  // The classic anon key works with every supabase-js version; the newer publishable key otherwise.
  const anon = keys.find((k) => k.name === 'anon' && k.api_key) ?? keys.find((k) => k.type === 'publishable' && k.api_key);
  return anon?.api_key ?? null;
}

export async function supabaseProjectStatus(userId: string, ref: string): Promise<string> {
  const res = await supabaseCall(`${API}/v1/projects/${encodeURIComponent(ref)}`, { headers: auth(await requireToken(userId)) });
  if (!res.ok) return 'UNKNOWN';
  return ((await res.json()) as { status?: string }).status ?? 'UNKNOWN';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Links one of the user's Supabase projects to a Yasa project: installs the client with the project's key; SQL then
 * runs with the user's connected account. A project that is still starting is waited for up to `waitMs`.
 */
export async function linkSupabaseProject(userId: string, projectId: string, ref: string, waitMs = 0): Promise<void> {
  if (!/^[a-z0-9]{12,40}$/.test(ref)) throw badRequest('Unknown Supabase project.', { supabase: 'bad_url' });
  const token = await requireToken(userId);
  const deadline = Date.now() + waitMs;
  let key = await projectKey(token, ref);
  while (!key && Date.now() < deadline) {
    await sleep(4000);
    key = await projectKey(token, ref);
  }
  if (!key) throw badRequest('This Supabase project is still starting. Try again in a minute.', { supabase: 'not_ready' });
  // The key comes from Supabase itself: no need to test it against a project that may still be booting.
  await connectSupabase(projectId, { url: `https://${ref}.supabase.co`, anonKey: key, accessToken: null }, { trusted: true, accountUserId: userId });
}

/** Creates a backend for a Yasa project in the user's account and links it (used by the AI). */
export async function provisionBackend(userId: string, projectId: string, name: string, waitMs: number): Promise<SupabaseAccountProject> {
  const created = await createSupabaseProject(userId, { name });
  await linkSupabaseProject(userId, projectId, created.ref, waitMs);
  return created;
}

/** Waits until a linked project's database answers, so its migrations can run. */
export async function waitUntilReady(userId: string, ref: string, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if ((await supabaseProjectStatus(userId, ref)) === 'ACTIVE_HEALTHY') return true;
    if (Date.now() >= deadline) return false;
    await sleep(5000);
  }
}
