import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type Ref } from 'react';
import { ArrowUp, ImagePlus, LoaderCircle, MessagesSquare, MousePointerClick, Hammer, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { LIMITS } from '@shared/constants';
import type { Attachment, ChatMode, ChatRequest, ModelId } from '@shared/types';
import { Textarea } from '@/components/ui/textarea';
import { Hint } from '@/components/ui/tooltip';
import { ModelPicker } from '@/features/home/ModelPicker';
import { useWorkspace } from '@/features/workspace/store';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { storedMode, storedModel, storeMode, storeModel } from './prefs';


interface PendingImage {
  key: string;
  preview: string;
  attachment: Attachment | null;
}

export interface ComposerHandle {
  setText(text: string): void;
  focus(): void;
}


export function Composer(props: {
  ref?: Ref<ComposerHandle>;
  projectId: string;
  generating: boolean;
  remaining: number | null;
  lastPrompt: string | null;
  onSend(request: ChatRequest): void;
  onStop(): void;
  onAddKey(): void;
}) {
  const { projectId, generating, onSend } = props;
  const t = useT('chat');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ChatMode>(storedMode);
  const [model, setModel] = useState<ModelId | null>(storedModel);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectMode = useWorkspace((s) => s.selectMode);
  const selectedElement = useWorkspace((s) => s.selectedElement);
  const queued = useWorkspace((s) => s.queuedChat);

  useImperativeHandle(props.ref, () => ({
    setText: (value: string) => {
      setText(value);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    focus: () => textareaRef.current?.focus(),
  }));

  const toggleMode = useCallback(() => {
    setMode((m) => {
      const next = m === 'build' ? 'chat' : 'build';
      storeMode(next);
      return next;
    });
  }, []);

  // Alt+P toggles Build/Chat anywhere in the workspace.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP') {
        e.preventDefault();
        toggleMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleMode]);

  useEffect(
    () => () => {
      for (const image of images) URL.revokeObjectURL(image.preview);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const picked = files.filter((f) => f.type.startsWith('image/'));
      if (picked.length === 0) return;
      const room = LIMITS.attachmentsMax - images.length;
      if (room <= 0 || picked.length > room) toast.error(t('composer.tooManyImages', { count: LIMITS.attachmentsMax }));
      for (const file of picked.slice(0, Math.max(room, 0))) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const preview = URL.createObjectURL(file);
        setImages((list) => [...list, { key, preview, attachment: null }]);
        api.uploads
          .create(file, { projectId })
          .then(({ attachment }) => setImages((list) => list.map((i) => (i.key === key ? { ...i, attachment } : i))))
          .catch(() => {
            toast.error(t('composer.uploadFailed'));
            URL.revokeObjectURL(preview);
            setImages((list) => list.filter((i) => i.key !== key));
          });
      }
    },
    [images.length, projectId, t],
  );

  const uploading = images.some((i) => !i.attachment);
  const canSend = text.trim().length > 0 && !uploading && !(generating && queued);

  const submit = useCallback(() => {
    const message = text.trim();
    if (!message || uploading) return;
    if (generating && useWorkspace.getState().queuedChat) return; // only one queued message
    const workspace = useWorkspace.getState();
    onSend({
      message,
      attachmentIds: images.map((i) => i.attachment!.id),
      selectedElement: workspace.selectedElement,
      model: model ?? undefined,
      mode,
    });
    setText('');
    for (const image of images) URL.revokeObjectURL(image.preview);
    setImages([]);
    workspace.setSelectedElement(null);
    workspace.setSelectMode(false);
  }, [generating, images, mode, model, onSend, text, uploading]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp' && text === '' && props.lastPrompt) {
      e.preventDefault();
      setText(props.lastPrompt);
    } else if (e.key === 'Escape' && selectMode) {
      useWorkspace.getState().setSelectMode(false);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const elementName = selectedElement ? (selectedElement.components?.[0] ?? selectedElement.tagName.toLowerCase()) : null;

  return (
    <div className="px-3 pb-3">
      {queued ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-[12.5px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-foreground">{t('composer.queued')}</span> · {queued.message}
          </span>
          <button type="button" aria-label={t('composer.cancelQueued')} title={t('composer.cancelQueued')} onClick={() => useWorkspace.getState().consumeQueuedChat()} className="rounded p-0.5 hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'relative rounded-2xl border border-border bg-card shadow-sm transition focus-within:border-foreground/25 focus-within:shadow-md',
          dragging && 'border-ring ring-2 ring-ring/30',
        )}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-background/85 text-sm font-medium">
            {t('composer.dropHere')}
          </div>
        ) : null}

        {images.length > 0 || elementName || selectMode ? (
          <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
            {images.map((image) => (
              <div key={image.key} className="relative size-14 overflow-hidden rounded-lg border border-border">
                <img src={image.preview} alt="" className="size-full object-cover" />
                {!image.attachment ? (
                  <div className="absolute inset-0 grid place-items-center bg-background/70" aria-label={t('composer.uploading')}>
                    <LoaderCircle className="size-4 animate-spin" />
                  </div>
                ) : null}
                <button
                  type="button"
                  aria-label={t('composer.removeImage')}
                  onClick={() => {
                    URL.revokeObjectURL(image.preview);
                    setImages((list) => list.filter((i) => i.key !== image.key));
                  }}
                  className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 shadow hover:bg-background"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {selectMode && !elementName ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-1 text-[11.5px] font-medium text-info">
                <MousePointerClick className="size-3 animate-pulse" />
                {t('composer.selectActive')}
              </span>
            ) : null}
            {elementName ? (
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11.5px]">
                <MousePointerClick className="size-3 shrink-0" />
                <span className="truncate">{t('composer.selected', { name: elementName })}</span>
                <button type="button" aria-label={t('composer.clearSelected')} onClick={() => useWorkspace.getState().setSelectedElement(null)} className="rounded-full hover:text-destructive">
                  <X className="size-3" />
                </button>
              </span>
            ) : null}
          </div>
        ) : null}

        <Textarea
          ref={textareaRef}
          unstyled
          autosize
          minRows={2}
          maxRows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          maxLength={LIMITS.messageMax}
          placeholder={mode === 'chat' ? t('composer.placeholderChat') : t('composer.placeholder')}
          aria-label={mode === 'chat' ? t('composer.placeholderChat') : t('composer.placeholder')}
          className="block w-full resize-none bg-transparent px-3.5 pt-3 text-sm outline-none placeholder:text-muted-foreground"
        />

        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <Hint label={t('composer.attach')}>
            <button type="button" onClick={() => fileRef.current?.click()} aria-label={t('composer.attach')} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <ImagePlus className="size-4" />
            </button>
          </Hint>
          <Hint label={t('composer.selectElement')}>
            <button
              type="button"
              aria-pressed={selectMode}
              aria-label={t('composer.selectElement')}
              onClick={() => {
                const workspace = useWorkspace.getState();
                if (!workspace.selectMode) workspace.setView('preview');
                workspace.setSelectMode(!workspace.selectMode);
              }}
              className={cn('rounded-lg p-1.5 transition', selectMode ? 'bg-info/15 text-info' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
            >
              <MousePointerClick className="size-4" />
            </button>
          </Hint>
          <Hint label={mode === 'build' ? t('composer.modeBuildHint') : t('composer.modeChatHint')} shortcut="Alt+P">
            <button
              type="button"
              onClick={toggleMode}
              aria-label={mode === 'build' ? t('composer.modeBuild') : t('composer.modeChat')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium transition',
                mode === 'chat' ? 'bg-info/15 text-info' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {mode === 'build' ? <Hammer className="size-3.5" /> : <MessagesSquare className="size-3.5" />}
              {mode === 'build' ? t('composer.modeBuild') : t('composer.modeChat')}
            </button>
          </Hint>
          <div className="min-w-0 flex-1" />
          <ModelPicker
            compact
            value={model}
            onChange={(id) => {
              setModel(id);
              storeModel(id);
            }}
            onAddKey={props.onAddKey}
          />
          {generating && !text.trim() ? (
            <Hint label={t('composer.stop')}>
              <button type="button" onClick={props.onStop} aria-label={t('composer.stop')} className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background transition hover:opacity-85">
                <Square className="size-3.5 fill-current" />
              </button>
            </Hint>
          ) : (
            <Hint label={generating ? t('composer.queued') : t('composer.send')} shortcut="Enter">
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                aria-label={t('composer.send')}
                className="grid size-8 shrink-0 place-items-center rounded-full bg-send transition hover:scale-105 hover:brightness-105 disabled:cursor-not-allowed disabled:bg-none disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:hover:scale-100"
              >
                {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </button>
            </Hint>
          )}
        </div>
      </div>

      {props.remaining !== null && props.remaining <= 10 ? (
        <p className="mt-1.5 px-1 text-[11.5px] text-muted-foreground">{t('composer.remaining', { count: props.remaining })}</p>
      ) : null}
    </div>
  );
}
