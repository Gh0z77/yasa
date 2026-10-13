import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** Lowercase base32 ([a-z2-7]) string of the given length from secure random bytes. */
export function randomBase32(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] & 31];
  return out;
}

export type IdPrefix = 'usr' | 'prj' | 'ver' | 'msg' | 'upl' | 'use' | 'act';

/** e.g. prj_k3j2h4g5f6d7s8a9q2w3e4r5t6 */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBase32(26)}`;
}

/** Preview tokens are used as DNS labels: lowercase base32, 20 chars. */
export function newPreviewToken(): string {
  return randomBase32(20);
}

/** Opaque session token for the cookie (base64url, 32 random bytes). */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}
