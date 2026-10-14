import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent, ChatMessage } from '../../shared/types';
import { listModelsForUser, planModels, setProviderForTests } from '../../server/ai/registry';
import { ProviderError, type Provider, type ProviderErrorKind } from '../../server/ai/providers/types';
import { call, chat, createProject, setupTestApp, signup } from './helpers';

const KEYS = { geminiApiKey: 'gemini-test-key', nvidiaApiKey: 'nvidia-test-key', enableMockProvider: false };

/** A provider that fails every request the same way. */
function failing(id: 'gemini' | 'nvidia', kind: ProviderErrorKind): Provider & { calls: number } {
  const provider = {
    id,
    calls: 0,
    // eslint-disable-next-line require-yield
    async *stream() {
      provider.calls += 1;
      throw new ProviderError(kind, `${id} failed (${kind})`);
    },
    async test() {},
  };
  return provider as Provider & { calls: number };
}

/** A provider that answers with plain text. */
function answering(id: 'gemini' | 'nvidia', text: string): Provider & { calls: number; models: string[] } {
  const provider = {
    id,
    calls: 0,
    models: [] as string[],
    async *stream(req: { model: string }) {
      provider.calls += 1;
      provider.models.push(req.model);
      yield { type: 'text' as const, delta: text };
      yield { type: 'usage' as const, inputTokens: 10, outputTokens: 5 };
      yield { type: 'stop' as const, reason: 'end' as const };
    },
    async test() {},
  };
  return provider as unknown as Provider & { calls: number; models: string[] };
}

function done(events: ChatEvent[]): ChatMessage {
  const event = events.find((e) => e.type === 'done');
  if (!event || event.type !== 'done') throw new Error('no done event');
  return event.message;
}

afterEach(() => {
  setProviderForTests('gemini', null);
  setProviderForTests('nvidia', null);
});

describe('model fallback', () => {
  it('continues on NVIDIA NIM when Gemini has run out of quota', async () => {
    const app = setupTestApp(KEYS);
    const gemini = failing('gemini', 'rate_limit');
    const nvidia = answering('nvidia', 'Hello from the fallback model.');
    setProviderForTests('gemini', gemini);
    setProviderForTests('nvidia', nvidia);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });

    const message = done(await chat(app, cookie, project.id, { message: 'What can you do?', mode: 'chat', model: 'gemini:gemini-flash-latest' }));

    expect(message.status).toBe('done');
    expect(message.content).toContain('Hello from the fallback model.');
    expect(message.model).toBe('nvidia:nvidia/nemotron-3-super-120b-a12b');
    // The switch is invisible in the chat: no notice, no error — just the answer.
    expect(message.parts.map((p) => p.type)).toEqual(['text']);
    // No waiting on a provider that is out of quota: one attempt, then the switch.
    expect(gemini.calls).toBe(1);
    expect(nvidia.models).toEqual(['nvidia/nemotron-3-super-120b-a12b']);
  });

  it.each(['overloaded', 'network', 'auth'] as const)('also switches when the provider is %s', async (kind) => {
    const app = setupTestApp(KEYS);
    setProviderForTests('gemini', failing('gemini', kind));
    setProviderForTests('nvidia', answering('nvidia', 'Recovered.'));
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });
    const message = done(await chat(app, cookie, project.id, { message: 'Hi', mode: 'chat', model: 'gemini:gemini-flash-latest' }));
    expect(message.status).toBe('done');
    expect(message.content).toContain('Recovered.');
  });

  it('works the other way round: Gemini takes over from NVIDIA', async () => {
    const app = setupTestApp(KEYS);
    setProviderForTests('nvidia', failing('nvidia', 'overloaded'));
    const gemini = answering('gemini', 'Gemini here.');
    setProviderForTests('gemini', gemini);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });
    const message = done(await chat(app, cookie, project.id, { message: 'Hi', mode: 'chat', model: 'nvidia:nvidia/nemotron-3-super-120b-a12b' }));
    expect(message.content).toContain('Gemini here.');
    expect(gemini.models).toEqual(['gemini-flash-latest']);
  });

  it('reports the last error when every provider fails', async () => {
    const app = setupTestApp(KEYS);
    setProviderForTests('gemini', failing('gemini', 'rate_limit'));
    setProviderForTests('nvidia', failing('nvidia', 'overloaded'));
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });
    const message = done(await chat(app, cookie, project.id, { message: 'Hi', mode: 'chat', model: 'gemini:gemini-flash-latest' }));
    expect(message.status).toBe('error');
    expect(message.parts.find((p) => p.type === 'error')).toMatchObject({ code: 'provider_overloaded' });
  });

  it('also moves on when the provider rejects the request (a retired model, a context it cannot take)', async () => {
    const app = setupTestApp(KEYS);
    setProviderForTests('gemini', failing('gemini', 'bad_request'));
    const nvidia = answering('nvidia', 'Answered elsewhere.');
    setProviderForTests('nvidia', nvidia);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });
    const message = done(await chat(app, cookie, project.id, { message: 'Hi', mode: 'chat', model: 'gemini:gemini-flash-latest' }));
    expect(message.status).toBe('done');
    expect(message.content).toContain('Answered elsewhere.');
    expect(nvidia.calls).toBe(1);
  });
});

