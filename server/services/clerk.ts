// Clerk as the identity provider (optional): verifies the session token of a request and maps the Clerk user
// onto a local `users` row, which keeps owning projects, keys and usage. Enabled when both Clerk keys are set.
import { createClerkClient, verifyToken, type ClerkClient } from '@clerk/backend';
import type { User } from '../../shared/types';
import { getConfig } from '../env';
import { logger } from '../lib/logger';
import { createUser, getUserByClerkId, getUserByEmail, linkClerkId, setEmailVerified, updateUser } from './users';

/** What we need to know about a Clerk user to create or refresh the local account. */
export interface ClerkIdentity {
  clerkId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export interface ClerkAdapter {
  /** Returns the Clerk user id (`sub`) of a valid session token, or null. */
  verify(token: string): Promise<string | null>;
  identity(clerkId: string): Promise<ClerkIdentity>;
  deleteUser(clerkId: string): Promise<void>;
}

/** Frontend API host encoded in a publishable key (`pk_test_<base64("host$")>`), or null if malformed. */
export function frontendApiFromPublishableKey(key: string): string | null {
  const match = /^pk_(?:test|live)_(.+)$/.exec(key.trim());
  if (!match?.[1]) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  if (!decoded.endsWith('$')) return null;
  const host = decoded.slice(0, -1).toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

function createAdapter(): ClerkAdapter {
  const config = getConfig().clerk;
  if (!config) throw new Error('Clerk is not configured');
  const client: ClerkClient = createClerkClient({ secretKey: config.secretKey, publishableKey: config.publishableKey });
  const authorizedParties = getConfig().allowedOrigins;
  return {
    async verify(token) {
      try {
        const result = (await verifyToken(token, { secretKey: config.secretKey, authorizedParties })) as unknown;
        // Newer SDKs return the payload, older ones `{ data, errors }`.
        const payload = (result && typeof result === 'object' && 'data' in result ? (result as { data?: unknown }).data : result) as
          | { sub?: unknown }
          | undefined;
        return typeof payload?.sub === 'string' && payload.sub ? payload.sub : null;
      } catch {
        return null;
      }
    },
    async identity(clerkId) {
      const user = await client.users.getUser(clerkId);
      const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ?? user.emailAddresses[0] ?? null;
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username || null;
      return {
        clerkId,
        email: primary?.emailAddress?.toLowerCase() ?? null,
        emailVerified: primary?.verification?.status === 'verified',
        name,
      };
    },
    async deleteUser(clerkId) {
      await client.users.deleteUser(clerkId);
    },
  };
}

let adapter: ClerkAdapter | null = null;

function getAdapter(): ClerkAdapter {
  if (!adapter) adapter = createAdapter();
  return adapter;
}

/** Test helper: swaps the Clerk API for a fake (pass null to restore the real one). */
export function setClerkAdapterForTests(fake: ClerkAdapter | null): void {
  adapter = fake;
  pending.clear();
  lastSync.clear();
}

export function clerkEnabled(): boolean {
  return getConfig().clerk !== null;
}

function displayName(identity: ClerkIdentity): string {
  return (identity.name ?? identity.email?.split('@')[0] ?? 'User').slice(0, 80) || 'User';
}

/** Creates the local account for a Clerk user, or links an existing one that has the same verified email. */
async function provision(clerkId: string): Promise<User | null> {
  const identity = await getAdapter().identity(clerkId);
  // Sign-ups without an email (phone, username) still need the unique column filled.
  const email = identity.email ?? `${clerkId.toLowerCase()}@users.clerk.invalid`;
  const existing = getUserByEmail(email);
  if (existing) {
    if (existing.clerkId === clerkId) return existing.user;
    // An account from before Clerk: adopt it only when Clerk has verified that the address is theirs.
    if (!existing.clerkId && identity.email && identity.emailVerified) return linkClerkId(existing.user.id, clerkId);
    logger.warn(`Clerk user ${clerkId} was not linked: the email already belongs to another local account`);
    return null;
  }
  try {
    return createUser({ email, name: displayName(identity), passwordHash: '!clerk', clerkId, emailVerified: Boolean(identity.email && identity.emailVerified) });
  } catch (err) {
    // A parallel request created the row first.
    const raced = getUserByClerkId(clerkId);
    if (raced) return raced;
    throw err;
  }
}

const pending = new Map<string, Promise<User | null>>();
const lastSync = new Map<string, number>();
const RESYNC_MS = 15 * 60_000;

/** Keeps the local name in step with the Clerk profile (the user edits it in Clerk's account screen). */
function refreshInBackground(user: User, clerkId: string): void {
  const now = Date.now();
  if (now - (lastSync.get(clerkId) ?? 0) < RESYNC_MS) return;
  lastSync.set(clerkId, now);
  void getAdapter()
    .identity(clerkId)
    .then((identity) => {
      const name = displayName(identity);
      if (identity.name && name !== user.name) updateUser(user.id, { name });
      if (identity.email === user.email) setEmailVerified(user.id, identity.emailVerified);
    })
    .catch(() => undefined);
}

/** The local user behind a Clerk session token, or null when the token is missing, invalid or unlinkable. */
export async function userFromClerkToken(token: string | undefined): Promise<User | null> {
  if (!token || token.length > 8192) return null;
  const clerkId = await getAdapter().verify(token);
  if (!clerkId) return null;

  const known = getUserByClerkId(clerkId);
  if (known) {
    refreshInBackground(known, clerkId);
    return known;
  }

  let job = pending.get(clerkId);
  if (!job) {
    job = provision(clerkId).finally(() => pending.delete(clerkId));
    pending.set(clerkId, job);
    lastSync.set(clerkId, Date.now());
  }
  try {
    return await job;
  } catch (err) {
    logger.error(`Could not load Clerk user ${clerkId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Removes the Clerk account that backs a local user (account deletion). */
export async function deleteClerkUser(clerkId: string): Promise<void> {
  await getAdapter().deleteUser(clerkId);
}
