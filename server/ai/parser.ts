// Incremental parser for the model output protocol (docs/SPEC.md §8.2, §15.1).
// Pure: no I/O. Feed arbitrary chunks with push(), then call finish().
import type { ActionKind, ChatQuestion } from '../../shared/types';

export interface EditBlock {
  search: string;
  replace: string;
}

interface ActionBase {
  id: string;
  /** True when the stream ended (or was cut) before the closing tag. Never applied. */
  incomplete?: boolean;
}

export type ParsedAction =
  | (ActionBase & { kind: 'write'; path: string; content: string })
  | (ActionBase & { kind: 'edit'; path: string; blocks: EditBlock[]; parseError?: string })
  | (ActionBase & { kind: 'delete'; path: string })
  | (ActionBase & { kind: 'rename'; from: string; to: string })
  | (ActionBase & { kind: 'dependency'; name: string; version: string })
  /** An image the server generates from `prompt` and stores at `path`. */
  | (ActionBase & { kind: 'image'; path: string; prompt: string; aspect: string });

export interface ActionStart {
  id: string;
  kind: ActionKind;
  path: string | null;
  from?: string;
  dependency?: { name: string; version: string };
}

export interface ProjectMeta {
  name?: string;
  emoji?: string;
  description?: string;
}

export interface ParserHandlers {
  onText(delta: string): void;
  onActionStart(action: ActionStart): void;
  /** Streaming content of a write action (best effort, for live display only). */
  onActionDelta(id: string, delta: string): void;
  onActionEnd(action: ParsedAction): void;
  onProject(meta: ProjectMeta): void;
  onTitle(title: string): void;
  onSuggestions(items: string[]): void;
  onQuestions(items: ChatQuestion[]): void;
  /** `<yasa-backend />`: the app needs a backend (Supabase). */
  onBackend?(): void;
}

const HEX_COLOR = /#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi;

/**
 * Parses the body of a <yasa-questions> block:
 *   ? Question text [multi]
 *   - Option
 *   ? Which palette? [colors]
 *   - Warm sand | #F5E9DA #C98A4B #2A2118
 */
export function parseQuestions(raw: string): ChatQuestion[] {
  const questions: ChatQuestion[] = [];
  let current: ChatQuestion | null = null;
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const asked = /^(?:\?|\d+[.)])\s*(.+)$/.exec(line);
    if (asked && !/^[-*•]/.test(line)) {
      let text = asked[1]!;
      let kind: ChatQuestion['kind'] = 'single';
      const flag = /\[(multi|colors|colours|single)\]/i.exec(text);
      if (flag) {
        const name = flag[1]!.toLowerCase();
        kind = name === 'multi' ? 'multi' : name === 'single' ? 'single' : 'colors';
        text = text.replace(flag[0], '');
      }
      current = { text: text.replace(/\s+/g, ' ').trim().slice(0, 200), kind, options: [] };
      if (current.text) questions.push(current);
      continue;
    }
    const option = /^[-*•]\s*(.+)$/.exec(line);
    if (!option || !current || current.options.length >= 6) continue;
    const [labelPart = '', colorPart = ''] = option[1]!.split('|');
    const colors = (colorPart.match(HEX_COLOR) ?? []).slice(0, 5).map((c) => c.toLowerCase());
    const label = labelPart.replace(HEX_COLOR, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!label) continue;
    current.options.push(colors.length ? { label, colors } : { label });
  }
  // A palette question without swatches is just a normal question; one without options is unusable.
  return questions
    .filter((q) => q.options.length >= 2)
    .map((q) => (q.kind === 'colors' && !q.options.some((o) => o.colors) ? { ...q, kind: 'single' as const } : q))
    .slice(0, 4);
}

