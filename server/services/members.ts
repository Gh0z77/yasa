// Collaboration: the owner shares a project with other people by email. A membership is keyed by the address,
// so it can be created before that person has an account, and it only counts once their address is verified.
import type { ProjectMember, ProjectMemberRole, ProjectSummary } from '../../shared/types';
import { all, get, run } from '../db';
import { badRequest } from '../lib/errors';
import { nowIso } from '../lib/time';
import { toSharedSummary, type ProjectRow } from './projects';

export const MAX_MEMBERS = 20;

interface MemberRow {
  email: string;
  role: string;
  created_at: string;
  name: string | null;
}

const toRole = (value: string): ProjectMemberRole => (value === 'editor' ? 'editor' : 'viewer');

/** The role a signed-in user holds in a project they do not own, or null. */
export function memberRole(projectId: string, userId: string): ProjectMemberRole | null {
  const row = get<{ role: string }>(
    `SELECT m.role FROM project_members m JOIN users u ON u.email = m.email
     WHERE m.project_id = ? AND u.id = ? AND u.email_verified = 1`,
    projectId,
    userId,
  );
  return row ? toRole(row.role) : null;
}

export function listMembers(projectId: string): ProjectMember[] {
  return all<MemberRow>(
    `SELECT m.email, m.role, m.created_at, u.name FROM project_members m
     LEFT JOIN users u ON u.email = m.email AND u.email_verified = 1
     WHERE m.project_id = ? ORDER BY m.created_at`,
    projectId,
  ).map((row) => ({ email: row.email, role: toRole(row.role), name: row.name, joined: row.name !== null, addedAt: row.created_at }));
}

/** Adds a member or changes the role of an existing one. */
export function setMember(projectId: string, ownerEmail: string, email: string, role: ProjectMemberRole, invitedBy: string): ProjectMember {
  const address = email.trim().toLowerCase();
  if (address === ownerEmail.trim().toLowerCase()) throw badRequest('You already own this project.');
  const existing = get<{ n: number }>('SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND email <> ?', projectId, address);
  if ((existing?.n ?? 0) >= MAX_MEMBERS) throw badRequest(`A project can be shared with up to ${MAX_MEMBERS} people.`);
  run(
    `INSERT INTO project_members (project_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, email) DO UPDATE SET role = excluded.role`,
    projectId,
    address,
    role,
    invitedBy,
    nowIso(),
  );
  return listMembers(projectId).find((m) => m.email === address)!;
}

export function removeMember(projectId: string, email: string): boolean {
  return run('DELETE FROM project_members WHERE project_id = ? AND email = ?', projectId, email.trim().toLowerCase()).changes > 0;
}

/** Projects other people shared with this user, newest first. */
export function listSharedProjects(userId: string): ProjectSummary[] {
  const rows = all<ProjectRow & { member_role: string; owner_name: string }>(
    `SELECT p.*, m.role AS member_role, o.name AS owner_name,
       (SELECT number FROM versions v WHERE v.id = p.current_version_id) AS current_version_number,
       (SELECT number FROM versions v WHERE v.id = p.published_version_id) AS published_version_number
     FROM project_members m
     JOIN users u ON u.email = m.email AND u.email_verified = 1
     JOIN projects p ON p.id = m.project_id
     JOIN users o ON o.id = p.user_id
     WHERE u.id = ? AND p.user_id <> u.id
     ORDER BY p.updated_at DESC`,
    userId,
  );
  return rows.map((row) => toSharedSummary(row, toRole(row.member_role), row.owner_name));
}
