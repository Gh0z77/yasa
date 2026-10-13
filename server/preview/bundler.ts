// Preview / publish build pipeline (SPEC §9.2): virtual-FS esbuild bundle → named-import validation →
// server-side Tailwind → import map → single-file HTML.
//
// Depends only on shared/*, node built-ins, esbuild, tailwindcss and sibling modules of server/preview.
import * as esbuild from 'esbuild';
import { posix } from 'node:path';
import { LIMITS } from '../../shared/constants';
import type { BuildErrorInfo, BuildSummary, ProjectFile } from '../../shared/types';
import { BuildTimeoutError, LruCache, Semaphore, buildCacheKey, hashFiles, withTimeout } from './cache';
import { compileCss } from './css';
import { DEFAULT_ENTRY, composeHtml, findEntryScript, findLocalStylesheets } from './html';
import {
  buildImportMap,
  cssCdnUrl,
  isBareSpecifier,
  isCssSpecifier,
  isDeclared,
  parseSpecifier,
  readPackageJson,
  type PackageJsonLike,
} from './importmap';
import { RUNTIME_BRIDGE_VERSION } from './runtime';
import { validateImports, type ValidateSource } from './validate-imports';
import { validateReferences } from './validate-refs';

export interface BuildOutput {
  summary: BuildSummary;
  html: string | null;
  /** Source files that ended up in the bundle (empty when the build failed). */
  bundled: string[];
  /** npm packages the code imports without listing them in package.json (empty when the build failed). */
  undeclared: string[];
}

export interface BuildOptions {
  mode: 'preview' | 'publish';
  /** Origin of the builder app (e.g. http://localhost:3000) — the only origin the runtime bridge talks to. */
  appOrigin: string;
  /** Project metadata used for the publish-mode meta tags. */
  project?: { name: string; emoji: string; description: string };
}

// ------------------------------------------------------------------------------------------------ constants

/** Bump when the pipeline output changes for identical inputs (invalidates the in-memory cache key space). */
const PIPELINE_VERSION = `1.${RUNTIME_BRIDGE_VERSION}`;

const NS = 'yasa';
const NS_PUBLIC = 'yasa-public';
const NS_REMOTE_CSS = 'yasa-remote-css';
const NS_EMPTY = 'yasa-empty';

const RESOLVE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.json'];

const CODE_LOADERS: Record<string, esbuild.Loader> = {
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.jsx': 'jsx',
  // Vite only allows JSX in .jsx/.tsx; being lenient here avoids a confusing failure for generated .js files.
  '.js': 'jsx',
  '.mjs': 'js',
  '.cjs': 'js',
  '.json': 'json',
  '.txt': 'text',
  '.md': 'text',
};

const ASSET_EXTENSIONS = new Set([
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.avif',
  // not required by the spec but handled the same way (inlined as data URLs)
  '.bmp', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.pdf',
]);

const MAX_REPORTED = 30;

// ------------------------------------------------------------------------------------------------ state

const semaphore = new Semaphore(LIMITS.maxParallelBuilds);
/** LRU of finished builds: 100 entries, ~50 MB of HTML. */
const resultCache = new LruCache<BuildOutput>(100, 50 * 1024 * 1024);
const inflight = new Map<string, Promise<BuildOutput>>();

/** Clears the build cache (tests). */
export function clearBuildCache(): void {
  resultCache.clear();
}

export function buildCacheStats(): { entries: number; bytes: number; running: number; queued: number } {
  return { entries: resultCache.size, bytes: resultCache.totalBytes, running: semaphore.running, queued: semaphore.pending };
}

// ------------------------------------------------------------------------------------------------ helpers

function normalizeProjectPath(p: string): string {
  return posix.normalize(p.replace(/\\/g, '/')).replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
}

function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

function fileText(file: ProjectFile): string {
  return file.encoding === 'base64' ? Buffer.from(file.content, 'base64').toString('utf8') : file.content;
}

function fileBytes(file: ProjectFile): Uint8Array {
  return file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8');
}

