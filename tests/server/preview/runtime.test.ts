import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { runtimeBridgeScript } from '../../../server/preview/runtime';
import { APP_ORIGIN } from './fixture';

type Listener = (event: Record<string, unknown>) => void;

/** A very small fake browser, just enough to execute the bridge and observe its protocol behaviour. */
function createEnv(opts: { framed?: boolean; ancestorOrigins?: string[] | null; buildErrors?: unknown[]; rootChildren?: number } = {}) {
  const framed = opts.framed ?? true;
  const posted: Array<{ msg: Record<string, any>; target: string }> = [];
  const listeners = new Map<string, Listener[]>();
  const docListeners = new Map<string, Listener[]>();
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const consoleCalls: Array<{ level: string; args: unknown[] }> = [];
  const parent = { postMessage: (msg: Record<string, any>, target: string) => posted.push({ msg: structuredClone(msg), target }) };
  const location = { pathname: '/', search: '', hash: '', reloaded: 0, reload() { this.reloaded++; }, ancestorOrigins: undefined as unknown };
  if (opts.ancestorOrigins !== null) location.ancestorOrigins = opts.ancestorOrigins ?? (framed ? [APP_ORIGIN] : []);
  const root = {
    id: 'root',
    textContent: '',
    get firstElementChild() { return (opts.rootChildren ?? 0) > 0 ? { nextElementSibling: null } : null; },
  };
  const history = {
    calls: [] as string[],
    pushState(_s: unknown, _t: string, url: string) { this.calls.push(`push:${url}`); setUrl(url); },
    replaceState(_s: unknown, _t: string, url: string) { this.calls.push(`replace:${url}`); setUrl(url); },
  };
  function setUrl(url: string) {
    const u = new URL(url, 'http://pv-test.localhost:3000');
    location.pathname = u.pathname;
    location.search = u.search;
    location.hash = u.hash;
  }
  const fakeConsole: Record<string, (...a: unknown[]) => void> = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) fakeConsole[level] = (...args: unknown[]) => consoleCalls.push({ level, args });

  const window: Record<string, any> = {
    location,
    history,
    console: fakeConsole,
    innerWidth: 800,
    innerHeight: 600,
    addEventListener(type: string, fn: Listener) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    removeEventListener(type: string, fn: Listener) { listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)); },
    dispatchEvent(ev: { type: string }) { for (const fn of listeners.get(ev.type) ?? []) fn(ev as Record<string, unknown>); return true; },
    __YASA_BUILD_ERRORS__: opts.buildErrors,
  };
  window.parent = framed ? parent : window;
  window.window = window;
  const document = {
    readyState: 'loading',
    documentElement: { appendChild() {} },
    body: {},
    head: { appendChild() {} },
    addEventListener(type: string, fn: Listener) { docListeners.set(type, [...(docListeners.get(type) ?? []), fn]); },
    getElementById: (id: string) => (id === 'root' ? root : null),
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {}, parentNode: null }),
  };
  class PopStateEvent { type: string; state: unknown; constructor(type: string, init?: { state?: unknown }) { this.type = type; this.state = init?.state; } }
  const context = vm.createContext({
    window,
    document,
    console: fakeConsole,
    setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; },
    PopStateEvent,
    Date,
    JSON,
    Object,
    Array,
    Error,
    RegExp,
    Map,
    Set,
    String,
    Math,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
  });

  return {
    posted,
    timers,
    consoleCalls,
    location,
    history,
    window,
    parent,
    run(origin = APP_ORIGIN) { vm.runInContext(runtimeBridgeScript(origin), context); },
    fire(type: string, event: Record<string, unknown> = {}) { for (const fn of listeners.get(type) ?? []) fn({ type, ...event }); },
    fireDoc(type: string) { for (const fn of docListeners.get(type) ?? []) fn({ type }); },
    fromParent(data: unknown, origin = APP_ORIGIN, source: unknown = parent) { for (const fn of listeners.get('message') ?? []) fn({ data, origin, source }); },
    messages(type?: string) { return posted.map((p) => p.msg).filter((m) => !type || m.type === type); },
    /** Fires the blank-page check timer (4 s after DOMContentLoaded). */
    blankCheck() { const t = timers.find((x) => x.ms === 4000); if (!t) throw new Error('blank-page check is not scheduled'); t.fn(); },
    /** Fires the fallback ready timer (slow CDN: the app module has not executed yet). */
    fallbackReady() { const t = timers.find((x) => x.ms === 2500); if (!t) throw new Error('fallback ready is not scheduled'); t.fn(); },
  };
}