const TAG_PREFIX = '<yasa-';
/** Closing tags outside a block ("</yasa-assistant>") are noise some models add around their answer. */
const CLOSE_PREFIX = '</yasa-';
const MAX_OPEN_TAG = 1200;
const VOID_TAGS = new Set(['delete', 'rename', 'dependency', 'project', 'image', 'backend']);
const BLOCK_TAGS = new Set(['write', 'edit', 'suggestions', 'title', 'questions']);

const RE_SEARCH = /^<{5,9}\s*SEARCH\s*$/;
const RE_DIVIDER = /^={5,9}\s*$/;
const RE_REPLACE = /^>{5,9}\s*REPLACE\s*$/;
const RE_FENCE_OPEN = /^```[\w.+-]*\s*$/;

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
  return attrs;
}

/** Removes one wrapping Markdown code fence and the newline that follows the opening tag. */
export function cleanBlockContent(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n');
  if (text.startsWith('\n')) text = text.slice(1);
  const firstNl = text.indexOf('\n');
  const firstLine = firstNl === -1 ? text : text.slice(0, firstNl);
  if (RE_FENCE_OPEN.test(firstLine)) {
    text = firstNl === -1 ? '' : text.slice(firstNl + 1);
    const trimmed = text.replace(/\s+$/, '');
    if (trimmed.endsWith('```')) text = trimmed.slice(0, -3);
  }
  // Exactly one trailing newline for non-empty files.
  text = text.replace(/\s+$/, '');
  return text.length > 0 ? `${text}\n` : '';
}

const WRAPPER_TAGS = 'file|data|content|code|source|document|write|edit|contents|text|yasa-file|yasa-code';
const RE_STRAY_WRAPPER = new RegExp(`\\n</(?:${WRAPPER_TAGS})>\\s*$`);
const RE_STRAY_ANY = /\n<\/[a-zA-Z][\w-]*>\s*$/;
/** A new action tag at the start of a line (inside a block it means the closing tag was mangled). */
const RE_NEXT_ACTION = /\n<yasa-(?:write|edit|delete|rename|dependency|title|suggestions|questions|project|image|backend)[\s>/]/;
const NEXT_ACTION_PREFIX = '\n<yasa-';
/**
 * A line that can only be a mangled closing tag (some models close files with "</file>"). In a block that never
 * gets its real closing tag, the file ends there: what follows is the model talking, not file content.
 */
const RE_MANGLED_CLOSE = /\n<\/(?:file|write|edit|document|yasa-file|yasa-code|yasa-write|yasa-edit)>[ \t]*(?:\r?\n|$)/;

function cutAtMangledClose(block: { tag: string; raw: string }): boolean {
  if (block.tag !== 'write') return false;
  const match = RE_MANGLED_CLOSE.exec(block.raw);
  if (!match) return false;
  block.raw = block.raw.slice(0, match.index + 1);
  return true;
}

/**
 * Models occasionally close an imaginary wrapper (e.g. "</data>") right before the real closing tag.
 * Such a trailing line is never valid in code files, so it is dropped.
 */
export function stripStrayClosingTag(content: string, path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (['html', 'htm', 'svg', 'xml', 'md', 'mdx'].includes(ext)) return content;
  // Plain code/style/data files can never end with a closing tag; JSX files only lose known wrapper names.
  const re = ['ts', 'js', 'mjs', 'cjs', 'css', 'json'].includes(ext) ? RE_STRAY_ANY : RE_STRAY_WRAPPER;
  let out = content;
  // Several stray tags can pile up ("</write>\n</file>").
  for (let i = 0; i < 4 && re.test(out); i++) out = `${out.replace(re, '').replace(/\s+$/, '')}\n`;
  return out;
}

