import type { Attachment } from '../../shared/types';
import { get, run } from '../db';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/time';

interface UploadRow {
  id: string;
  user_id: string;
  project_id: string | null;
  name: string;
  mime: string;
  size: number;
  data: Uint8Array;
  created_at: string;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function extensionForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'bin';
}

/** Detects the real image type from magic bytes; null when it is not an allowed image. */
export function sniffImageMime(data: Uint8Array): string | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 6 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) return 'image/gif';
  if (
    data.length >= 12 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function toAttachment(row: Omit<UploadRow, 'data'>): Attachment {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    url: `/api/uploads/${row.id}`,
    projectPath: null,
  };
}

export function createUpload(input: {
  userId: string;
  projectId?: string | null;
  name: string;
  mime: string;
  data: Uint8Array;
}): Attachment {
  const id = newId('upl');
  const name = input.name.replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || `image.${extensionForMime(input.mime)}`;
  run(
    'INSERT INTO uploads (id, user_id, project_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    input.userId,
    input.projectId ?? null,
    name,
    input.mime,
    input.data.byteLength,
    input.data,
    nowIso(),
  );
  return toAttachment({ id, user_id: input.userId, project_id: input.projectId ?? null, name, mime: input.mime, size: input.data.byteLength, created_at: '' });
}

export function getUpload(
  id: string,
): { attachment: Attachment; userId: string; projectId: string | null; data: Uint8Array } | null {
  const row = get<UploadRow>('SELECT * FROM uploads WHERE id = ?', id);
  if (!row) return null;
  return { attachment: toAttachment(row), userId: row.user_id, projectId: row.project_id, data: row.data };
}

export function attachUploadToProject(id: string, projectId: string): void {
  run('UPDATE uploads SET project_id = ? WHERE id = ?', projectId, id);
}

/** File name used when an upload is referenced inside a project: <id>.<ext> */
export function uploadFileName(id: string, mime: string): string {
  return `${id}.${extensionForMime(mime)}`;
}
