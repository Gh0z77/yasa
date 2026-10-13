import type { ModelId, User } from '../../shared/types';
import { get, run } from '../db';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  plan: string;
  default_model: string | null;
  clerk_id: string | null;
  created_at: string;
  updated_at: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    plan: row.plan === 'pro' ? 'pro' : 'free',
    defaultModel: (row.default_model as ModelId | null) ?? null,
    createdAt: row.created_at,
  };
}

export function createUser(input: { email: string; name: string; passwordHash: string; clerkId?: string; emailVerified?: boolean }): User {
  const now = nowIso();
  const id = newId('usr');
  run(
    'INSERT INTO users (id, email, name, password_hash, clerk_id, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    input.email.trim().toLowerCase(),
    input.name.trim(),
    input.passwordHash,
    input.clerkId ?? null,
    input.emailVerified === false ? 0 : 1,
    now,
    now,
  );
  return getUserById(id)!;
}

export function getUserById(id: string): User | null {
  const row = get<UserRow>('SELECT * FROM users WHERE id = ?', id);
  return row ? toUser(row) : null;
}

export function getUserAuthByEmail(email: string): { user: User; passwordHash: string } | null {
  const row = get<UserRow>('SELECT * FROM users WHERE email = ?', email.trim().toLowerCase());
  return row ? { user: toUser(row), passwordHash: row.password_hash } : null;
}

/** The local account linked to a Clerk user id. */
export function getUserByClerkId(clerkId: string): User | null {
  const row = get<UserRow>('SELECT * FROM users WHERE clerk_id = ?', clerkId);
  return row ? toUser(row) : null;
}

export function getUserByEmail(email: string): { user: User; clerkId: string | null } | null {
  const row = get<UserRow>('SELECT * FROM users WHERE email = ?', email.trim().toLowerCase());
  return row ? { user: toUser(row), clerkId: row.clerk_id } : null;
}

export function getUserClerkId(id: string): string | null {
  return get<{ clerk_id: string | null }>('SELECT clerk_id FROM users WHERE id = ?', id)?.clerk_id ?? null;
}

/** Records whether the address is proven to belong to the account (shared projects only open for verified ones). */
export function setEmailVerified(id: string, verified: boolean): void {
  run('UPDATE users SET email_verified = ? WHERE id = ?', verified ? 1 : 0, id);
}

export function linkClerkId(id: string, clerkId: string): User {
  run('UPDATE users SET clerk_id = ?, updated_at = ? WHERE id = ?', clerkId, nowIso(), id);
  return getUserById(id)!;
}

export function getUserPasswordHash(id: string): string | null {
  return get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', id)?.password_hash ?? null;
}

export function updateUser(
  id: string,
  patch: { name?: string; defaultModel?: ModelId | null; passwordHash?: string },
): User {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name.trim());
  }
  if (patch.defaultModel !== undefined) {
    sets.push('default_model = ?');
    params.push(patch.defaultModel);
  }
  if (patch.passwordHash !== undefined) {
    sets.push('password_hash = ?');
    params.push(patch.passwordHash);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(nowIso());
    run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  }
  return getUserById(id)!;
}

export function deleteUser(id: string): void {
  run('DELETE FROM users WHERE id = ?', id);
}

export function countUsers(): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
}
