import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type {
  ActionPart,
  ApiErrorBody,
  BuildPart,
  ChatEvent,
  ChatMessage,
  CreateProjectResponse,
  MessagePart,
  ProjectDetailResponse,
  UsageSummary,
  VersionSummary,
} from '../../shared/types';
import { isGenerating } from '../../server/ai/jobs';
import type { AppEnv } from '../../server/types';
import { call, chat, createProject, json, readEvents, setupTestApp, signup, sleep } from './helpers';

let app: Hono<AppEnv>;

beforeEach(() => {
  app = setupTestApp();
});

/** Replays part events the way the web client does. */
function replay(events: ChatEvent[]): MessagePart[] {
  const parts: MessagePart[] = [];
  for (const e of events) {
    if (e.type === 'part_start') parts[e.index] = structuredClone(e.part);
    else if (e.type === 'part_update') parts[e.index] = structuredClone(e.part);
    else if (e.type === 'part_delta') {
      const part = parts[e.index];
      if (part.type === 'text' || part.type === 'thinking') part.text += e.delta;
    }
  }
  return parts;
}

function done(events: ChatEvent[]): ChatMessage {
  const last = events[events.length - 1];
  if (last.type !== 'done') throw new Error(`stream did not end with done: ${last.type}`);
  return last.message;
}

async function waitForIdle(projectId: string): Promise<void> {
  for (let i = 0; i < 400 && isGenerating(projectId); i++) await sleep(25);
  if (isGenerating(projectId)) throw new Error('job did not finish');
}