/** Parses SEARCH/REPLACE blocks. Returns an error string when the block structure is invalid. */
export function parseEditBlocks(raw: string): { blocks: EditBlock[]; error?: string } {
  let text = raw.replace(/\r\n/g, '\n');
  if (text.startsWith('\n')) text = text.slice(1);
  const lines = text.split('\n');
  // Tolerate a wrapping code fence.
  if (lines.length && RE_FENCE_OPEN.test(lines[0]) && !RE_SEARCH.test(lines[0])) lines.shift();

  const blocks: EditBlock[] = [];
  let state: 'idle' | 'search' | 'replace' = 'idle';
  let search: string[] = [];
  let replace: string[] = [];
  for (const line of lines) {
    if (state === 'idle') {
      if (RE_SEARCH.test(line)) {
        state = 'search';
        search = [];
        replace = [];
      }
      continue;
    }
    if (state === 'search') {
      if (RE_DIVIDER.test(line)) state = 'replace';
      else search.push(line);
      continue;
    }
    if (RE_REPLACE.test(line)) {
      blocks.push({ search: search.join('\n'), replace: replace.join('\n') });
      state = 'idle';
    } else replace.push(line);
  }
  if (state !== 'idle') return { blocks, error: 'An edit block is missing its ">>>>>>> REPLACE" terminator' };
  if (blocks.length === 0) return { blocks, error: 'No SEARCH/REPLACE blocks found' };
  if (blocks.some((b) => b.search.trim() === '')) return { blocks, error: 'A SEARCH block is empty; use yasa-write to replace the whole file' };
  return { blocks };
}

interface OpenBlock {
  tag: 'write' | 'edit' | 'suggestions' | 'title' | 'questions';
  closeTag: string;
  id: string;
  path: string;
  raw: string;
  /** How much of `raw` was already forwarded via onActionDelta (write only). */
  emitted: number;
  /** Whether the first line has been inspected for a code fence (write only). */
  headChecked: boolean;
  headSkip: number;
}

export class ProtocolParser {
  private buffer = '';
  private block: OpenBlock | null = null;
  private counter = 0;
  private dropLeadingNewlines = false;

  constructor(
    private readonly handlers: ParserHandlers,
    private readonly idPrefix = 'a',
  ) {}

  push(chunk: string): void {
    if (!chunk) return;
    this.buffer += chunk;
    this.drain(false);
  }

  finish(): void {
    this.drain(true);
  }

  private nextId(): string {
    this.counter += 1;
    return `${this.idPrefix}${this.counter}`;
  }

  private emitText(text: string): void {
    if (!text) return;
    if (this.dropLeadingNewlines) {
      text = text.replace(/^[ \t]*\n+/, '');
      if (!text) return;
      this.dropLeadingNewlines = false;
    }
    this.handlers.onText(text);
  }

  private drain(final: boolean): void {
    for (;;) {
      if (this.block) {
        if (!this.drainBlock(final)) return;
        continue;
      }
      if (!this.buffer) return;
      const lt = this.buffer.indexOf('<');
      if (lt === -1) {
        this.emitText(this.buffer);
        this.buffer = '';
        return;
      }
      if (lt > 0) {
        this.emitText(this.buffer.slice(0, lt));
        this.buffer = this.buffer.slice(lt);
      }
      // buffer starts with '<'
      const closeHead = this.buffer.slice(0, CLOSE_PREFIX.length);
      if (closeHead.length > 1 && CLOSE_PREFIX.startsWith(closeHead)) {
        const end = closeHead === CLOSE_PREFIX ? this.buffer.indexOf('>') : -1;
        if (end !== -1 && end <= 40) {
          this.buffer = this.buffer.slice(end + 1);
          continue;
        }
        if (!final && this.buffer.length <= 40) return; // wait for the rest of the tag
        if (closeHead !== CLOSE_PREFIX || end === -1) {
          this.emitText('<');
          this.buffer = this.buffer.slice(1);
          continue;
        }
      }
      const head = this.buffer.slice(0, TAG_PREFIX.length);
      if (!TAG_PREFIX.startsWith(head) && !head.startsWith(TAG_PREFIX)) {
        // Not ours: emit '<' and keep scanning.
        this.emitText('<');
        this.buffer = this.buffer.slice(1);
        continue;
      }
      if (this.buffer.length < TAG_PREFIX.length) {
        if (!final) return; // might still become <yasa-
        this.emitText(this.buffer);
        this.buffer = '';
        return;
      }
      const gt = this.buffer.indexOf('>');
      if (gt === -1) {
        if (!final && this.buffer.length < MAX_OPEN_TAG) return; // wait for the rest of the tag
        this.emitText(this.buffer);
        this.buffer = '';
        return;
      }
      const tagSource = this.buffer.slice(0, gt + 1);
      const nameMatch = /^<yasa-([a-z]+)/.exec(tagSource);
      const name = nameMatch?.[1] ?? '';
      if (!VOID_TAGS.has(name) && !BLOCK_TAGS.has(name)) {
        // An invented wrapper ("<yasa-assistant>") is dropped; anything longer is real text that merely looks like a tag.
        if (!/^<yasa-[a-z-]+\s*\/?>$/.test(tagSource)) this.emitText(tagSource);
        this.buffer = this.buffer.slice(gt + 1);
        continue;
      }
      this.buffer = this.buffer.slice(gt + 1);
      this.openTag(name, tagSource);
    }
  }

