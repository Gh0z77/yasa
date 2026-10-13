import { strToU8, zipSync, type Zippable } from 'fflate';
import { Hono } from 'hono';
import { z } from 'zod';
import { LIMITS } from '../../shared/constants';
import { downloadFileName, provisionalName } from '../../shared/slug';
import type {
  CreateProjectResponse,
  FileEncoding,
  ModelId,
  OkResponse,
  Project,
  ProjectDetailResponse,
  ProjectSummary,
} from '../../shared/types';
import { isGenerating, startChatJob } from '../ai/jobs';
import { ownProject, viewProject } from '../lib/access';
import { conflict, HttpError, notFound } from '../lib/errors';
import { logger } from '../lib/logger';
import { parseJson, parseQuery, zLocale, zModelId } from '../lib/validate';
import { requireUser } from '../middleware/auth';
import { listSharedProjects } from '../services/members';
import { listFiles } from '../services/files';
import {
  createProject,
  deleteProject,
  getProjectRow,
  listUserProjects,
  rotatePreviewToken,
  toProjectDto,
  updateProject,
} from '../services/projects';
import { deletePublishedBuild } from '../services/publish';
import { getVersion, getVersionFiles } from '../services/versions';
import { getTemplateFiles } from '../template';
import type { AppEnv } from '../types';

const ListQuery = z.object({
  q: z.string().max(100).optional(),
  sort: z.enum(['updated', 'created', 'name']).optional(),
});

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.projectNameMax).optional(),
  prompt: z.string().trim().min(1).max(LIMITS.messageMax).optional(),
  attachmentIds: z.array(z.string().max(40)).max(LIMITS.attachmentsMax).optional(),
  model: zModelId.optional(),
  locale: zLocale.optional(),
  skipQuestions: z.boolean().optional(),
});

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.projectNameMax).optional(),
  emoji: z.string().trim().min(1).max(16).optional(),
  description: z.string().trim().max(LIMITS.descriptionMax).optional(),
  visibility: z.enum(['private', 'public']).optional(),
  customInstructions: z.string().max(LIMITS.customInstructionsMax).optional(),
});

function filesRecord(files: { path: string; content: string; encoding: FileEncoding }[]) {
  const out: Record<string, { content: string; encoding: FileEncoding }> = {};
  for (const f of files) out[f.path] = { content: f.content, encoding: f.encoding };
  return out;
}

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.get('/', (c) => {
  const user = requireUser(c);
  const query = parseQuery(c, ListQuery);
  return c.json<{ projects: ProjectSummary[]; shared: ProjectSummary[] }>({ projects: listUserProjects(user.id, query), shared: listSharedProjects(user.id) });
});

projectRoutes.post('/', async (c) => {
  const user = requireUser(c);
  const body = await parseJson(c, CreateSchema);
  const name = body.name ?? (body.prompt ? provisionalName(body.prompt) : 'New project');
  const project = createProject({ userId: user.id, name, files: getTemplateFiles(body.locale ?? 'en') });

  let generating = false;
  if (body.prompt) {
    try {
      startChatJob({
        project: getProjectRow(project.id)!,
        user,
        request: {
          message: body.prompt,
          attachmentIds: body.attachmentIds,
          model: body.model as ModelId | undefined,
          mode: 'build',
          locale: body.locale,
          skipQuestions: body.skipQuestions,
        },
      });
      generating = true;
    } catch (err) {
      // The project still exists; the workspace shows why generation could not start.
      if (!(err instanceof HttpError)) logger.error('Could not start the first generation', { error: err });
    }
  }
  return c.json<CreateProjectResponse>({ project, generating }, 201);
});

projectRoutes.get('/:id', (c) => {
  const { row, isOwner, role } = viewProject(c);
  const project = toProjectDto(row);
  const canEdit = role === 'owner' || role === 'editor';
  if (!canEdit) project.customInstructions = '';
  return c.json<ProjectDetailResponse>({ project, files: listFiles(row.id), isOwner, canEdit, role });
});

projectRoutes.patch('/:id', async (c) => {
  const { row } = ownProject(c);
  const body = await parseJson(c, UpdateSchema);
  let project: Project = updateProject(row.id, {
    ...body,
    // A manual rename wins over later AI renames.
    ...(body.name !== undefined && body.name !== row.name ? { nameLocked: true } : {}),
  });
  // Going private invalidates links that were shared while public.
  if (body.visibility === 'private' && row.visibility === 'public') project = rotatePreviewToken(row.id);
  return c.json<{ project: Project }>({ project });
});

projectRoutes.delete('/:id', (c) => {
  const { row } = ownProject(c);
  if (isGenerating(row.id)) throw conflict('Stop the running generation first');
  deletePublishedBuild(row.id);
  deleteProject(row.id);
  return c.json<OkResponse>({ ok: true });
});

projectRoutes.post('/:id/duplicate', (c) => {
  const { row, user } = ownProject(c);
  const copy = createProject({
    userId: user.id,
    name: `${row.name} (copy)`.slice(0, LIMITS.projectNameMax),
    emoji: row.emoji,
    description: row.description,
    files: filesRecord(listFiles(row.id)),
    initialSummary: `Copied from ${row.name}`,
  });
  if (row.custom_instructions) updateProject(copy.id, { customInstructions: row.custom_instructions });
  return c.json<{ project: Project }>({ project: updateProject(copy.id, {}) }, 201);
});

projectRoutes.post('/:id/remix', (c) => {
  const user = requireUser(c);
  const { row } = viewProject(c);
  // Remix copies files only — never chat history or the owner's custom instructions.
  const copy = createProject({
    userId: user.id,
    name: `${row.name} (remix)`.slice(0, LIMITS.projectNameMax),
    emoji: row.emoji,
    description: row.description,
    files: filesRecord(listFiles(row.id)),
    remixedFromId: row.id,
    initialSummary: `Remixed from ${row.name}`,
  });
  return c.json<{ project: Project }>({ project: copy }, 201);
});

projectRoutes.get('/:id/download', (c) => {
  const { row } = viewProject(c);
  const versionId = c.req.query('versionId');
  let files = listFiles(row.id);
  if (versionId) {
    if (!getVersion(row.id, versionId)) throw notFound('Version not found');
    files = getVersionFiles(versionId);
  }
  const zippable: Zippable = {};
  for (const file of files) {
    zippable[file.path] = file.encoding === 'base64' ? new Uint8Array(Buffer.from(file.content, 'base64')) : strToU8(file.content);
  }
  const zip = zipSync(zippable, { level: 6 });
  const fileName = downloadFileName(row.name);
  const utf8Name = encodeURIComponent(`${row.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'yasa-app'}.zip`);
  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(zip.byteLength),
      'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${utf8Name}`,
      'Cache-Control': 'no-store',
    },
  });
});
