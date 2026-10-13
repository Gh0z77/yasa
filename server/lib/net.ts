import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { getConfig } from '../env';
import { badRequest } from './errors';

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inRange(ip: number, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (ipv4ToInt(base) & mask);
}

/** True for loopback, private, link-local, CGNAT, multicast and unspecified addresses. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const ip = ipv4ToInt(address);
    return (
      inRange(ip, '0.0.0.0', 8) ||
      inRange(ip, '10.0.0.0', 8) ||
      inRange(ip, '100.64.0.0', 10) ||
      inRange(ip, '127.0.0.0', 8) ||
      inRange(ip, '169.254.0.0', 16) ||
      inRange(ip, '172.16.0.0', 12) ||
      inRange(ip, '192.0.0.0', 24) ||
      inRange(ip, '192.168.0.0', 16) ||
      inRange(ip, '198.18.0.0', 15) ||
      inRange(ip, '224.0.0.0', 3)
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('ff');
  }
  return true;
}

/**
 * Validates a user-supplied provider base URL (BYOK OpenAI-compatible endpoints).
 * https only; in production the host must not resolve to an internal address.
 * http://localhost is tolerated outside production for local model servers.
 */
export async function assertSafeBaseUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('Base URL is not a valid URL');
  }
  if (url.username || url.password) throw badRequest('Base URL must not contain credentials');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const { isProd } = getConfig();

  if (url.protocol === 'http:') {
    if (isProd || !isLocal) throw badRequest('Base URL must use https');
  } else if (url.protocol !== 'https:') {
    throw badRequest('Base URL must use https');
  }

  if (isProd) {
    if (isLocal) throw badRequest('Base URL must be a public host');
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (addresses.length === 0) throw badRequest('Base URL host could not be resolved');
    if (addresses.some((a) => isPrivateAddress(a.address))) throw badRequest('Base URL must be a public host');
  }
  return url.toString().replace(/\/+$/, '');
}
