import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { Bot, CircleCheck, CircleX, FileCode, LoaderCircle, PanelLeft, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { basename, countLines, extname, isBinaryPath, languageFor, mimeFor } from '@shared/paths';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useTheme } from '@/components/common/ThemeProvider';
import { useWorkspace } from '@/features/workspace/store';
import { useErrorMessage, useT } from '@/i18n';
import { api } from '@/lib/api';
import { useDeleteFile, useRenameFile, useSaveFile } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { FileIcon, FileTree } from './FileTree';

const AUTOSAVE_MS = 800;

const editorTheme = EditorView.theme({
  '&': { fontSize: '12.5px', height: '100%', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
  '&.cm-focused': { outline: 'none' },
});

function languageExtension(path: string): Extension[] {
  const ext = extname(path);
  switch (languageFor(path)) {
    case 'typescript':
      return [javascript({ typescript: true, jsx: ext === 'tsx' })];
    case 'javascript':
      return [javascript({ jsx: true })];
    case 'css':
      return [css()];
    case 'html':
      return [html()];
    case 'json':
      return [json()];
    case 'markdown':
      return [markdown()];
    default:
      return [];
  }
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function CodePanel(props: { projectId: string; readOnly: boolean }) {
  const { projectId } = props;
  const t = useT('code');
  const tc = useT('common');
  const errorMessage = useErrorMessage();
  const { resolvedTheme } = useTheme();

  const files = useWorkspace((s) => s.files);
  const activePath = useWorkspace((s) => s.activePath);
  const openPaths = useWorkspace((s) => s.openPaths);
  const drafts = useWorkspace((s) => s.drafts);
  const generating = useWorkspace((s) => s.generating);
  const liveFile = useWorkspace((s) => s.liveFile);
  const build = useWorkspace((s) => s.build);

  const saveFile = useSaveFile(projectId);
  const renameFile = useRenameFile(projectId);
  const deleteFile = useDeleteFile(projectId);

  const [treeOpen, setTreeOpen] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [toDelete, setToDelete] = useState<string | null>(null);
  const timerRef = useRef<number>(0);
  const liveViewRef = useRef<EditorView | null>(null);

  const editable = !props.readOnly && !generating;
  const paths = useMemo(() => Object.keys(files).sort(), [files]);
  const dirtyPaths = useMemo(() => new Set(Object.keys(drafts)), [drafts]);
  const errorPaths = useMemo(() => new Set((build && !build.ok ? build.errors : []).map((e) => e.file).filter(Boolean) as string[]), [build]);

  // Open something sensible the first time the panel has files.
  useEffect(() => {
    if (activePath || paths.length === 0) return;
    const preferred = ['src/App.tsx', 'src/main.tsx', 'index.html'].find((p) => files[p]) ?? paths[0];
    useWorkspace.getState().openFile(preferred);
  }, [activePath, files, paths]);

  // ----- saving -------------------------------------------------------------------------------------------------
  const save = useCallback(
    async (path: string, content: string) => {
      setSaveState('saving');
      try {
        await saveFile.mutateAsync({ path, content });
        const store = useWorkspace.getState();
        const newer = store.drafts[path];
        store.applyFileChanges([{ path, kind: 'upsert', content, encoding: 'utf8' }]);
        // The user kept typing while the request was in flight: keep their newer text as the draft.
        if (newer !== undefined && newer !== content) store.setDraft(path, newer);
        setSaveState('saved');
        store.setBuilding(true);
        try {
          const summary = await api.preview.build(projectId);
          store.setBuild(summary);
          if (summary.ok) store.reloadPreview();
        } finally {
          store.setBuilding(false);
        }
      } catch (err) {
        setSaveState('failed');
        toast.error(errorMessage(err));
      }
    },
    [errorMessage, projectId, saveFile],
  );

  const flush = useCallback(() => {
    window.clearTimeout(timerRef.current);
    const store = useWorkspace.getState();
    const path = store.activePath;
    if (!path) return;
    const draft = store.drafts[path];
    if (draft !== undefined && draft !== store.files[path]?.content) void save(path, draft);
  }, [save]);

  const onChange = useCallback(
    (value: string) => {
      const store = useWorkspace.getState();
      const path = store.activePath;
      if (!path || !editable) return;
      store.setDraft(path, value === store.files[path]?.content ? null : value);
      setSaveState('idle');
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(flush, AUTOSAVE_MS);
    },
    [editable, flush],
  );

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && useWorkspace.getState().view === 'code') {
        e.preventDefault();
        if (editable) flush();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, flush]);

  // ----- file operations -------------------------------------------------------------------------------------------
  const createFile = useCallback(
    async (path: string) => {
      try {
        await saveFile.mutateAsync({ path, content: '' });
        const store = useWorkspace.getState();
        store.applyFileChanges([{ path, kind: 'upsert', content: '', encoding: 'utf8' }]);
        store.openFile(path);
        toast.success(t('tree.created'));
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    [errorMessage, saveFile, t],
  );

  const rename = useCallback(
    async (from: string, to: string) => {
      try {
        const { file } = await renameFile.mutateAsync({ from, to });
        const store = useWorkspace.getState();
        store.applyFileChanges([
          { path: from, kind: 'delete' },
          { path: file.path, kind: 'upsert', content: file.content, encoding: file.encoding },
        ]);
        store.openFile(file.path);
        toast.success(t('tree.renamed'));
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    [errorMessage, renameFile, t],
  );

  const confirmDelete = useCallback(async () => {
    if (!toDelete) return;
    try {
      await deleteFile.mutateAsync(toDelete);
      useWorkspace.getState().applyFileChanges([{ path: toDelete, kind: 'delete' }]);
      toast.success(t('tree.deleted'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, [deleteFile, errorMessage, t, toDelete]);

  // ----- live "AI is writing" view --------------------------------------------------------------------------------------
  useEffect(() => {
    const view = liveViewRef.current;
    if (!view || !liveFile) return;
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'end' }) });
  }, [liveFile]);

  const shownPath = liveFile ? liveFile.path : activePath;
  const file = shownPath ? files[shownPath] : undefined;
  const isBinary = Boolean(shownPath) && !liveFile && (file?.encoding === 'base64' || (shownPath ? isBinaryPath(shownPath) : false));
  const value = liveFile ? liveFile.content : shownPath ? (drafts[shownPath] ?? file?.content ?? '') : '';
  const extensions = useMemo(() => (shownPath ? [...languageExtension(shownPath), editorTheme, EditorView.lineWrapping] : [editorTheme]), [shownPath]);
  const problems = build && !build.ok ? build.errors : [];
  const isImage = isBinary && shownPath ? mimeFor(shownPath).startsWith('image/') : false;

  return (
    <div className="relative flex h-full min-h-0 bg-background">
      {treeOpen ? (
        <aside className="w-56 shrink-0 border-r border-border max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-10 max-md:bg-background max-md:shadow-xl">
          <FileTree
            paths={paths}
            activePath={shownPath}
            dirtyPaths={dirtyPaths}
            errorPaths={errorPaths}
            editable={editable}
            onOpen={(path) => {
              useWorkspace.getState().openFile(path);
              if (window.innerWidth < 768) setTreeOpen(false);
            }}
            onCreate={createFile}
            onRename={rename}
            onDelete={setToDelete}
          />
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* tabs */}
        <div className="flex h-9 shrink-0 items-stretch border-b border-border">
          <button
            type="button"
            title={t('tree.toggle')}
            aria-label={t('tree.toggle')}
            aria-pressed={treeOpen}
            onClick={() => setTreeOpen((v) => !v)}
            className="grid w-9 shrink-0 place-items-center border-r border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelLeft className="size-3.5" />
          </button>
          <div className="scrollbar-none flex min-w-0 flex-1 overflow-x-auto" role="tablist">
            {openPaths.map((path) => {
              const active = path === activePath && !liveFile;
              return (
                <div
                  key={path}
                  role="tab"
                  aria-selected={active}
                  title={path}
                  onAuxClick={(e) => {
                    if (e.button === 1) useWorkspace.getState().closeFile(path);
                  }}
                  className={cn(
                    'group/tab flex shrink-0 items-center gap-1.5 border-r border-border pl-3 pr-1.5 text-[12.5px]',
                    active ? 'bg-background text-foreground' : 'bg-muted/40 text-muted-foreground hover:text-foreground',
                  )}
                >
                  <button type="button" onClick={() => useWorkspace.getState().setActivePath(path)} className="flex items-center gap-1.5 py-2">
                    <FileIcon path={path} className="size-3.5" />
                    <span className="max-w-40 truncate">{basename(path)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={t('editor.closeTab')}
                    onClick={() => useWorkspace.getState().closeFile(path)}
                    className="grid size-4 place-items-center rounded hover:bg-muted"
                  >
                    {dirtyPaths.has(path) ? <span className="size-1.5 rounded-full bg-warning group-hover/tab:hidden" /> : null}
                    <X className={cn('size-3', dirtyPaths.has(path) && 'hidden group-hover/tab:block')} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 px-3 text-[11.5px] text-muted-foreground">
            {liveFile ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-info">
                <Bot className="size-3.5 animate-pulse" />
                {t('editor.aiWriting')}
              </span>
            ) : saveState === 'saving' ? (
              <>
                <LoaderCircle className="size-3 animate-spin" />
                {t('editor.saving')}
              </>
            ) : saveState === 'saved' ? (
              <>
                <CircleCheck className="size-3 text-success" />
                {t('editor.saved')}
              </>
            ) : saveState === 'failed' ? (
              <>
                <CircleX className="size-3 text-destructive" />
                {t('editor.saveFailed')}
              </>
            ) : activePath && dirtyPaths.has(activePath) ? (
              t('editor.unsaved')
            ) : null}
          </div>
        </div>

        {generating && !liveFile ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-info/5 px-3 py-1.5 text-[12px] text-info">
            <Bot className="size-3.5" />
            {t('editor.aiWorking')}
          </div>
        ) : null}

        {/* editor */}
        <div className="relative min-h-0 flex-1">
          {!shownPath ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <FileCode className="mx-auto size-8 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-medium">{t('editor.emptyTitle')}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{t('editor.emptyHint')}</p>
              </div>
            </div>
          ) : isBinary ? (
            <div className="grid h-full place-items-center bg-grid p-6">
              {isImage && file ? (
                <img src={`data:${mimeFor(shownPath)};base64,${file.content}`} alt={basename(shownPath)} className="max-h-full max-w-full rounded-lg border border-border bg-background object-contain shadow-sm" />
              ) : (
                <p className="text-[13px] text-muted-foreground">{t('editor.binary')}</p>
              )}
            </div>
          ) : (
            <CodeMirror
              key={liveFile ? `live:${shownPath}` : shownPath}
              value={value}
              height="100%"
              className="h-full [&_.cm-editor]:h-full"
              theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
              extensions={extensions}
              editable={editable && !liveFile}
              readOnly={!editable || Boolean(liveFile)}
              onChange={liveFile ? undefined : onChange}
              onCreateEditor={(view) => {
                liveViewRef.current = liveFile ? view : null;
              }}
              basicSetup={{ foldGutter: true, highlightActiveLine: editable, autocompletion: false, tabSize: 2 }}
            />
          )}
        </div>

        {/* status / problems */}
        <div className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-1 text-[11.5px] text-muted-foreground">
          {shownPath ? <span className="truncate font-mono">{shownPath}</span> : null}
          {shownPath && !isBinary ? <span>{t('editor.lines', { count: countLines(value) })}</span> : null}
          {!editable ? <span>{t('editor.readOnly')}</span> : null}
          {problems.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                const first = problems.find((p) => p.file && files[p.file]);
                if (first?.file) useWorkspace.getState().openFile(first.file);
              }}
              className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-destructive hover:underline"
              title={problems.map((p) => `${p.file ?? ''}${p.line ? `:${p.line}` : ''} ${p.message}`).join('\n')}
            >
              <TriangleAlert className="size-3 shrink-0" />
              <span className="truncate">
                {t('editor.problems')}: {problems[0].file ? `${problems[0].file}${problems[0].line ? `:${problems[0].line}` : ''} — ` : ''}
                {problems[0].message}
              </span>
            </button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title={tc('confirm.deleteTitle', { name: toDelete ? basename(toDelete) : '' })}
        description={tc('confirm.deleteDescription')}
        confirmLabel={tc('actions.delete')}
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
