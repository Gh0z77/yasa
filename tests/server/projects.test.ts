import { unzipSync, strFromU8 } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type {
  CommunityProject,
  Project,
  ProjectDetailResponse,
  ProjectFile,
  ProjectSummary,
  VersionFileDiff,
  VersionSummary,
} from '../../shared/types';
import type { AppEnv } from '../../server/types';
import { call, createProject, json, setupTestApp, signup } from './helpers';

let app: Hono<AppEnv>;

beforeEach(() => {
  app = setupTestApp();
});

describe('projects', () => {
  it('creates a project from the starter template with version 1', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'My shop' });
    expect(project.name).toBe('My shop');
    expect(project.previewUrl).toMatch(/^http:\/\/pv-[a-z2-7]{20}\.localhost:3000\/$/);
    expect(project.currentVersionNumber).toBe(1);
    expect(project.hasUncommittedChanges).toBe(false);
    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    expect(detail.isOwner).toBe(true);
    const paths = detail.files.map((f) => f.path);
    expect(paths).toContain('src/App.tsx');
    expect(paths).toContain('package.json');
    expect(paths).toContain('src/components/ui/button.tsx');
  });

  it('lists, searches, updates and deletes', async () => {
    const { cookie } = await signup(app);
    const a = await createProject(app, cookie, { name: 'Alpha notes' });
    await createProject(app, cookie, { name: 'Beta shop' });
    const all = await json<{ projects: ProjectSummary[] }>(await call(app, 'GET', '/api/projects', { cookie }));
    expect(all.projects).toHaveLength(2);
    const found = await json<{ projects: ProjectSummary[] }>(await call(app, 'GET', '/api/projects?q=alpha', { cookie }));
    expect(found.projects.map((p) => p.id)).toEqual([a.id]);
    const patched = await json<{ project: Project }>(
      await call(app, 'PATCH', `/api/projects/${a.id}`, { cookie, body: { name: 'Renamed', emoji: '📝', customInstructions: 'Use green.' } }),
    );
    expect(patched.project.name).toBe('Renamed');
    expect(patched.project.customInstructions).toBe('Use green.');
    expect((await call(app, 'DELETE', `/api/projects/${a.id}`, { cookie })).status).toBe(200);
    expect((await call(app, 'GET', `/api/projects/${a.id}`, { cookie })).status).toBe(404);
  });

  it('hides private projects from other users and guests (404), shows public ones read-only', async () => {
    const owner = await signup(app);
    const other = await signup(app);
    const project = await createProject(app, owner.cookie, { name: 'Secret' });
    await call(app, 'PATCH', `/api/projects/${project.id}`, { cookie: owner.cookie, body: { customInstructions: 'private notes' } });
    expect((await call(app, 'GET', `/api/projects/${project.id}`, { cookie: other.cookie })).status).toBe(404);
    expect((await call(app, 'GET', `/api/projects/${project.id}`)).status).toBe(404);
    expect((await call(app, 'PATCH', `/api/projects/${project.id}`, { cookie: other.cookie, body: { name: 'x' } })).status).toBe(404);

    await call(app, 'PATCH', `/api/projects/${project.id}`, { cookie: owner.cookie, body: { visibility: 'public' } });
    const seen = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie: other.cookie }));
    expect(seen.isOwner).toBe(false);
    expect(seen.project.customInstructions).toBe('');
    // still not writable
    expect((await call(app, 'PUT', `/api/projects/${project.id}/files`, { cookie: other.cookie, body: { path: 'src/x.ts', content: '' } })).status).toBe(404);
    const community = await json<{ projects: CommunityProject[] }>(await call(app, 'GET', '/api/community'));
    expect(community.projects.map((p) => p.id)).toContain(project.id);
  });

  it('rotates the preview link when a public project becomes private again', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    await call(app, 'PATCH', `/api/projects/${project.id}`, { cookie, body: { visibility: 'public' } });
    const back = await json<{ project: Project }>(await call(app, 'PATCH', `/api/projects/${project.id}`, { cookie, body: { visibility: 'private' } }));
    expect(back.project.previewUrl).not.toBe(project.previewUrl);
  });

  it('remixes a public project without chat or custom instructions and counts remixes', async () => {
    const owner = await signup(app);
    const other = await signup(app);
    const project = await createProject(app, owner.cookie, { name: 'Original' });
    await call(app, 'PATCH', `/api/projects/${project.id}`, { cookie: owner.cookie, body: { visibility: 'public', customInstructions: 'secret' } });
    const res = await call(app, 'POST', `/api/projects/${project.id}/remix`, { cookie: other.cookie });
    expect(res.status).toBe(201);
    const remix = (await json<{ project: Project }>(res)).project;
    expect(remix.ownerId).toBe(other.user.id);
    expect(remix.remixedFromId).toBe(project.id);
    expect(remix.customInstructions).toBe('');
    expect(remix.visibility).toBe('private');
    const community = await json<{ projects: CommunityProject[] }>(await call(app, 'GET', '/api/community?sort=popular'));
    expect(community.projects.find((p) => p.id === project.id)?.remixCount).toBe(1);
  });

  it('downloads the project as a zip', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Gulli doʻkon' });
    const res = await call(app, 'GET', `/api/projects/${project.id}/download`, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('filename="gulli-dokon.zip"');
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files)).toContain('package.json');
    expect(JSON.parse(strFromU8(files['package.json'])).name).toBe('yasa-app');
  });
});

