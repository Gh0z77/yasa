import { describe, expect, it } from 'vitest';
import { applyAction, locateBlock, treeFromFiles } from '../../server/ai/apply';
import { cleanBlockContent, parseEditBlocks, ProtocolParser, type ParsedAction } from '../../server/ai/parser';

interface Collected {
  text: string;
  starts: string[];
  deltas: Record<string, string>;
  actions: ParsedAction[];
  project: unknown[];
  titles: string[];
  suggestions: string[][];
}

function run(input: string, chunk: (s: string) => string[]): Collected {
  const out: Collected = { text: '', starts: [], deltas: {}, actions: [], project: [], titles: [], suggestions: [] };
  const parser = new ProtocolParser({
    onText: (d) => (out.text += d),
    onActionStart: (a) => out.starts.push(`${a.kind}:${a.path ?? ''}`),
    onActionDelta: (id, d) => (out.deltas[id] = (out.deltas[id] ?? '') + d),
    onActionEnd: (a) => out.actions.push(a),
    onProject: (m) => out.project.push(m),
    onTitle: (t) => out.titles.push(t),
    onSuggestions: (s) => out.suggestions.push(s),
    onQuestions: () => undefined,
  });
  for (const piece of chunk(input)) parser.push(piece);
  parser.finish();
  return out;
}

const whole = (s: string) => [s];
const byChar = (s: string) => [...s];
const bySize = (n: number) => (s: string) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) ?? [];

const SAMPLE = `Here is the plan:

- a header
- a <div> in prose and 1 < 2

<yasa-project name="Pomodoro Timer" emoji="🍅" description="Focus timer" />
<yasa-title>Build the timer</yasa-title>
<yasa-write path="src/components/Timer.tsx">
export function Timer() {
  return <div className="p-4">{1 < 2 ? 'a' : 'b'}</div>;
}
</yasa-write>
<yasa-edit path="src/App.tsx">
<<<<<<< SEARCH
  return <main />;
=======
  return <main><Timer /></main>;
>>>>>>> REPLACE
</yasa-edit>
<yasa-delete path="src/old.tsx" />
<yasa-rename from="src/a.tsx" to="src/b.tsx" />
<yasa-dependency name="framer-motion" version="^12.0.0" />

Done — try it.

<yasa-suggestions>
- Add sounds
2. Add dark mode
</yasa-suggestions>`;

