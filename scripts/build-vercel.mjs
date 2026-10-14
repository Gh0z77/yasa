// Builds the deployment for Vercel in the Build Output API layout (.vercel/output):
//
//   static/assets/**            the hashed files of the web app, served by the CDN
//   functions/index.func/**     the whole server as one Node.js function, with exactly the node_modules it needs
//   config.json                 static files first, everything else goes to the function
//
// Run after `vite build` (npm run build:vercel). The function serves the app shell, the API and the generated
// apps; only DATABASE_URL (Postgres) holds state, see docs/VERCEL.md.
import { build } from 'esbuild';
import { nodeFileTrace } from '@vercel/nft';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve('.');
const out = join(root, '.vercel', 'output');
const func = join(out, 'functions', 'index.func');
const web = join(root, 'dist', 'web');

if (!existsSync(join(web, 'index.html'))) throw new Error('dist/web is missing: run "vite build" first.');
rmSync(out, { recursive: true, force: true });
mkdirSync(func, { recursive: true });

// ---- the server bundle (node_modules stay external and are copied below)
await build({
  entryPoints: ['server/vercel.ts'],
  outfile: join(func, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __yasaCreateRequire } from 'node:module'; const require = __yasaCreateRequire(import.meta.url);",
  },
});

// ---- node_modules: what the bundle imports, plus what it only loads by name at run time
/** Packages whose named imports the preview compiler checks (server/preview/validate-imports.ts). */
const VALIDATED = [
  'lucide-react', 'react', 'react-dom', 'react-dom/client', 'clsx', 'tailwind-merge', 'class-variance-authority', 'sonner', 'radix-ui',
  'recharts', '@tanstack/react-table', '@tanstack/react-query', 'react-hook-form', '@hookform/resolvers', '@hookform/resolvers/zod',
  'date-fns', 'react-router-dom', 'motion', 'motion/react', 'zustand', 'zustand/middleware', 'zod',
];
const probe = join(root, '.vercel', 'trace-entry.mjs');
writeFileSync(probe, VALIDATED.map((name) => `import ${JSON.stringify(name)};`).join('\n'));
const { fileList } = await nodeFileTrace([join(func, 'index.mjs'), probe], { base: root });
rmSync(probe, { force: true });

const copied = new Set();
const copy = (from, to) => {
  if (copied.has(to)) return;
  copied.add(to);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, dereference: true });
};
for (const file of fileList) {
  if (!file.replaceAll('\\', '/').startsWith('node_modules/')) continue;
  copy(join(root, file), join(func, file));
}
/** Whole packages: read from disk by the preview compiler, or resolved by platform at run time. */
const WHOLE = ['tailwindcss', 'tw-animate-css', 'esbuild'];
for (const name of WHOLE) copy(join(root, 'node_modules', name), join(func, 'node_modules', name));
for (const scope of ['@esbuild']) {
  const dir = join(root, 'node_modules', scope);
  if (existsSync(dir)) for (const name of readdirSync(dir)) copy(join(dir, name), join(func, 'node_modules', scope, name));
}
// The validated packages are looked up by their package.json (version check) before they are imported.
for (const name of new Set(VALIDATED.map((spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])))) {
  const manifest = join(root, 'node_modules', name, 'package.json');
  if (existsSync(manifest)) copy(manifest, join(func, 'node_modules', name, 'package.json'));
}

// ---- the app shell and public files are served by the function (it adds the security headers)
for (const name of readdirSync(web)) {
  if (name === 'assets') continue;
  copy(join(web, name), join(func, 'dist', 'web', name));
}
writeFileSync(join(func, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(
  join(func, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      // The longest a generation may take; the server stops one itself a little earlier (see server/env.ts).
      maxDuration: 300,
    },
    null,
    2,
  ),
);

// ---- static assets and routing
cpSync(join(web, 'assets'), join(out, 'static', 'assets'), { recursive: true });
writeFileSync(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index' },
      ],
    },
    null,
    2,
  ),
);

const size = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).reduce((sum, entry) => (entry.isFile() ? sum + statSync(join(entry.parentPath, entry.name)).size : sum), 0);
console.log(`Vercel output ready: function ${(size(func) / 1e6).toFixed(1)} MB (${relative(root, func)}), static ${(size(join(out, 'static')) / 1e6).toFixed(1)} MB`);
