import { describe, expect, it } from 'vitest';
import type { ChatEvent, ChatMessage } from '../../shared/types';
import { parseQuestions } from '../../server/ai/parser';
import { buildSystemPrompt } from '../../server/ai/prompt';
import { chat, createProject, setupTestApp, signup } from './helpers';

function done(events: ChatEvent[]): ChatMessage {
  const event = events.find((e) => e.type === 'done');
  if (!event || event.type !== 'done') throw new Error('no done event');
  return event.message;
}

describe('parseQuestions', () => {
  it('reads questions, options, flags and palettes', () => {
    const items = parseQuestions(`
? Sayt qanday uslubda boʻlsin?
- Minimalistik va toza
- Yorqin va quvnoq
? Qaysi ranglar yoqadi? [colors]
- Iliq qum | #F5E9DA #C98A4B #e8b86d #2A2118
- Dengiz | #0B132B, #1C7293, #5BC0BE
? Qaysi boʻlimlar kerak? [multi]
* Narxlar
* Mijozlar fikri
`);
    expect(items).toEqual([
      { text: 'Sayt qanday uslubda boʻlsin?', kind: 'single', options: [{ label: 'Minimalistik va toza' }, { label: 'Yorqin va quvnoq' }] },
      {
        text: 'Qaysi ranglar yoqadi?',
        kind: 'colors',
        options: [
          { label: 'Iliq qum', colors: ['#f5e9da', '#c98a4b', '#e8b86d', '#2a2118'] },
          { label: 'Dengiz', colors: ['#0b132b', '#1c7293', '#5bc0be'] },
        ],
      },
      { text: 'Qaysi boʻlimlar kerak?', kind: 'multi', options: [{ label: 'Narxlar' }, { label: 'Mijozlar fikri' }] },
    ]);
  });

  it('accepts numbered questions and drops unusable ones', () => {
    const items = parseQuestions(`
1. Which style?
- Clean
- Bold
2) A question without enough options
- Only one
? Palette without swatches [colors]
- Warm
- Cool
`);
    expect(items.map((q) => [q.text, q.kind, q.options.length])).toEqual([
      ['Which style?', 'single', 2],
      ['Palette without swatches', 'single', 2],
    ]);
    expect(parseQuestions('just some text\n- stray option')).toEqual([]);
  });
});

describe('asking before building', () => {
  it('invites questions only on the first request of a project', () => {
    expect(buildSystemPrompt({ mode: 'build', askFirst: true })).toContain('<yasa-questions>');
    expect(buildSystemPrompt({ mode: 'build' })).not.toContain('Before you build: ask first');
    expect(buildSystemPrompt({ mode: 'build' })).toContain('Answers to your questions');
    expect(buildSystemPrompt({ mode: 'chat', askFirst: true })).not.toContain('Before you build: ask first');
  });

  it('stores the questions without creating a version, then builds from the answers', async () => {
    const app = setupTestApp();
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Coffee' });

    const asked = done(await chat(app, cookie, project.id, { message: 'Coffee shop site [[mock:questions]]' }));
    expect(asked.status).toBe('done');
    expect(asked.versionId).toBeNull();
    const questions = asked.parts.find((p) => p.type === 'questions');
    expect(questions).toMatchObject({ type: 'questions' });
    if (questions?.type !== 'questions') throw new Error('no questions part');
    expect(questions.items.map((q) => q.kind)).toEqual(['single', 'colors', 'multi']);
    expect(questions.items[1]?.options[0]).toEqual({ label: 'Warm sand', colors: ['#f5e9da', '#c98a4b', '#e8b86d', '#2a2118'] });
    expect(asked.parts.some((p) => p.type === 'action' || p.type === 'build')).toBe(false);

    const built = done(await chat(app, cookie, project.id, { message: 'Style: Minimal and clean. Palette: Warm sand (#F5E9DA #C98A4B). Sections: Pricing.' }));
    expect(built.status).toBe('done');
    expect(built.versionId).not.toBeNull();
    expect(built.parts.some((p) => p.type === 'action')).toBe(true);
  });

  it('never asks a second time, even if the model tries to', async () => {
    const app = setupTestApp();
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Coffee' });
    await chat(app, cookie, project.id, { message: 'Coffee shop site [[mock:questions]]' });
    const again = done(await chat(app, cookie, project.id, { message: 'Just build it [[mock:questions]]' }));
    expect(again.parts.some((p) => p.type === 'questions')).toBe(false);
  });

  it('does not ask when the user turned questions off', async () => {
    const app = setupTestApp();
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Coffee' });
    const message = done(await chat(app, cookie, project.id, { message: 'Coffee shop site [[mock:questions]]', skipQuestions: true }));
    expect(message.parts.some((p) => p.type === 'questions')).toBe(false);
  });
});