  private openTag(name: string, source: string): void {
    const attrs = parseAttrs(source);
    this.dropLeadingNewlines = true;
    switch (name) {
      case 'project':
        this.handlers.onProject({ name: attrs.name, emoji: attrs.emoji, description: attrs.description });
        return;
      case 'delete': {
        const id = this.nextId();
        const path = attrs.path ?? '';
        this.handlers.onActionStart({ id, kind: 'delete', path });
        this.handlers.onActionEnd({ id, kind: 'delete', path });
        return;
      }
      case 'rename': {
        const id = this.nextId();
        const from = attrs.from ?? '';
        const to = attrs.to ?? '';
        this.handlers.onActionStart({ id, kind: 'rename', path: to, from });
        this.handlers.onActionEnd({ id, kind: 'rename', from, to });
        return;
      }
      case 'backend':
        this.handlers.onBackend?.();
        return;
      case 'image': {
        const id = this.nextId();
        const path = attrs.path ?? attrs.src ?? '';
        this.handlers.onActionStart({ id, kind: 'image', path });
        this.handlers.onActionEnd({ id, kind: 'image', path, prompt: attrs.prompt ?? attrs.alt ?? '', aspect: attrs.aspect ?? attrs.ratio ?? '' });
        return;
      }
      case 'dependency': {
        const id = this.nextId();
        const dependency = { name: attrs.name ?? '', version: attrs.version || 'latest' };
        this.handlers.onActionStart({ id, kind: 'dependency', path: null, dependency });
        this.handlers.onActionEnd({ id, kind: 'dependency', ...dependency });
        return;
      }
      case 'write':
      case 'edit': {
        const id = this.nextId();
        const path = attrs.path ?? attrs.file ?? attrs.file_path ?? '';
        this.block = { tag: name, closeTag: `</yasa-${name}>`, id, path, raw: '', emitted: 0, headChecked: false, headSkip: 0 };
        this.handlers.onActionStart({ id, kind: name, path });
        return;
      }
      default:
        this.block = {
          tag: name as 'suggestions' | 'title' | 'questions',
          closeTag: `</yasa-${name}>`,
          id: '',
          path: '',
          raw: '',
          emitted: 0,
          headChecked: true,
          headSkip: 0,
        };
    }
  }

