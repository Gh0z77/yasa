import { useMemo, useState, type FormEvent } from 'react';
import {
  Braces,
  ChevronRight,
  Ellipsis,
  File,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Palette,
  Pencil,
  Plus,
  Search,
  Trash,
} from 'lucide-react';
import { extname, normalizePath, pathError } from '@shared/paths';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode> | null; // null = file
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() };
  for (const path of paths) {
    const segments = path.split('/');
    let node = root;
    segments.forEach((segment, i) => {
      const isFile = i === segments.length - 1;
      const childPath = segments.slice(0, i + 1).join('/');
      let child = node.children!.get(segment);
      if (!child) {
        child = { name: segment, path: childPath, children: isFile ? null : new Map() };
        node.children!.set(segment, child);
      }
      node = child;
    });
  }
  return root;
}

function sortedChildren(node: TreeNode): TreeNode[] {
  return [...(node.children?.values() ?? [])].sort((a, b) => {
    if (Boolean(a.children) !== Boolean(b.children)) return a.children ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function FileIcon({ path, className }: { path: string; className?: string }) {
  const ext = extname(path);
  const Icon =
    ['ts', 'tsx', 'js', 'jsx', 'mjs', 'html'].includes(ext) ? FileCode
    : ['css', 'scss'].includes(ext) ? Palette
    : ext === 'json' ? Braces
    : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif'].includes(ext) ? ImageIcon
    : ['md', 'txt'].includes(ext) ? FileText
    : File;
  return <Icon className={className} />;
}

export interface FileTreeProps {
  paths: string[];
  activePath: string | null;
  dirtyPaths: Set<string>;
  errorPaths: Set<string>;
  editable: boolean;
  onOpen(path: string): void;
  onCreate(path: string): Promise<void> | void;
  onRename(from: string, to: string): Promise<void> | void;
  onDelete(path: string): void;
}

export function FileTree(props: FileTreeProps) {
  const { paths, activePath, editable } = props;
  const t = useT('code');
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['src/components/ui', 'public']));
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? paths.filter((p) => p.toLowerCase().includes(q)) : paths;
  }, [filter, paths]);
  const tree = useMemo(() => buildTree(visible), [visible]);
  const filtering = filter.trim() !== '';

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const validate = (raw: string, ignore?: string): string | null => {
    const path = normalizePath(raw);
    const problem = pathError(path);
    if (problem) return problem;
    if (path !== ignore && paths.includes(path)) return t('tree.exists');
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = validate(draft, renaming ?? undefined);
    if (problem) {
      setError(problem);
      return;
    }
    const path = normalizePath(draft);
    if (renaming) {
      if (path !== renaming) await props.onRename(renaming, path);
    } else await props.onCreate(path);
    setCreating(false);
    setRenaming(null);
    setDraft('');
    setError(null);
  };

  const cancel = () => {
    setCreating(false);
    setRenaming(null);
    setDraft('');
    setError(null);
  };

  const inputRow = (
    <form onSubmit={(e) => void submit(e)} className="px-2 py-1">
      <input
        autoFocus
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={cancel}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel();
        }}
        placeholder={t('tree.newFilePlaceholder')}
        spellCheck={false}
        aria-invalid={Boolean(error)}
        className={cn('h-7 w-full rounded-md border bg-background px-2 font-mono text-[12px] outline-none', error ? 'border-destructive' : 'border-ring')}
      />
      {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}
    </form>
  );

  const renderNode = (node: TreeNode, depth: number) => {
    if (node.children) {
      const open = filtering || !collapsed.has(node.path);
      return (
        <li key={node.path}>
          <button
            type="button"
            onClick={() => toggle(node.path)}
            aria-expanded={open}
            style={{ paddingLeft: 8 + depth * 12 }}
            className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
            {open ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />}
            <span className="truncate">{node.name}</span>
          </button>
          {open ? <ul>{sortedChildren(node).map((child) => renderNode(child, depth + 1))}</ul> : null}
        </li>
      );
    }
    if (renaming === node.path) return <li key={node.path}>{inputRow}</li>;
    const active = node.path === activePath;
    return (
      <li key={node.path} className="group/file relative">
        <button
          type="button"
          onClick={() => props.onOpen(node.path)}
          style={{ paddingLeft: 23 + depth * 12 }}
          aria-current={active ? 'true' : undefined}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md py-1 pr-7 text-left text-[13px]',
            active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
          )}
        >
          <FileIcon path={node.path} className={cn('size-3.5 shrink-0', props.errorPaths.has(node.path) && 'text-destructive')} />
          <span className={cn('truncate', props.errorPaths.has(node.path) && 'text-destructive')}>{node.name}</span>
          {props.dirtyPaths.has(node.path) ? <span className="ml-auto size-1.5 shrink-0 rounded-full bg-warning" /> : null}
        </button>
        {editable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={node.name}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover/file:opacity-100 data-[state=open]:opacity-100"
              >
                <Ellipsis className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-36">
              <DropdownMenuItem
                onSelect={() => {
                  setRenaming(node.path);
                  setDraft(node.path);
                  setCreating(false);
                }}
              >
                <Pencil className="size-3.5" />
                {t('tree.rename')}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete(node.path)}>
                <Trash className="size-3.5" />
                {t('tree.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="flex-1 px-1 text-[12px] font-medium text-muted-foreground">{t('tree.title')}</span>
        {editable ? (
          <button
            type="button"
            title={t('tree.newFile')}
            aria-label={t('tree.newFile')}
            onClick={() => {
              setCreating(true);
              setRenaming(null);
              setDraft('src/');
            }}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="relative shrink-0 border-b border-border">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('tree.search')}
          aria-label={t('tree.search')}
          className="h-8 w-full bg-transparent pl-8 pr-2 text-[12.5px] outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-1">
        {creating ? inputRow : null}
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-center text-[12.5px] text-muted-foreground">{t('tree.noMatch')}</p>
        ) : (
          <ul className="px-1">{sortedChildren(tree).map((node) => renderNode(node, 0))}</ul>
        )}
      </div>
    </div>
  );
}

export { FileIcon };
