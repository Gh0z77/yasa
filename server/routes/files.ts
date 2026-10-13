import { Hono } from 'hono';
import { z } from 'zod';
import { LIMITS } from '../../shared/constants';
import type { OkResponse, ProjectFile } from '../../shared/types';
import { isGenerating } from '../ai/jobs';
import { editProject, viewProject } from '../lib/access';
import { badRequest, conflict, notFound, tooLarge } from '../lib/errors';
import { parseJson, zProjectPath } from '../lib/validate';
import { contentSize, deleteFile, getFile, listFiles, projectSize, renameFile, upsertFile } from '../services/files';
import type { AppEnv } from '../types';

const SaveSchema = z.object({
  path: zProjectPath,
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']).optional(),
});
const DeleteSchema = z.object({ path: zProjectPath });
const RenameSchema = z.object({ from: zProjectPath, to: zProjectPath });

function assertNotGenerating(projectId: string): void {
  if (isGenerating(projectId)) throw conflict('Wait for the AI to finish (or stop it) before editing files');
}

export const fileRoutes = new Hono<AppEnv>();

fileRoutes.get('/:id/files', (c) => {
  const { row } = viewProject(c);
  return c.json<{ files: ProjectFile[] }>({ files: listFiles(row.id) });
});

fileRoutes.put('/:id/files', async (c) => {
  const { row } = editProject(c);
  assertNotGenerating(row.id);
  const body = await parseJson(c, SaveSchema);
  const encoding = body.encoding ?? 'utf8';
  if (encoding === 'base64' && !/^[A-Za-z0-9+/]*={0,2}$/.test(body.content)) throw badRequest('Content is not valid base64');
  const size = contentSize(body.content, encoding);
  const max = encoding === 'base64' ? LIMITS.binaryFileBytesMax : LIMITS.fileBytesMax;
  if (size > max) throw tooLarge(`File is larger than ${Math.round(max / 1024)} KB`);
  const existing = getFile(row.id, body.path);
  const total = projectSize(row.id);
  if (!existing && total.files >= LIMITS.projectFilesMax) throw tooLarge(`A project can have at most ${LIMITS.projectFilesMax} files`);
  if (total.bytes - (existing?.size ?? 0) + size > LIMITS.projectBytesMax) throw tooLarge('The project is too large');
  return c.json<{ file: ProjectFile }>({ file: upsertFile(row.id, body.path, body.content, encoding) });
});

fileRoutes.post('/:id/files/delete', async (c) => {
  const { row } = editProject(c);
  assertNotGenerating(row.id);
  const body = await parseJson(c, DeleteSchema);
  if (!deleteFile(row.id, body.path)) throw notFound('File not found');
  return c.json<OkResponse>({ ok: true });
});

fileRoutes.post('/:id/files/rename', async (c) => {
  const { row } = editProject(c);
  assertNotGenerating(row.id);
  const body = await parseJson(c, RenameSchema);
  try {
    return c.json<{ file: ProjectFile }>({ file: renameFile(row.id, body.from, body.to) });
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'not_found') throw notFound('File not found');
    if (message === 'exists') throw conflict('A file with that name already exists');
    throw err;
  }
});
