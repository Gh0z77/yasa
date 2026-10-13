import { describe, expect, it } from 'vitest';
import {
  composeHtml,
  emojiIconDataUrl,
  errorPageHtml,
  escapeHtml,
  escapeInlineJson,
  escapeInlineScript,
  escapeInlineStyle,
  findEntryScript,
  findLocalStylesheets,
} from '../../../server/preview/html';
import { APP_ORIGIN } from './fixture';

const MAP = { imports: { react: 'https://esm.sh/react' } };

function compose(indexHtml: string | null, over: Partial<Parameters<typeof composeHtml>[0]> = {}): string {
  return composeHtml({ indexHtml, mode: 'preview', appOrigin: APP_ORIGIN, importMap: MAP, css: '.a{color:red}', cssLinks: [], js: 'console.log("app")', ...over });
}

describe('escaping helpers', () => {
  it('escapes HTML text and attributes', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('neutralises </script> and <!-- without changing what the script evaluates to', () => {
    const js = 'const a = "</script><SCRIPT>alert(1)</ScRiPt>"; const b = `<!-- ${a} -->`; const r = /<\\/script>/u; export { a, b, r };';
    const safe = escapeInlineScript(js);
    expect(safe).not.toMatch(/<\/script/i);
    expect(safe).not.toContain('<!--');
    const run = (code: string) => new Function(`${code.replace(/export \{[^}]*\};?/, '')}; return [a, b, String(r.test("</script>"))];`)() as string[];
    expect(run(safe)).toEqual(run(js));
    expect(run(safe)[0]).toBe('</script><SCRIPT>alert(1)</ScRiPt>');
  });

  it('escapes JSON and CSS for inline elements', () => {
    const json = escapeInlineJson(JSON.stringify({ a: '</script><b>', sep: String.fromCharCode(0x2028) }));
    expect(json).not.toContain('<');
    expect(json).not.toContain(String.fromCharCode(0x2028));
    expect(JSON.parse(json)).toEqual({ a: '</script><b>', sep: String.fromCharCode(0x2028) });
    expect(escapeInlineStyle('a::after{content:"</style><script>x</script>"}')).not.toMatch(/<\/style/i);
  });

  it('renders an emoji favicon as an SVG data URL', () => {
    const url = emojiIconDataUrl('🚀');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url.slice('data:image/svg+xml,'.length))).toContain('>🚀</text>');
    expect(decodeURIComponent(emojiIconDataUrl('<script>'))).toContain('&lt;script&gt;');
    expect(decodeURIComponent(emojiIconDataUrl(''))).toContain('</text>');
  });
});

describe('index.html scanning', () => {
  it('finds the module entry script regardless of attribute order and quoting', () => {
    expect(findEntryScript('<script type="module" src="/src/main.tsx"></script>')?.src).toBe('/src/main.tsx');
    expect(findEntryScript("<script src='./src/index.jsx' type='module' defer>\n</script >")?.src).toBe('./src/index.jsx');
    expect(findEntryScript('<script type=module src=/src/main.ts></script>')?.src).toBe('/src/main.ts');
    const html = '<body><!-- <script type="module" src="/src/old.tsx"></script> --><script type="module" src="https://cdn.example/x.js"></script><script src="/legacy.js"></script><script type="module" src="/src/real.tsx"></script></body>';
    const found = findEntryScript(html);
    expect(found?.src).toBe('/src/real.tsx');
    expect(html.slice(found?.start, found?.end)).toBe('<script type="module" src="/src/real.tsx"></script>');
    expect(findEntryScript('<script>inline()</script><script type="module">import "x"</script>')).toBeNull();
  });

  it('finds local stylesheet links only', () => {
    const html = '<link rel="stylesheet" href="/src/index.css"><link href="./a.css" rel="preload stylesheet"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel="icon" href="/favicon.svg"><!-- <link rel="stylesheet" href="/commented.css"> -->';
    expect(findLocalStylesheets(html).map((l) => l.href)).toEqual(['/src/index.css', './a.css']);
  });
});

