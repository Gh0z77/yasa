import { afterEach, describe, expect, it } from 'vitest';
import type { ActionPart, BuildPart, ChatEvent, ChatMessage, ProjectDetailResponse } from '../../shared/types';
import { setProviderForTests } from '../../server/ai/registry';
import type { Provider } from '../../server/ai/providers/types';
import { applyDependency, treeFromFiles } from '../../server/ai/apply';
import { cdnUrlFor, relaxCaret } from '../../server/preview/importmap';
import { declareDependencies, fixMigrationSql, isMigrationPath, unusedFiles } from '../../server/ai/tidy';
import { call, chat, createProject, json, setupTestApp, signup } from './helpers';

const KEYS = { geminiApiKey: 'gemini-test-key', enableMockProvider: false };
const TWO_KEYS = { ...KEYS, nvidiaApiKey: 'nvidia-test-key' };

/** A provider that plays the given replies in order (the last one repeats) and records what it was asked. */
function scripted(replies: string[], id: 'gemini' | 'nvidia' = 'gemini'): Provider & { prompts: string[] } {
  const provider = {
    id,
    prompts: [] as string[],
    async *stream(req: { messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }> }) {
      const last = req.messages[req.messages.length - 1];
      provider.prompts.push(last.content.map((c) => c.text ?? '').join('\n'));
      const text = replies[Math.min(provider.prompts.length, replies.length) - 1]!;
      yield { type: 'text' as const, delta: text };
      yield { type: 'usage' as const, inputTokens: 10, outputTokens: 5 };
      yield { type: 'stop' as const, reason: 'end' as const };
    },
    async test() {},
  };
  return provider as unknown as Provider & { prompts: string[] };
}

function done(events: ChatEvent[]): ChatMessage {
  const event = events.find((e) => e.type === 'done');
  if (!event || event.type !== 'done') throw new Error('no done event');
  return event.message;
}

const write = (path: string, content: string) => `\n<yasa-write path="${path}">\n${content}\n</yasa-write>\n`;

const STATS = `export function Stats() {
  return <section>Revenue this month</section>;
}`;
const APP_EMPTY = `export default function App() {
  return <main />;
}`;
const APP_WIRED = `import { Stats } from "@/components/Stats";

export default function App() {
  return (
    <main>
      <Stats />
    </main>
  );
}`;

afterEach(() => {
  setProviderForTests('gemini', null);
  setProviderForTests('nvidia', null);
});