describe('chat with the demo provider', () => {
  it('streams a full build turn: text, actions, build, version, done', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const events = await chat(app, cookie, project.id, { message: 'Coffee shop landing page' });

    expect(events[0].type).toBe('start');
    const types = new Set(events.map((e) => e.type));
    for (const t of ['part_start', 'part_delta', 'files_changed', 'project_updated', 'build', 'version', 'usage', 'done']) {
      expect(types.has(t as ChatEvent['type']), t).toBe(true);
    }
    const message = done(events);
    expect(message.status).toBe('done');
    expect(message.versionNumber).toBe(2);
    expect(message.durationMs).toBeGreaterThanOrEqual(0);

    // what a client reconstructs from deltas equals what the server persisted
    expect(replay(events)).toEqual(message.parts);

    const action = message.parts.find((p): p is ActionPart => p.type === 'action')!;
    expect(action).toMatchObject({ kind: 'write', path: 'src/App.tsx', status: 'done' });
    expect(action.linesAdded).toBeGreaterThan(10);
    const build = message.parts.find((p): p is BuildPart => p.type === 'build')!;
    expect(build).toMatchObject({ ok: true, attempt: 0, failedActions: 0, willRetry: false });
    expect(message.parts.some((p) => p.type === 'suggestions')).toBe(true);
    expect(message.parts.some((p) => p.type === 'thinking')).toBe(true);
    // protocol tags never leak into the visible text
    expect(message.content).not.toMatch(/yasa-/);

    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    expect(detail.project.name).toBe('Coffee shop landing page');
    expect(detail.project.emoji).toBe('🚀');
    expect(detail.project.hasUncommittedChanges).toBe(false);
    expect(detail.files.find((f) => f.path === 'src/App.tsx')?.content).toContain('Coffee shop landing page');

    const versions = await json<{ versions: VersionSummary[] }>(await call(app, 'GET', `/api/projects/${project.id}/versions`, { cookie }));
    expect(versions.versions[0]).toMatchObject({ number: 2, source: 'ai', buildOk: true });
    expect(versions.versions[0].summary).toContain('Build');

    const messages = await json<{ messages: ChatMessage[] }>(await call(app, 'GET', `/api/projects/${project.id}/messages`, { cookie }));
    expect(messages.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('applies follow-up edits and keeps a user rename', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    await chat(app, cookie, project.id, { message: 'Portfolio site' });
    await call(app, 'PATCH', `/api/projects/${project.id}`, { cookie, body: { name: 'My name' } });
    const events = await chat(app, cookie, project.id, { message: 'Add a section about me' });
    const message = done(events);
    const actions = message.parts.filter((p): p is ActionPart => p.type === 'action');
    expect(actions.map((a) => `${a.kind}:${a.path}:${a.status}`)).toEqual(['write:src/components/Section1.tsx:done', 'edit:src/App.tsx:done']);
    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    expect(detail.project.name).toBe('My name');
    expect(detail.files.find((f) => f.path === 'src/App.tsx')?.content).toContain('<Section1 />');
    expect(message.versionNumber).toBe(3);
  });

  it('repairs a broken build automatically', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const message = done(await chat(app, cookie, project.id, { message: 'Break it [[mock:build-error]]' }));
    const builds = message.parts.filter((p): p is BuildPart => p.type === 'build');
    expect(builds).toHaveLength(2);
    expect(builds[0]).toMatchObject({ ok: false, attempt: 0, willRetry: true });
    expect(builds[0].errors[0].file).toBe('src/App.tsx');
    expect(builds[1]).toMatchObject({ ok: true, attempt: 1, willRetry: false });
    expect(message.status).toBe('done');
    const versions = await json<{ versions: VersionSummary[] }>(await call(app, 'GET', `/api/projects/${project.id}/versions`, { cookie }));
    expect(versions.versions[0].buildOk).toBe(true);
  });

  it('re-applies a failed edit through the repair loop', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const message = done(await chat(app, cookie, project.id, { message: 'Tweak [[mock:bad-edit]]' }));
    const actions = message.parts.filter((p): p is ActionPart => p.type === 'action');
    expect(actions[0]).toMatchObject({ kind: 'edit', status: 'error' });
    expect(actions[0].error).toContain('not found');
    expect(actions[1]).toMatchObject({ kind: 'write', status: 'done' });
    const builds = message.parts.filter((p): p is BuildPart => p.type === 'build');
    expect(builds[0]).toMatchObject({ failedActions: 1, willRetry: true });
    expect(builds[builds.length - 1]).toMatchObject({ ok: true, failedActions: 0 });
    expect(message.status).toBe('done');
  });

  it('never changes files in chat mode', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const message = done(await chat(app, cookie, project.id, { message: 'How should I structure this?', mode: 'chat' }));
    expect(message.mode).toBe('chat');
    expect(message.parts.some((p) => p.type === 'action')).toBe(false);
    expect(message.versionId).toBeNull();
    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    expect(detail.project.currentVersionNumber).toBe(1);
  });

  it('reports refusals as an error part with a code', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const events = await chat(app, cookie, project.id, { message: 'x [[mock:refusal]]' });
    const message = done(events);
    expect(message.status).toBe('error');
    expect(message.parts.find((p) => p.type === 'error')).toMatchObject({ code: 'refusal' });
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('snapshots manual edits before an AI turn so the AI version diff is clean', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    await call(app, 'PUT', `/api/projects/${project.id}/files`, { cookie, body: { path: 'src/mine.ts', content: 'export const mine = true;\n' } });
    await chat(app, cookie, project.id, { message: 'Landing page' });
    const versions = await json<{ versions: VersionSummary[] }>(await call(app, 'GET', `/api/projects/${project.id}/versions`, { cookie }));
    expect(versions.versions.map((v) => v.source)).toEqual(['ai', 'manual', 'initial']);
    expect(versions.versions[0].filesChanged).toBe(1);
  });

  it('stops a running generation and keeps the project usable', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const pending = call(app, 'POST', `/api/projects/${project.id}/chat`, { cookie, body: { message: 'Slow one [[mock:slow]]', model: 'mock:demo' } });
    await sleep(120);
    expect(isGenerating(project.id)).toBe(true);
    // a second request while one is running is rejected
    const second = await call(app, 'POST', `/api/projects/${project.id}/chat`, { cookie, body: { message: 'again', model: 'mock:demo' } });
    expect(second.status).toBe(409);
    // manual edits are blocked meanwhile
    const edit = await call(app, 'PUT', `/api/projects/${project.id}/files`, { cookie, body: { path: 'src/x.ts', content: '' } });
    expect(edit.status).toBe(409);

    const stop = await json<{ stopped: boolean }>(await call(app, 'POST', `/api/projects/${project.id}/chat/stop`, { cookie }));
    expect(stop.stopped).toBe(true);
    const message = done(await readEvents(await pending));
    expect(message.status).toBe('stopped');
    expect(isGenerating(project.id)).toBe(false);
    expect(message.parts.every((p) => p.type !== 'action' || p.status !== 'pending')).toBe(true);
    expect((await call(app, 'GET', `/api/projects/${project.id}/chat/active`, { cookie })).status).toBe(204);
  });

  it('lets a late client attach to a running job with a snapshot', async () => {
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const first = call(app, 'POST', `/api/projects/${project.id}/chat`, { cookie, body: { message: 'Attach test [[mock:slow]]', model: 'mock:demo' } });
    await sleep(150);
    const attached = await call(app, 'GET', `/api/projects/${project.id}/chat/active`, { cookie });
    expect(attached.status).toBe(200);
    const [a, b] = await Promise.all([readEvents(await first), readEvents(attached)]);
    expect(b[0].type).toBe('snapshot');
    const finalA = done(a);
    const finalB = done(b);
    expect(finalB.id).toBe(finalA.id);
    // snapshot + later events reconstruct the same parts
    const snap = b[0].type === 'snapshot' ? structuredClone(b[0].assistantMessage.parts) : [];
    for (const e of b.slice(1)) {
      if (e.type === 'part_start' || e.type === 'part_update') snap[e.index] = structuredClone(e.part);
      else if (e.type === 'part_delta') {
        const part = snap[e.index];
        if (part.type === 'text' || part.type === 'thinking') part.text += e.delta;
      }
    }
    expect(snap).toEqual(finalB.parts);
  });

  it('starts the first generation on the server when a project is created with a prompt', async () => {
    const { cookie } = await signup(app);
    const res = await call(app, 'POST', '/api/projects', { cookie, body: { prompt: 'Build me a todo app for my team', model: 'mock:demo', locale: 'uz' } });
    const body = await json<CreateProjectResponse>(res);
    expect(body.generating).toBe(true);
    expect(body.project.name).toBe('Todo App For My Team');
    await waitForIdle(body.project.id);
    const messages = await json<{ messages: ChatMessage[] }>(await call(app, 'GET', `/api/projects/${body.project.id}/messages`, { cookie }));
    expect(messages.messages).toHaveLength(2);
    expect(messages.messages[1].status).toBe('done');
  });

  it('enforces the daily limit for server keys but not for the demo provider', async () => {
    app = setupTestApp({ dailyMessageLimit: 1 });
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    // demo provider is unlimited
    done(await chat(app, cookie, project.id, { message: 'one' }));
    done(await chat(app, cookie, project.id, { message: 'two' }));
    const usage = await json<UsageSummary>(await call(app, 'GET', '/api/me/usage', { cookie }));
    expect(usage.today.messages).toBe(2);
    expect(usage.remainingToday).toBe(1);
  });

  it('answers 503 no_provider when nothing is configured', async () => {
    app = setupTestApp({ enableMockProvider: false });
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie);
    const res = await call(app, 'POST', `/api/projects/${project.id}/chat`, { cookie, body: { message: 'hi' } });
    expect(res.status).toBe(503);
    expect((await json<ApiErrorBody>(res)).error.code).toBe('no_provider');
  });

  it('rejects chat from non-owners', async () => {
    const owner = await signup(app);
    const other = await signup(app);
    const project = await createProject(app, owner.cookie);
    await call(app, 'PATCH', `/api/projects/${project.id}`, { cookie: owner.cookie, body: { visibility: 'public' } });
    const res = await call(app, 'POST', `/api/projects/${project.id}/chat`, { cookie: other.cookie, body: { message: 'hi', model: 'mock:demo' } });
    expect(res.status).toBe(404);
  });
});
