import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { getConfig } from '../env';
import { finishSupabaseOAuth } from '../services/supabase-account';
import type { AppEnv } from '../types';
import { SUPABASE_OAUTH_COOKIE } from './me';

/** Supabase sends the browser back here after the user approved (or declined) the connection. */
export const supabaseOAuthRoutes = new Hono<AppEnv>();

supabaseOAuthRoutes.get('/callback', async (c) => {
  const target = await finishSupabaseOAuth(getCookie(c, SUPABASE_OAUTH_COOKIE), {
    code: c.req.query('code'),
    state: c.req.query('state'),
    error: c.req.query('error'),
  });
  deleteCookie(c, SUPABASE_OAUTH_COOKIE, { path: '/api/supabase/oauth' });
  return c.redirect(`${getConfig().appUrl}${target}`, 302);
});