  /** Returns true when the block was closed and scanning should continue. */
  private drainBlock(final: boolean): boolean {
    const block = this.block!;
    const closeAt = this.buffer.indexOf(block.closeTag);
    // Models sometimes mangle the closing tag and simply start the next action. A new action tag at the start
    // of a line can never be file content, so it ends the current block.
    const implicit = block.tag === 'write' || block.tag === 'edit' ? RE_NEXT_ACTION.exec(this.buffer) : null;
    if (implicit && (closeAt === -1 || implicit.index < closeAt)) {
      block.raw += this.buffer.slice(0, implicit.index);
      this.buffer = this.buffer.slice(implicit.index + 1); // keep "<yasa-…" for the main loop
      this.streamWrite(block, true);
      cutAtMangledClose(block);
      this.closeBlock(block, false);
      return true;
    }
    if (closeAt !== -1) {
      block.raw += this.buffer.slice(0, closeAt);
      this.buffer = this.buffer.slice(closeAt + block.closeTag.length);
      this.streamWrite(block, true);
      this.closeBlock(block, false);
      return true;
    }
    // Keep a tail that could be the beginning of the closing tag…
    let keep = 0;
    const max = Math.min(block.closeTag.length - 1, this.buffer.length);
    for (let n = max; n > 0; n--) {
      if (block.closeTag.startsWith(this.buffer.slice(this.buffer.length - n))) {
        keep = n;
        break;
      }
    }
    // …or the beginning of a new action tag on its own line.
    const lastLine = this.buffer.lastIndexOf('\n');
    if (lastLine !== -1) {
      const tail = this.buffer.slice(lastLine);
      if (tail.length <= 24 && (NEXT_ACTION_PREFIX.startsWith(tail) || /^\n<yasa-[a-z]*$/.test(tail))) {
        keep = Math.max(keep, tail.length);
      }
    }
    if (final) keep = 0;
    block.raw += this.buffer.slice(0, this.buffer.length - keep);
    this.buffer = this.buffer.slice(this.buffer.length - keep);
    this.streamWrite(block, final);
    if (final) {
      // A file closed with a mangled tag and followed only by prose is complete, not cut off.
      this.closeBlock(block, !cutAtMangledClose(block));
      return true;
    }
    return false;
  }

  private streamWrite(block: OpenBlock, flush: boolean): void {
    if (block.tag !== 'write') return;
    if (!block.headChecked) {
      // Wait for the first full line to decide whether a code fence wraps the content.
      const body = block.raw.startsWith('\n') ? 1 : block.raw.startsWith('\r\n') ? 2 : 0;
      const nl = block.raw.indexOf('\n', body);
      if (nl === -1 && !flush && block.raw.length < 64) return;
      const firstLine = (nl === -1 ? block.raw.slice(body) : block.raw.slice(body, nl)).replace(/\r$/, '');
      block.headSkip = RE_FENCE_OPEN.test(firstLine) && nl !== -1 ? nl + 1 : body;
      block.headChecked = true;
      block.emitted = block.headSkip;
    }
    if (block.raw.length > block.emitted) {
      this.handlers.onActionDelta(block.id, block.raw.slice(block.emitted));
      block.emitted = block.raw.length;
    }
  }

  private closeBlock(block: OpenBlock, incomplete: boolean): void {
    this.block = null;
    this.dropLeadingNewlines = true;
    const flag = incomplete ? { incomplete: true as const } : {};
    switch (block.tag) {
      case 'write':
        this.handlers.onActionEnd({
          id: block.id,
          kind: 'write',
          path: block.path,
          content: stripStrayClosingTag(cleanBlockContent(block.raw), block.path),
          ...flag,
        });
        return;
      case 'edit': {
        const { blocks, error } = parseEditBlocks(block.raw);
        this.handlers.onActionEnd({ id: block.id, kind: 'edit', path: block.path, blocks, ...(error ? { parseError: error } : {}), ...flag });
        return;
      }
      case 'title': {
        const title = block.raw.replace(/\s+/g, ' ').trim();
        if (title) this.handlers.onTitle(title.slice(0, 80));
        return;
      }
      case 'questions': {
        const items = parseQuestions(block.raw);
        if (items.length) this.handlers.onQuestions(items);
        return;
      }
      case 'suggestions': {
        const items = block.raw
          .split('\n')
          .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
          .filter(Boolean)
          .map((line) => line.slice(0, 120))
          .slice(0, 4);
        if (items.length) this.handlers.onSuggestions(items);
        return;
      }
    }
  }
}
