import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { APP_VERSION, LIMITS } from '../shared/constants';
import type { HealthResponse } from '../shared/types';
import { getConfig } from './env';
import { errorBody, handleError, tooLarge } from './lib/errors';
import { sessionLoader } from './middleware/auth';
import { apiGuard, clientIp, securityHeaders } from './middleware/security';
import { sandboxMiddleware } from './preview/sandbox';
import { authRoutes } from './routes/auth';
import { collabRoutes, tlsRoutes } from './routes/collab';
import { githubAccountRoutes, githubProjectRoutes } from './routes/github';
import { chatRoutes } from './routes/chat';
import { communityRoutes } from './routes/community';
import { fileRoutes } from './routes/files';
import { meRoutes } from './routes/me';
import { modelRoutes } from './routes/models';
import { previewRoutes, slugRoutes } from './routes/preview';
import { projectRoutes } from './routes/projects';
import { uploadRoutes } from './routes/uploads';
import { supabaseOAuthRoutes } from './routes/supabase-oauth';
import { versionRoutes } from './routes/versions';
import type { AppEnv } from './types';

const JSON_LIMIT = 2 * 1024 * 1024;
const UPLOAD_LIMIT = LIMITS.uploadBytesMax + 1024 * 1024;

export function createApp(): Hono<AppEnv> {
  const config = getConfig();
  const app = new Hono<AppEnv>();

  app.onError(handleError);

  // Generated apps are served by host name before anything else touches the request.
  app.use('*', sandboxMiddleware());
  app.use('*', clientIp());
  app.use('*', securityHeaders());

  app.use('/api/*', apiGuard());
  app.use('/api/*', async (c, next) => {
    const limit = c.req.path.startsWith('/api/uploads') ? UPLOAD_LIMIT : JSON_LIMIT;
    return bodyLimit({
      maxSize: limit,
      onError: () => {
        throw tooLarge();
      },
    })(c, next);
  });
  app.use('/api/*', sessionLoader());

  app.get('/api/health', (c) => c.json<HealthResponse>({ ok: true, version: APP_VERSION }));
  app.route('/api/auth', authRoutes);
  app.route('/api/me/github', githubAccountRoutes);
  app.route('/api/me', meRoutes);
  app.route('/api/projects', githubProjectRoutes);
  app.route('/api/projects', collabRoutes);
  app.route('/api', tlsRoutes);
  app.route('/api/models', modelRoutes);
  app.route('/api/projects', projectRoutes);
  app.route('/api/projects', fileRoutes);
  app.route('/api/projects', versionRoutes);
  app.route('/api/projects', chatRoutes);
  app.route('/api/projects', previewRoutes);
  app.route('/api/uploads', uploadRoutes);
  app.route('/api/supabase/oauth', supabaseOAuthRoutes);
  app.route('/api/community', communityRoutes);
  app.route('/api', slugRoutes);

  app.all('/api/*', (c) => c.json(errorBody('not_found', 'Unknown API route'), 404));

  // Built web app (production / `npm start`). In development Vite serves the UI on :5173.
  const staticDir = process.env.STATIC_DIR ?? 'dist/web';
  const indexFile = path.resolve(process.cwd(), staticDir, 'index.html');
  if (existsSync(indexFile)) {
    const indexHtml = readFileSync(indexFile, 'utf8');
    app.use(
      '/assets/*',
      serveStatic({
        root: staticDir,
        onFound: (_path, c) => {
          c.header('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.use('*', serveStatic({ root: staticDir }));
    // SPA fallback
    app.get('*', (c) => c.html(indexHtml));
  } else {
    app.get('*', (c) =>
      c.text(`Yasa API server is running.\nOpen the app at ${config.appUrl} (run "npm run dev"), or build it with "npm run build".\n`),
    );
  }

  return app;
}