describe('unused files', () => {
  it('asks the model once to render a component it wrote but never used', async () => {
    const app = setupTestApp(KEYS);
    const provider = scripted([
      `Building it.${write('src/components/Stats.tsx', STATS)}${write('src/App.tsx', APP_EMPTY)}`,
      `Wired up.${write('src/App.tsx', APP_WIRED)}`,
    ]);
    setProviderForTests('gemini', provider);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });

    const message = done(await chat(app, cookie, project.id, { message: 'A sales dashboard', model: 'gemini:gemini-flash-latest' }));

    const builds = message.parts.filter((p): p is BuildPart => p.type === 'build');
    expect(builds).toHaveLength(2);
    expect(builds[0]).toMatchObject({ ok: false, willRetry: true });
    expect(builds[0].errors.map((e) => e.file)).toEqual(['src/components/Stats.tsx']);
    expect(builds[1]).toMatchObject({ ok: true, willRetry: false });
    expect(provider.prompts[1]).toContain('<unused_files>\n- src/components/Stats.tsx\n</unused_files>');
    expect(provider.prompts[1]).toContain('src/App.tsx');
    expect(message.status).toBe('done');
    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    expect(detail.files.find((f) => f.path === 'src/App.tsx')?.content).toContain('<Stats />');
  });

  it('continues an answer that stopped after its first files', async () => {
    const app = setupTestApp(KEYS);
    const provider = scripted([
      `I will build it.${write('src/types/index.ts', 'export interface Product {\n  id: string;\n}\nexport const EMPTY: Product[] = [];')}`,
      `Here is the rest.${write('src/components/Stats.tsx', STATS)}${write('src/App.tsx', APP_WIRED)}`,
    ]);
    setProviderForTests('gemini', provider);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });

    const message = done(await chat(app, cookie, project.id, { message: 'A sales dashboard', model: 'gemini:gemini-flash-latest' }));

    expect(provider.prompts).toHaveLength(2);
    expect(provider.prompts[1]).toContain('- src/types/index.ts');
    expect(provider.prompts[1]).toContain('finish it now');
    expect(message.status).toBe('done');
    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    expect(detail.files.find((f) => f.path === 'src/App.tsx')?.content).toContain('<Stats />');
  });

  it('asks once more when the reply left the starter placeholder in place', async () => {
    const app = setupTestApp(KEYS);
    const provider = scripted([`Colours updated.${write('src/index.css', '@import "tailwindcss";\n:root { --primary: #dc2626; }')}`, `Here is the site.${write('src/App.tsx', APP_EMPTY)}`]);
    setProviderForTests('gemini', provider);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'School' });

    const message = done(await chat(app, cookie, project.id, { message: 'A site for a learning centre', model: 'gemini:gemini-flash-latest' }));

    expect(provider.prompts).toHaveLength(2);
    expect(provider.prompts[1]).toContain('starter placeholder');
    expect(message.status).toBe('done');
    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    expect(detail.files.find((f) => f.path === 'src/App.tsx')?.content.trim()).toBe(APP_EMPTY);
  });

  it('tells the model which App.tsx is only the starter screen', async () => {
    const { renderProjectFiles } = await import('../../server/ai/context');
    const { getTemplateFiles } = await import('../../server/template');
    const starter = getTemplateFiles('uz')['src/App.tsx']!.content;
    const untouched = renderProjectFiles(treeFromFiles([{ path: 'src/App.tsx', content: starter, encoding: 'utf8' }]));
    expect(untouched).toContain('<file path="src/App.tsx" placeholder="true" note="starter screen only');
    // shown in full, so an edit can still anchor on it
    expect(untouched).toContain('animate-bounce');
    // an app appended below the starter screen is shown in full, with the instruction to drop the starter part
    const mixed = renderProjectFiles(treeFromFiles([{ path: 'src/App.tsx', content: `${starter}\nexport function Wedding() { return null; }\n`, encoding: 'utf8' }]));
    expect(mixed).toContain('still contains the starter screen');
    expect(mixed).toContain('export function Wedding()');
    const built = renderProjectFiles(treeFromFiles([{ path: 'src/App.tsx', content: APP_WIRED, encoding: 'utf8' }]));
    expect(built).not.toContain('placeholder="true"');
  });

  it('does not insist: a model that leaves the file unused still finishes the turn', async () => {
    const app = setupTestApp(KEYS);
    const provider = scripted([`Done.${write('src/components/Stats.tsx', STATS)}`, 'It is kept for later on purpose.']);
    setProviderForTests('gemini', provider);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });

    const message = done(await chat(app, cookie, project.id, { message: 'Prepare a stats block', model: 'gemini:gemini-flash-latest' }));

    // one reminder about the unused file, one about the untouched starter screen — then the turn ends
    expect(provider.prompts).toHaveLength(3);
    expect(provider.prompts[2]).toContain('starter placeholder');
    const builds = message.parts.filter((p): p is BuildPart => p.type === 'build');
    expect(builds[builds.length - 1]).toMatchObject({ ok: true, willRetry: false });
    expect(message.status).toBe('done');
  });

  it('ignores the UI kit, tests and files that are part of the bundle', () => {
    const tree = treeFromFiles(
      ['src/App.tsx', 'src/pages/Home.tsx', 'src/pages/Old.tsx', 'src/components/ui/table.tsx', 'src/lib/data.ts', 'src/pages/Home.test.tsx'].map((path) => ({
        path,
        content: '',
        encoding: 'utf8' as const,
      })),
    );
    const written = ['src/App.tsx', 'src/pages/Home.tsx', 'src/pages/Old.tsx', 'src/components/ui/table.tsx', 'src/lib/data.ts', 'src/pages/Home.test.tsx', 'src/pages/Deleted.tsx'];
    expect(unusedFiles(['src/App.tsx', 'src/pages/Home.tsx'], written, tree)).toEqual(['src/pages/Old.tsx']);
  });
});

