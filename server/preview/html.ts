// HTML composition for previews, published apps and the build-error page (SPEC §9.4).
import { randomUUID } from 'node:crypto';
import type { BuildErrorInfo } from '../../shared/types';
import type { ImportMap } from './importmap';
import { runtimeBridgeScript } from './runtime';

export const DEFAULT_ENTRY = '/src/main.tsx';

export const DEFAULT_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${DEFAULT_ENTRY}"></script>
  </body>
</html>
`;

// ------------------------------------------------------------------------------------------------ escaping

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Makes JavaScript safe to inline in a `<script>` element: `</script` can no longer close the element and
 * `<!--` can no longer open the "script data escaped" state. Both rewrites are no-ops for the JS engine inside
 * string, template and regex literals — the only places where these sequences can legally occur in module code.
 */
export function escapeInlineScript(js: string): string {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\x21--');
}

/** JSON for an inline `<script type="importmap">` / data script. */
export function escapeInlineJson(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .split(String.fromCharCode(0x2028))
    .join('\\u2028')
    .split(String.fromCharCode(0x2029))
    .join('\\u2029');
}

/** CSS for an inline `<style>` element (`\/` is an escaped slash in CSS, i.e. the same character). */
export function escapeInlineStyle(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

// ------------------------------------------------------------------------------------------------ parsing helpers

/** Replaces HTML comments by spaces of equal length so that tag searches ignore commented-out markup. */
function maskComments(html: string): string {
  return html.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => m.replace(/[^\n]/g, ' '));
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(tag);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

function isRemoteUrl(url: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^(?:data|blob|javascript):/i.test(url);
}

export interface EntryScript {
  /** Value of the `src` attribute as written (e.g. `/src/main.tsx`). */
  src: string;
  /** Offsets of the whole `<script …></script>` element in the HTML. */
  start: number;
  end: number;
}

/** Finds the app entry: the first local `<script type="module" src="…">` of the document. */
export function findEntryScript(html: string): EntryScript | null {
  const masked = maskComments(html);
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const attrs = ` ${m[1] ?? ''}`;
    const type = attr(attrs, 'type');
    const src = attr(attrs, 'src');
    if (!src || isRemoteUrl(src)) continue;
    if ((type ?? '').toLowerCase() !== 'module') continue;
    return { src, start: m.index, end: m.index + m[0].length };
  }
  return null;
}

export interface LocalStylesheetLink {
  href: string;
  start: number;
  end: number;
}

/** `<link rel="stylesheet" href="/src/x.css">` tags that point at local (non-remote) files. */
export function findLocalStylesheets(html: string): LocalStylesheetLink[] {
  const masked = maskComments(html);
  const out: LocalStylesheetLink[] = [];
  const re = /<link\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const attrs = ` ${m[1] ?? ''}`;
    const rel = (attr(attrs, 'rel') ?? '').toLowerCase();
    const href = attr(attrs, 'href');
    if (!href || isRemoteUrl(href)) continue;
    if (!rel.split(/\s+/).includes('stylesheet')) continue;
    out.push({ href, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function hasMeta(html: string, attrName: 'name' | 'property', value: string): boolean {
  const re = /<meta\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = ` ${m[1] ?? ''}`;
    const v = attr(attrs, attrName) ?? (attrName === 'property' ? attr(attrs, 'name') : null);
    if (v && v.toLowerCase() === value) return true;
  }
  return false;
}

function hasIconLink(html: string): boolean {
  const re = /<link\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const rel = (attr(` ${m[1] ?? ''}`, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('icon')) return true;
  }
  return false;
}

/** SVG data URL that renders an emoji as the favicon. */
export function emojiIconDataUrl(emoji: string): string {
  const glyph = escapeHtml((emoji || '').trim() || '✨');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${glyph}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ------------------------------------------------------------------------------------------------ composition

export interface ComposeHtmlInput {
  /** The project's index.html (null → DEFAULT_INDEX_HTML). */
  indexHtml: string | null;
  mode: 'preview' | 'publish';
  /** Builder origin(s) for the runtime bridge. */
  appOrigin: string;
  importMap: ImportMap;
  /** Compiled app CSS. */
  css: string;
  /** Remote stylesheets, emitted as `<link rel="stylesheet">` before the app style block. */
  cssLinks: readonly string[];
  /** The bundled app (ES module source). */
  js: string;
  project?: { name: string; emoji: string; description: string };
}

function indentBlock(lines: string[]): string {
  return lines.map((l) => `    ${l}`).join('\n');
}

/** Ensures the document has `<html>`, `<head>` and `<body>` so that injection points exist. */
function normalizeDocument(html: string): string {
  let doc = html;
  const masked = (): string => maskComments(doc);
  if (!/<html\b/i.test(masked())) {
    const hasBody = /<body\b/i.test(masked());
    const hasHead = /<head\b/i.test(masked());
    const doctype = /^\s*<!doctype[^>]*>/i.exec(doc)?.[0] ?? '';
    const rest = doc.slice(doctype.length);
    if (hasHead || hasBody) doc = `<!doctype html>\n<html>\n${rest}\n</html>\n`;
    else doc = `<!doctype html>\n<html>\n  <head>\n    <meta charset="UTF-8" />\n  </head>\n  <body>\n${rest}\n  </body>\n</html>\n`;
  }
  if (!/^\s*<!doctype/i.test(doc)) doc = `<!doctype html>\n${doc}`;
  if (!/<head\b[^>]*>/i.test(masked())) {
    const m = /<html\b[^>]*>/i.exec(masked());
    if (m) {
      const at = m.index + m[0].length;
      doc = `${doc.slice(0, at)}\n  <head>\n    <meta charset="UTF-8" />\n  </head>${doc.slice(at)}`;
    }
  }
  if (!/<\/head\s*>/i.test(masked())) {
    // unclosed <head>: close it right before <body> (or right after the opening tag)
    const body = /<body\b/i.exec(masked());
    const head = /<head\b[^>]*>/i.exec(masked());
    const at = body ? body.index : head ? head.index + head[0].length : 0;
    doc = `${doc.slice(0, at)}</head>\n${doc.slice(at)}`;
  }
  if (!/<body\b/i.test(masked())) {
    const m = /<\/head\s*>/i.exec(masked());
    if (m) {
      const at = m.index + m[0].length;
      const end = /<\/html\s*>/i.exec(masked());
      const stop = end && end.index >= at ? end.index : doc.length;
      doc = `${doc.slice(0, at)}\n  <body>${doc.slice(at, stop)}</body>\n${doc.slice(stop)}`;
    }
  }
  return doc;
}

/**
 * Builds the final single-file HTML document.
 *
 * Injection order (head): import map → runtime bridge (preview only; first so it catches every later error) →
 * the project's own head content → publish meta tags that are missing → remote stylesheet links →
 * `<style data-yasa="app">`. The bundle replaces the original entry `<script type="module" src>` in place.
 */
export function composeHtml(input: ComposeHtmlInput): string {
  let doc = normalizeDocument(input.indexHtml ?? DEFAULT_INDEX_HTML);

  // 1. Replace the entry script by a placeholder (the bundle is spliced in last, so no later regex ever scans it).
  // The slot markers carry a random nonce so that project content can never collide with them.
  const nonce = randomUUID();
  const BUNDLE_SLOT = `<!--yasa:bundle:${nonce}-->`;
  const STYLE_SLOT = `<!--yasa:style:${nonce}-->`;
  const entry = findEntryScript(doc);
  if (entry) {
    doc = doc.slice(0, entry.start) + BUNDLE_SLOT + doc.slice(entry.end);
  } else {
    const masked = maskComments(doc);
    const bodyEnd = /<\/body\s*>/i.exec(masked);
    const at = bodyEnd ? bodyEnd.index : doc.length;
    doc = `${doc.slice(0, at)}${BUNDLE_SLOT}\n${doc.slice(at)}`;
  }

  // 2. Local stylesheet links are compiled into the app style block → drop the tags.
  const localLinks = findLocalStylesheets(doc).sort((a, b) => b.start - a.start);
  for (const l of localLinks) doc = doc.slice(0, l.start) + doc.slice(l.end);

  // 3. Head start: import map (+ bridge). Must precede every module script and modulepreload.
  const headStart: string[] = [];
  const maskedForCharset = maskComments(doc);
  const headOpen = /<head\b[^>]*>/i.exec(maskedForCharset);
  const headClose = /<\/head\s*>/i.exec(maskedForCharset);
  const headInner = headOpen && headClose ? maskedForCharset.slice(headOpen.index + headOpen[0].length, headClose.index) : '';
  if (!/<meta\b[^>]*\bcharset\s*=/i.test(headInner)) headStart.push('<meta charset="UTF-8" />');
  headStart.push(`<script type="importmap">${escapeInlineJson(JSON.stringify(input.importMap))}</script>`);
  if (input.mode === 'preview') {
    headStart.push(`<script data-yasa="bridge">${escapeInlineScript(runtimeBridgeScript(input.appOrigin))}</script>`);
  }

  // 4. Head end: publish meta, remote CSS links, compiled CSS.
  const headEnd: string[] = [];
  if (input.mode === 'publish') {
    const p = input.project;
    const name = p?.name?.trim() ?? '';
    const description = p?.description?.trim() ?? '';
    if (!hasMeta(headInner, 'name', 'viewport')) {
      headEnd.push('<meta name="viewport" content="width=device-width, initial-scale=1.0" />');
    }
    if (!/<title\b[^>]*>\s*[^<\s]/i.test(headInner) && name) headEnd.push(`<title>${escapeHtml(name)}</title>`);
    if (!hasIconLink(headInner) && p) headEnd.push(`<link rel="icon" href="${escapeHtml(emojiIconDataUrl(p.emoji))}" />`);
    if (!hasMeta(headInner, 'name', 'description') && description) {
      headEnd.push(`<meta name="description" content="${escapeHtml(description)}" />`);
    }
    if (!hasMeta(headInner, 'property', 'og:title') && name) {
      headEnd.push(`<meta property="og:title" content="${escapeHtml(name)}" />`);
    }
    if (!hasMeta(headInner, 'property', 'og:description') && description) {
      headEnd.push(`<meta property="og:description" content="${escapeHtml(description)}" />`);
    }
    if (!hasMeta(headInner, 'property', 'og:type')) headEnd.push('<meta property="og:type" content="website" />');
  }
  for (const href of input.cssLinks) {
    headEnd.push(`<link rel="stylesheet" href="${escapeHtml(href)}" data-yasa="css" />`);
  }

  // Splice (from the end of the document towards the start so offsets stay valid).
  {
    const masked = maskComments(doc);
    const close = /<\/head\s*>/i.exec(masked);
    const at = close ? close.index : 0;
    doc = `${doc.slice(0, at)}${headEnd.length ? `${indentBlock(headEnd)}\n` : ''}    ${STYLE_SLOT}\n  ${doc.slice(at)}`;
  }
  {
    const masked = maskComments(doc);
    const open = /<head\b[^>]*>/i.exec(masked);
    let at = open ? open.index + open[0].length : 0;
    // Keep an existing <meta charset> first: browsers only look for it in the first 1024 bytes and the injected
    // block is much larger. (Only when no script precedes it — the import map must stay ahead of every script.)
    const rest = masked.slice(at);
    const charset = /<meta\b[^>]*\bcharset\s*=[^>]*>/i.exec(rest);
    if (charset && !/<script\b/i.test(rest.slice(0, charset.index))) at += charset.index + charset[0].length;
    doc = `${doc.slice(0, at)}\n${indentBlock(headStart)}${doc.slice(at)}`;
  }

  // 5. Large payloads last, via function replacers (no `$` substitution patterns, no rescanning).
  const style = `<style data-yasa="app">${escapeInlineStyle(input.css)}</style>`;
  const bundle = `<script type="module" data-yasa="app">${escapeInlineScript(input.js)}</script>`;
  doc = doc.replace(STYLE_SLOT, () => style);
  doc = doc.replace(BUNDLE_SLOT, () => bundle);
  return doc;
}

// ------------------------------------------------------------------------------------------------ error page

function formatLocation(e: BuildErrorInfo): string {
  if (!e.file) return '';
  let s = e.file;
  if (e.line != null) {
    s += `:${e.line}`;
    if (e.column != null) s += `:${e.column}`;
  }
  return s;
}

/**
 * Stand-alone page shown in the preview when the build failed. It lists the errors, includes the runtime bridge
 * and reports every error to the builder as `{ type: 'error', error: { kind: 'build', … } }`.
 */
export function errorPageHtml(errors: BuildErrorInfo[], appOrigin: string): string {
  const list = errors.length ? errors : [{ file: null, line: null, column: null, message: 'Build failed', lineText: null }];
  const items = list
    .slice(0, 50)
    .map((e) => {
      const loc = formatLocation(e);
      const code =
        e.lineText != null && e.lineText.trim() !== ''
          ? `<pre class="code"><span class="ln">${e.line ?? ''}</span>${escapeHtml(e.lineText.length > 400 ? `${e.lineText.slice(0, 400)}…` : e.lineText)}</pre>`
          : '';
      return `<li>${loc ? `<div class="loc">${escapeHtml(loc)}</div>` : ''}<div class="msg">${escapeHtml(e.message)}</div>${code}</li>`;
    })
    .join('\n        ');
  const more = list.length > 50 ? `<p class="more">+ ${list.length - 50} more</p>` : '';
  const payload = list.slice(0, 50).map((e) => ({
    message: e.file ? `${formatLocation(e)}: ${e.message}` : e.message,
    file: e.file,
    line: e.line,
    column: e.column,
  }));
  const count = list.length;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>Build failed</title>
    <style>
      :root { color-scheme: light dark; --bg: #fafafa; --fg: #18181b; --muted: #71717a; --card: #ffffff; --border: #e4e4e7; --red: #dc2626; --red-bg: #fef2f2; --code: #f4f4f5; }
      @media (prefers-color-scheme: dark) {
        :root { --bg: #09090b; --fg: #fafafa; --muted: #a1a1aa; --card: #18181b; --border: #27272a; --red: #f87171; --red-bg: #2a1215; --code: #0f0f12; }
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body { background: var(--bg); color: var(--fg); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 32px 16px; }
      main { max-width: 760px; margin: 0 auto; }
      header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
      .badge { flex: none; width: 36px; height: 36px; border-radius: 10px; background: var(--red-bg); color: var(--red); display: grid; place-items: center; font-size: 20px; font-weight: 700; }
      h1 { font-size: 18px; margin: 0; letter-spacing: -0.01em; }
      header p { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
      li { background: var(--card); border: 1px solid var(--border); border-left: 3px solid var(--red); border-radius: 10px; padding: 12px 14px; overflow: hidden; }
      .loc { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--muted); margin-bottom: 4px; word-break: break-all; }
      .msg { font-weight: 500; white-space: pre-wrap; word-break: break-word; }
      .code { margin: 10px 0 0; padding: 8px 10px; background: var(--code); border-radius: 6px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-x: auto; white-space: pre; }
      .ln { color: var(--muted); user-select: none; margin-right: 12px; }
      .more { color: var(--muted); margin: 12px 2px 0; }
    </style>
    <script>window.__YASA_BUILD_ERRORS__ = ${escapeInlineScript(escapeInlineJson(JSON.stringify(payload)))};</script>
    <script data-yasa="bridge">${escapeInlineScript(runtimeBridgeScript(appOrigin))}</script>
  </head>
  <body>
    <main data-yasa-build-error>
      <header>
        <div class="badge" aria-hidden="true">!</div>
        <div>
          <h1>Build failed</h1>
          <p>${count} ${count === 1 ? 'error' : 'errors'} — fix ${count === 1 ? 'it' : 'them'} to see the preview.</p>
        </div>
      </header>
      <ul>
        ${items}
      </ul>
      ${more}
    </main>
  </body>
</html>
`;
}