describe('files and versions', () => {
  it('saves, renames and deletes files with path validation', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const base = `/api/projects/${project.id}/files`;
    const saved = await call(app, 'PUT', base, { cookie, body: { path: './src/data/items.ts', content: 'export const items = [1];\n' } });
    expect(saved.status).toBe(200);
    expect((await json<{ file: ProjectFile }>(saved)).file.path).toBe('src/data/items.ts');
    for (const path of ['../evil.ts', 'node_modules/x.js', '/abs.ts', 'a\\b.ts', '.git/config', 'src/<x>.ts']) {
      const bad = await call(app, 'PUT', base, { cookie, body: { path, content: '' } });
      expect(bad.status, path).toBe(400);
    }
    const renamed = await call(app, 'POST', `${base}/rename`, { cookie, body: { from: 'src/data/items.ts', to: 'src/data/list.ts' } });
    expect(renamed.status).toBe(200);
    expect((await call(app, 'POST', `${base}/rename`, { cookie, body: { from: 'src/nope.ts', to: 'src/a.ts' } })).status).toBe(404);
    expect((await call(app, 'POST', `${base}/rename`, { cookie, body: { from: 'src/data/list.ts', to: 'src/App.tsx' } })).status).toBe(409);
    expect((await call(app, 'POST', `${base}/delete`, { cookie, body: { path: 'src/data/list.ts' } })).status).toBe(200);
    expect((await call(app, 'POST', `${base}/delete`, { cookie, body: { path: 'src/data/list.ts' } })).status).toBe(404);
  });

  it('creates manual versions, diffs them and restores without losing unsaved edits', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const files = `/api/projects/${project.id}/files`;
    const versions = `/api/projects/${project.id}/versions`;

    expect((await call(app, 'POST', versions, { cookie, body: {} })).status).toBe(409); // nothing to save

    await call(app, 'PUT', files, { cookie, body: { path: 'src/note.ts', content: 'export const a = 1;\n' } });
    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    expect(detail.project.hasUncommittedChanges).toBe(true);

    const v2 = (await json<{ version: VersionSummary }>(await call(app, 'POST', versions, { cookie, body: { summary: 'Add note' } }))).version;
    expect(v2.number).toBe(2);
    expect(v2.source).toBe('manual');
    expect(v2.filesChanged).toBe(1);

    const diff = await json<{ diff: VersionFileDiff[] }>(await call(app, 'GET', `${versions}/${v2.id}/diff`, { cookie }));
    expect(diff.diff).toEqual([{ path: 'src/note.ts', status: 'added', encoding: 'utf8', before: null, after: 'export const a = 1;\n' }]);

    // unsaved edit, then restore v1 → the edit is snapshotted first
    await call(app, 'PUT', files, { cookie, body: { path: 'src/note.ts', content: 'export const a = 2;\n' } });
    const list1 = await json<{ versions: VersionSummary[] }>(await call(app, 'GET', versions, { cookie }));
    const v1 = list1.versions.find((v) => v.number === 1)!;
    const restored = await json<{ version: VersionSummary; files: ProjectFile[] }>(
      await call(app, 'POST', `${versions}/${v1.id}/restore`, { cookie }),
    );
    expect(restored.version.source).toBe('restore');
    expect(restored.version.number).toBe(4);
    expect(restored.files.some((f) => f.path === 'src/note.ts')).toBe(false);
    const list2 = await json<{ versions: VersionSummary[] }>(await call(app, 'GET', versions, { cookie }));
    const v3 = list2.versions.find((v) => v.number === 3)!;
    expect(v3.source).toBe('manual');
    expect(v3.summary).toContain('Unsaved edits');
    const v3detail = await json<{ version: { files: ProjectFile[] } }>(await call(app, 'GET', `${versions}/${v3.id}`, { cookie }));
    expect(v3detail.version.files.find((f) => f.path === 'src/note.ts')?.content).toBe('export const a = 2;\n');
  });

  it('accepts only real images as uploads and serves them to the owner', async () => {
    const { cookie } = await signup(app);
    const other = await signup(app);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const form = new FormData();
    form.set('file', new File([png], 'shot.png', { type: 'image/png' }));
    const res = await call(app, 'POST', '/api/uploads', { cookie, body: form });
    expect(res.status).toBe(201);
    const { attachment } = await json<{ attachment: { id: string; url: string; mime: string } }>(res);
    expect(attachment.mime).toBe('image/png');
    const got = await call(app, 'GET', attachment.url, { cookie });
    expect(got.status).toBe(200);
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await call(app, 'GET', attachment.url, { cookie: other.cookie })).status).toBe(404);

    const fake = new FormData();
    fake.set('file', new File(['<svg onload="alert(1)"></svg>'], 'x.png', { type: 'image/png' }));
    expect((await call(app, 'POST', '/api/uploads', { cookie, body: fake })).status).toBe(400);
  });
});
