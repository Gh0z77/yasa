// Undefined-reference validation.
//
// esbuild bundles `{items.map((p) => <Card className={cn(...)} />)}` happily even when `cn` or `Card` was never
// imported: nothing is type-checked, so the mistake only shows in the browser as a ReferenceError and a blank
// page. Generated code makes this mistake often enough (a forgotten icon, hook or helper import) that it is worth
// catching at build time, where the agent can repair it.
//
// The check is deliberately conservative: a name counts as defined if it is declared ANYWHERE in the file
// (scopes are flattened) or is a known global. That can miss a real bug, but it does not invent one.
import * as esbuild from 'esbuild';
import { parse, type Node } from 'acorn';
import { ancestor } from 'acorn-walk';
import type { BuildErrorInfo } from '../../shared/types';
import type { ValidateSource } from './validate-imports';

const SCRIPT = /\.(tsx?|jsx?|mts|mjs)$/;
const MAX_ERRORS = 12;

/** Browser globals that are not also Node globals. */
const BROWSER_GLOBALS = [
  'window', 'document', 'navigator', 'location', 'history', 'screen', 'localStorage', 'sessionStorage', 'indexedDB',
  'alert', 'confirm', 'prompt', 'open', 'close', 'print', 'focus', 'blur', 'scroll', 'scrollTo', 'scrollBy',
  'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset',
  'devicePixelRatio', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  'getComputedStyle', 'matchMedia', 'getSelection', 'postMessage', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'self', 'top', 'parent', 'frames', 'origin', 'name', 'status', 'caches', 'visualViewport',
  'speechSynthesis', 'Image', 'Audio', 'Option', 'Notification', 'FileReader', 'FileList', 'File', 'DataTransfer',
  'XMLHttpRequest', 'DOMParser', 'XMLSerializer', 'Node', 'NodeList', 'Element', 'Document', 'DocumentFragment',
  'Range', 'Selection', 'Text', 'Comment', 'ShadowRoot', 'Window', 'Storage', 'Touch', 'TouchList', 'Path2D',
  'ImageData', 'ImageBitmap', 'OffscreenCanvas', 'CanvasGradient', 'CanvasPattern', 'FontFace', 'Worker',
  'SharedWorker', 'ServiceWorker', 'IntersectionObserverEntry', 'ResizeObserverEntry', 'MutationRecord',
  'ClipboardItem', 'Geolocation', 'Animation', 'KeyframeEffect', 'createImageBitmap', 'reportError', 'arguments',
  'SpeechSynthesisUtterance', 'SpeechRecognition', 'webkitSpeechRecognition', 'webkitAudioContext', 'AudioContext',
];

const GLOBALS = new Set<string>([...Object.getOwnPropertyNames(globalThis), ...BROWSER_GLOBALS]);
/** Families of DOM interfaces that would be pointless to enumerate. */
const GLOBAL_FAMILY = /^(HTML|SVG|CSS|DOM|RTC|Media|Audio|IDB|GPU|WebGL|Web|XR|USB|Canvas|Performance|Payment|Speech|Gamepad)[A-Z0-9]|(Event|Observer|Element|List|Map|Collection)$/;

function isGlobal(name: string): boolean {
  return GLOBALS.has(name) || GLOBAL_FAMILY.test(name);
}

type AnyNode = Node & Record<string, unknown>;

/** Adds every name bound by a pattern (`a`, `{ a, b: [c] }`, `...rest`, `a = 1`). */
function bind(pattern: unknown, names: Set<string>): void {
  const node = pattern as AnyNode | null;
  if (!node) return;
  switch (node.type) {
    case 'Identifier':
      names.add(node.name as string);
      break;
    case 'ObjectPattern':
      for (const prop of node.properties as AnyNode[]) bind(prop.type === 'RestElement' ? prop.argument : prop.value, names);
      break;
    case 'ArrayPattern':
      for (const element of node.elements as unknown[]) bind(element, names);
      break;
    case 'RestElement':
      bind(node.argument, names);
      break;
    case 'AssignmentPattern':
      bind(node.left, names);
      break;
    default:
      break;
  }
}

function lineOf(source: string, name: string): { line: number; lineText: string } | null {
  const match = new RegExp(`(?<![\\w$.])${name.replace(/[$]/g, '\\$')}(?![\\w$])`).exec(source);
  if (!match) return null;
  const line = source.slice(0, match.index).split('\n').length;
  return { line, lineText: (source.split('\n')[line - 1] ?? '').trim().slice(0, 200) };
}

/** Names that are used in one file but neither declared in it nor known globals. */
export function undefinedReferences(code: string): string[] {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const declared = new Set<string>();
  const used = new Map<string, number>();

  const functionLike = (node: AnyNode) => {
    if (node.id) bind(node.id, declared);
    for (const param of node.params as unknown[]) bind(param, declared);
  };
  ancestor(ast, {
    ImportDeclaration(node) {
      for (const spec of (node as unknown as AnyNode).specifiers as AnyNode[]) bind(spec.local, declared);
    },
    VariableDeclarator(node) {
      bind((node as unknown as AnyNode).id, declared);
    },
    FunctionDeclaration: (node) => functionLike(node as unknown as AnyNode),
    FunctionExpression: (node) => functionLike(node as unknown as AnyNode),
    ArrowFunctionExpression: (node) => functionLike(node as unknown as AnyNode),
    ClassDeclaration(node) {
      bind((node as unknown as AnyNode).id, declared);
    },
    ClassExpression(node) {
      bind((node as unknown as AnyNode).id, declared);
    },
    CatchClause(node) {
      bind((node as unknown as AnyNode).param, declared);
    },
    Identifier(node, _state, ancestors) {
      const parent = ancestors[ancestors.length - 2] as AnyNode | undefined;
      // `typeof maybeMissing` is a legitimate way to probe for a global.
      if (parent?.type === 'UnaryExpression' && parent.operator === 'typeof') return;
      const name = (node as unknown as AnyNode).name as string;
      if (!used.has(name)) used.set(name, node.start);
    },
  });

  return [...used.keys()].filter((name) => !declared.has(name) && !isGlobal(name));
}

/**
 * Checks the bundled source files for names that are used without being imported or defined. Files that do not
 * parse are skipped: syntax errors are esbuild's to report.
 */
export async function validateReferences(sources: ValidateSource[]): Promise<BuildErrorInfo[]> {
  const errors: BuildErrorInfo[] = [];
  for (const source of sources) {
    if (!SCRIPT.test(source.path) || source.path.endsWith('.d.ts')) continue;
    let missing: string[];
    try {
      const loader = source.path.endsWith('x') ? (source.path.endsWith('.tsx') ? 'tsx' : 'jsx') : source.path.endsWith('.ts') || source.path.endsWith('.mts') ? 'ts' : 'js';
      const { code } = await esbuild.transform(source.content, { loader, jsx: 'automatic', format: 'esm', target: 'es2022' });
      missing = undefinedReferences(code);
    } catch {
      continue;
    }
    for (const name of missing) {
      const where = lineOf(source.content, name);
      // A name that only exists in the transformed output was introduced by the compiler, not by the author.
      if (!where) continue;
      errors.push({
        file: source.path,
        line: where.line,
        column: null,
        message: `"${name}" is used but it is not imported or defined in this file. Add the missing import (or definition).`,
        lineText: where.lineText,
      });
      if (errors.length >= MAX_ERRORS) return errors;
    }
  }
  return errors;
}