describe('model health memory', () => {
  it('starts the next turn on the working model instead of failing over again', async () => {
    const app = setupTestApp(KEYS);
    const gemini = failing('gemini', 'rate_limit');
    const nvidia = answering('nvidia', 'Still here.');
    setProviderForTests('gemini', gemini);
    setProviderForTests('nvidia', nvidia);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });

    await chat(app, cookie, project.id, { message: 'First', mode: 'chat', model: 'gemini:gemini-flash-latest' });
    expect(gemini.calls).toBe(1);

    const second = done(await chat(app, cookie, project.id, { message: 'Second', mode: 'chat', model: 'gemini:gemini-flash-latest' }));
    // Gemini is resting: it was not asked again, and nothing in the chat says so.
    expect(gemini.calls).toBe(1);
    expect(nvidia.calls).toBe(2);
    expect(second.status).toBe('done');
    expect(second.model).toBe('nvidia:nvidia/nemotron-3-super-120b-a12b');
    expect(second.parts.some((p) => p.type === 'notice')).toBe(false);

    // …and the model list leaves it out while it rests.
    const models = (await (await call(app, 'GET', '/api/models', { cookie })).json()) as { models: Array<{ id: string }>; defaultModel: string };
    expect(models.models.some((m) => m.id === 'gemini:gemini-flash-latest')).toBe(false);
    expect(models.defaultModel).not.toBe('gemini:gemini-flash-latest');
  });

  it('treats an out-of-credit answer (402) like used-up quota', async () => {
    const { kindFromStatus } = await import('../../server/ai/providers/types');
    expect(kindFromStatus(402)).toBe('rate_limit');
    expect(kindFromStatus(429)).toBe('rate_limit');
  });
});

describe('cut-off streams', () => {
  it('keeps what was applied and resumes on the next model when the connection dies mid-answer', async () => {
    const app = setupTestApp(KEYS);
    const gemini = {
      id: 'gemini' as const,
      async *stream() {
        yield { type: 'text' as const, delta: '<yasa-write path="src/data/a.ts">\nexport const a = 1;\n</yasa-write>\n' };
        yield { type: 'text' as const, delta: '<yasa-write path="src/data/b.ts">\nexport const b = ' };
        throw new ProviderError('network', 'The connection to the AI provider was lost.');
      },
      async test() {},
    };
    const prompts: string[] = [];
    const nvidia = {
      id: 'nvidia' as const,
      async *stream(req: { messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }> }) {
        prompts.push(req.messages.at(-1)?.content.map((part) => part.text ?? '').join('') ?? '');
        yield { type: 'text' as const, delta: '<yasa-write path="src/data/b.ts">\nexport const b = 2;\n</yasa-write>\nBoth files are in place.' };
        yield { type: 'usage' as const, inputTokens: 10, outputTokens: 5 };
        yield { type: 'stop' as const, reason: 'end' as const };
      },
      async test() {},
    };
    setProviderForTests('gemini', gemini as unknown as Provider);
    setProviderForTests('nvidia', nvidia as unknown as Provider);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });

    const message = done(await chat(app, cookie, project.id, { message: 'Add two data files', model: 'gemini:gemini-flash-latest' }));

    expect(message.status).toBe('done');
    expect(message.parts.some((p) => p.type === 'notice')).toBe(false);
    expect(message.parts.some((p) => p.type === 'error')).toBe(false);
    expect(prompts[0]).toContain('cut off');
    expect(prompts[0]).toContain('src/data/b.ts');

    const detail = (await (await call(app, 'GET', `/api/projects/${project.id}`, { cookie })).json()) as { files: Array<{ path: string; content: string }> };
    const file = (path: string) => detail.files.find((f) => f.path === path)?.content ?? '';
    expect(file('src/data/a.ts')).toContain('export const a = 1;');
    expect(file('src/data/b.ts')).toContain('export const b = 2;');
  });
});

describe('free OpenRouter models', () => {
  const FREE_KEYS = { geminiApiKey: 'gemini-test-key', nvidiaApiKey: 'nvidia-test-key', openrouterApiKey: 'openrouter-test-key', enableMockProvider: false };

  it('are the default without a paid key, with the other free models next in line', async () => {
    const app = setupTestApp(FREE_KEYS);
    const me = await signup(app);

    expect(listModelsForUser(me.user.id).defaultModel).toBe('openrouter:apodex/apodex-1.1-mini:free');
    const plan = planModels(me.user.id, null);
    expect(plan.model.modelId).toBe('openrouter:apodex/apodex-1.1-mini:free');
    expect(plan.fallbacks.map((m) => m.modelId)).toEqual([
      'openrouter:nvidia/nemotron-3-super-120b-a12b:free',
      'openrouter:cohere/north-mini-code:free',
      'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free',
      'nvidia:nvidia/nemotron-3-super-120b-a12b',
      'nvidia:nvidia/nemotron-3-ultra-550b-a55b',
      'gemini:gemini-flash-latest',
    ]);
    // nothing that costs money is ever chosen silently
    expect(plan.fallbacks.some((m) => m.provider.id === 'openrouter' && !m.model.endsWith(':free'))).toBe(false);
  });

  it('a paid Anthropic key still comes first', async () => {
    const app = setupTestApp({ ...FREE_KEYS, anthropicApiKey: 'anthropic-test-key' });
    const me = await signup(app);
    expect(listModelsForUser(me.user.id).defaultModel).toBe('anthropic:claude-opus-5');
  });
});