describe('undeclared packages', () => {
  it('adds a package the code imports to package.json without another model pass', async () => {
    const app = setupTestApp(KEYS);
    const provider = scripted([
      `Chart added.${write(
        'src/App.tsx',
        `import { format } from "date-fns";\nimport confetti from "some-unknown-package";\n\nexport default function App() {\n  return <main onClick={() => confetti()}>{format(new Date(), "PP")}</main>;\n}`,
      )}`,
    ]);
    setProviderForTests('gemini', provider);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });

    const message = done(await chat(app, cookie, project.id, { message: 'Show the date', model: 'gemini:gemini-flash-latest' }));

    expect(provider.prompts).toHaveLength(1);
    expect(message.status).toBe('done');
    expect(message.parts.filter((p): p is ActionPart => p.type === 'action')).toHaveLength(1);
    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    const pkg = JSON.parse(detail.files.find((f) => f.path === 'package.json')!.content) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['date-fns']).toBe('^4');
    expect(pkg.dependencies['some-unknown-package']).toBe('latest');
    expect(pkg.dependencies.react).toBeTruthy();
  });

  it('drops an invented minor version so the package still resolves', () => {
    expect(relaxCaret('^8.22.0')).toBe('^8');
    expect(relaxCaret('^3.1')).toBe('^3');
    // 0.x minors are breaking, and pins or tildes are deliberate: left as written
    expect(relaxCaret('^0.7.1')).toBe('^0.7.1');
    expect(relaxCaret('8.22.0')).toBe('8.22.0');
    expect(relaxCaret('~8.22.0')).toBe('~8.22.0');
    expect(relaxCaret(null)).toBeNull();

    const pkg = { dependencies: { '@tanstack/react-table': '^8.22.0', react: '^19.3.0' } };
    expect(cdnUrlFor('@tanstack/react-table', pkg, 'preview')).toBe('https://esm.sh/@tanstack/react-table@^8?external=react,react-dom');

    const tree = treeFromFiles([{ path: 'package.json', content: '{}', encoding: 'utf8' }]);
    applyDependency(tree, '@tanstack/react-table', '^8.22.0');
    expect(JSON.parse(tree.get('package.json')!.content).dependencies).toEqual({ '@tanstack/react-table': '^8' });
  });

  it('rewrites the policy syntax Postgres does not have', () => {
    const sql = `create table if not exists public.clients (id uuid primary key);
create policy if not exists "Users can view their own clients" on public.clients
  for select using (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS read_all ON notes FOR SELECT USING (true);
create policy "kept as is" on public.clients for delete using (true);`;
    expect(fixMigrationSql(sql)).toBe(`create table if not exists public.clients (id uuid primary key);
drop policy if exists "Users can view their own clients" on public.clients;
create policy "Users can view their own clients" on public.clients
  for select using (auth.uid() = user_id);
drop policy if exists read_all on notes;
create policy read_all on notes FOR SELECT USING (true);
create policy "kept as is" on public.clients for delete using (true);`);
    expect(isMigrationPath('supabase/migrations/20260101000000_init.sql')).toBe(true);
    expect(isMigrationPath('src/data/seed.sql')).toBe(false);
  });

  it('puts back the stylesheet import a rewrite of main.tsx dropped', async () => {
    const { ensureStylesImported } = await import('../../server/ai/tidy');
    const main = [
      'import { StrictMode } from "react";',
      'import { createRoot } from "react-dom/client";',
      'import App from "./App";',
      '',
      'createRoot(document.getElementById("root")!).render(<App />);',
    ].join('\n');
    const tree = treeFromFiles([
      { path: 'src/main.tsx', content: main, encoding: 'utf8' },
      { path: 'src/index.css', content: '@import "tailwindcss";', encoding: 'utf8' },
    ]);
    expect(ensureStylesImported(tree)).toHaveLength(1);
    expect(tree.get('src/main.tsx')!.content).toContain('import App from "./App";\nimport "./index.css";\n');
    // once it is there (or imported anywhere else) nothing changes
    expect(ensureStylesImported(tree)).toEqual([]);
    const elsewhere = treeFromFiles([
      { path: 'src/main.tsx', content: main, encoding: 'utf8' },
      { path: 'src/App.tsx', content: 'import "@/index.css";\nexport default function App() { return null; }', encoding: 'utf8' },
      { path: 'src/index.css', content: '', encoding: 'utf8' },
    ]);
    expect(ensureStylesImported(elsewhere)).toEqual([]);
  });

  it('flags lower-case tags that are no element', async () => {
    const { validateReferences } = await import('../../server/preview/validate-refs');
    const content = [
      'export function Item() {',
      '  return <li><span>x</span><trash2 className="size-4" /><svg><linearGradient id="g" /></svg><my-widget /></li>;',
      '}',
    ].join('\n');
    const errors = await validateReferences([{ path: 'src/Item.tsx', content }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: 'src/Item.tsx', line: 2 });
    expect(errors[0]!.message).toContain('<trash2> is not an HTML element');
    expect(errors[0]!.message).toContain('<Trash2 />');
  });

  it('returns no change when everything is already declared', () => {
    const tree = treeFromFiles([{ path: 'package.json', content: JSON.stringify({ dependencies: { recharts: '^3' } }), encoding: 'utf8' }]);
    expect(declareDependencies(tree, ['recharts'])).toEqual([]);
    expect(declareDependencies(tree, ['zustand'])).toHaveLength(1);
    expect(JSON.parse(tree.get('package.json')!.content).dependencies).toEqual({ recharts: '^3', zustand: '^5' });
  });
});