describe('ProtocolParser', () => {
  for (const [name, chunker] of [['whole', whole], ['char by char', byChar], ['7 chars', bySize(7)], ['64 chars', bySize(64)]] as const) {
    it(`parses the full protocol (${name})`, () => {
      const out = run(SAMPLE, chunker);
      expect(out.text).toContain('a <div> in prose and 1 < 2');
      expect(out.text).toContain('Done — try it.');
      expect(out.text).not.toContain('yasa-');
      expect(out.project).toEqual([{ name: 'Pomodoro Timer', emoji: '🍅', description: 'Focus timer' }]);
      expect(out.titles).toEqual(['Build the timer']);
      expect(out.suggestions).toEqual([['Add sounds', 'Add dark mode']]);
      expect(out.starts).toEqual(['write:src/components/Timer.tsx', 'edit:src/App.tsx', 'delete:src/old.tsx', 'rename:src/b.tsx', 'dependency:']);
      const [write, edit, del, rename, dep] = out.actions;
      expect(write).toMatchObject({ kind: 'write', path: 'src/components/Timer.tsx' });
      if (write.kind === 'write') {
        expect(write.content).toBe(`export function Timer() {\n  return <div className="p-4">{1 < 2 ? 'a' : 'b'}</div>;\n}\n`);
        expect(out.deltas[write.id]).toContain('export function Timer()');
      }
      expect(edit).toMatchObject({ kind: 'edit', path: 'src/App.tsx', blocks: [{ search: '  return <main />;', replace: '  return <main><Timer /></main>;' }] });
      expect(del).toMatchObject({ kind: 'delete', path: 'src/old.tsx' });
      expect(rename).toMatchObject({ kind: 'rename', from: 'src/a.tsx', to: 'src/b.tsx' });
      expect(dep).toMatchObject({ kind: 'dependency', name: 'framer-motion', version: '^12.0.0' });
    });
  }

  it('marks an unterminated block as incomplete', () => {
    const out = run('Start\n<yasa-write path="src/A.tsx">\nexport const a = 1;\n', bySize(5));
    expect(out.actions).toHaveLength(1);
    expect(out.actions[0].incomplete).toBe(true);
  });

  it('treats unknown yasa tags and a dangling "<" as text', () => {
    const out = run('a <yasa-unknown x="1"> b <', byChar);
    expect(out.text).toBe('a <yasa-unknown x="1"> b <');
    expect(out.actions).toHaveLength(0);
  });

  for (const [name, chunker] of [['whole', whole], ['char by char', byChar], ['7 chars', bySize(7)]] as const) {
    it(`drops wrapper tags models invent around their answer (${name})`, () => {
      const out = run('<yasa-assistant>\nHello </yasa-project> there, 1 </ 2 and </div> stay.\n</yasa-assistant>', chunker);
      expect(out.text).toBe('\nHello  there, 1 </ 2 and </div> stay.\n');
      expect(out.actions).toHaveLength(0);
    });

    it(`ends a file at a mangled closing tag (${name})`, () => {
      const out = run(
        'Go.\n<yasa-write path="src/a.ts">\nexport const a = 1;\n</file>\n\nNow the second one.\n</think>\n\n<yasa-write path="src/b.tsx">\nexport const B = () => <b />;\n</file>\n\nAll done.',
        chunker,
      );
      expect(out.actions.map((a) => (a.kind === 'write' ? [a.path, a.content, a.incomplete ?? false] : []))).toEqual([
        ['src/a.ts', 'export const a = 1;\n', false],
        ['src/b.tsx', 'export const B = () => <b />;\n', false],
      ]);
    });
  }

  it('accepts single-quoted attributes and strips a wrapping code fence', () => {
    const out = run("<yasa-write path='src/x.ts'>\n```ts\nexport const x = 1;\n```\n</yasa-write>", bySize(9));
    expect(out.actions[0]).toMatchObject({ kind: 'write', path: 'src/x.ts', content: 'export const x = 1;\n' });
  });

  for (const [name, chunker] of [['whole', whole], ['char by char', byChar], ['11 chars', bySize(11)]] as const) {
    it(`recovers when the model mangles a closing tag and starts the next action (${name})`, () => {
      const input = [
        'Plan.',
        '<yasa-write path="src/data/items.ts">',
        'export const items = [1, 2];',
        '</write>',
        '</file>',
        '',
        '<yasa-write path="src/data/items.ts">',
        'export const items = [1, 2, 3];',
        '</yasa-write>',
        '<yasa-edit path="src/App.tsx">',
        '<<<<<<< SEARCH',
        'a',
        '=======',
        'b',
        '>>>>>>> REPLACE',
        '<yasa-delete path="src/old.ts" />',
        'Done.',
      ].join('\n');
      const out = run(input, chunker);
      expect(out.actions.map((a) => a.kind)).toEqual(['write', 'write', 'edit', 'delete']);
      expect(out.actions[0]).toMatchObject({ path: 'src/data/items.ts', content: 'export const items = [1, 2];\n' });
      expect(out.actions[0].incomplete).toBeUndefined();
      expect(out.actions[1]).toMatchObject({ content: 'export const items = [1, 2, 3];\n' });
      expect(out.actions[2]).toMatchObject({ kind: 'edit', blocks: [{ search: 'a', replace: 'b' }] });
      expect(out.text).toContain('Done.');
      expect(out.text).not.toContain('yasa-');
    });
  }

  it('drops stray wrapper tags at the end of code files but keeps real markup', () => {
    const ts = run('<yasa-write path="src/a.ts">\nexport const a = 1;\n</data>\n</yasa-write>', whole);
    expect(ts.actions[0]).toMatchObject({ content: 'export const a = 1;\n' });
    const tsx = run('<yasa-write path="src/A.tsx">\nexport const A = () => (\n  <div>\n    hi\n  </div>\n);\n</file>\n</yasa-write>', whole);
    expect(tsx.actions[0]).toMatchObject({ content: 'export const A = () => (\n  <div>\n    hi\n  </div>\n);\n' });
    const html = run('<yasa-write path="index.html">\n<html>\n<body></body>\n</html>\n</yasa-write>', whole);
    expect(html.actions[0]).toMatchObject({ content: '<html>\n<body></body>\n</html>\n' });
  });

  it('does not end a write block on a look-alike closing tag', () => {
    const out = run('<yasa-write path="a.md">\n</yasa-writ and </yasa-edit> stay\n</yasa-write>after', byChar);
    expect(out.actions[0]).toMatchObject({ content: '</yasa-writ and </yasa-edit> stay\n' });
    expect(out.text).toBe('after');
  });
});

describe('edit blocks', () => {
  it('reports malformed blocks', () => {
    expect(parseEditBlocks('nothing here').error).toMatch(/No SEARCH/);
    expect(parseEditBlocks('<<<<<<< SEARCH\na\n=======\nb\n').error).toMatch(/terminator/);
    expect(parseEditBlocks('<<<<<<< SEARCH\n=======\nb\n>>>>>>> REPLACE').error).toMatch(/empty/);
  });

  it('allows an empty replacement (deletion) and multiple blocks', () => {
    const { blocks, error } = parseEditBlocks('<<<<<<< SEARCH\na\n=======\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nb\n=======\nc\n>>>>>>> REPLACE');
    expect(error).toBeUndefined();
    expect(blocks).toEqual([{ search: 'a', replace: '' }, { search: 'b', replace: 'c' }]);
  });

  it('cleanBlockContent keeps inner blank lines and ends with one newline', () => {
    expect(cleanBlockContent('\na\n\nb\n\n\n')).toBe('a\n\nb\n');
    expect(cleanBlockContent('\n')).toBe('');
  });
});

