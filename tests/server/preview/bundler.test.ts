import { beforeAll, describe, expect, it } from 'vitest';
import { buildProject, clearBuildCache, type BuildOutput } from '../../../server/preview/bundler';
import { APP_ORIGIN, PNG_1X1_BASE64, file, fixtureFiles, withFile } from './fixture';

const PREVIEW = { mode: 'preview', appOrigin: APP_ORIGIN } as const;
const PUBLISH = {
  mode: 'publish',
  appOrigin: APP_ORIGIN,
  project: { name: 'Choyxona <Menu> & "Co"', emoji: '🍵', description: 'Best "plov" in town' },
} as const;

function importMapOf(html: string): { imports: Record<string, string> } {
  const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  if (!m || !m[1]) throw new Error('no import map');
  return JSON.parse(m[1]) as { imports: Record<string, string> };
}

function bundleOf(html: string): string {
  const m = /<script type="module" data-yasa="app">([\s\S]*?)<\/script>/.exec(html);
  if (!m || m[1] === undefined) throw new Error('no bundle');
  return m[1];
}

function styleOf(html: string): string {
  const m = /<style data-yasa="app">([\s\S]*?)<\/style>/.exec(html);
  if (!m || m[1] === undefined) throw new Error('no style');
  return m[1];
}