describe('models that cannot finish the job', () => {
  const BROKEN = `export default function App() {
  return <main>;
}`;

  it('hands a build it could not repair to the next model', async () => {
    const app = setupTestApp(TWO_KEYS);
    const gemini = scripted([`Here.${write('src/App.tsx', BROKEN)}`]);
    const nvidia = scripted([`Fixed.${write('src/App.tsx', APP_EMPTY)}`], 'nvidia');
    setProviderForTests('gemini', gemini);
    setProviderForTests('nvidia', nvidia);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });

    const message = done(await chat(app, cookie, project.id, { message: 'A page', model: 'gemini:gemini-flash-latest' }));

    // the first pass and both repair attempts, then one pass by the other model
    expect(gemini.prompts).toHaveLength(3);
    expect(nvidia.prompts).toHaveLength(1);
    expect(nvidia.prompts[0]).toContain('does not build');
    expect(message.status).toBe('done');
    expect(message.model).toBe('nvidia:nvidia/nemotron-3-super-120b-a12b');
    expect(message.parts.some((p) => p.type === 'notice')).toBe(false);
    const builds = message.parts.filter((p): p is BuildPart => p.type === 'build');
    expect(builds.map((b) => b.ok)).toEqual([false, false, false, true]);
    expect(builds[2]).toMatchObject({ willRetry: true });
  });

  it('reports the failure when there is no other model to try', async () => {
    const app = setupTestApp(KEYS);
    const gemini = scripted([`Here.${write('src/App.tsx', BROKEN)}`]);
    setProviderForTests('gemini', gemini);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });

    const message = done(await chat(app, cookie, project.id, { message: 'A page', model: 'gemini:gemini-flash-latest' }));

    expect(gemini.prompts).toHaveLength(3);
    expect(message.status).toBe('error');
    expect(message.parts.find((p) => p.type === 'error')).toMatchObject({ code: 'build_failed' });
  });

  it('goes back to the last state that built when the repairs break it', async () => {
    const app = setupTestApp(KEYS);
    const badEdit = '\n<yasa-edit path="src/App.tsx">\n<<<<<<< SEARCH\nthis text is not in the file\n=======\nnothing\n>>>>>>> REPLACE\n</yasa-edit>\n';
    const gemini = scripted([`Here.${write('src/App.tsx', APP_EMPTY)}${badEdit}`, `Trying again.${write('src/App.tsx', BROKEN)}`]);
    setProviderForTests('gemini', gemini);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });

    const message = done(await chat(app, cookie, project.id, { message: 'A page', model: 'gemini:gemini-flash-latest' }));

    expect(gemini.prompts).toHaveLength(3);
    expect(message.status).toBe('done');
    expect(message.parts.some((p) => p.type === 'error')).toBe(false);
    const builds = message.parts.filter((p): p is BuildPart => p.type === 'build');
    expect(builds.map((b) => b.ok)).toEqual([true, false, false, true]);
    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    expect(detail.files.find((f) => f.path === 'src/App.tsx')?.content.trim()).toBe(APP_EMPTY);
  });

  it('continues when the model stops in the middle of a file', async () => {
    const app = setupTestApp(KEYS);
    const gemini = scripted([
      `Start.
<yasa-write path="src/App.tsx">
export default function App() {
  return <ma`,
      `Finishing.${write('src/App.tsx', APP_EMPTY)}`,
    ]);
    setProviderForTests('gemini', gemini);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });

    const message = done(await chat(app, cookie, project.id, { message: 'A page', model: 'gemini:gemini-flash-latest' }));

    expect(gemini.prompts).toHaveLength(2);
    expect(gemini.prompts[1]).toContain('cut off');
    expect(message.status).toBe('done');
    const builds = message.parts.filter((p): p is BuildPart => p.type === 'build');
    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({ ok: true });
  });

  it('accepts a file closed with a mangled tag and followed by chatter', async () => {
    const app = setupTestApp(KEYS);
    const gemini = scripted([
      `Here.
<yasa-write path="src/components/Stats.tsx">
${STATS}
</file>

Now the app itself.
</think>

<yasa-write path="src/App.tsx">
${APP_WIRED}
</file>

All done, enjoy.`,
    ]);
    setProviderForTests('gemini', gemini);
    const { cookie } = await signup(app);
    const project = await createProject(app, cookie, { name: 'Shop' });

    const message = done(await chat(app, cookie, project.id, { message: 'A page', model: 'gemini:gemini-flash-latest' }));

    expect(gemini.prompts).toHaveLength(1);
    expect(message.status).toBe('done');
    const actions = message.parts.filter((p): p is ActionPart => p.type === 'action');
    expect(actions.map((a) => `${a.path}:${a.status}`)).toEqual(['src/components/Stats.tsx:done', 'src/App.tsx:done']);
    const detail = await json<ProjectDetailResponse>(await call(app, 'GET', `/api/projects/${project.id}`, { cookie }));
    expect(detail.files.find((f) => f.path === 'src/components/Stats.tsx')?.content.trim()).toBe(STATS);
    expect(detail.files.find((f) => f.path === 'src/App.tsx')?.content.trim()).toBe(APP_WIRED);
  });
});