function splitQuery(spec: string): { path: string; query: string } {
  const i = spec.search(/[?#]/);
  return i === -1 ? { path: spec, query: '' } : { path: spec.slice(0, i), query: spec.slice(i) };
}

function buildError(message: string, file: string | null = null): BuildErrorInfo {
  return { file, line: null, column: null, message, lineText: null };
}

function stripNamespace(file: string): string {
  return file.replace(/^(?:yasa(?:-[a-z-]+)?):/, '');
}

function toErrorInfo(m: esbuild.Message): BuildErrorInfo {
  const loc = m.location;
  let message = m.text;
  const notes = (m.notes ?? []).map((n) => n.text).filter((t) => t && !/:$/.test(t) && !/^The plugin ".*" was triggered by this import$/.test(t));
  if (notes.length) message += ` (${notes.slice(0, 2).join(' ')})`;
  let lineText = loc?.lineText ?? null;
  if (lineText && lineText.length > 300) lineText = `${lineText.slice(0, 300)}…`;
  return {
    file: loc?.file ? stripNamespace(loc.file) : null,
    line: loc?.line ?? null,
    // esbuild columns are 0-based; BuildErrorInfo uses 1-based lines and columns.
    column: loc ? loc.column + 1 : null,
    message,
    lineText,
  };
}

function dedupe(list: BuildErrorInfo[]): BuildErrorInfo[] {
  const seen = new Set<string>();
  const out: BuildErrorInfo[] = [];
  for (const e of list) {
    const key = `${e.file}\n${e.line}\n${e.column}\n${e.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.slice(0, MAX_REPORTED);
}

// ------------------------------------------------------------------------------------------------ virtual FS plugin

interface PluginState {
  externals: Set<string>;
  loadedSources: Set<string>;
  undeclared: Set<string>;
}

function createResolver(files: Map<string, ProjectFile>) {
  const lowerIndex = new Map<string, string>();
  for (const p of files.keys()) lowerIndex.set(p.toLowerCase(), p);

  function probe(target: string): string | null {
    if (files.has(target)) return target;
    for (const ext of RESOLVE_EXTENSIONS) if (files.has(target + ext)) return target + ext;
    // TypeScript-style specifiers: './foo.js' → foo.ts / foo.tsx
    const m = /^(.*)\.(js|jsx|mjs)$/.exec(target);
    if (m && m[1]) {
      for (const ext of m[2] === 'jsx' ? ['.tsx'] : ['.ts', '.tsx']) if (files.has(m[1] + ext)) return m[1] + ext;
    }
    for (const ext of RESOLVE_EXTENSIONS) {
      const idx = `${target}/index${ext}`;
      if (files.has(idx)) return idx;
    }
    return null;
  }

  function caseHint(target: string): string | null {
    const candidates = [target, ...RESOLVE_EXTENSIONS.map((e) => target + e), ...RESOLVE_EXTENSIONS.map((e) => `${target}/index${e}`)];
    for (const c of candidates) {
      const real = lowerIndex.get(c.toLowerCase());
      if (real && real !== c) return real;
    }
    return null;
  }

  /** Maps a local specifier to a project-relative target path (not yet probed); null when it escapes the root. */
  function targetOf(spec: string, importer: string): string | null {
    let target: string;
    if (spec.startsWith('@/')) target = posix.join('src', spec.slice(2));
    else if (spec.startsWith('~/')) target = posix.join('src', spec.slice(2));
    else if (spec.startsWith('/')) target = spec.replace(/^\/+/, '');
    else target = posix.join(posix.dirname(importer), spec);
    target = posix.normalize(target);
    if (target === '.' || target === '') return 'index';
    if (target.startsWith('../') || target === '..') return null;
    return target.replace(/\/+$/, '');
  }

  return { probe, caseHint, targetOf };
}

function isLocalSpecifier(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..' || spec.startsWith('/') || spec.startsWith('@/') || spec.startsWith('~/');
}

function virtualFsPlugin(files: Map<string, ProjectFile>, entry: string, pkg: PackageJsonLike | null, state: PluginState): esbuild.Plugin {
  const resolver = createResolver(files);
  return {
    name: 'yasa-virtual-fs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args): esbuild.OnResolveResult | null => {
        if (args.kind === 'entry-point') return { path: entry, namespace: NS };
        if (args.namespace !== NS) return { path: args.path, external: true };
        const raw = args.path;
        const cssContext = args.kind === 'import-rule' || args.kind === 'url-token' || args.kind === 'composes-from';

        if (/^(?:https?:)?\/\//i.test(raw)) return { path: raw, external: true };
        if (/^data:/i.test(raw)) return cssContext ? { path: raw, external: true } : null;
        if (/^node:/i.test(raw)) {
          return { errors: [{ text: `Node.js built-in module "${raw}" is not available in the browser` }] };
        }
        if (cssContext && raw.startsWith('#')) return { path: raw, external: true };

        const { path: spec, query } = splitQuery(raw);

        if (isLocalSpecifier(spec) || (cssContext && !isBareSpecifier(spec))) {
          const target = resolver.targetOf(spec, args.importer);
          const found = target === null ? null : resolver.probe(target);
          if (found) return { path: found, namespace: NS, suffix: query || undefined };
          // Vite serves public/ at the root: `import logo from '/logo.svg'` yields the URL.
          if (spec.startsWith('/')) {
            const pub = `public/${spec.replace(/^\/+/, '')}`;
            if (files.has(pub)) return { path: spec, namespace: NS_PUBLIC };
            if (cssContext) return { path: raw, external: true };
          }
          let text = `Could not resolve '${raw}' from ${args.importer}`;
          const hint = target === null ? null : resolver.caseHint(target);
          if (target === null) text += ' (the path points outside of the project)';
          else if (hint) text += ` (file names are case-sensitive — did you mean "${hint}"?)`;
          else if (spec.startsWith('@/')) text += ` ("@/" maps to "src/": the file src/${spec.slice(2)} does not exist)`;
          return { errors: [{ text }] };
        }

        if (cssContext) {
          // `@import "pkg/x.css"` / url(relative-without-dot) inside a CSS module: try the file, else leave it alone.
          const target = resolver.targetOf(`./${spec}`, args.importer);
          const found = target === null ? null : resolver.probe(target);
          return found ? { path: found, namespace: NS, suffix: query || undefined } : { path: raw, external: true };
        }

        // ---- bare specifier → npm package
        const { name, subpath } = parseSpecifier(spec);
        // Tailwind / tw-animate-css are compiled on the server and only matter inside CSS files: a JS import of
        // them (`import 'tw-animate-css'`, `import 'tailwindcss/index.css'`) is a no-op. Tailwind's JS helpers
        // (`tailwindcss/colors`, …) stay ordinary externals.
        if (name === 'tw-animate-css') return { path: spec, namespace: NS_EMPTY };
        if (name === 'tailwindcss' && (!subpath || /\.css$/i.test(subpath) || /^(?:index|theme|preflight|utilities)$/.test(subpath))) {
          return { path: spec, namespace: NS_EMPTY };
        }
        if (isCssSpecifier(spec)) return { path: spec, namespace: NS_REMOTE_CSS };
        const warnings: esbuild.PartialMessage[] = [];
        if (args.kind === 'require-call' || args.kind === 'require-resolve') {
          warnings.push({ text: `require("${spec}") does not work in the browser preview — use an ES import instead` });
        }
        if (!isDeclared(pkg, name) && !state.undeclared.has(name)) {
          state.undeclared.add(name);
          warnings.push({
            text: `Package "${name}" is imported but not listed in package.json dependencies — the latest version will be loaded`,
          });
        }
        state.externals.add(spec);
        return { path: spec, external: true, warnings };
      });

      build.onLoad({ filter: /.*/, namespace: NS_EMPTY }, () => ({ contents: '', loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: NS_REMOTE_CSS }, () => ({ contents: '', loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: NS_PUBLIC }, (args) => ({
        contents: `export default ${JSON.stringify(args.path)};`,
        loader: 'js',
      }));

      build.onLoad({ filter: /.*/, namespace: NS }, (args): esbuild.OnLoadResult => {
        const file = files.get(args.path);
        if (!file) return { errors: [{ text: `File not found: ${args.path}` }] };
        const ext = extOf(args.path);
        const query = args.suffix ?? '';

        if (/^\?raw\b/.test(query)) return { contents: fileText(file), loader: 'text' };
        if (/^\?(?:url|inline)\b/.test(query) && ext !== '.css') return { contents: fileBytes(file), loader: 'dataurl' };

        if (ext === '.css') {
          if (/^\?inline\b/.test(query)) return { contents: fileText(file), loader: 'text' };
          if (/\.module\.css$/i.test(args.path)) return { contents: fileText(file), loader: 'local-css' };
          // Collected (in import order, from the metafile) and compiled by Tailwind — not part of the JS bundle.
          return { contents: '', loader: 'js' };
        }
        if (ASSET_EXTENSIONS.has(ext)) return { contents: fileBytes(file), loader: 'dataurl' };
        const loader = CODE_LOADERS[ext];
        if (!loader) {
          return {
            errors: [
              {
                text: `Unsupported file type "${ext || args.path}" — it cannot be imported in the preview (supported: ts, tsx, js, jsx, json, css, images, txt, md)`,
              },
            ],
          };
        }
        if (loader === 'ts' || loader === 'tsx' || loader === 'js' || loader === 'jsx') state.loadedSources.add(args.path);
        return { contents: fileText(file), loader };
      });
    },
  };
}

// ------------------------------------------------------------------------------------------------ pipeline

interface PipelineResult {
  ok: boolean;
  errors: BuildErrorInfo[];
  warnings: BuildErrorInfo[];
  html: string | null;
  bundled: string[];
  undeclared: string[];
}

function fail(errors: BuildErrorInfo[], warnings: BuildErrorInfo[] = []): PipelineResult {
  return { ok: false, errors: dedupe(errors), warnings: dedupe(warnings), html: null, bundled: [], undeclared: [] };
}

/** Local CSS files and remote stylesheets in module evaluation (import) order, derived from the metafile. */
function orderedStyles(metafile: esbuild.Metafile, entry: string): { cssPaths: string[]; remote: string[] } {
  const cssPaths: string[] = [];
  const remote: string[] = [];
  const visited = new Set<string>();
  const stack: Array<{ key: string; next: number }> = [];
  const start = `${NS}:${entry}`;
  if (!metafile.inputs[start]) return { cssPaths, remote };
  visited.add(start);
  stack.push({ key: start, next: 0 });
  while (stack.length) {
    const frame = stack[stack.length - 1] as { key: string; next: number };
    const imports = metafile.inputs[frame.key]?.imports ?? [];
    if (frame.next >= imports.length) {
      stack.pop();
      continue;
    }
    const imp = imports[frame.next++];
    if (!imp || imp.external || visited.has(imp.path)) continue;
    visited.add(imp.path);
    if (imp.path.startsWith(`${NS_REMOTE_CSS}:`)) {
      remote.push(imp.path.slice(NS_REMOTE_CSS.length + 1));
      continue;
    }
    if (imp.path.startsWith(`${NS}:`)) {
      const p = splitQuery(imp.path.slice(NS.length + 1)).path;
      if (extOf(p) === '.css' && !/\.module\.css$/i.test(p) && imp.path === `${NS}:${p}`) {
        cssPaths.push(p);
        continue;
      }
    }
    if (metafile.inputs[imp.path]) stack.push({ key: imp.path, next: 0 });
  }
  return { cssPaths, remote };
}

async function runEsbuild(options: esbuild.BuildOptions, timeoutMs: number): Promise<esbuild.BuildResult> {
  const ctx = await esbuild.context(options);
  try {
    return await withTimeout(ctx.rebuild(), timeoutMs);
  } catch (err) {
    if (err instanceof BuildTimeoutError) void ctx.cancel().catch(() => undefined);
    throw err;
  } finally {
    void ctx.dispose().catch(() => undefined);
  }
}

async function runPipeline(input: readonly ProjectFile[], opts: BuildOptions): Promise<PipelineResult> {
  const deadline = Date.now() + LIMITS.buildTimeoutMs;
  const dev = opts.mode === 'preview';

  const files = new Map<string, ProjectFile>();
  for (const f of input) files.set(normalizeProjectPath(f.path), f);
  const fileList = [...files.entries()].map(([path, f]) => (path === f.path ? f : { ...f, path }));

  // ---- index.html + entry
  const indexFile = files.get('index.html');
  if (!indexFile) {
    return fail([
      buildError('index.html is missing. The project needs an index.html with <div id="root"></div> and <script type="module" src="/src/main.tsx"></script>.', 'index.html'),
    ]);
  }
  const indexHtml = fileText(indexFile);
  const resolver = createResolver(files);
  const entryTag = findEntryScript(indexHtml);
  let entry: string | null;
  if (entryTag) {
    const target = resolver.targetOf(splitQuery(entryTag.src).path.replace(/^(?!\.{0,2}\/|@\/)/, './'), 'index.html');
    entry = target === null ? null : resolver.probe(target);
    if (!entry) {
      return fail([
        buildError(`The entry script "${entryTag.src}" referenced by index.html does not exist in the project.`, 'index.html'),
      ]);
    }
  } else {
    entry = resolver.probe(normalizeProjectPath(DEFAULT_ENTRY));
    if (!entry) {
      return fail([
        buildError(`index.html has no <script type="module" src="…"> entry and the default entry ${DEFAULT_ENTRY} does not exist.`, 'index.html'),
      ]);
    }
  }
  if (!(extOf(entry) in CODE_LOADERS) || extOf(entry) === '.json') {
    return fail([buildError(`The entry script "${entry}" is not a JavaScript/TypeScript module.`, 'index.html')]);
  }

  const pkg = readPackageJson(fileList);
  const warnings: BuildErrorInfo[] = [];
  if (!pkg) {
    warnings.push(buildError('package.json is missing or invalid — npm packages are loaded in their latest versions.', 'package.json'));
  }

  // ---- bundle
  const state: PluginState = { externals: new Set(), loadedSources: new Set(), undeclared: new Set() };
  const envMode = dev ? 'development' : 'production';
  let result: esbuild.BuildResult;
  try {
    result = await runEsbuild(
      {
        entryPoints: [entry],
        bundle: true,
        write: false,
        outdir: 'out',
        entryNames: 'app',
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        jsx: 'automatic',
        jsxDev: false,
        charset: 'utf8',
        legalComments: 'none',
        sourcemap: dev ? 'inline' : false,
        minify: !dev,
        metafile: true,
        logLevel: 'silent',
        tsconfigRaw: '{}',
        define: {
          'process.env.NODE_ENV': JSON.stringify(envMode),
          'import.meta.env.MODE': JSON.stringify(envMode),
          'import.meta.env.DEV': String(dev),
          'import.meta.env.PROD': String(!dev),
          'import.meta.env.SSR': 'false',
          'import.meta.env.BASE_URL': '"/"',
          'import.meta.env': JSON.stringify({ MODE: envMode, DEV: dev, PROD: !dev, SSR: false, BASE_URL: '/' }),
          'import.meta.hot': 'undefined',
        },
        plugins: [virtualFsPlugin(files, entry, pkg, state)],
      },
      Math.max(1000, deadline - Date.now()),
    );
  } catch (err) {
    if (err instanceof BuildTimeoutError) return fail([buildError(err.message)]);
    const failure = err as Partial<esbuild.BuildFailure>;
    if (Array.isArray(failure.errors) && failure.errors.length) {
      return fail(failure.errors.map(toErrorInfo), [...warnings, ...(failure.warnings ?? []).map(toErrorInfo)]);
    }
    return fail([buildError(`Build failed: ${err instanceof Error ? err.message : String(err)}`)]);
  }

  for (const w of result.warnings) warnings.push(toErrorInfo(w));
  if (result.errors.length) return fail(result.errors.map(toErrorInfo), warnings);

  const outputs = result.outputFiles ?? [];
  const jsOut = outputs.find((o) => o.path.endsWith('.js'));
  const cssOut = outputs.find((o) => o.path.endsWith('.css'));
  if (!jsOut || !result.metafile) return fail([buildError('Build produced no output.')], warnings);

  // ---- named-import validation (only files that are part of the bundle)
  const sources: ValidateSource[] = [];
  for (const p of [...state.loadedSources].sort()) {
    const f = files.get(p);
    if (f) sources.push({ path: p, content: fileText(f) });
  }
  const errors: BuildErrorInfo[] = [];
  try {
    errors.push(...(await validateImports(sources, pkg)));
    errors.push(...(await validateReferences(sources)));
  } catch (err) {
    warnings.push(buildError(`Import validation was skipped: ${err instanceof Error ? err.message : String(err)}`));
  }
  if (Date.now() > deadline) return fail([buildError(new BuildTimeoutError(LIMITS.buildTimeoutMs).message)], warnings);

  // ---- CSS
  const styles = orderedStyles(result.metafile, entry);
  const htmlCss: string[] = [];
  for (const link of findLocalStylesheets(indexHtml)) {
    const target = resolver.targetOf(splitQuery(link.href).path.replace(/^(?!\.{0,2}\/|@\/)/, './'), 'index.html');
    const found = target !== null && files.has(target) ? target : null;
    // files under public/ are served as-is by the sandbox; everything else is compiled into the style block
    if (found && !htmlCss.includes(found)) htmlCss.push(found);
  }
  const cssPaths = [...htmlCss, ...styles.cssPaths.filter((p) => !htmlCss.includes(p))];
  const css = await compileCss({ files: fileList, cssPaths, mode: opts.mode, pkg });
  errors.push(...css.errors);
  warnings.push(...css.warnings);
  if (errors.length) return fail(errors, warnings);
  if (Date.now() > deadline) return fail([buildError(new BuildTimeoutError(LIMITS.buildTimeoutMs).message)], warnings);

  let cssText = css.css;
  if (cssOut && cssOut.text.trim()) {
    // CSS modules (*.module.css) are bundled by esbuild itself.
    let moduleCss = cssOut.text.replace(/\/\*# sourceMappingURL=[^*]*\*\//g, '').trim();
    if (!dev) {
      try {
        moduleCss = (await esbuild.transform(moduleCss, { loader: 'css', minify: true, legalComments: 'none', logLevel: 'silent' })).code;
      } catch {
        /* keep unminified */
      }
    }
    cssText = cssText ? `${cssText}\n${moduleCss}` : moduleCss;
  }
  const cssLinks: string[] = [];
  for (const href of [...styles.remote.map((spec) => cssCdnUrl(spec, pkg)), ...css.links]) {
    if (!cssLinks.includes(href)) cssLinks.push(href);
  }

  // ---- HTML
  const importMap = buildImportMap(state.externals, pkg, opts.mode);
  const html = composeHtml({
    indexHtml,
    mode: opts.mode,
    appOrigin: opts.appOrigin,
    importMap,
    css: cssText,
    cssLinks,
    js: jsOut.text,
    project: opts.project,
  });
  return { ok: true, errors: [], warnings: dedupe(warnings), html, bundled: [...state.loadedSources].sort(), undeclared: [...state.undeclared].sort() };
}

/**
 * Builds a project into a single self-contained HTML document.
 *
 * - Never throws for project problems: failures are reported in `summary.errors` and `html` is null
 *   (serve `errorPageHtml(summary.errors, appOrigin)` from ./html in that case).
 * - Results are cached (LRU 100) by content hash + mode + appOrigin + project meta; a cache hit returns the very
 *   same object, so callers must treat the result as immutable.
 * - At most LIMITS.maxParallelBuilds builds run concurrently; each is limited to LIMITS.buildTimeoutMs.
 */
export async function buildProject(files: ProjectFile[], opts: BuildOptions): Promise<BuildOutput> {
  const hash = hashFiles(files);
  const key = buildCacheKey(`${PIPELINE_VERSION}:${hash}`, opts.mode, opts.appOrigin, opts.project);

  const cached = resultCache.get(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = semaphore
    .run(async (): Promise<BuildOutput> => {
      const started = Date.now();
      let res: PipelineResult;
      let cacheable = true;
      try {
        res = await runPipeline(files, opts);
        // a timeout says nothing about the content — let the next request try again
        if (!res.ok && res.errors.some((e) => /^Build timed out/.test(e.message))) cacheable = false;
      } catch (err) {
        cacheable = false;
        res = fail([buildError(`Internal build error: ${err instanceof Error ? err.message : String(err)}`)]);
      }
      const output: BuildOutput = {
        summary: { ok: res.ok, errors: res.errors, warnings: res.warnings, durationMs: Date.now() - started, hash },
        html: res.html,
        bundled: res.bundled,
        undeclared: res.undeclared,
      };
      if (cacheable) resultCache.set(key, output, output.html ? output.html.length : 1024);
      return output;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}
