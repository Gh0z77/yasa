// Runtime bridge injected into every draft preview (SPEC §9.5 + §15.5).
//
// The returned string is plain, dependency-free JavaScript (classic script, no modules). It talks to the builder
// with the postMessage protocol of shared/types.ts:
//   iframe → parent: PreviewToParentMessage  { source: 'yasa-preview', type: 'ready' | 'navigate' | 'console' | 'error' | 'element-selected' }
//   parent → iframe: ParentToPreviewMessage  { source: 'yasa-parent',  type: 'select-mode' | 'navigate' | 'reload' }
// Messages are posted only to — and accepted only from — the builder origin(s) passed to runtimeBridgeScript().
// When the page is not framed (opened in a new tab) the bridge stays completely passive towards a parent.

/** Bumped whenever the bridge source changes in a way that should invalidate cached builds. */
export const RUNTIME_BRIDGE_VERSION = 2;

// NOTE: String.raw — the text below is JavaScript source. It must not contain backticks or "${".
const BRIDGE_SOURCE = String.raw`
(function () {
  'use strict';
  if (window.__YASA_BRIDGE__) return;
  window.__YASA_BRIDGE__ = true;

  var ORIGINS = __YASA_ORIGINS__;
  var MAX_ARG = 2048;
  var MAX_ERRORS = 50;
  var MAX_CONSOLE_PER_SEC = 100;

  var parentWin = null;
  try {
    if (window.parent && window.parent !== window) parentWin = window.parent;
  } catch (e) { parentWin = null; }

  // Post only to the origin that really frames us when the browser tells us (Chromium/WebKit), else to all allowed.
  var targets = ORIGINS;
  try {
    var anc = window.location.ancestorOrigins;
    if (anc && anc.length) {
      var direct = anc[0];
      targets = ORIGINS.indexOf(direct) !== -1 ? [direct] : [];
    }
  } catch (e) {}

  function post(msg) {
    if (!parentWin) return;
    msg.source = 'yasa-preview';
    for (var i = 0; i < targets.length; i++) {
      try { parentWin.postMessage(msg, targets[i]); } catch (e) {}
    }
  }

  function currentPath() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function truncate(s, max) {
    s = String(s);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  // ---------------------------------------------------------------- safe serialisation
  function describeElement(el) {
    try {
      var s = '<' + String(el.tagName || 'node').toLowerCase();
      if (el.id) s += ' id="' + el.id + '"';
      var cls = typeof el.getAttribute === 'function' ? el.getAttribute('class') : '';
      if (cls) s += ' class="' + truncate(cls, 80) + '"';
      return s + '>';
    } catch (e) { return '[Element]'; }
  }

  function errorToString(err) {
    try {
      var name = err.name || 'Error';
      var message = err.message !== undefined ? String(err.message) : '';
      var head = message ? name + ': ' + message : String(name);
      var stack = typeof err.stack === 'string' ? err.stack : '';
      if (stack) return stack.indexOf(message) !== -1 && message ? stack : head + '\n' + stack;
      return head;
    } catch (e) { return 'Error'; }
  }

  function isErrorLike(v) {
    return !!v && typeof v === 'object' && (v instanceof Error || (typeof v.message === 'string' && typeof v.stack === 'string'));
  }

  function toPlain(value, depth, seen) {
    var t = typeof value;
    if (value === null || t === 'boolean' || t === 'number' || t === 'string') {
      if (t === 'number' && !isFinite(value)) return String(value);
      if (t === 'string' && value.length > MAX_ARG) return value.slice(0, MAX_ARG);
      return value;
    }
    if (t === 'undefined') return '[undefined]';
    if (t === 'function') return '[Function' + (value.name ? ' ' + value.name : '') + ']';
    if (t === 'symbol' || t === 'bigint') { try { return String(value) + (t === 'bigint' ? 'n' : ''); } catch (e) { return '[' + t + ']'; } }
    if (isErrorLike(value)) return errorToString(value);
    if (typeof Node !== 'undefined' && value instanceof Node) return describeElement(value);
    if (typeof Window !== 'undefined' && value instanceof Window) return '[Window]';
    if (value instanceof Date) { try { return value.toISOString(); } catch (e) { return 'Invalid Date'; } }
    if (value instanceof RegExp) return String(value);
    if (seen.indexOf(value) !== -1) return '[Circular]';
    if (depth >= 4) return Array.isArray(value) ? '[Array]' : '[Object]';
    seen.push(value);
    var out;
    try {
      if (Array.isArray(value)) {
        out = [];
        for (var i = 0; i < value.length && i < 50; i++) out.push(toPlain(value[i], depth + 1, seen));
        if (value.length > 50) out.push('… ' + (value.length - 50) + ' more');
      } else if (typeof Map !== 'undefined' && value instanceof Map) {
        out = { '[Map]': toPlain(Array.from(value.entries()).slice(0, 50), depth + 1, seen) };
      } else if (typeof Set !== 'undefined' && value instanceof Set) {
        out = { '[Set]': toPlain(Array.from(value.values()).slice(0, 50), depth + 1, seen) };
      } else {
        out = {};
        var keys = Object.keys(value);
        for (var k = 0; k < keys.length && k < 50; k++) {
          var v;
          try { v = value[keys[k]]; } catch (e) { v = '[Throws]'; }
          out[keys[k]] = toPlain(v, depth + 1, seen);
        }
        if (keys.length > 50) out['…'] = (keys.length - 50) + ' more keys';
        if (value.$$typeof && typeof value.$$typeof === 'symbol') out = '[React element]';
      }
    } catch (e) { out = '[Unserializable]'; }
    seen.pop();
    return out;
  }

  function serialize(value) {
    var s;
    try {
      if (typeof value === 'string') s = value;
      else {
        var plain = toPlain(value, 0, []);
        s = typeof plain === 'string' ? plain : JSON.stringify(plain);
        if (s === undefined) s = String(value);
      }
    } catch (e) {
      try { s = String(value); } catch (e2) { s = '[Unserializable]'; }
    }
    return truncate(s, MAX_ARG);
  }

  // console.log('%s is %d', 'x', 1) → ['x is 1']
  function formatArgs(args) {
    var list = Array.prototype.slice.call(args, 0, 20);
    if (typeof list[0] === 'string' && list.length > 1 && /%[sdifoOc]/.test(list[0])) {
      var idx = 1;
      var first = list[0].replace(/%([sdifoOc%])/g, function (m, c) {
        if (c === '%') return '%';
        if (idx >= list.length) return m;
        var a = list[idx++];
        if (c === 'c') return '';
        if (c === 'd' || c === 'i') { var n = parseInt(a, 10); return isNaN(n) ? 'NaN' : String(n); }
        if (c === 'f') return String(parseFloat(a));
        return serialize(a);
      });
      list = [first].concat(list.slice(idx));
    }
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(serialize(list[i]));
    return out;
  }

  // ---------------------------------------------------------------- errors
  var errorCount = 0;
  var fatalPosted = false;
  var lastErrorKey = '';
  var lastErrorAt = 0;

  function postError(kind, message, stack, source, line, column) {
    var now = Date.now();
    message = truncate(message || 'Unknown error', 4000);
    var key = kind + '|' + message;
    if (key === lastErrorKey && now - lastErrorAt < 1000) return;
    lastErrorKey = key;
    lastErrorAt = now;
    if (kind === 'runtime' || kind === 'promise' || kind === 'build') fatalPosted = true;
    if (errorCount >= MAX_ERRORS) return;
    errorCount++;
    post({
      type: 'error',
      error: {
        kind: kind,
        message: message,
        stack: stack ? truncate(stack, 8000) : null,
        source: source ? String(source) : null,
        line: typeof line === 'number' && isFinite(line) ? line : null,
        column: typeof column === 'number' && isFinite(column) ? column : null,
        timestamp: now
      }
    });
  }

  window.addEventListener('error', function (event) {
    var target = event.target;
    if (target && target !== window && target.nodeType === 1) {
      // Resource load failure (does not bubble — caught in the capture phase).
      var tag = String(target.tagName || '').toLowerCase();
      if (tag === 'img' || tag === 'script' || tag === 'link' || tag === 'video' || tag === 'audio' || tag === 'source' || tag === 'iframe') {
        var url = target.currentSrc || target.src || target.href || '';
        if (tag === 'script' && !url) {
          postError('runtime', 'A module imported by the app failed to load (check the package names and versions in package.json)', null, null, null, null);
        } else {
          postError('resource', 'Failed to load <' + tag + '>: ' + (url || '(no url)'), null, url || null, null, null);
        }
      }
      return;
    }
    var err = event.error;
    var message = event.message || (err && err.message) || 'Script error';
    if (err && err.name && message.indexOf(err.name) === -1 && err.message) message = err.name + ': ' + err.message;
    postError('runtime', message, err && typeof err.stack === 'string' ? err.stack : null, event.filename || null, event.lineno, event.colno);
  }, true);

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    var message;
    var stack = null;
    if (isErrorLike(reason)) {
      message = (reason.name ? reason.name + ': ' : '') + reason.message;
      stack = reason.stack || null;
    } else {
      message = serialize(reason);
    }
    postError('promise', 'Unhandled promise rejection: ' + message, stack, null, null, null);
  });

  // ---------------------------------------------------------------- console
  var consoleWindowStart = 0;
  var consoleInWindow = 0;
  var LEVELS = ['log', 'info', 'warn', 'error', 'debug'];

  function wrapConsole(level) {
    var original = window.console && window.console[level];
    if (typeof original !== 'function') return;
    window.console[level] = function () {
      try {
        var now = Date.now();
        if (now - consoleWindowStart > 1000) { consoleWindowStart = now; consoleInWindow = 0; }
        consoleInWindow++;
        if (consoleInWindow <= MAX_CONSOLE_PER_SEC) {
          var args = formatArgs(arguments);
          post({ type: 'console', entry: { level: level, args: args, timestamp: now } });
          if (level === 'error') {
            var stack = null;
            for (var i = 0; i < arguments.length; i++) {
              if (isErrorLike(arguments[i])) { stack = arguments[i].stack || null; break; }
            }
            postError('console', args.join(' '), stack, null, null, null);
          }
        } else if (consoleInWindow === MAX_CONSOLE_PER_SEC + 1) {
          post({ type: 'console', entry: { level: 'warn', args: ['[yasa] console output throttled (too many messages)'], timestamp: now } });
        }
      } catch (e) {}
      return original.apply(window.console, arguments);
    };
  }
  for (var li = 0; li < LEVELS.length; li++) wrapConsole(LEVELS[li]);

  // ---------------------------------------------------------------- navigation
  var lastPath = null;
  function notifyNavigate() {
    var p = currentPath();
    if (p === lastPath) return;
    lastPath = p;
    post({ type: 'navigate', path: p });
  }

  var nativePush = window.history.pushState;
  var nativeReplace = window.history.replaceState;
  function patchHistory(name, native) {
    if (typeof native !== 'function') return;
    window.history[name] = function () {
      var result = native.apply(window.history, arguments);
      try { notifyNavigate(); } catch (e) {}
      return result;
    };
  }
  patchHistory('pushState', nativePush);
  patchHistory('replaceState', nativeReplace);
  window.addEventListener('popstate', notifyNavigate);
  window.addEventListener('hashchange', notifyNavigate);

  // ---------------------------------------------------------------- element selection
  var selecting = false;
  var overlay = null;
  var label = null;
  var cursorStyle = null;
  var hovered = null;

  function reactComponents(el) {
    var names = [];
    try {
      var node = el;
      var fiber = null;
      while (node && !fiber) {
        var keys = Object.keys(node);
        for (var i = 0; i < keys.length; i++) {
          if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) { fiber = node[keys[i]]; break; }
        }
        node = node.parentElement;
      }
      var guard = 0;
      while (fiber && names.length < 5 && guard++ < 500) {
        var type = fiber.type;
        var name = null;
        if (typeof type === 'function') name = type.displayName || type.name || null;
        else if (type && typeof type === 'object') {
          // memo / forwardRef wrappers
          var inner = type.render || type.type;
          name = type.displayName || (inner && (inner.displayName || inner.name)) || null;
          if (!name && inner && typeof inner === 'object' && inner.render) name = inner.render.displayName || inner.render.name || null;
        }
        if (name && typeof name === 'string' && names[names.length - 1] !== name) names.push(name);
        fiber = fiber.return;
      }
    } catch (e) {}
    return names;
  }

  function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, function (c) { return '\\' + c; });
  }

  function isUnique(selector, el) {
    try {
      var found = document.querySelectorAll(selector);
      return found.length === 1 && found[0] === el;
    } catch (e) { return false; }
  }

  function uniqueSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el === document.documentElement) return 'html';
    if (el === document.body) return 'body';
    if (el.id && isUnique('#' + cssEscape(el.id), el)) return '#' + cssEscape(el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node === document.body) { parts.unshift('body'); break; }
      if (node !== el && node.id && isUnique('#' + cssEscape(node.id), node)) {
        parts.unshift('#' + cssEscape(node.id));
        break;
      }
      var tag = node.localName || String(node.tagName).toLowerCase();
      var segment = cssEscape(tag);
      var parent = node.parentElement;
      if (parent) {
        var sameTag = 0;
        var position = 0;
        for (var c = parent.firstElementChild; c; c = c.nextElementSibling) {
          if (c.localName === node.localName) {
            sameTag++;
            if (c === node) position = sameTag;
          }
        }
        if (sameTag > 1) segment += ':nth-of-type(' + position + ')';
      }
      parts.unshift(segment);
      var candidate = parts.join(' > ');
      if (isUnique(candidate, el)) return candidate;
      node = parent;
    }
    return parts.join(' > ');
  }

  function describeSelected(el) {
    var cls = '';
    try { cls = el.getAttribute('class') || ''; } catch (e) {}
    var text = '';
    try { text = (typeof el.innerText === 'string' ? el.innerText : el.textContent) || ''; } catch (e) {}
    text = text.replace(/\s+/g, ' ').trim();
    var html = '';
    try { html = el.outerHTML || ''; } catch (e) {}
    return {
      tagName: String(el.localName || el.tagName || '').toLowerCase(),
      id: el.id ? String(el.id) : null,
      className: cls,
      text: text.length > 300 ? text.slice(0, 300) : text,
      html: html.length > 1200 ? html.slice(0, 1200) : html,
      selector: uniqueSelector(el),
      components: reactComponents(el),
      path: currentPath()
    };
  }

  function isOwnNode(node) {
    return !!node && (node === overlay || node === label || node === cursorStyle);
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.setAttribute('data-yasa-overlay', '');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;' +
      'border:2px solid #6366f1;background:rgba(99,102,241,0.12);border-radius:3px;display:none;' +
      'top:0;left:0;width:0;height:0;margin:0;padding:0;transition:none;';
    label = document.createElement('div');
    label.setAttribute('data-yasa-overlay', '');
    label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;display:none;' +
      'font:600 11px/1.4 ui-sans-serif,system-ui,sans-serif;color:#fff;background:#6366f1;' +
      'padding:1px 6px;border-radius:3px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis;margin:0;';
    cursorStyle = document.createElement('style');
    cursorStyle.setAttribute('data-yasa-overlay', '');
    cursorStyle.textContent = '*, *::before, *::after { cursor: crosshair !important; }';
  }

  function positionOverlay() {
    if (!overlay || !label) return;
    if (!hovered || !hovered.isConnected) { overlay.style.display = 'none'; label.style.display = 'none'; return; }
    var r = hovered.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = r.top + 'px';
    overlay.style.left = r.left + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
    var comps = reactComponents(hovered);
    var tag = String(hovered.localName || '').toLowerCase();
    label.textContent = comps.length ? comps[0] + ' · ' + tag : tag;
    label.style.display = 'block';
    var top = r.top - 20;
    if (top < 2) top = Math.min(r.bottom + 2, window.innerHeight - 20);
    label.style.top = Math.max(top, 2) + 'px';
    label.style.left = Math.max(Math.min(r.left, window.innerWidth - 80), 2) + 'px';
  }

  function elementFromEvent(event) {
    var el = event.target;
    if (el && el.nodeType === 3) el = el.parentElement;
    if (!el || el.nodeType !== 1 || isOwnNode(el)) return null;
    if (el === document.documentElement) return document.body;
    return el;
  }

  function onMove(event) {
    var el = elementFromEvent(event);
    if (el && el !== hovered) { hovered = el; positionOverlay(); }
  }

  function swallow(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
  }

  function onClick(event) {
    swallow(event);
    var el = elementFromEvent(event) || hovered;
    if (!el) return;
    var info = describeSelected(el);
    setSelectMode(false);
    post({ type: 'element-selected', element: info });
  }

  function onKey(event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      swallow(event);
      setSelectMode(false);
      post({ type: 'select-mode-exited' });
    }
  }

  var SWALLOWED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick', 'contextmenu', 'submit', 'touchstart', 'touchend', 'dragstart'];

  function setSelectMode(enabled) {
    enabled = !!enabled;
    if (enabled === selecting) return;
    selecting = enabled;
    var i;
    if (enabled) {
      ensureOverlay();
      var host = document.documentElement;
      host.appendChild(overlay);
      host.appendChild(label);
      (document.head || host).appendChild(cursorStyle);
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseover', onMove, true);
      window.addEventListener('click', onClick, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', positionOverlay, true);
      window.addEventListener('resize', positionOverlay, true);
      for (i = 0; i < SWALLOWED.length; i++) window.addEventListener(SWALLOWED[i], swallow, { capture: true, passive: false });
    } else {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseover', onMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', positionOverlay, true);
      window.removeEventListener('resize', positionOverlay, true);
      for (i = 0; i < SWALLOWED.length; i++) window.removeEventListener(SWALLOWED[i], swallow, { capture: true });
      hovered = null;
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (label && label.parentNode) label.parentNode.removeChild(label);
      if (cursorStyle && cursorStyle.parentNode) cursorStyle.parentNode.removeChild(cursorStyle);
    }
  }

  // ---------------------------------------------------------------- parent → iframe commands
  window.addEventListener('message', function (event) {
    if (!parentWin || event.source !== parentWin) return;
    if (ORIGINS.indexOf(event.origin) === -1) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data.source !== 'yasa-parent') return;
    try {
      if (data.type === 'select-mode') {
        setSelectMode(data.enabled === true);
      } else if (data.type === 'navigate') {
        var path = data.path;
        if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/' || path.charAt(1) === '\\') return;
        if (path !== currentPath()) window.history.pushState(null, '', path);
        var ev;
        try { ev = new PopStateEvent('popstate', { state: null }); }
        catch (e) { ev = document.createEvent('Event'); ev.initEvent('popstate', false, false); }
        window.dispatchEvent(ev);
      } else if (data.type === 'reload') {
        window.location.reload();
      }
    } catch (e) {}
  });

  // ---------------------------------------------------------------- ready + blank page detection
  function reportBuildErrors() {
    var list = window.__YASA_BUILD_ERRORS__;
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var e = list[i] || {};
      // distinct messages must not be collapsed by the duplicate filter
      lastErrorKey = '';
      postError('build', e.message || 'Build failed', null, e.file || null, e.line, e.column);
    }
  }

  function checkBlank() {
    if (fatalPosted) return;
    var root = document.getElementById('root') || document.getElementById('app');
    if (!root) return;
    var hasElement = false;
    for (var c = root.firstElementChild; c; c = c.nextElementSibling) {
      if (!isOwnNode(c)) { hasElement = true; break; }
    }
    if (hasElement) return;
    if ((root.textContent || '').replace(/\s+/g, '') !== '') return;
    postError('runtime', 'The app rendered a blank page', null, null, null, null);
  }

  // "ready" = the preview document is alive. It is posted when the app module has executed (DOMContentLoaded —
  // module scripts are deferred, so this is after the bundle and all its CDN imports ran), but at the latest
  // READY_FALLBACK_MS after the bridge started: on a cold cache the npm modules can take many seconds to arrive
  // and the builder must not conclude that the preview failed to load.
  // The blank-page check always waits for the app to have executed: 4 s after DOMContentLoaded.
  var READY_FALLBACK_MS = 2500;
  var readySent = false;
  var domReady = false;
  function ready() {
    if (readySent) return;
    readySent = true;
    lastPath = currentPath();
    post({ type: 'ready', path: lastPath });
    reportBuildErrors();
  }
  function onDomReady() {
    if (domReady) return;
    domReady = true;
    ready();
    setTimeout(checkBlank, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady);
    window.addEventListener('load', onDomReady);
    setTimeout(ready, READY_FALLBACK_MS);
  } else {
    onDomReady();
  }
})();
`;

function normalizeOrigin(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    const origin = new URL(v).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Returns the runtime bridge as JavaScript source (to be inlined in a classic `<script>`).
 *
 * `appOrigin` is the origin of the builder that frames the preview (e.g. `http://localhost:3000`). Several
 * origins may be given separated by commas or whitespace (useful in development when the web app runs on the
 * Vite dev server); messages are only exchanged with these origins.
 */
export function runtimeBridgeScript(appOrigin: string): string {
  const origins: string[] = [];
  for (const part of String(appOrigin ?? '').split(/[\s,]+/)) {
    const o = normalizeOrigin(part);
    if (o && !origins.includes(o)) origins.push(o);
  }
  // JSON is valid JS; escape "<" so the script can never terminate its own <script> element.
  const literal = JSON.stringify(origins).replace(/</g, '\\u003c');
  return BRIDGE_SOURCE.replace('__YASA_ORIGINS__', () => literal).trim();
}