describe('applyAction', () => {
  const base = () =>
    treeFromFiles([
      { path: 'package.json', content: '{\n  "name": "x",\n  "dependencies": {\n    "react": "^19.0.0"\n  }\n}\n', encoding: 'utf8' },
      { path: 'index.html', content: '<html></html>', encoding: 'utf8' },
      { path: 'src/App.tsx', content: 'export default function App() {\n    return <main />;\n}\n', encoding: 'utf8' },
      { path: 'public/logo.png', content: 'iVBORw0KGgo=', encoding: 'base64' },
    ]);

  it('writes files and counts lines', () => {
    const tree = base();
    const res = applyAction(tree, { id: '1', kind: 'write', path: './src/New.tsx', content: 'a\nb\n' });
    expect(res).toMatchObject({ ok: true, path: 'src/New.tsx', linesAdded: 2, linesRemoved: 0 });
    expect(tree.get('src/New.tsx')?.content).toBe('a\nb\n');
  });

  it('rejects unsafe paths', () => {
    const tree = base();
    for (const path of ['../x.ts', 'node_modules/a/index.js', '.git/hooks/x', 'dist/a.js', 'C:/x.ts', '']) {
      expect(applyAction(tree, { id: '1', kind: 'write', path, content: 'x' }).ok, path).toBe(false);
    }
    expect(tree.size).toBe(4);
  });

  it('edits with exact, whitespace-tolerant and indentation-tolerant matching', () => {
    const tree = base();
    // the file is indented with 4 spaces, the model wrote 2
    const res = applyAction(tree, {
      id: '1',
      kind: 'edit',
      path: 'src/App.tsx',
      blocks: [{ search: '  return <main />;', replace: '  return (\n    <main>hi</main>\n  );' }],
    });
    expect(res.ok).toBe(true);
    expect(tree.get('src/App.tsx')?.content).toBe('export default function App() {\n    return (\n      <main>hi</main>\n    );\n}\n');
  });

  it('fails atomically when a block is missing or ambiguous', () => {
    const tree = base();
    const before = tree.get('src/App.tsx')!.content;
    const missing = applyAction(tree, {
      id: '1',
      kind: 'edit',
      path: 'src/App.tsx',
      blocks: [{ search: 'export default function App() {', replace: 'export default function Root() {' }, { search: 'not there', replace: 'x' }],
    });
    expect(missing.ok).toBe(false);
    expect(missing.failedSearch).toBe('not there');
    expect(tree.get('src/App.tsx')!.content).toBe(before);

    expect('error' in locateBlock('a\nx\na\n', { search: 'a', replace: 'b' })).toBe(true);
    expect(applyAction(tree, { id: '2', kind: 'edit', path: 'src/Nope.tsx', blocks: [{ search: 'a', replace: 'b' }] }).ok).toBe(false);
    expect(applyAction(tree, { id: '3', kind: 'edit', path: 'public/logo.png', blocks: [{ search: 'a', replace: 'b' }] }).ok).toBe(false);
  });

  it('handles delete, rename and dependency', () => {
    const tree = base();
    expect(applyAction(tree, { id: '1', kind: 'delete', path: 'package.json' }).ok).toBe(false);
    expect(applyAction(tree, { id: '2', kind: 'delete', path: 'src/missing.ts' })).toMatchObject({ ok: true, changes: [] });
    const renamed = applyAction(tree, { id: '3', kind: 'rename', from: 'src/App.tsx', to: 'src/Root.tsx' });
    expect(renamed.changes.map((c) => `${c.kind}:${c.path}`)).toEqual(['delete:src/App.tsx', 'upsert:src/Root.tsx']);
    expect(applyAction(tree, { id: '4', kind: 'rename', from: 'src/Root.tsx', to: 'index.html' }).ok).toBe(false);

    const dep = applyAction(tree, { id: '5', kind: 'dependency', name: 'framer-motion', version: '^12.0.0' });
    expect(dep.ok).toBe(true);
    const pkg = JSON.parse(tree.get('package.json')!.content);
    expect(Object.keys(pkg.dependencies)).toEqual(['framer-motion', 'react']);
    expect(applyAction(tree, { id: '6', kind: 'dependency', name: '../evil', version: '1' }).ok).toBe(false);
    expect(applyAction(tree, { id: '7', kind: 'write', path: 'package.json', content: '{ broken' }).ok).toBe(false);
  });

  it('never applies incomplete actions', () => {
    const tree = base();
    expect(applyAction(tree, { id: '1', kind: 'write', path: 'src/A.tsx', content: 'half', incomplete: true }).ok).toBe(false);
    expect(tree.has('src/A.tsx')).toBe(false);
  });
});
