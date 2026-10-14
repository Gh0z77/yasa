// How many database statements common requests need. On a serverless host every statement is a network round
// trip, so these numbers are what the user waits for. Run with YASA_PERF=1; it prints the counts.
import { describe, it } from 'vitest';
import { queryStats } from '../../server/db';
import { call, chat, createProject, setupTestApp, signup } from '../server/helpers';

const print = (line: string) => process.stderr.write(`${line}\n`);

describe.skipIf(!process.env.YASA_PERF)('query counts', () => {
  it('prints statements per request', async () => {
    const app = setupTestApp();
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    await chat(app, cookie, project.id, { message: 'Coffee shop landing page' });
    const measure = async (label: string, run: () => Promise<unknown>, detail = false) => {
      const before = queryStats.count;
      if (detail) queryStats.log = [];
      await run();
      print(`${label.padEnd(34)} ${String(queryStats.count - before).padStart(4)} statements`);
      if (!detail || !queryStats.log) return;
      const counts = new Map<string, number>();
      for (const sql of queryStats.log) {
        const key = sql.replace(/\s+/g, ' ').slice(0, 100);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      queryStats.log = null;
      for (const [sql, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 16)) print(`  ${String(n).padStart(3)}  ${sql}`);
    };
    await measure('GET /api/me', () => call(app, 'GET', '/api/me', { cookie }));
    await measure('GET /api/models', () => call(app, 'GET', '/api/models', { cookie }), true);
    await measure('GET /api/projects', () => call(app, 'GET', '/api/projects', { cookie }));
    await measure('GET /api/projects/:id', () => call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    await measure('GET /api/projects/:id/messages', () => call(app, 'GET', `/api/projects/${project.id}/messages`, { cookie }));
    await measure('GET /api/me/usage', () => call(app, 'GET', '/api/me/usage', { cookie }));
    await measure('preview page', async () => app.request('http://localhost:3000/', { headers: { host: new URL(project.previewUrl).host } }));
    await measure('chat turn (demo model)', () => chat(app, cookie, project.id, { message: 'Add a section about us' }), true);
  });
});
