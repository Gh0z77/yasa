// Builds the REAL starter template (server/template) with the preview pipeline.
import { describe, expect, it } from 'vitest';
import type { Locale, ProjectFile } from '../../../shared/types';
import { buildProject } from '../../../server/preview/bundler';
import { getTemplateFiles } from '../../../server/template';
import { APP_ORIGIN, file } from './fixture';

function templateProject(locale: Locale = 'en', overrides: Record<string, string> = {}): ProjectFile[] {
  const files = getTemplateFiles(locale);
  const out: ProjectFile[] = [];
  for (const [path, f] of Object.entries(files)) {
    if (path in overrides) continue;
    out.push(file(path, f.content, f.encoding));
  }
  for (const [path, content] of Object.entries(overrides)) out.push(file(path, content));
  return out;
}

const MOCK_APP = `import { useState } from 'react';
import { ArrowRight, Check, Sparkles, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const features = [
  { icon: Sparkles, title: 'Beautiful by default', text: 'Design tokens and polished components.' },
  { icon: Zap, title: 'Instant preview', text: 'See every change in seconds.' },
  { icon: Check, title: 'Ready to publish', text: 'One click to go live.' },
];

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
      <Badge variant="secondary" className="animate-fade-in">Demo</Badge>
      <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">Hello from the demo app</h1>
      <p className="mt-4 text-muted-foreground">This page was produced by the mock provider.</p>
      <Button
        className="mt-8"
        onClick={() => {
          setCount((c) => c + 1);
          toast.success('It works');
        }}
      >
        Clicked {count} times <ArrowRight className="size-4" />
      </Button>
      <section className="mt-12 grid gap-6 md:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title} className="rounded-2xl shadow-sm transition hover:shadow-md">
            <CardHeader>
              <f.icon className="size-6 text-primary" />
              <CardTitle>{f.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{f.text}</CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
`;

describe('starter template', () => {
  for (const mode of ['preview', 'publish'] as const) {
    it(`builds in ${mode} mode without errors`, async () => {
      const out = await buildProject(templateProject('en'), {
        mode,
        appOrigin: APP_ORIGIN,
        project: { name: 'Starter', emoji: '✨', description: 'The starter template' },
      });
      expect(out.summary.errors).toEqual([]);
      expect(out.summary.ok).toBe(true);
      const html = out.html ?? '';
      expect(html).toContain('<script type="importmap">');
      expect(html).toContain('<style data-yasa="app">');
      expect(html).toContain('<script type="module" data-yasa="app">');
      expect(html).not.toContain('src="/src/main.tsx"');
      expect(html.includes('data-yasa="bridge"')).toBe(mode === 'preview');
      // design tokens and at least one token-based utility made it through Tailwind
      expect(html).toMatch(/--primary:\s*oklch\(/);
      expect(html).toMatch(/\.bg-background\s*\{/);
      expect(html).not.toMatch(/@apply|@theme|@custom-variant/);
      // the Google Fonts link of the template head is kept as-is
      expect(html).toContain('https://fonts.googleapis.com/css2?family=Inter');
      // every bare import of the bundle has an import-map entry
      const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '{}') as { imports: Record<string, string> };
      const bundle = /<script type="module" data-yasa="app">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
      const head = bundle.slice(0, bundle.indexOf('sourceMappingURL') === -1 ? undefined : bundle.indexOf('sourceMappingURL'));
      const specifiers = new Set<string>();
      for (const m of head.matchAll(/(?:^|[;\n])\s*import\s*(?:[^"';()]*?\s*from\s*)?"([^"./][^"]*)"/g)) specifiers.add(m[1] ?? '');
      expect(specifiers.size).toBeGreaterThan(3);
      for (const s of specifiers) expect(map.imports[s], `import map entry for ${s}`).toBeDefined();
    });
  }

  it('builds in every locale', async () => {
    for (const locale of ['uz', 'ru'] as const) {
      const out = await buildProject(templateProject(locale), { mode: 'preview', appOrigin: APP_ORIGIN });
      expect(out.summary.errors).toEqual([]);
      expect(out.html).toContain(`<html lang="${locale}">`);
    }
  });

  it('builds the mock-provider demo app on top of the template', async () => {
    for (const mode of ['preview', 'publish'] as const) {
      const out = await buildProject(templateProject('en', { 'src/App.tsx': MOCK_APP }), { mode, appOrigin: APP_ORIGIN });
      expect(out.summary.errors).toEqual([]);
      expect(out.summary.ok).toBe(true);
      const html = out.html ?? '';
      expect(html).toContain('Hello from the demo app');
      expect(html).toContain('.md\\:grid-cols-3');
      expect(html).toContain('.hover\\:shadow-md');
      expect(html).toMatch(/"lucide-react":\s*"https:\/\/esm\.sh\/lucide-react@/);
      expect(html).toMatch(/"sonner":\s*"https:\/\/esm\.sh\/sonner@/);
    }
  });

  it('rejects a brand icon in the template project (declared lucide major matches the installed one)', async () => {
    const app = MOCK_APP.replace('{ ArrowRight, Check, Sparkles, Zap }', '{ ArrowRight, Check, Github, Sparkles, Zap }').replace('<Badge ', '<Github /><Badge ');
    const out = await buildProject(templateProject('en', { 'src/App.tsx': app }), { mode: 'preview', appOrigin: APP_ORIGIN });
    expect(out.summary.ok).toBe(false);
    expect(out.summary.errors).toHaveLength(1);
    expect(out.summary.errors[0]).toMatchObject({ file: 'src/App.tsx', line: 2 });
    expect(out.summary.errors[0]?.message).toContain('brand icons were removed in lucide v1');
  });
});
