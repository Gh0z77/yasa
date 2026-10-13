import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent, ChatMessage, ProjectDetailResponse } from '../../shared/types';
import { buildSystemPrompt } from '../../server/ai/prompt';
import { normalizeAspect, setImageGeneratorForTests, type ImageRequest } from '../../server/services/imagegen';
import { call, chat, createProject, json, setupTestApp, signup } from './helpers';

// The smallest valid JPEG header is enough for the pipeline: it only stores and serves the bytes.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

function done(events: ChatEvent[]): ChatMessage {
  const event = events.find((e) => e.type === 'done');
  if (!event || event.type !== 'done') throw new Error('no done event');
  return event.message;
}

function fakeGenerator(options: { fail?: boolean } = {}) {
  const requests: ImageRequest[] = [];
  setImageGeneratorForTests(async (request) => {
    requests.push(request);
    if (options.fail) throw new Error('no quota');
    return { data: JPEG, mime: 'image/jpeg', provider: 'fake' };
  });
  return requests;
}

async function ready(overrides: Record<string, unknown> = { imageProvider: 'auto' }) {
  const app = setupTestApp(overrides);
  const { cookie } = await signup(app);
  const project = await createProject(app, cookie, { name: 'Cafe' });
  return { app, cookie, project };
}

afterEach(() => setImageGeneratorForTests(null));

describe('generated images', () => {
  it('creates the picture, stores it in the project and serves it in the preview', async () => {
    const requests = fakeGenerator();
    const { app, cookie, project } = await ready();

    const message = done(await chat(app, cookie, project.id, { message: 'Cafe site with a hero picture [[mock:image]]', skipQuestions: true }));
    expect(message.status).toBe('done');
    expect(message.versionId).not.toBeNull();

    const images = message.parts.filter((p) => p.type === 'action' && p.kind === 'image');
    expect(images).toEqual([
      expect.objectContaining({ path: 'public/images/hero.jpg', status: 'done' }),
      expect.objectContaining({ path: 'src/not-allowed.ts', status: 'error' }),
    ]);
    // One request reached the generator, steered away from rendered text.
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ aspect: '16:9' });
    expect(requests[0]?.prompt).toContain('A cozy cafe interior');
    expect(requests[0]?.prompt).toContain('No text');

    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    const file = detail.files.find((f) => f.path === 'public/images/hero.jpg');
    expect(file).toMatchObject({ encoding: 'base64', size: JPEG.length });
    expect(detail.files.some((f) => f.path === 'src/not-allowed.ts')).toBe(false);

    const host = new URL(detail.project.previewUrl).host;
    const served = await app.request(`http://${host}/images/hero.jpg`, { headers: { host } });
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toContain('image/jpeg');
    expect(Buffer.from(await served.arrayBuffer()).equals(JPEG)).toBe(true);
  });

  it('finishes the turn when a picture cannot be generated', async () => {
    fakeGenerator({ fail: true });
    const { app, cookie, project } = await ready();
    const message = done(await chat(app, cookie, project.id, { message: 'Cafe site [[mock:image]]', skipQuestions: true }));
    expect(message.status).toBe('done');
    const hero = message.parts.find((p) => p.type === 'action' && p.kind === 'image' && p.path === 'public/images/hero.jpg');
    expect(hero).toMatchObject({ status: 'error', error: 'The image could not be generated' });
    expect(message.parts.some((p) => p.type === 'action' && p.kind === 'write' && p.status === 'done')).toBe(true);
  });

  it('does nothing when image generation is switched off', async () => {
    const requests = fakeGenerator();
    const { app, cookie, project } = await ready({ imageProvider: 'off' });
    const message = done(await chat(app, cookie, project.id, { message: 'Cafe site [[mock:image]]', skipQuestions: true }));
    expect(requests).toHaveLength(0);
    expect(message.parts.filter((p) => p.type === 'action' && p.kind === 'image').every((p) => p.type === 'action' && p.status === 'error')).toBe(true);
  });

  it('tells the AI about image generation only when it is available', () => {
    expect(buildSystemPrompt({ mode: 'build', images: true })).toContain('<yasa-image path="public/images/NAME.jpg"');
    expect(buildSystemPrompt({ mode: 'build' })).not.toContain('<yasa-image');
    expect(buildSystemPrompt({ mode: 'chat', images: true })).not.toContain('<yasa-image');
  });

  it('normalises aspect ratios', () => {
    expect(normalizeAspect('4:3')).toBe('4:3');
    expect(normalizeAspect('1x1')).toBe('1:1');
    expect(normalizeAspect(' 9 / 16 ')).toBe('9:16');
    expect(normalizeAspect('21:9')).toBe('16:9');
    expect(normalizeAspect(undefined)).toBe('16:9');
  });
});
