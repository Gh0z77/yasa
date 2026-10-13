// Project add-ons: people (members), backend (Supabase) and custom domains.
import { Hono } from 'hono';
import { z } from 'zod';
import { LIMITS } from '../../shared/constants';
import type { DomainsResponse, MembersResponse, OkResponse, ProjectDomain, ProjectMember, SupabaseApplyResponse, SupabaseOverview, SupabaseStatus } from '../../shared/types';
import { isGenerating } from '../ai/jobs';
import { ownProject, viewProject } from '../lib/access';
import { conflict, forbidden, notFound, unauthorized } from '../lib/errors';
import { RateLimiter } from '../lib/rate-limit';
import { parseJson } from '../lib/validate';
import { addDomain, listDomains, projectIdForDomain, removeDomain, verifyDomain } from '../services/domains';
import { listMembers, removeMember, setMember } from '../services/members';
import { applyPendingMigrations, connectSupabase, disconnectSupabase, getSupabaseOverview, getSupabaseStatus, markMigrationApplied } from '../services/supabase';
import { getUserById } from '../services/users';
import type { AppEnv } from '../types';

/** External lookups (Supabase, DNS) and invitations get a small per-user budget. */
export const collabLimiter = new RateLimiter(20, 60_000);

const zEmail = z.string().trim().toLowerCase().min(3).max(LIMITS.emailMax).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address');
const MemberSchema = z.object({ email: zEmail, role: z.enum(['editor', 'viewer']).default('editor') });
const RemoveMemberSchema = z.object({ email: zEmail });
const SupabaseSchema = z.object({
  url: z.string().trim().min(10).max(200),
  anonKey: z.string().trim().min(20, 'The key looks too short').max(2000),
  accessToken: z.string().trim().max(400).nullable().optional(),
  dbUrl: z.string().trim().max(600).nullable().optional(),
});
const MarkSchema = z.object({ path: z.string().trim().min(1).max(300) });
const DomainSchema = z.object({ domain: z.string().trim().min(3).max(260) });

export const collabRoutes = new Hono<AppEnv>();

// ---- members ---------------------------------------------------------------------------------------------
collabRoutes.get('/:id/members', (c) => {
  const { row, user, role } = viewProject(c);
  // Only people who are part of the project see who else is.
  if (!user || !role) throw notFound('Project not found');
  const owner = getUserById(row.user_id);
  return c.json<MembersResponse>({ owner: { email: owner?.email ?? '', name: owner?.name ?? '' }, members: listMembers(row.id) });
});

collabRoutes.post('/:id/members', async (c) => {
  const { row, user } = ownProject(c);
  collabLimiter.check(`member:${user.id}`);
  const body = await parseJson(c, MemberSchema);
  return c.json<{ member: ProjectMember }>({ member: setMember(row.id, user.email, body.email, body.role, user.id) });
});

collabRoutes.post('/:id/members/remove', async (c) => {
  const { row, user, isOwner } = viewProject(c);
  if (!user) throw unauthorized();
  const body = await parseJson(c, RemoveMemberSchema);
  // The owner removes anyone; a member can only leave.
  if (!isOwner && body.email !== user.email.toLowerCase()) throw forbidden('Only the owner can remove other people');
  if (!removeMember(row.id, body.email)) throw notFound('This person is not a member');
  return c.json<OkResponse>({ ok: true });
});

// ---- Supabase --------------------------------------------------------------------------------------------
collabRoutes.get('/:id/supabase', (c) => {
  const { row } = ownProject(c);
  return c.json<SupabaseStatus>(getSupabaseStatus(row.id));
});

collabRoutes.get('/:id/supabase/overview', async (c) => {
  const { row, user } = ownProject(c);
  collabLimiter.check('supabase:' + user.id);
  return c.json<SupabaseOverview>(await getSupabaseOverview(row.id));
});

collabRoutes.put('/:id/supabase', async (c) => {
  const { row, user } = ownProject(c);
  collabLimiter.check(`supabase:${user.id}`);
  if (isGenerating(row.id)) throw conflict('Wait for the AI to finish before changing the backend connection');
  const body = await parseJson(c, SupabaseSchema);
  return c.json<SupabaseStatus>(await connectSupabase(row.id, body));
});

collabRoutes.delete('/:id/supabase', (c) => {
  const { row } = ownProject(c);
  disconnectSupabase(row.id);
  return c.json<SupabaseStatus>(getSupabaseStatus(row.id));
});

collabRoutes.post('/:id/supabase/migrations/apply', async (c) => {
  const { row, user } = ownProject(c);
  collabLimiter.check(`supabase:${user.id}`);
  return c.json<SupabaseApplyResponse>(await applyPendingMigrations(row.id));
});

collabRoutes.post('/:id/supabase/migrations/mark', async (c) => {
  const { row } = ownProject(c);
  const body = await parseJson(c, MarkSchema);
  return c.json<SupabaseStatus>(markMigrationApplied(row.id, body.path));
});

// ---- custom domains --------------------------------------------------------------------------------------
collabRoutes.get('/:id/domains', (c) => {
  const { row } = ownProject(c);
  return c.json<DomainsResponse>({ domains: listDomains(row.id) });
});

collabRoutes.post('/:id/domains', async (c) => {
  const { row, user } = ownProject(c);
  collabLimiter.check(`domain:${user.id}`);
  const body = await parseJson(c, DomainSchema);
  return c.json<{ domain: ProjectDomain }>({ domain: addDomain(row.id, body.domain) }, 201);
});

collabRoutes.post('/:id/domains/verify', async (c) => {
  const { row, user } = ownProject(c);
  collabLimiter.check(`domain:${user.id}`);
  const body = await parseJson(c, DomainSchema);
  return c.json<{ domain: ProjectDomain }>({ domain: await verifyDomain(row.id, body.domain) });
});

collabRoutes.post('/:id/domains/remove', async (c) => {
  const { row } = ownProject(c);
  const body = await parseJson(c, DomainSchema);
  if (!removeDomain(row.id, body.domain)) throw notFound('Domain not found');
  return c.json<OkResponse>({ ok: true });
});

// ---- certificate gate ------------------------------------------------------------------------------------
/**
 * `GET /api/tls-check?domain=…` — asked by the reverse proxy before it requests a certificate for a host it has
 * not seen (Caddy "on-demand TLS"). 200 only for verified custom domains, so nobody can make the server obtain
 * certificates for arbitrary names.
 */
export const tlsRoutes = new Hono<AppEnv>();
tlsRoutes.get('/tls-check', (c) => {
  const domain = c.req.query('domain') ?? '';
  return projectIdForDomain(domain) ? c.text('ok') : c.text('unknown domain', 404);
});
