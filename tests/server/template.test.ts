import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Locale } from '../../shared/types';
import {
  TEMPLATE_EXPORTS,
  TEMPLATE_HASHES,
  TEMPLATE_LOCALE_NAMES,
  TEMPLATE_PATHS,
  getTemplateFiles,
  isTemplateFile,
} from '../../server/template';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES_DIR = join(ROOT, 'server', 'template', 'files');
const LOCALES: Locale[] = ['en', 'uz', 'ru'];

const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return ['node_modules', 'dist'].includes(entry.name) ? [] : listSourceFiles(full);
    return [relative(FILES_DIR, full).split(sep).join('/')];
  });
}

describe('starter template', () => {
  it('generated.ts is in sync with server/template/files', () => {
    // Throws (non-zero exit) when the generator would produce different output.
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'gen-template.mjs'), '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out).toContain('up to date');
  });

  it('contains every source file, with sorted POSIX paths', () => {
    const onDisk = listSourceFiles(FILES_DIR).sort();
    expect([...TEMPLATE_PATHS]).toEqual(onDisk);
    expect(Object.keys(TEMPLATE_HASHES)).toEqual(onDisk);
    for (const path of TEMPLATE_PATHS) expect(path).not.toMatch(/\\|^\//);
  });

  it('has all files required by the spec', () => {
    const ui = [
      'button', 'card', 'input', 'textarea', 'label', 'badge', 'dialog', 'sheet', 'tabs', 'accordion',
      'dropdown-menu', 'select', 'switch', 'checkbox', 'tooltip', 'avatar', 'separator', 'skeleton', 'sonner',
    ].map((name) => `src/components/ui/${name}.tsx`);
    const required = [
      'package.json', 'index.html', 'vite.config.ts', 'tsconfig.json', '.gitignore', 'README.md',
      'src/main.tsx', 'src/App.tsx', 'src/index.css', 'src/vite-env.d.ts', 'src/lib/utils.ts',
      'src/hooks/use-local-storage.ts', 'src/hooks/use-mobile.ts', 'src/components/brand-icons.tsx',
      ...ui,
    ];
    for (const path of required) expect(TEMPLATE_PATHS, path).toContain(path);
  });

  it('supports exactly the app locales', () => {
    expect([...TEMPLATE_LOCALE_NAMES].sort()).toEqual([...LOCALES].sort());
  });

  it.each(LOCALES)('renders locale %s without leftover markers', (locale) => {
    const files = getTemplateFiles(locale);
    expect(Object.keys(files)).toEqual([...TEMPLATE_PATHS]);
    for (const [path, file] of Object.entries(files)) {
      expect(file.encoding, path).toBe('utf8');
      expect(file.content, path).not.toContain('__YASA_');
      expect(file.content, path).not.toContain('\r');
      expect(file.content.length, path).toBeGreaterThan(0);
    }
    expect(files['index.html'].content).toContain(`<html lang="${locale}">`);
    expect(files['index.html'].content).toMatch(/<title>[^<]+<\/title>/);
  });

  it('localizes the placeholder and the document title', () => {
    const en = getTemplateFiles('en');
    const uz = getTemplateFiles('uz');
    const ru = getTemplateFiles('ru');
    expect(en['src/App.tsx'].content).toContain('Your app will appear here');
    expect(uz['src/App.tsx'].content).toContain('Ilovangiz shu yerda paydo bo');
    expect(ru['src/App.tsx'].content).toContain('Здесь появится ваше приложение');
    const contents = [en, uz, ru].map((files) => files['src/App.tsx'].content);
    expect(new Set(contents).size).toBe(3);
    const titles = [en, uz, ru].map((files) => /<title>([^<]+)<\/title>/.exec(files['index.html'].content)?.[1]);
    expect(new Set(titles).size).toBe(3);
    // Everything else is identical across locales.
    for (const path of TEMPLATE_PATHS) {
      if (path === 'src/App.tsx' || path === 'index.html') continue;
      expect(uz[path].content, path).toBe(en[path].content);
      expect(ru[path].content, path).toBe(en[path].content);
    }
  });

  it('returns a fresh object on every call', () => {
    const first = getTemplateFiles('en');
    first['src/App.tsx'].content = 'changed';
    delete first['README.md'];
    const second = getTemplateFiles('en');
    expect(second['src/App.tsx'].content).toContain('Your app will appear here');
    expect(second['README.md']).toBeDefined();
  });

  it('TEMPLATE_HASHES are the sha256 of the default (en) rendering', () => {
    const en = getTemplateFiles('en');
    for (const [path, file] of Object.entries(en)) {
      expect(TEMPLATE_HASHES[path], path).toBe(sha256(file.content));
      expect(TEMPLATE_HASHES[path], path).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(TEMPLATE_HASHES['src/App.tsx']).not.toBe(sha256(getTemplateFiles('uz')['src/App.tsx'].content));
  });

  it('isTemplateFile recognises any locale rendering and rejects edits', () => {
    for (const locale of LOCALES) {
      for (const [path, file] of Object.entries(getTemplateFiles(locale))) {
        expect(isTemplateFile(path, file.content), `${locale}:${path}`).toBe(true);
      }
    }
    const app = getTemplateFiles('ru')['src/App.tsx'].content;
    expect(isTemplateFile('src/App.tsx', `${app}\n// edited`)).toBe(false);
    expect(isTemplateFile('src/App.tsx', '')).toBe(false);
    expect(isTemplateFile('src/Other.tsx', app)).toBe(false);
    expect(isTemplateFile('src/main.tsx', app)).toBe(false);
    // Raw (unrendered) sources are not a valid rendering.
    const raw = readFileSync(join(FILES_DIR, 'src', 'App.tsx'), 'utf8').replace(/\r\n?/g, '\n');
    expect(isTemplateFile('src/App.tsx', raw)).toBe(false);
    // Path and line-ending normalization.
    expect(isTemplateFile('./src/App.tsx', app)).toBe(true);
    expect(isTemplateFile('/src/App.tsx', app)).toBe(true);
    expect(isTemplateFile('src\\App.tsx', app.replace(/\n/g, '\r\n'))).toBe(true);
  });

  it('package.json is valid and pins the expected dependencies', () => {
    const pkg = JSON.parse(getTemplateFiles('en')['package.json'].content) as {
      name: string;
      private: boolean;
      type: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('yasa-app');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    expect(pkg.scripts).toMatchObject({ dev: 'vite', build: 'vite build', preview: 'vite preview' });
    const deps = [
      'react', 'react-dom', 'lucide-react', 'clsx', 'tailwind-merge', 'class-variance-authority',
      'radix-ui', 'sonner', 'tw-animate-css',
    ];
    const devDeps = [
      'vite', '@vitejs/plugin-react', 'typescript', '@types/react', '@types/react-dom', 'tailwindcss',
      '@tailwindcss/vite',
    ];
    expect(Object.keys(pkg.dependencies).sort()).toEqual([...deps].sort());
    expect(Object.keys(pkg.devDependencies).sort()).toEqual([...devDeps].sort());
    for (const range of [...Object.values(pkg.dependencies), ...Object.values(pkg.devDependencies)]) {
      expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
    }
    expect(pkg.dependencies.react).toMatch(/^\^19\./);
    expect(pkg.devDependencies.tailwindcss).toMatch(/^\^4\./);
  });

  it('tsconfig.json is valid JSON with the @/ alias and no baseUrl', () => {
    const tsconfig = JSON.parse(getTemplateFiles('en')['tsconfig.json'].content) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.jsx).toBe('react-jsx');
    expect(tsconfig.compilerOptions.paths).toEqual({ '@/*': ['./src/*'] });
    expect(tsconfig.compilerOptions).not.toHaveProperty('baseUrl');
  });

  it('index.html and index.css contain the required pieces', () => {
    const files = getTemplateFiles('en');
    const html = files['index.html'].content;
    for (const piece of [
      '<div id="root"></div>',
      '<script type="module" src="/src/main.tsx"></script>',
      'rel="preconnect" href="https://fonts.googleapis.com"',
      'family=Inter',
      'name="viewport"',
      'name="description"',
      'property="og:title"',
      'property="og:description"',
      'name="theme-color"',
    ]) {
      expect(html, piece).toContain(piece);
    }
    const css = files['src/index.css'].content;
    for (const piece of [
      '@import "tailwindcss";',
      '@import "tw-animate-css";',
      '@custom-variant dark (&:where(.dark, .dark *));',
      '@theme inline',
      '--animate-fade-up',
      '--animate-fade-in',
      '--animate-scale-in',
      '@keyframes fade-up',
      '@layer base',
      '.dark {',
    ]) {
      expect(css, piece).toContain(piece);
    }
    expect(css).not.toMatch(/@plugin|@config|@source/);
    expect(files['src/main.tsx'].content).toContain('<Toaster />');
  });

  it('TEMPLATE_EXPORTS lists exported names of every ts/tsx file', () => {
    const tsFiles = TEMPLATE_PATHS.filter((path) => /\.tsx?$/.test(path));
    expect(Object.keys(TEMPLATE_EXPORTS)).toEqual(tsFiles);
    expect(TEMPLATE_EXPORTS['src/components/ui/button.tsx']).toEqual(
      expect.arrayContaining(['Button', 'buttonVariants']),
    );
    expect([...TEMPLATE_EXPORTS['src/components/ui/dialog.tsx']].sort()).toEqual(
      [
        'Dialog', 'DialogClose', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader',
        'DialogOverlay', 'DialogPortal', 'DialogTitle', 'DialogTrigger',
      ].sort(),
    );
    expect(TEMPLATE_EXPORTS['src/components/brand-icons.tsx']).toEqual(
      expect.arrayContaining([
        'Telegram', 'Instagram', 'Facebook', 'YouTube', 'XTwitter', 'X', 'GitHub', 'LinkedIn', 'WhatsApp',
        'TikTok',
      ]),
    );
    expect(TEMPLATE_EXPORTS['src/lib/utils.ts']).toEqual(['cn']);
    expect(TEMPLATE_EXPORTS['src/hooks/use-local-storage.ts']).toEqual(['useLocalStorage']);
    expect(TEMPLATE_EXPORTS['src/hooks/use-mobile.ts']).toEqual(['useIsMobile']);
    expect(TEMPLATE_EXPORTS['src/components/ui/sonner.tsx']).toEqual(expect.arrayContaining(['Toaster']));
    expect(TEMPLATE_EXPORTS['src/App.tsx']).toContain('default');
    for (const path of tsFiles.filter((p) => p.startsWith('src/components/'))) {
      expect(TEMPLATE_EXPORTS[path].length, path).toBeGreaterThan(0);
    }
  });

  it('class names avoid characters that break simple candidate extraction', () => {
    // The preview compiles Tailwind from tokens split on whitespace, quotes, backticks and <>{}:
    // an arbitrary variant such as [&>svg] or [class*='x'] would be silently dropped there.
    for (const [path, file] of Object.entries(getTemplateFiles('en'))) {
      if (!path.endsWith('.tsx')) continue;
      expect(file.content, path).not.toMatch(/\[[^\]\s"]*['>][^\]\s"]*\]/);
    }
  });
});