describe('buildProject — preview', () => {
  let out: BuildOutput;
  let html: string;

  beforeAll(async () => {
    clearBuildCache();
    out = await buildProject(fixtureFiles(), PREVIEW);
    html = out.html ?? '';
  });

  it('builds the fixture project', () => {
    expect(out.summary.errors).toEqual([]);
    expect(out.summary.ok).toBe(true);
    expect(out.summary.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('contains the import map, style block, runtime bridge and inline module bundle (in that order)', () => {
    const iMap = html.indexOf('<script type="importmap">');
    const iBridge = html.indexOf('<script data-yasa="bridge">');
    const iStyle = html.indexOf('<style data-yasa="app">');
    const iBundle = html.indexOf('<script type="module" data-yasa="app">');
    expect(iMap).toBeGreaterThan(-1);
    expect(iBridge).toBeGreaterThan(iMap);
    expect(iStyle).toBeGreaterThan(iBridge);
    expect(iBundle).toBeGreaterThan(iStyle);
    // the original entry tag is gone, the project's head content is kept
    expect(html).not.toContain('src="/src/main.tsx"');
    expect(html).toContain('<title>Fixture App</title>');
    expect(html).toContain('<link rel="preconnect" href="https://fonts.googleapis.com" />');
    expect(html).toContain('<div id="root"></div>');
    // exactly one </head>, the import map precedes every other script
    expect(html.match(/<\/head>/g)).toHaveLength(1);
    expect(html.indexOf('<script')).toBe(iMap);
  });

  it('maps every external specifier exactly and always includes React', () => {
    const { imports } = importMapOf(html);
    expect(imports.react).toBe('https://esm.sh/react@^19.0.0?dev');
    expect(imports['react/jsx-runtime']).toBe('https://esm.sh/react@^19.0.0/jsx-runtime?dev');
    expect(imports['react-dom/client']).toBe('https://esm.sh/react-dom@^19.0.0/client?external=react&dev');
    expect(imports['lucide-react']).toBe('https://esm.sh/lucide-react@^1?external=react,react-dom');
    expect(imports['radix-ui']).toBe('https://esm.sh/radix-ui@^1?external=react,react-dom');
    for (const spec of ['sonner', 'clsx', 'tailwind-merge', 'class-variance-authority']) {
      expect(imports[spec]).toMatch(/^https:\/\/esm\.sh\/.+\?external=react,react-dom$/);
    }
    // no prefix (trailing-slash) maps
    expect(Object.keys(imports).some((k) => k.endsWith('/'))).toBe(false);
  });

  it('bundles local modules, keeps npm packages external and inlines a source map', () => {
    const js = bundleOf(html);
    expect(js).toMatch(/from "react\/jsx-runtime"/);
    expect(js).toMatch(/from "react-dom\/client"/);
    expect(js).toMatch(/from "lucide-react"/);
    expect(js).toContain('buttonVariants');
    expect(js).toContain('Hello Yasa'); // json import
    expect(js).toContain('//# sourceMappingURL=data:application/json;base64,');
    expect(js).not.toMatch(/from "\.\/App"/);
    expect(js).not.toContain('process.env.NODE_ENV');
    // type-only imports are erased
    expect(js).not.toContain('LucideIcon');
  });

  it('inlines base64 image assets as data URLs', () => {
    expect(bundleOf(html)).toContain(`data:image/png;base64,${PNG_1X1_BASE64}`);
  });

  it('compiles Tailwind on the server', () => {
    const css = styleOf(html);
    expect(css).toContain('.md\\:grid-cols-3');
    expect(css).toContain('.hover\\:bg-primary\\/90:hover');
    expect(css).toContain('.px-\\[13px\\]');
    expect(css).toMatch(/\.dark\\:bg-muted:where\(\.dark, \.dark \*\)/);
    expect(css).toContain('--background: oklch(1 0 0)');
    expect(css).toContain('.animate-in'); // tw-animate-css
    expect(css).toContain('.\\[\\&\\>svg\\]\\:size-6');
    expect(css).not.toContain('@apply');
    expect(css).not.toContain('@theme');
  });

  it('returns the very same object from the cache', async () => {
    const again = await buildProject(fixtureFiles(), PREVIEW);
    expect(again).toBe(out);
    // file order, size and updatedAt do not matter
    const shuffled = fixtureFiles()
      .reverse()
      .map((f) => ({ ...f, updatedAt: '2030-01-01T00:00:00.000Z', size: 0 }));
    expect(await buildProject(shuffled, PREVIEW)).toBe(out);
    // a different appOrigin or content is a different build
    const other = await buildProject(fixtureFiles(), { mode: 'preview', appOrigin: 'http://localhost:5173' });
    expect(other).not.toBe(out);
    expect(other.summary.hash).toBe(out.summary.hash);
    const changed = await buildProject(withFile(fixtureFiles(), 'src/data.json', '{"title":"Changed"}'), PREVIEW);
    expect(changed.summary.hash).not.toBe(out.summary.hash);
    expect(changed.html).toContain('Changed');
  });

  it('deduplicates concurrent builds of the same input', async () => {
    const files = withFile(fixtureFiles(), 'src/data.json', '{"title":"Concurrent"}');
    const [a, b, c] = await Promise.all([buildProject(files, PREVIEW), buildProject(files, PREVIEW), buildProject(files, PREVIEW)]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a.summary.ok).toBe(true);
  });
});

describe('buildProject — errors', () => {
  it('reports a syntax error with file, line, column and line text', async () => {
    const files = withFile(fixtureFiles(), 'src/App.tsx', 'export default function App() {\n  return <div>\n    <span>oops</div>;\n}\n');
    const out = await buildProject(files, PREVIEW);
    expect(out.summary.ok).toBe(false);
    expect(out.html).toBeNull();
    const first = out.summary.errors[0];
    expect(first).toBeDefined();
    expect(first?.file).toBe('src/App.tsx');
    expect(first?.line).toBe(3);
    expect(first?.column).toBeGreaterThan(0);
    expect(first?.lineText).toBe('    <span>oops</div>;');
    expect(first?.message).toMatch(/closing "div" tag/);
  });

  it('reports a missing local import clearly', async () => {
    const files = withFile(
      fixtureFiles(),
      'src/App.tsx',
      "import Foo from './Foo';\nimport { helper } from '@/lib/missing';\nexport default function App() { return <Foo x={helper} />; }\n",
    );
    const out = await buildProject(files, PREVIEW);
    expect(out.summary.ok).toBe(false);
    const messages = out.summary.errors.map((e) => e.message);
    expect(messages[0]).toBe("Could not resolve './Foo' from src/App.tsx");
    expect(messages[1]).toMatch(/^Could not resolve '@\/lib\/missing' from src\/App\.tsx/);
    expect(out.summary.errors[0]).toMatchObject({ file: 'src/App.tsx', line: 1, lineText: "import Foo from './Foo';" });
  });

  it('hints at case mismatches', async () => {
    const files = withFile(fixtureFiles(), 'src/main.tsx', "import App from './app';\nconsole.log(App);\n");
    const out = await buildProject(files, PREVIEW);
    expect(out.summary.errors[0]?.message).toContain("Could not resolve './app' from src/main.tsx");
    expect(out.summary.errors[0]?.message).toContain('src/App.tsx');
  });

  it('rejects removed lucide brand icons with a suggestion', async () => {
    const files = fixtureFiles().map((f) =>
      f.path === 'src/App.tsx'
        ? { ...f, content: f.content.replace("import { ArrowRight, Sparkles, Zap } from 'lucide-react';", "import { ArrowRight, Github, Sparkles, Zap } from 'lucide-react';").replace('<f.icon />', '<f.icon /><Github />') }
        : f,
    );
    const out = await buildProject(files, PREVIEW);
    expect(out.summary.ok).toBe(false);
    expect(out.summary.errors).toHaveLength(1);
    const err = out.summary.errors[0];
    expect(err?.file).toBe('src/App.tsx');
    expect(err?.line).toBe(3);
    expect(err?.message).toContain('lucide-react has no export "Github"');
    expect(err?.message).toContain('brand icons were removed in lucide v1');
    expect(err?.message).toContain('"@/components/brand-icons"');
    expect(err?.message).toMatch(/Did you mean "[A-Za-z0-9]+"\?/);
  });

  it('does not flag type-only imports', async () => {
    // LucideIcon / ReactNode / VariantProps / ClassValue are types in the fixture; add more shapes here
    const files = withFile(
      fixtureFiles(),
      'src/lib/utils.ts',
      "import { clsx, type ClassValue } from 'clsx';\nimport { twMerge } from 'tailwind-merge';\nimport type { LucideProps } from 'lucide-react';\nimport { ComponentProps, FC } from 'react';\n" +
        'export type P = LucideProps & ComponentProps<"div">;\nexport type C = FC<P>;\n' +
        'export function cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}\n',
    );
    const out = await buildProject(files, PREVIEW);
    expect(out.summary.errors).toEqual([]);
    expect(out.summary.ok).toBe(true);
  });

  it('fails clearly without index.html or without an entry', async () => {
    const noIndex = await buildProject(fixtureFiles().filter((f) => f.path !== 'index.html'), PREVIEW);
    expect(noIndex.summary.ok).toBe(false);
    expect(noIndex.summary.errors[0]?.message).toMatch(/index\.html is missing/);

    const badEntry = await buildProject(
      withFile(fixtureFiles(), 'index.html', '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/src/nope.tsx"></script></body></html>'),
      PREVIEW,
    );
    expect(badEntry.summary.ok).toBe(false);
    expect(badEntry.summary.errors[0]?.message).toMatch(/entry script "\/src\/nope\.tsx".*does not exist/);

    const noEntry = await buildProject(
      withFile(fixtureFiles().filter((f) => f.path !== 'src/main.tsx'), 'index.html', '<!doctype html><html><head></head><body><div id="root"></div></body></html>'),
      PREVIEW,
    );
    expect(noEntry.summary.ok).toBe(false);
    expect(noEntry.summary.errors[0]?.message).toMatch(/no <script type="module" src=/);
  });

  it('turns Tailwind compile errors into build errors for the CSS file', async () => {
    const files = withFile(fixtureFiles(), 'src/index.css', '@import "tailwindcss";\n.x {\n  @apply bg-nope-500;\n}\n');
    const out = await buildProject(files, PREVIEW);
    expect(out.summary.ok).toBe(false);
    expect(out.summary.errors[0]).toMatchObject({ file: 'src/index.css', line: 3 });
    expect(out.summary.errors[0]?.message).toContain('bg-nope-500');
  });

  it('keeps unknown packages external (latest) with a warning and links package CSS from jsDelivr', async () => {
    const files = withFile(
      fixtureFiles(),
      'src/lib/utils.ts',
      "import { clsx, type ClassValue } from 'clsx';\nimport { twMerge } from 'tailwind-merge';\nimport dayjs from 'dayjs';\nimport { format } from 'date-fns/format';\nimport 'leaflet/dist/leaflet.css';\nimport 'tw-animate-css';\n" +
        'export const now = () => format(dayjs().toDate(), "yyyy");\nexport function cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}\n',
    );
    const out = await buildProject(files, PREVIEW);
    expect(out.summary.errors).toEqual([]);
    const html = out.html ?? '';
    const { imports } = importMapOf(html);
    expect(imports.dayjs).toBe('https://esm.sh/dayjs?external=react,react-dom');
    expect(imports['date-fns/format']).toBe('https://esm.sh/date-fns/format?external=react,react-dom');
    expect(imports['tw-animate-css']).toBeUndefined();
    expect(html).toContain('<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet/dist/leaflet.css" data-yasa="css" />');
    const warned = out.summary.warnings.map((w) => w.message).join('\n');
    expect(warned).toContain('"dayjs"');
    expect(warned).toContain('"date-fns"');
    expect(out.summary.warnings.find((w) => w.message.includes('"dayjs"'))).toMatchObject({ file: 'src/lib/utils.ts', line: 3 });
  });

  it('supports ?raw, public URLs, CSS modules, import.meta.env and "use client"', async () => {
    let files = withFile(
      fixtureFiles(),
      'src/lib/utils.ts',
      "'use client';\nimport { clsx, type ClassValue } from 'clsx';\nimport { twMerge } from 'tailwind-merge';\nimport styles from './x.module.css';\nimport raw from './note.md?raw';\nimport note from './note.md';\nimport robots from '/robots.txt';\n" +
        'export const info = [styles.box, raw, note, robots, import.meta.env.DEV, import.meta.env.MODE, import.meta.env.VITE_NOPE, process.env.NODE_ENV];\n' +
        'export function cn(...inputs: ClassValue[]) {\n  console.log(info);\n  return twMerge(clsx(inputs));\n}\n',
    );
    files = withFile(files, 'src/lib/x.module.css', '.box { color: rebeccapurple; }\n');
    files = withFile(files, 'src/lib/note.md', '# A note');
    const out = await buildProject(files, PREVIEW);
    expect(out.summary.errors).toEqual([]);
    expect(out.summary.warnings).toEqual([]);
    const js = bundleOf(out.html ?? '');
    expect(js).toContain('"/robots.txt"');
    expect(js).toContain('# A note');
    expect(js).toContain('"development"');
    expect(styleOf(out.html ?? '')).toMatch(/\.x_box\s*\{\s*color: rebeccapurple/);
  });

  it('rejects Node built-ins', async () => {
    const files = withFile(fixtureFiles(), 'src/lib/utils.ts', "import fs from 'node:fs';\nexport const cn = (...a: unknown[]) => String(fs) + a.join(' ');\n");
    const out = await buildProject(files, PREVIEW);
    expect(out.summary.ok).toBe(false);
    expect(out.summary.errors[0]?.message).toContain('not available in the browser');
  });
});

describe('buildProject — publish', () => {
  let out: BuildOutput;
  let html: string;

  beforeAll(async () => {
    out = await buildProject(fixtureFiles(), PUBLISH);
    html = out.html ?? '';
  });

  it('builds without the runtime bridge', () => {
    expect(out.summary.ok).toBe(true);
    expect(html).not.toContain('data-yasa="bridge"');
    expect(html).not.toContain('yasa-preview');
    expect(html).not.toContain('__YASA_BRIDGE__');
  });

  it('is minified and uses production React', async () => {
    const preview = await buildProject(fixtureFiles(), PREVIEW);
    const js = bundleOf(html);
    expect(js).not.toContain('sourceMappingURL');
    expect(js.length).toBeLessThan(bundleOf(preview.html ?? '').length / 3);
    expect(js.split('\n').length).toBeLessThan(10);
    const css = styleOf(html);
    expect(css.split('\n').length).toBeLessThan(10);
    expect(css).toContain('.md\\:grid-cols-3');
    expect(css.length).toBeLessThan(styleOf(preview.html ?? '').length);
    const { imports } = importMapOf(html);
    expect(imports.react).toBe('https://esm.sh/react@^19.0.0');
    expect(imports['react-dom/client']).toBe('https://esm.sh/react-dom@^19.0.0/client?external=react');
  });

  it('injects missing meta tags from the project', () => {
    // the fixture already has a viewport and a title
    expect(html.match(/<meta name="viewport"/g)).toHaveLength(1);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,');
    expect(html).toContain(encodeURIComponent('🍵'));
    expect(html).toContain('<meta name="description" content="Best &quot;plov&quot; in town" />');
    expect(html).toContain('<meta property="og:title" content="Choyxona &lt;Menu&gt; &amp; &quot;Co&quot;" />');
    expect(html).toContain('<meta property="og:description" content="Best &quot;plov&quot; in town" />');
    expect(html).toContain('<meta property="og:type" content="website" />');
  });

  it('does not duplicate meta tags that the project already has', async () => {
    const index = `<!doctype html>
<html lang="uz">
  <head>
    <meta charset="UTF-8" />
    <title>Mine</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="description" content="mine" />
    <meta property="og:title" content="mine" />
    <meta property="og:description" content="mine" />
    <meta property="og:type" content="article" />
  </head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>`;
    const res = await buildProject(withFile(fixtureFiles(), 'index.html', index), PUBLISH);
    const h = res.html ?? '';
    expect(res.summary.ok).toBe(true);
    expect(h.match(/rel="icon"/g)).toHaveLength(1);
    expect(h.match(/name="description"/g)).toHaveLength(1);
    expect(h.match(/og:title/g)).toHaveLength(1);
    expect(h.match(/og:description/g)).toHaveLength(1);
    expect(h.match(/og:type/g)).toHaveLength(1);
    // viewport was missing
    expect(h.match(/<meta name="viewport"/g)).toHaveLength(1);
    expect(h).toContain('<html lang="uz">');
  });
});

describe('buildProject — html escaping', () => {
  it('escapes </script> and <!-- inside the inlined bundle', async () => {
    const files = withFile(
      fixtureFiles(),
      'src/lib/utils.ts',
      "import { clsx, type ClassValue } from 'clsx';\nimport { twMerge } from 'tailwind-merge';\n" +
        'export const evil = "</script><script>window.__pwned = 1</script><!-- x";\n' +
        'export function cn(...inputs: ClassValue[]) {\n  console.log(evil);\n  return twMerge(clsx(inputs));\n}\n',
    );
    for (const opts of [PREVIEW, PUBLISH]) {
      const out = await buildProject(files, opts);
      expect(out.summary.ok).toBe(true);
      const html = out.html ?? '';
      const start = html.indexOf('<script type="module" data-yasa="app">');
      const end = html.indexOf('</script>', start);
      const body = html.slice(start, end);
      // the first </script> after the bundle start is the real end of the bundle: the payload is still inside
      expect(body).toContain('window.__pwned = 1');
      expect(body).toContain('<\\/script>');
      expect(body).not.toContain('<!--');
      expect(html.slice(end)).not.toContain('__pwned');
      // and the escaped source still evaluates to the original string
      const literal = /"(<\\\/script>[^"]*)"/.exec(body)?.[0];
      expect(literal).toBeDefined();
      expect(new Function(`return ${literal}`)()).toBe('</script><script>window.__pwned = 1</script><!-- x');
    }
  });

  it('decodes base64 text sources and treats svg as an asset', async () => {
    let files = fixtureFiles().map((f) => (f.path === 'src/lib/utils.ts' ? file(f.path, Buffer.from(f.content, 'utf8').toString('base64'), 'base64') : f));
    files = withFile(files, 'src/assets/logo.png', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    files = files.map((f) => (f.path === 'src/assets/logo.png' ? { ...f, path: 'src/assets/logo.svg' } : f));
    files = files.map((f) => (f.path === 'src/App.tsx' ? { ...f, content: f.content.replace('./assets/logo.png', './assets/logo.svg') } : f));
    const out = await buildProject(files, PREVIEW);
    expect(out.summary.errors).toEqual([]);
    expect(bundleOf(out.html ?? '')).toContain('data:image/svg+xml');
    expect(bundleOf(out.html ?? '')).toContain('twMerge');
  });
});
