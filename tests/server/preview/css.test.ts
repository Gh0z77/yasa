import { describe, expect, it } from 'vitest';
import { collectCandidates, compileCss, extractCandidates } from '../../../server/preview/css';
import { readPackageJson } from '../../../server/preview/importmap';
import { PNG_1X1_BASE64, file, fixtureFiles, withFile } from './fixture';

async function compile(files = fixtureFiles(), mode: 'preview' | 'publish' = 'preview', cssPaths = ['src/index.css']) {
  return compileCss({ files, cssPaths, mode, pkg: readPackageJson(files) });
}

describe('compileCss', () => {
  it('compiles the fixture stylesheet with Tailwind', async () => {
    const res = await compile();
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.links).toEqual([]);
    const css = res.css;
    // utilities used in the sources
    expect(css).toContain('.md\\:grid-cols-3');
    // Tailwind v4 emits media range syntax, which is inside the browser baseline (no lowering needed)
    expect(css).toMatch(/@media \(width >= 48rem\) \{\s*\.md\\:grid-cols-3 \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    expect(css).toContain('.hover\\:bg-primary\\/90:hover');
    expect(css).toMatch(/\.px-\\\[13px\\\] \{\s*padding-inline: 13px;/);
    expect(css).toMatch(/\.dark\\:bg-muted:where\(\.dark, \.dark \*\) \{\s*background-color: var\(--muted\);/);
    expect(css).toContain('.dark\\:text-foreground:where(.dark, .dark *)');
    expect(css).toContain('.\\[\\&\\>svg\\]\\:size-6');
    expect(css).toMatch(/\.bg-primary \{\s*background-color: var\(--primary\);/);
    expect(css).toContain('.max-w-6xl');
    expect(css).toContain('.rounded-2xl');
    // tokens
    expect(css).toContain('--background: oklch(1 0 0)');
    expect(css).toContain('--primary: oklch(0.55 0.22 264)');
    expect(css).toMatch(/\.dark \{\s*--background: oklch\(0\.145 0 0\)/);
    // @layer base with @apply resolved
    expect(css).toMatch(/border-color: var\(--border\)/);
    expect(css).toMatch(/body \{\s*background-color: var\(--background\);\s*color: var\(--foreground\);/);
    // preflight + tw-animate-css
    expect(css).toContain('@layer theme, base, components, utilities');
    expect(css).toContain('box-sizing: border-box');
    expect(css).toContain('.animate-in');
    expect(css).toContain('.fade-in');
    expect(css).toContain('@keyframes enter');
    // nothing Tailwind-specific is left, unused utilities are not generated
    expect(css).not.toMatch(/@apply|@theme|@custom-variant|@import/);
    expect(css).not.toContain('.grid-cols-7');
    // CSS nesting is flattened for the Tailwind v4 browser baseline
    expect(css).not.toMatch(/&:hover/);
  });

  it('minifies in publish mode', async () => {
    const dev = await compile();
    const prod = await compile(fixtureFiles(), 'publish');
    expect(prod.errors).toEqual([]);
    expect(prod.css.length).toBeLessThan(dev.css.length * 0.9);
    expect(prod.css.split('\n').length).toBeLessThan(5);
    expect(prod.css).toContain('.md\\:grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}');
  });

  it('reports @apply of an unknown utility with file and line', async () => {
    const files = withFile(fixtureFiles(), 'src/index.css', '@import "tailwindcss";\n\n.card {\n  @apply flex bg-nope-500;\n}\n');
    const res = await compile(files);
    expect(res.css).toBe('');
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ file: 'src/index.css', line: 4, lineText: '  @apply flex bg-nope-500;' });
    expect(res.errors[0]?.message).toContain('bg-nope-500');
  });

  it('reports CSS syntax errors with a location', async () => {
    const files = withFile(fixtureFiles(), 'src/index.css', '@import "tailwindcss";\n.x { color: red;\n');
    const res = await compile(files);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]?.file).toBe('src/index.css');
    expect(res.errors[0]?.line).toBe(2);
    expect(res.errors[0]?.message).toMatch(/Missing closing \}/);
  });

  it('reports unresolvable relative imports', async () => {
    const files = withFile(fixtureFiles(), 'src/index.css', '@import "tailwindcss";\n@import "./nope.css";\n');
    const res = await compile(files);
    expect(res.errors[0]?.file).toBe('src/index.css');
    expect(res.errors[0]?.message).toContain('./nope.css');
  });

  it('hoists remote imports, links npm stylesheets and drops @plugin/@config/@source with warnings', async () => {
    let files = withFile(
      fixtureFiles(),
      'src/index.css',
      [
        '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap");',
        "@import 'https://example.com/a.css';",
        '@import "tailwindcss";',
        '@import "leaflet/dist/leaflet.css";',
        '/* @plugin "in-a-comment"; */',
        '@plugin "@tailwindcss/typography";',
        '@config "../tailwind.config.js";',
        '@source "../node_modules/some-lib";',
        '@import "./extra.css";',
        '.a { color: red; }',
        '',
      ].join('\n'),
    );
    files = withFile(files, 'src/extra.css', '@import url(https://example.com/b.css);\n.extra { @apply flex; }\n');
    const res = await compile(files);
    expect(res.errors).toEqual([]);
    expect(res.links).toEqual([
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap',
      'https://example.com/a.css',
      'https://cdn.jsdelivr.net/npm/leaflet/dist/leaflet.css',
      'https://example.com/b.css',
    ]);
    expect(res.warnings.map((w) => [w.file, w.line, /@(\w+)/.exec(w.message)?.[1]])).toEqual([
      ['src/index.css', 6, 'plugin'],
      ['src/index.css', 7, 'config'],
      ['src/index.css', 8, 'source'],
    ]);
    expect(res.css).not.toMatch(/@import|@plugin|@config|@source|fonts\.googleapis/);
    expect(res.css).toMatch(/\.a \{\s*color: red;/);
    expect(res.css).toMatch(/\.extra \{\s*display: flex;/);
    expect(res.css).toContain('.md\\:grid-cols-3');
  });

  it('resolves tailwindcss subpath imports and relative imports from the virtual files', async () => {
    let files = withFile(
      fixtureFiles(),
      'src/index.css',
      '@layer theme, base, components, utilities;\n@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/preflight.css" layer(base);\n@import "tailwindcss/utilities.css" layer(utilities);\n@import "./styles/tokens.css";\n',
    );
    files = withFile(files, 'src/styles/tokens.css', '@import "../more.css";\n:root { --brand: #123456; }\n');
    files = withFile(files, 'src/more.css', '.more { color: var(--brand); }\n');
    const res = await compile(files);
    expect(res.errors).toEqual([]);
    expect(res.css).toContain('--brand: #123456');
    expect(res.css).toMatch(/\.more \{\s*color: var\(--brand\);/);
    expect(res.css).toContain('.md\\:grid-cols-3');
    expect(res.css).toContain('box-sizing: border-box');
  });

  it('outputs plain CSS when nothing imports Tailwind', async () => {
    let files = withFile(fixtureFiles(), 'src/index.css', 'body { margin: 0 }\n.card { &:hover { color: red } }\n');
    files = withFile(files, 'src/other.css', '.other { background: url("./assets/logo.png"); }\n.pub { background: url(/robots.txt); }\n');
    const res = await compile(files, 'preview', ['src/index.css', 'src/other.css']);
    expect(res.errors).toEqual([]);
    expect(res.css).toMatch(/body \{\s*margin: 0;/);
    expect(res.css).toMatch(/\.card:hover \{\s*color: red;/);
    expect(res.css).not.toContain('.md\\:grid-cols-3');
    // files are concatenated in the given order
    expect(res.css.indexOf('.card')).toBeLessThan(res.css.indexOf('.other'));
    // relative asset URLs are inlined, public URLs stay
    // (the CSS printer drops quotes that a URL token does not need)
    expect(res.css).toMatch(/\.other \{\s*background: url\("?data:image\/png;base64,([A-Za-z0-9+/=]+)"?\);/);
    expect(/url\("?data:image\/png;base64,([A-Za-z0-9+/=]+)"?\)/.exec(res.css)?.[1]).toBe(PNG_1X1_BASE64);
    expect(res.css).not.toContain('./assets/logo.png');
    expect(res.css).toMatch(/url\("?\/robots\.txt"?\)/);
  });

  it('returns empty CSS for a project without stylesheets', async () => {
    const res = await compile(fixtureFiles(), 'preview', []);
    expect(res).toEqual({ css: '', links: [], errors: [], warnings: [] });
  });

  it('supports the legacy @tailwind directives without throwing', async () => {
    const files = withFile(fixtureFiles(), 'src/index.css', '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
    const res = await compile(files);
    expect(res.errors).toEqual([]);
  });
});

describe('candidate extraction', () => {
  it('finds classes in JSX, template literals, cn() calls and object keys', () => {
    const found = extractCandidates(
      '<div className={cn("flex [&>svg]:size-4", active && \'bg-primary/90\', { hidden: !x, "md:grid-cols-3": y })} data-x={`p-4 ${a ? "m-2" : ""}`}>',
    );
    for (const c of ['flex', '[&>svg]:size-4', 'bg-primary/90', 'hidden', 'md:grid-cols-3', 'p-4', 'm-2']) {
      expect(found.has(c)).toBe(true);
    }
  });

  it('scans src/** sources and index.html only', () => {
    const files = [
      file('index.html', '<body class="from-html"></body>'),
      file('src/a.tsx', 'const a = "from-tsx";'),
      file('src/deep/b.md', 'from-md'),
      file('src/c.css', '.from-css {}'),
      file('other/d.tsx', 'const d = "from-outside";'),
      file('src/e.png', 'ZnJvbS1iaW5hcnk=', 'base64'),
      file('README.md', 'from-readme'),
    ];
    const found = collectCandidates(files);
    expect(found).toContain('from-html');
    expect(found).toContain('from-tsx');
    expect(found).toContain('from-md');
    expect(found).not.toContain('from-outside');
    expect(found).not.toContain('from-readme');
    expect(found).not.toContain('.from-css');
  });
});