describe('composeHtml', () => {
  const INDEX = `<!doctype html>
<html lang="uz">
  <head>
    <meta charset="UTF-8" />
    <title>Choyxona</title>
    <link rel="stylesheet" href="/src/index.css" />
    <link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet" />
  </head>
  <body class="antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
    <script>window.after = 1</script>
  </body>
</html>`;

  it('injects import map, bridge, links, style and bundle in a valid order', () => {
    const html = compose(INDEX, { cssLinks: ['https://cdn.jsdelivr.net/npm/leaflet/dist/leaflet.css?a=1&b=2'] });
    const order = ['<meta charset="UTF-8" />', '<script type="importmap">', '<script data-yasa="bridge">', '<title>Choyxona</title>', 'fonts.googleapis.com', '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet/dist/leaflet.css?a=1&amp;b=2" data-yasa="css" />', '<style data-yasa="app">.a{color:red}</style>', '</head>', '<body class="antialiased">', '<div id="root"></div>', '<script type="module" data-yasa="app">console.log("app")</script>', '<script>window.after = 1</script>', '</body>'];
    let last = -1;
    for (const needle of order) {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(last);
      last = i;
    }
    expect(html).toContain('<html lang="uz">');
    expect(html).not.toContain('/src/main.tsx');
    expect(html).not.toContain('href="/src/index.css"'); // compiled into the style block
    expect(html).not.toMatch(/<!--yasa:/);
    expect(JSON.parse(/<script type="importmap">(.*?)<\/script>/.exec(html)?.[1] ?? '')).toEqual(MAP);
  });

  it('omits the bridge in publish mode and adds missing meta tags', () => {
    const html = compose(INDEX, { mode: 'publish', project: { name: 'Choyxona "Navro\'z"', emoji: '🍵', description: 'Osh <va> choy' } });
    expect(html).not.toContain('data-yasa="bridge"');
    expect(html).not.toContain('__YASA_BRIDGE__');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0" />');
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,');
    expect(html).toContain('<meta name="description" content="Osh &lt;va&gt; choy" />');
    expect(html).toContain('<meta property="og:title" content="Choyxona &quot;Navro&#39;z&quot;" />');
    expect(html).toContain('<meta property="og:description" content="Osh &lt;va&gt; choy" />');
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html.match(/<title>/g)).toHaveLength(1);
    // without project info only the neutral tags are added
    const bare = compose(INDEX, { mode: 'publish' });
    expect(bare).toContain('<meta name="viewport"');
    expect(bare).toContain('og:type');
    expect(bare).not.toContain('og:title');
    expect(bare).not.toContain('rel="icon"');
  });

  it('adds a title in publish mode when the document has none', () => {
    const html = compose('<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>', {
      mode: 'publish',
      project: { name: 'My App', emoji: '🚀', description: '' },
    });
    expect(html).toContain('<title>My App</title>');
    expect(html).toContain('<meta charset="UTF-8" />');
    expect(html).not.toContain('name="description"');
  });

  it('copes with minimal or missing documents', () => {
    for (const input of [null, '', '<div id="root"></div>', '<body><div id="root"></div></body>', '<html><body><div id="root"></div></body></html>', '<head><title>x</title></head><div id="root"></div>']) {
      const html = compose(input);
      expect(html.toLowerCase().startsWith('<!doctype html>'), String(input)).toBe(true);
      expect(html.match(/<head\b/g), String(input)).toHaveLength(1);
      expect(html.match(/<\/head>/g), String(input)).toHaveLength(1);
      expect(html.match(/<body\b/g), String(input)).toHaveLength(1);
      const iMap = html.indexOf('<script type="importmap">');
      const iHeadEnd = html.indexOf('</head>');
      const iBundle = html.indexOf('<script type="module" data-yasa="app">');
      expect(iMap).toBeGreaterThan(html.indexOf('<head'));
      expect(iMap).toBeLessThan(iHeadEnd);
      expect(html.indexOf('<style data-yasa="app">')).toBeLessThan(iHeadEnd);
      expect(iBundle).toBeGreaterThan(html.indexOf('<body'));
      if (input && input.includes('id="root"')) expect(html.indexOf('<div id="root">')).toBeLessThan(iBundle);
    }
  });

  it('never lets bundle or CSS content break out of its element or hit replacement patterns', () => {
    const js = 'const s = "</script><img src=x onerror=alert(1)>$& $1 $` <!--yasa:bundle-slot--> <!-- c -->";';
    const css = '.x::after{content:"</style><script>alert(2)</script> $& <!--yasa:style-slot-->"}';
    const html = compose(INDEX, { js, css });
    const bundleStart = html.indexOf('<script type="module" data-yasa="app">');
    const bundleEnd = html.indexOf('</script>', bundleStart);
    const body = html.slice(bundleStart, bundleEnd);
    expect(body).toContain('onerror=alert(1)>$& $1 $`');
    expect(body).toContain('<\\/script>');
    const styleStart = html.indexOf('<style data-yasa="app">');
    const styleEnd = html.indexOf('</style>', styleStart);
    expect(html.slice(styleStart, styleEnd)).toContain('alert(2)');
    expect(html.slice(styleStart, styleEnd)).toContain('$&');
    // one app bundle, one app style, and the script after the entry is still there
    expect(html.match(/data-yasa="app"/g)).toHaveLength(2);
    expect(html).toContain('<script>window.after = 1</script>');
  });
});

describe('errorPageHtml', () => {
  const errors = [
    { file: 'src/App.tsx', line: 3, column: 17, message: 'Unexpected closing "div" tag <b>x</b>', lineText: '    <span>oops</div>;' },
    { file: null, line: null, column: null, message: 'Something else </script><script>alert(1)</script>', lineText: null },
  ];

  it('lists the errors safely and is styled', () => {
    const html = errorPageHtml(errors, APP_ORIGIN);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Build failed</title>');
    expect(html).toContain('<style>');
    expect(html).toContain('src/App.tsx:3:17');
    expect(html).toContain('Unexpected closing &quot;div&quot; tag &lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('&lt;span&gt;oops&lt;/div&gt;;');
    expect(html).toContain('2 errors');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<b>x</b>');
    expect(errorPageHtml([errors[0]!], APP_ORIGIN)).toContain('1 error ');
    expect(errorPageHtml([], APP_ORIGIN)).toContain('Build failed');
  });

  it('includes the runtime bridge and hands the errors to it as build errors', () => {
    const html = errorPageHtml(errors, APP_ORIGIN);
    const iData = html.indexOf('window.__YASA_BUILD_ERRORS__ = ');
    const iBridge = html.indexOf('<script data-yasa="bridge">');
    expect(iData).toBeGreaterThan(-1);
    expect(iBridge).toBeGreaterThan(iData);
    expect(html).toContain('["http://localhost:3000"]');
    expect(html).toContain("postError('build'");
    const literal = html.slice(iData + 'window.__YASA_BUILD_ERRORS__ = '.length, html.indexOf(';</script>', iData));
    const parsed = new Function(`return ${literal}`)() as Array<Record<string, unknown>>;
    expect(parsed).toEqual([
      { message: 'src/App.tsx:3:17: Unexpected closing "div" tag <b>x</b>', file: 'src/App.tsx', line: 3, column: 17 },
      { message: 'Something else </script><script>alert(1)</script>', file: null, line: null, column: null },
    ]);
    // every inline script of the page is syntactically valid
    for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) expect(() => new Function(m[1] ?? '')).not.toThrow();
  });
});
