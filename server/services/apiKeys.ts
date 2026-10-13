import type { ApiKeyInfo, KeyProvider } from '../../shared/types';
import { all, get, run } from '../db';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { logger } from '../lib/logger';
import { nowIso } from '../lib/time';

interface KeyRow {
  provider: string;
  encrypted_key: string;
  last4: string;
  base_url: string | null;
  model: string | null;
  created_at: string;
}

function toInfo(row: KeyRow): ApiKeyInfo {
  return {
    provider: row.provider as KeyProvider,
    last4: row.last4,
    baseUrl: row.base_url,
    model: row.model,
    createdAt: row.created_at,
  };
}

export function listApiKeys(userId: string): ApiKeyInfo[] {
  return all<KeyRow>('SELECT * FROM user_api_keys WHERE user_id = ? ORDER BY provider', userId).map(toInfo);
}

export function setApiKey(
  userId: string,
  provider: KeyProvider,
  apiKey: string,
  opts: { baseUrl?: string | null; model?: string | null } = {},
): ApiKeyInfo {
  const key = apiKey.trim();
  run(
    `INSERT INTO user_api_keys (user_id, provider, encrypted_key, last4, base_url, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET encrypted_key = excluded.encrypted_key, last4 = excluded.last4,
       base_url = excluded.base_url, model = excluded.model, created_at = excluded.created_at`,
    userId,
    provider,
    encryptSecret(key),
    key.slice(-4),
    opts.baseUrl?.trim().replace(/\/+$/, '') || null,
    opts.model?.trim() || null,
    nowIso(),
  );
  return toInfo(get<KeyRow>('SELECT * FROM user_api_keys WHERE user_id = ? AND provider = ?', userId, provider)!);
}

export function deleteApiKey(userId: string, provider: KeyProvider): void {
  run('DELETE FROM user_api_keys WHERE user_id = ? AND provider = ?', userId, provider);
}

/** Decrypted key for server-side use only. Never send the result to clients or logs. */
export function getUserApiKey(
  userId: string,
  provider: KeyProvider,
): { apiKey: string; baseUrl: string | null; model: string | null } | null {
  const row = get<KeyRow>('SELECT * FROM user_api_keys WHERE user_id = ? AND provider = ?', userId, provider);
  if (!row) return null;
  const apiKey = decryptSecret(row.encrypted_key);
  if (!apiKey) {
    logger.warn('Stored API key could not be decrypted (APP_SECRET changed?)', { userId, provider });
    return null;
  }
  return { apiKey, baseUrl: row.base_url, model: row.model };
}
