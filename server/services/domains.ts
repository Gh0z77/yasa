// Custom domains for published apps. The owner adds a domain, proves control of it with a DNS TXT record and
// points it at the server; requests for that host are then answered with the project's published build.
import { resolveTxt } from 'node:dns/promises';
import type { ProjectDomain } from '../../shared/types';
import { all, get, run } from '../db';
import { getConfig } from '../env';
import { badRequest, conflict, notFound } from '../lib/errors';
import { randomBase32 } from '../lib/ids';
import { nowIso } from '../lib/time';

export const MAX_DOMAINS_PER_PROJECT = 5;
/** TXT record that proves ownership: `_yasa-verify.<domain>` = `yasa-verify=<token>`. */
export const VERIFY_LABEL = '_yasa-verify';
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

type TxtResolver = (name: string) => Promise<string[][]>;
let lookupTxt: TxtResolver = (name) => resolveTxt(name);

/** Test helper: replaces the DNS lookup (pass null to restore the real one). */
export function setTxtResolverForTests(fake: TxtResolver | null): void {
  lookupTxt = fake ?? ((name) => resolveTxt(name));
}

interface DomainRow {
  domain: string;
  project_id: string;
  verify_token: string;
  verified_at: string | null;
  created_at: string;
}

function toDto(row: DomainRow): ProjectDomain {
  return {
    domain: row.domain,
    verified: row.verified_at !== null,
    verifiedAt: row.verified_at,
    txtName: `${VERIFY_LABEL}.${row.domain}`,
    txtValue: `yasa-verify=${row.verify_token}`,
    // Where the domain itself has to point: the host that serves published apps.
    target: getConfig().sandboxDomain.replace(/:\d+$/, ''),
    addedAt: row.created_at,
  };
}

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

export function listDomains(projectId: string): ProjectDomain[] {
  return all<DomainRow>('SELECT * FROM project_domains WHERE project_id = ? ORDER BY created_at', projectId).map(toDto);
}

export function addDomain(projectId: string, input: string): ProjectDomain {
  const domain = normalizeDomain(input);
  if (!HOSTNAME.test(domain)) throw badRequest('Enter a domain like shop.example.com', { domain: 'invalid' });
  const config = getConfig();
  const own = [config.sandboxDomain.replace(/:\d+$/, ''), new URL(config.appUrl).hostname];
  if (own.some((host) => domain === host || domain.endsWith(`.${host}`))) throw badRequest('This domain belongs to the builder itself.', { domain: 'reserved' });
  const existing = get<DomainRow>('SELECT * FROM project_domains WHERE domain = ?', domain);
  if (existing) {
    if (existing.project_id === projectId) return toDto(existing);
    // A domain somebody else added but never verified can be claimed by whoever proves control of it.
    if (existing.verified_at) throw conflict('This domain is already connected to another project.', { domain: 'taken' });
    run('DELETE FROM project_domains WHERE domain = ?', domain);
  }
  const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM project_domains WHERE project_id = ?', projectId)?.n ?? 0;
  if (count >= MAX_DOMAINS_PER_PROJECT) throw badRequest(`A project can have up to ${MAX_DOMAINS_PER_PROJECT} domains.`);
  run('INSERT INTO project_domains (domain, project_id, verify_token, created_at) VALUES (?, ?, ?, ?)', domain, projectId, randomBase32(20), nowIso());
  return toDto(get<DomainRow>('SELECT * FROM project_domains WHERE domain = ?', domain)!);
}

export function removeDomain(projectId: string, input: string): boolean {
  return run('DELETE FROM project_domains WHERE project_id = ? AND domain = ?', projectId, normalizeDomain(input)).changes > 0;
}

/** Looks the TXT record up and marks the domain verified when it carries the project's token. */
export async function verifyDomain(projectId: string, input: string): Promise<ProjectDomain> {
  const domain = normalizeDomain(input);
  const row = get<DomainRow>('SELECT * FROM project_domains WHERE project_id = ? AND domain = ?', projectId, domain);
  if (!row) throw notFound('Domain not found');
  if (row.verified_at) return toDto(row);
  let records: string[][] = [];
  try {
    records = await lookupTxt(`${VERIFY_LABEL}.${domain}`);
  } catch {
    records = [];
  }
  const expected = `yasa-verify=${row.verify_token}`;
  const found = records.some((chunks) => chunks.join('').trim() === expected);
  if (!found) throw badRequest('The TXT record was not found yet. DNS changes can take a few minutes to spread.', { domain: 'not_verified' });
  run('UPDATE project_domains SET verified_at = ? WHERE domain = ?', nowIso(), domain);
  return toDto(get<DomainRow>('SELECT * FROM project_domains WHERE domain = ?', domain)!);
}

/** The project a verified custom domain serves, or null. */
export function projectIdForDomain(host: string): string | null {
  const domain = host.toLowerCase().replace(/:\d+$/, '');
  if (!HOSTNAME.test(domain)) return null;
  return get<{ project_id: string }>('SELECT project_id FROM project_domains WHERE domain = ? AND verified_at IS NOT NULL', domain)?.project_id ?? null;
}
