// Workspace store — the contract between ChatPanel (W2), Preview/Code panels (W3) and the shell (W4).
// Shape and signatures are fixed by SPEC §11.5; do not change them without updating the spec.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type {
  BuildSummary,
  ChatRequest,
  ConsoleEntry,
  FileChange,
  PreviewError,
  ProjectFile,
  SelectedElement,
} from '@shared/types';

export type WorkspaceView = 'preview' | 'code' | 'cloud';
export type Device = 'desktop' | 'tablet' | 'mobile';
export type PanelName = 'history' | 'publish' | 'share' | 'settings' | 'github' | 'supabase';

export interface LiveFile {
  path: string;
  content: string;
}

export interface QueuedChat extends Partial<ChatRequest> {
  id: number;
  message: string;
}

export const MAX_PREVIEW_ERRORS = 50;
export const MAX_CONSOLE_ENTRIES = 500;

export interface WorkspaceState {
  projectId: string | null;
  isOwner: boolean;
  files: Record<string, ProjectFile>;
  view: WorkspaceView;
  device: Device;
  panels: Record<PanelName, boolean>;
  activePath: string | null;
  openPaths: string[];
  drafts: Record<string, string>;
  previewNonce: number;
  previewPath: string;
  previewLoading: boolean;
  build: BuildSummary | null;
  building: boolean;
  /** Capped at 50. */
  previewErrors: PreviewError[];
  /** Capped at 500. */
  consoleEntries: ConsoleEntry[];
  selectMode: boolean;
  selectedElement: SelectedElement | null;
  generating: boolean;
  liveFile: LiveFile | null;
  queuedChat: QueuedChat | null;

  reset(projectId: string, files: ProjectFile[], isOwner: boolean): void;
  setFiles(files: ProjectFile[]): void;
  /** Also drops drafts of changed paths and fixes open tabs. */
  applyFileChanges(changes: FileChange[]): void;
  setView(v: WorkspaceView): void;
  setDevice(d: Device): void;
  setPanel(p: PanelName, open: boolean): void;
  openFile(path: string): void;
  closeFile(path: string): void;
  setActivePath(path: string | null): void;
  setDraft(path: string, content: string | null): void;
  /** nonce++ and clears previewErrors + consoleEntries. */
  reloadPreview(): void;
  setPreviewPath(path: string): void;
  setPreviewLoading(v: boolean): void;
  setBuild(b: BuildSummary | null): void;
  setBuilding(v: boolean): void;
  addPreviewError(e: PreviewError): void;
  clearPreviewErrors(): void;
  addConsoleEntry(e: ConsoleEntry): void;
  clearConsole(): void;
  setSelectMode(v: boolean): void;
  setSelectedElement(el: SelectedElement | null): void;
  setGenerating(v: boolean): void;
  setLiveFile(f: LiveFile | null): void;
  appendLiveFile(path: string, delta: string): void;
  queueChat(req: Omit<QueuedChat, 'id'>): void;
  consumeQueuedChat(): QueuedChat | null;
}

const CLOSED_PANELS: Record<PanelName, boolean> = { history: false, publish: false, share: false, settings: false, github: false, supabase: false };

function toRecord(files: ProjectFile[]): Record<string, ProjectFile> {
  const out: Record<string, ProjectFile> = {};
  for (const f of files) out[f.path] = f;
  return out;
}

/** Byte size of the decoded content (matches what the server stores). */
function contentSize(content: string, encoding: ProjectFile['encoding']): number {
  if (encoding === 'base64') {
    const clean = content.replace(/[^A-Za-z0-9+/]/g, '');
    return Math.floor((clean.length * 3) / 4);
  }
  return new TextEncoder().encode(content).length;
}

