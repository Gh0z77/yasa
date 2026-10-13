import { Hono } from 'hono';
import { LIMITS, RATE_LIMITS } from '../../shared/constants';
import type { UploadResponse } from '../../shared/types';
import { badRequest, notFound, tooLarge } from '../lib/errors';
import { RateLimiter } from '../lib/rate-limit';
import { requireUser } from '../middleware/auth';
import { getProjectRow } from '../services/projects';
import { createUpload, getUpload, sniffImageMime } from '../services/uploads';
import type { AppEnv } from '../types';

const uploadLimiter = new RateLimiter(RATE_LIMITS.uploadsPerMinute, 60_000);

export const uploadRoutes = new Hono<AppEnv>();

uploadRoutes.post('/', async (c) => {
  const user = requireUser(c);
  uploadLimiter.check(`upload:${user.id}`);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) throw badRequest('Attach an image in the "file" field');
  if (file.size > LIMITS.uploadBytesMax) throw tooLarge(`Images can be at most ${LIMITS.uploadBytesMax / (1024 * 1024)} MB`);
  const data = new Uint8Array(await file.arrayBuffer());
  // The declared type is ignored: only real PNG/JPEG/WebP/GIF bytes are accepted.
  const mime = sniffImageMime(data);
  if (!mime) throw badRequest('Only PNG, JPEG, WebP or GIF images are supported');

  let projectId: string | null = null;
  const requested = form.get('projectId');
  if (typeof requested === 'string' && requested) {
    const project = getProjectRow(requested);
    if (!project || project.user_id !== user.id) throw notFound('Project not found');
    projectId = project.id;
  }
  const attachment = createUpload({ userId: user.id, projectId, name: file.name || 'image', mime, data });
  return c.json<UploadResponse>({ attachment }, 201);
});

uploadRoutes.get('/:id', (c) => {
  const upload = getUpload(c.req.param('id'));
  if (!upload) throw notFound('Image not found');
  const user = c.get('user');
  let allowed = Boolean(user && upload.userId === user.id);
  if (!allowed && upload.projectId) {
    const project = getProjectRow(upload.projectId);
    allowed = Boolean(project && (project.visibility === 'public' || (user && project.user_id === user.id)));
  }
  if (!allowed) throw notFound('Image not found');
  const safeName = upload.attachment.name.replace(/[^\w.\- ]+/g, '_');
  return new Response(upload.data, {
    headers: {
      'Content-Type': upload.attachment.mime,
      'Content-Length': String(upload.data.byteLength),
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