describe('runtimeBridgeScript', () => {
  it('is syntactically valid, dependency-free JavaScript', () => {
    const src = runtimeBridgeScript(APP_ORIGIN);
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('["http://localhost:3000"]');
    expect(src).not.toMatch(/\bimport\b|\brequire\(/);
    expect(src).not.toContain('</script');
    expect(src).not.toContain('__YASA_ORIGINS__');
    expect(src).toContain("'yasa-preview'");
    expect(src).toContain("'yasa-parent'");
    expect(src).toContain('__reactFiber$');
    expect(src).toContain('The app rendered a blank page');
  });

  it('normalizes and sanitizes origins', () => {
    expect(runtimeBridgeScript('http://localhost:3000/some/path?x=1')).toContain('["http://localhost:3000"]');
    expect(runtimeBridgeScript('https://app.example.com, http://localhost:5173')).toContain('["https://app.example.com","http://localhost:5173"]');
    expect(runtimeBridgeScript('not a url')).toContain('var ORIGINS = [];');
    const evil = runtimeBridgeScript('http://x"];alert(1);["</script>');
    expect(() => new Function(evil)).not.toThrow();
    expect(evil).not.toContain('alert(1)');
    expect(evil).not.toContain('</script>');
  });

  it('posts ready on DOMContentLoaded with the current path, only to the app origin', () => {
    const env = createEnv();
    env.location.pathname = '/pricing';
    env.location.search = '?a=1';
    env.run();
    expect(env.posted).toHaveLength(0);
    env.fireDoc('DOMContentLoaded');
    env.fireDoc('DOMContentLoaded');
    expect(env.posted).toEqual([{ msg: { source: 'yasa-preview', type: 'ready', path: '/pricing?a=1' }, target: APP_ORIGIN }]);
    // fallback-ready timer (armed at start) + blank-page check (armed when the app module has executed)
    expect(env.timers.map((t) => t.ms)).toEqual([2500, 4000]);
  });

  it('does not break and posts nothing when there is no parent (opened in a new tab)', () => {
    const env = createEnv({ framed: false });
    env.run();
    env.fireDoc('DOMContentLoaded');
    env.window.console.error('boom', new Error('x'));
    env.window.history.pushState(null, '', '/a');
    env.fire('error', { message: 'Uncaught', error: new Error('x'), target: env.window });
    env.fromParent({ source: 'yasa-parent', type: 'reload' });
    for (const t of env.timers) t.fn();
    expect(env.posted).toHaveLength(0);
    expect(env.location.reloaded).toBe(0);
    expect(env.consoleCalls).toHaveLength(1);
  });

  it('posts nothing when framed by a foreign origin', () => {
    const env = createEnv({ ancestorOrigins: ['https://evil.example'] });
    env.run();
    env.fireDoc('DOMContentLoaded');
    env.window.console.log('secret');
    expect(env.posted).toHaveLength(0);
  });

  it('falls back to the allowed origins when ancestorOrigins is unavailable (Firefox)', () => {
    const env = createEnv({ ancestorOrigins: null });
    env.run('http://localhost:3000 http://localhost:5173');
    env.fireDoc('DOMContentLoaded');
    expect(env.posted.map((p) => p.target)).toEqual(['http://localhost:3000', 'http://localhost:5173']);
  });

  it('wraps console.* with safe serialisation (≤ 2 KB per argument) and still calls the original', () => {
    const env = createEnv();
    env.run();
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    env.window.console.log('hello', 42, { x: [1, 2, { y: null }] }, circular, undefined, () => 1, 'z'.repeat(5000));
    env.window.console.warn('%s has %d items%c!', 'cart', 3, 'color:red', 'extra');
    env.window.console.debug(Symbol('s'), 10n);
    const entries = env.messages('console').map((m) => m.entry);
    expect(entries).toHaveLength(3);
    expect(entries[0].level).toBe('log');
    expect(entries[0].args.slice(0, 6)).toEqual(['hello', '42', '{"x":[1,2,{"y":null}]}', '{"a":1,"self":"[Circular]"}', '[undefined]', '[Function]']);
    expect(entries[0].args[6].length).toBe(2048);
    expect(typeof entries[0].timestamp).toBe('number');
    expect(entries[1]).toMatchObject({ level: 'warn', args: ['cart has 3 items!', 'extra'] });
    expect(entries[2].args).toEqual(['Symbol(s)', '10n']);
    for (const e of entries) for (const a of e.args) expect(typeof a).toBe('string');
    expect(env.consoleCalls.map((c) => c.level)).toEqual(['log', 'warn', 'debug']);
    expect(env.consoleCalls[0]?.args[0]).toBe('hello');
    // console.log is not an error
    expect(env.messages('error')).toHaveLength(0);
  });

  it('reports console.error as a console-kind error with the stack of an Error argument', () => {
    const env = createEnv();
    env.run();
    const err = new Error('render failed');
    env.window.console.error('The above error occurred in <App>', err);
    const errors = env.messages('error').map((m) => m.error);
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe('console');
    expect(errors[0].message).toContain('The above error occurred in <App>');
    expect(errors[0].message).toContain('render failed');
    expect(errors[0].stack).toContain('render failed');
    expect(errors[0]).toMatchObject({ source: null, line: null, column: null });
  });

  it('throttles console floods', () => {
    const env = createEnv();
    env.run();
    for (let i = 0; i < 500; i++) env.window.console.log('spam', i);
    const entries = env.messages('console');
    expect(entries.length).toBe(101);
    expect(entries[100]?.entry.args[0]).toContain('throttled');
    expect(env.consoleCalls).toHaveLength(500);
  });

  it('reports runtime errors, promise rejections and failed resources', () => {
    const env = createEnv();
    env.run();
    const err = new TypeError('x is not a function');
    env.fire('error', { message: 'Uncaught TypeError: x is not a function', error: err, filename: 'http://pv/app.js', lineno: 12, colno: 7, target: env.window });
    env.fire('unhandledrejection', { reason: new Error('fetch failed') });
    env.fire('unhandledrejection', { reason: { code: 42 } });
    env.fire('error', { target: { nodeType: 1, tagName: 'IMG', src: 'https://images.example/missing.png' } });
    env.fire('error', { target: { nodeType: 1, tagName: 'LINK', href: 'https://cdn.example/x.css' } });
    env.fire('error', { target: { nodeType: 1, tagName: 'SCRIPT', src: '' } });
    const errors = env.messages('error').map((m) => m.error);
    expect(errors.map((e) => e.kind)).toEqual(['runtime', 'promise', 'promise', 'resource', 'resource', 'runtime']);
    expect(errors[0]).toMatchObject({ message: 'Uncaught TypeError: x is not a function', source: 'http://pv/app.js', line: 12, column: 7 });
    expect(errors[0].stack).toContain('x is not a function');
    expect(errors[1].message).toBe('Unhandled promise rejection: Error: fetch failed');
    expect(errors[2].message).toBe('Unhandled promise rejection: {"code":42}');
    expect(errors[3]).toMatchObject({ message: 'Failed to load <img>: https://images.example/missing.png', source: 'https://images.example/missing.png' });
    expect(errors[4].message).toContain('<link>');
    expect(errors[5].message).toContain('module imported by the app failed to load');
    for (const e of errors) expect(typeof e.timestamp).toBe('number');
  });

  it('caps the number of reported errors and drops immediate duplicates', () => {
    const env = createEnv();
    env.run();
    for (let i = 0; i < 5; i++) env.fire('error', { message: 'same', target: env.window });
    expect(env.messages('error')).toHaveLength(1);
    for (let i = 0; i < 200; i++) env.fire('error', { message: `err ${i}`, target: env.window });
    expect(env.messages('error')).toHaveLength(50);
  });

  it('reports navigation through pushState / replaceState / popstate', () => {
    const env = createEnv();
    env.run();
    env.fireDoc('DOMContentLoaded');
    env.window.history.pushState(null, '', '/about');
    env.window.history.pushState(null, '', '/about'); // unchanged → no duplicate
    env.window.history.replaceState(null, '', '/about?tab=2#x');
    env.location.pathname = '/';
    env.location.search = '';
    env.location.hash = '';
    env.fire('popstate');
    expect(env.messages('navigate').map((m) => m.path)).toEqual(['/about', '/about?tab=2#x', '/']);
    expect(env.history.calls).toEqual(['push:/about', 'push:/about', 'replace:/about?tab=2#x']);
  });

  it('obeys navigate and reload commands from the app origin only', () => {
    const env = createEnv();
    env.run();
    env.fireDoc('DOMContentLoaded');
    let pops = 0;
    env.window.addEventListener('popstate', () => { pops++; });

    env.fromParent({ source: 'yasa-parent', type: 'navigate', path: '/pricing' }, 'https://evil.example');
    env.fromParent({ source: 'yasa-parent', type: 'navigate', path: '/pricing' }, APP_ORIGIN, { other: 'window' });
    env.fromParent({ source: 'someone-else', type: 'navigate', path: '/pricing' });
    env.fromParent({ source: 'yasa-parent', type: 'navigate', path: '//evil.example/x' });
    env.fromParent({ source: 'yasa-parent', type: 'navigate', path: 'https://evil.example/' });
    env.fromParent({ source: 'yasa-parent', type: 'reload' }, 'https://evil.example');
    env.fromParent('garbage');
    env.fromParent(null);
    expect(env.history.calls).toEqual([]);
    expect(env.location.reloaded).toBe(0);
    expect(pops).toBe(0);

    env.fromParent({ source: 'yasa-parent', type: 'navigate', path: '/pricing' });
    expect(env.history.calls).toEqual(['push:/pricing']);
    expect(pops).toBe(1);
    expect(env.messages('navigate').map((m) => m.path)).toEqual(['/pricing']);

    env.fromParent({ source: 'yasa-parent', type: 'reload' });
    expect(env.location.reloaded).toBe(1);
  });

  it('detects a blank page 4 s after ready, unless something rendered or a fatal error was posted', () => {
    const blank = createEnv();
    blank.run();
    blank.fireDoc('DOMContentLoaded');
    blank.blankCheck();
    expect(blank.messages('error').map((m) => m.error)).toMatchObject([{ kind: 'runtime', message: 'The app rendered a blank page' }]);

    const rendered = createEnv({ rootChildren: 1 });
    rendered.run();
    rendered.fireDoc('DOMContentLoaded');
    rendered.blankCheck();
    expect(rendered.messages('error')).toHaveLength(0);

    const crashed = createEnv();
    crashed.run();
    crashed.fireDoc('DOMContentLoaded');
    crashed.fire('error', { message: 'boom', target: crashed.window });
    crashed.blankCheck();
    expect(crashed.messages('error').map((m) => m.error.message)).toEqual(['boom']);

    // a console-kind error (e.g. a React warning) does not hide a blank page
    const warned = createEnv();
    warned.run();
    warned.fireDoc('DOMContentLoaded');
    warned.window.console.error('Warning: something');
    warned.blankCheck();
    expect(warned.messages('error').map((m) => m.error.kind)).toEqual(['console', 'runtime']);
  });

  it('reports build errors handed over by the error page', () => {
    const env = createEnv({ buildErrors: [{ message: 'src/App.tsx:3:5: Unexpected token', file: 'src/App.tsx', line: 3, column: 5 }, { message: 'second' }] });
    env.run();
    env.fireDoc('DOMContentLoaded');
    const msgs = env.messages();
    expect(msgs[0]).toMatchObject({ type: 'ready' });
    expect(msgs.slice(1).map((m) => m.error)).toMatchObject([
      { kind: 'build', message: 'src/App.tsx:3:5: Unexpected token', source: 'src/App.tsx', line: 3, column: 5 },
      { kind: 'build', message: 'second', source: null, line: null, column: null },
    ]);
    env.blankCheck();
    expect(env.messages('error')).toHaveLength(2);
  });

  it('posts ready after 2.5 s even when the app modules are still loading, and checks for a blank page only after they ran', () => {
    const env = createEnv();
    env.run();
    expect(env.timers.map((t) => t.ms)).toEqual([2500]);
    env.fallbackReady();
    expect(env.messages().map((m) => m.type)).toEqual(['ready']);
    // no blank-page verdict while the bundle has not executed
    expect(() => env.blankCheck()).toThrow('not scheduled');
    env.fireDoc('DOMContentLoaded');
    expect(env.messages('ready')).toHaveLength(1);
    env.blankCheck();
    expect(env.messages('error').map((m) => m.error.message)).toEqual(['The app rendered a blank page']);
    // and the other way round: the fallback timer is a no-op once ready was sent
    const fast = createEnv({ rootChildren: 1 });
    fast.run();
    fast.fireDoc('DOMContentLoaded');
    fast.fallbackReady();
    fast.blankCheck();
    expect(fast.messages().map((m) => m.type)).toEqual(['ready']);
  });

  it('runs only once per page', () => {
    const env = createEnv();
    env.run();
    env.run();
    env.fireDoc('DOMContentLoaded');
    expect(env.messages('ready')).toHaveLength(1);
  });
});