/** Tab to focus after `closed` disappears from `openPaths`. */
function neighbourOf(openPaths: string[], closed: string): string | null {
  const index = openPaths.indexOf(closed);
  if (index === -1) return null;
  return openPaths[index + 1] ?? openPaths[index - 1] ?? null;
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

let queuedChatId = 0;

export const useWorkspace: UseBoundStore<StoreApi<WorkspaceState>> = create<WorkspaceState>()((set, get) => ({
  projectId: null,
  isOwner: false,
  files: {},
  view: 'preview',
  device: 'desktop',
  panels: { ...CLOSED_PANELS },
  activePath: null,
  openPaths: [],
  drafts: {},
  previewNonce: 0,
  previewPath: '/',
  previewLoading: false,
  build: null,
  building: false,
  previewErrors: [],
  consoleEntries: [],
  selectMode: false,
  selectedElement: null,
  generating: false,
  liveFile: null,
  queuedChat: null,

  reset(projectId, files, isOwner) {
    const sameProject = get().projectId === projectId;
    const record = toRecord(files);
    if (sameProject) {
      // Re-sync of the project that is already open (refetch): keep the UI state, refresh the data.
      const s = get();
      const openPaths = s.openPaths.filter((p) => p in record);
      set({
        isOwner,
        files: record,
        openPaths,
        activePath: s.activePath && s.activePath in record ? s.activePath : (openPaths[0] ?? null),
        drafts: Object.fromEntries(Object.entries(s.drafts).filter(([p]) => p in record)),
      });
      return;
    }
    set({
      projectId,
      isOwner,
      files: record,
      view: 'preview',
      device: 'desktop',
      panels: { ...CLOSED_PANELS },
      activePath: null,
      openPaths: [],
      drafts: {},
      previewNonce: 0,
      previewPath: '/',
      previewLoading: false,
      build: null,
      building: false,
      previewErrors: [],
      consoleEntries: [],
      selectMode: false,
      selectedElement: null,
      generating: false,
      liveFile: null,
      queuedChat: null,
    });
  },

  setFiles(files) {
    const record = toRecord(files);
    set((s) => {
      const openPaths = s.openPaths.filter((p) => p in record);
      return {
        files: record,
        openPaths,
        activePath: s.activePath && s.activePath in record ? s.activePath : (openPaths[0] ?? null),
        drafts: {},
      };
    });
  },

  applyFileChanges(changes) {
    if (changes.length === 0) return;
    set((s) => {
      const files = { ...s.files };
      let drafts = s.drafts;
      let openPaths = s.openPaths;
      let activePath = s.activePath;
      const now = new Date().toISOString();

      // A rename arrives as delete(from) + upsert(to): carry the tab over to the new path.
      const deleted = changes.filter((c) => c.kind === 'delete').map((c) => c.path);
      const created = changes.filter((c) => c.kind === 'upsert' && !(c.path in s.files)).map((c) => c.path);
      const renamedTo = deleted.length === 1 && created.length === 1 ? created[0]! : null;

      for (const change of changes) {
        drafts = omit(drafts, change.path);
        if (change.kind === 'delete') {
          delete files[change.path];
          if (openPaths.includes(change.path)) {
            if (renamedTo) {
              openPaths = openPaths.map((p) => (p === change.path ? renamedTo : p));
              if (activePath === change.path) activePath = renamedTo;
            } else {
              if (activePath === change.path) activePath = neighbourOf(openPaths, change.path);
              openPaths = openPaths.filter((p) => p !== change.path);
            }
          } else if (activePath === change.path) {
            activePath = renamedTo;
          }
        } else {
          const previous = files[change.path];
          const encoding = change.encoding ?? previous?.encoding ?? 'utf8';
          const content = change.content ?? previous?.content ?? '';
          files[change.path] = { path: change.path, content, encoding, size: contentSize(content, encoding), updatedAt: now };
        }
      }
      // De-duplicate in case the rename target was already open.
      openPaths = openPaths.filter((p, i) => openPaths.indexOf(p) === i && p in files);
      if (activePath && !(activePath in files)) activePath = openPaths[0] ?? null;
      return { files, drafts, openPaths, activePath };
    });
  },

  setView: (view) => set({ view }),
  setDevice: (device) => set({ device }),
  setPanel: (panel, open) => set((s) => (s.panels[panel] === open ? s : { panels: { ...s.panels, [panel]: open } })),

  openFile(path) {
    set((s) => ({
      openPaths: s.openPaths.includes(path) ? s.openPaths : [...s.openPaths, path],
      activePath: path,
    }));
  },

  closeFile(path) {
    set((s) => {
      if (!s.openPaths.includes(path)) return s;
      return {
        activePath: s.activePath === path ? neighbourOf(s.openPaths, path) : s.activePath,
        openPaths: s.openPaths.filter((p) => p !== path),
        drafts: omit(s.drafts, path),
      };
    });
  },

  setActivePath(path) {
    set((s) => ({
      activePath: path,
      openPaths: path && !s.openPaths.includes(path) ? [...s.openPaths, path] : s.openPaths,
    }));
  },

  setDraft(path, content) {
    set((s) => {
      if (content === null) return path in s.drafts ? { drafts: omit(s.drafts, path) } : s;
      if (s.drafts[path] === content) return s;
      return { drafts: { ...s.drafts, [path]: content } };
    });
  },

  reloadPreview: () => set((s) => ({ previewNonce: s.previewNonce + 1, previewErrors: [], consoleEntries: [] })),
  setPreviewPath: (previewPath) => set({ previewPath: previewPath || '/' }),
  setPreviewLoading: (previewLoading) => set({ previewLoading }),
  setBuild: (build) => set({ build }),
  setBuilding: (building) => set({ building }),

  addPreviewError(error) {
    set((s) => {
      const last = s.previewErrors[s.previewErrors.length - 1];
      // The same error often fires repeatedly (render loops); keep one copy.
      if (last && last.kind === error.kind && last.message === error.message && last.source === error.source) return s;
      const next = [...s.previewErrors, error];
      return { previewErrors: next.length > MAX_PREVIEW_ERRORS ? next.slice(next.length - MAX_PREVIEW_ERRORS) : next };
    });
  },
  clearPreviewErrors: () => set((s) => (s.previewErrors.length ? { previewErrors: [] } : s)),

  addConsoleEntry(entry) {
    set((s) => {
      const next = [...s.consoleEntries, entry];
      return { consoleEntries: next.length > MAX_CONSOLE_ENTRIES ? next.slice(next.length - MAX_CONSOLE_ENTRIES) : next };
    });
  },
  clearConsole: () => set((s) => (s.consoleEntries.length ? { consoleEntries: [] } : s)),

  setSelectMode: (selectMode) => set({ selectMode }),
  setSelectedElement: (selectedElement) => set({ selectedElement }),
  setGenerating: (generating) => set(generating ? { generating } : { generating, liveFile: null }),
  setLiveFile: (liveFile) => set({ liveFile }),

  appendLiveFile(path, delta) {
    set((s) => ({
      liveFile: s.liveFile && s.liveFile.path === path ? { path, content: s.liveFile.content + delta } : { path, content: delta },
    }));
  },

  queueChat(req) {
    set({ queuedChat: { ...req, id: ++queuedChatId } });
  },

  consumeQueuedChat() {
    const queued = get().queuedChat;
    if (queued) set({ queuedChat: null });
    return queued;
  },
}));
