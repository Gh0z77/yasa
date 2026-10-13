import type { ProjectRole, User } from '../../shared/types';
import { memberRole } from '../services/members';
import { getProjectRow, type ProjectRow } from '../services/projects';
import type { AppContext } from '../types';
import { notFound, unauthorized } from './errors';

export interface ProjectAccess {
  row: ProjectRow;
  user: User | null;
  isOwner: boolean;
  /** owner, a member's role, or null for someone who only sees a public project. */
  role: ProjectRole | null;
}

function roleOf(row: ProjectRow, user: User | null): ProjectRole | null {
  if (!user) return null;
  if (row.user_id === user.id) return 'owner';
  return memberRole(row.id, user.id);
}

/** Viewer access: the owner, a member, or anyone when the project is public. Others get 404 (existence is not leaked). */
export function viewProject(c: AppContext, id: string = c.req.param('id') ?? ''): ProjectAccess {
  const user = c.get('user');
  const row = getProjectRow(id);
  if (!row) throw notFound('Project not found');
  const role = roleOf(row, user);
  if (!role && row.visibility !== 'public') throw notFound('Project not found');
  return { row, user, isOwner: role === 'owner', role };
}

/** Editing access: the owner or a member with the editor role. Signed-out → 401, everyone else → 404. */
export function editProject(c: AppContext, id: string = c.req.param('id') ?? ''): { row: ProjectRow; user: User; isOwner: boolean } {
  const user = c.get('user');
  if (!user) throw unauthorized();
  const row = getProjectRow(id);
  const role = row ? roleOf(row, user) : null;
  if (!row || (role !== 'owner' && role !== 'editor')) throw notFound('Project not found');
  return { row, user, isOwner: role === 'owner' };
}

/** Owner access. Signed-out → 401, non-owner → 404. */
export function ownProject(c: AppContext, id: string = c.req.param('id') ?? ''): { row: ProjectRow; user: User } {
  const user = c.get('user');
  if (!user) throw unauthorized();
  const row = getProjectRow(id);
  if (!row || row.user_id !== user.id) throw notFound('Project not found');
  return { row, user };
}
