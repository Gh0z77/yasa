import { SESSION_TTL_DAYS } from '../../shared/constants';
import type { User } from '../../shared/types';
import { get, run } from '../db';
import { sha256Hex } from '../lib/crypto';
import { newSessionToken } from '../lib/ids';
import { addDaysIso, nowIso } from '../lib/time';
import { getUserById } from './users';

const SLIDE_WHEN_DAYS_LEFT = 15;

export function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): { token: string; expiresAt: string } {
  const token = newSessionToken();
  const expiresAt = addDaysIso(SESSION_TTL_DAYS);
  run(
    'INSERT INTO sessions (id, user_id, expires_at, created_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
    sha256Hex(token),
    userId,
    expiresAt,
    nowIso(),
    meta.userAgent?.slice(0, 300) ?? null,
    meta.ip ?? null,
  );
  return { token, expiresAt };
}

/** Resolves a cookie token to its user; slides the expiry when it gets close. */
export function getSessionUser(token: string): { user: User; sessionId: string; expiresAt: string } | null {
  if (!token || token.length > 200) return null;
  const sessionId = sha256Hex(token);
  const row = get<{ user_id: string; expires_at: string }>('SELECT user_id, expires_at FROM sessions WHERE id = ?', sessionId);
  if (!row) return null;
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) {
    run('DELETE FROM sessions WHERE id = ?', sessionId);
    return null;
  }
  const user = getUserById(row.user_id);
  if (!user) return null;
  let expiresAt = row.expires_at;
  if (Date.parse(expiresAt) - now < SLIDE_WHEN_DAYS_LEFT * 86_400_000) {
    expiresAt = addDaysIso(SESSION_TTL_DAYS);
    run('UPDATE sessions SET expires_at = ? WHERE id = ?', expiresAt, sessionId);
  }
  return { user, sessionId, expiresAt };
}

export function deleteSession(token: string): void {
  run('DELETE FROM sessions WHERE id = ?', sha256Hex(token));
}

export function deleteUserSessions(userId: string, exceptSessionId?: string): void {
  if (exceptSessionId) run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', userId, exceptSessionId);
  else run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function deleteExpiredSessions(): number {
  return run('DELETE FROM sessions WHERE expires_at <= ?', nowIso()).changes;
}
