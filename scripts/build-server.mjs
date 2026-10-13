// Bundles the server into dist/server/index.js. node_modules stay external.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __yasaCreateRequire } from 'node:module'; const require = __yasaCreateRequire(import.meta.url);",
  },
});
