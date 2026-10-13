import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import {
  ArrowUp,
  Briefcase,
  Coffee,
  GraduationCap,
  Heart,
  ImagePlus,
  LoaderCircle,
  Send,
  ShoppingBag,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { ALLOWED_UPLOAD_MIME, LIMITS } from '@shared/constants';
import type { ModelId } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Hint } from '@/components/ui/tooltip';
import { ConnectAiDialog } from '@/features/settings/ConnectAiDialog';
import { useErrorMessage, useT } from '@/i18n';
import { api, isAbortError } from '@/lib/api';
import { FOCUS_PROMPT_EVENT } from '@/components/common/AppSidebar';
import { pulse, usePointerGlow } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ModelPicker } from './ModelPicker';

export interface PromptBoxInput {
  prompt: string;
  attachmentIds: string[];
  model: ModelId | null;
}

export interface PromptBoxProps {
  onSubmit: (input: PromptBoxInput) => void | Promise<void>;
  busy?: boolean;
  guest?: boolean;
  autoFocus?: boolean;
}

interface PendingImage {
  key: string;
  name: string;
  previewUrl: string;
  status: 'uploading' | 'ready';
  attachmentId: string | null;
}

const EXAMPLES = [
  { key: 'wedding', icon: Heart },
  { key: 'teahouse', icon: Coffee },
  { key: 'courses', icon: GraduationCap },
  { key: 'telegram', icon: Send },
  { key: 'portfolio', icon: Briefcase },
  { key: 'shop', icon: ShoppingBag },
] as const satisfies ReadonlyArray<{ key: string; icon: LucideIcon }>;

const PLACEHOLDER_INTERVAL_MS = 4000;
const ALLOWED_MIME: readonly string[] = ALLOWED_UPLOAD_MIME;

let imageSeq = 0;

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** Hero composer: prompt textarea, image attachments, model picker and example chips. */
export function PromptBox({ onSubmit, busy = false, guest = false, autoFocus = false }: PromptBoxProps) {
  const t = useT('home');
  const errorMessage = useErrorMessage();
  const fieldId = useId();

  const [text, setText] = useState('');
  const [model, setModel] = useState<ModelId | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [images, setImages] = useState<PendingImage[]>([]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<PendingImage[]>([]);
  const controllersRef = useRef(new Map<string, AbortController>());
  const dragDepthRef = useRef(0);

  const placeholders = useMemo(
    () => [
      t('prompt.placeholder1'),
      t('prompt.placeholder2'),
      t('prompt.placeholder3'),
      t('prompt.placeholder4'),
      t('prompt.placeholder5'),
    ],
    [t],
  );

  // Rotate the example placeholder while the field is empty.
  const isEmpty = text.length === 0;
  useEffect(() => {
    if (!isEmpty) return;
    const timer = window.setInterval(() => setPlaceholderIndex((i) => i + 1), PLACEHOLDER_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isEmpty]);

  const commitImages = useCallback((update: (prev: PendingImage[]) => PendingImage[]) => {
    imagesRef.current = update(imagesRef.current);
    setImages(imagesRef.current);
  }, []);

  // Abort uploads and release object URLs when the composer goes away.
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
    };
  }, []);

  const focusField = useCallback((moveCaretToEnd = false) => {
    const field = wrapperRef.current?.querySelector('textarea');
    if (!field) return;
    field.focus();
    if (moveCaretToEnd) {
      const end = field.value.length;
      field.setSelectionRange(end, end);
    }
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      if (guest || files.length === 0) return;
      const accepted = files.filter((file) => ALLOWED_MIME.includes(file.type));
      if (accepted.length < files.length) toast.error(t('prompt.onlyImages'));

      const room = Math.max(0, LIMITS.attachmentsMax - imagesRef.current.length);
      if (accepted.length > room) toast.error(t('prompt.attachLimit', { max: LIMITS.attachmentsMax }));

      for (const file of accepted.slice(0, room)) {
        imageSeq += 1;
        const key = `img-${imageSeq}`;
        const name = file.name || 'image';
        const previewUrl = URL.createObjectURL(file);
        const controller = new AbortController();
        controllersRef.current.set(key, controller);
        commitImages((prev) => [...prev, { key, name, previewUrl, status: 'uploading', attachmentId: null }]);

        api.uploads
          .create(file, { signal: controller.signal })
          .then((res) => {
            commitImages((prev) =>
              prev.map((image) => (image.key === key ? { ...image, status: 'ready', attachmentId: res.attachment.id } : image)),
            );
          })
          .catch((error: unknown) => {
            if (isAbortError(error)) return;
            URL.revokeObjectURL(previewUrl);
            commitImages((prev) => prev.filter((image) => image.key !== key));
            toast.error(t('prompt.uploadFailed', { name }), { description: errorMessage(error) });
          })
          .finally(() => {
            controllersRef.current.delete(key);
          });
      }
    },
    [commitImages, errorMessage, guest, t],
  );

  const removeImage = useCallback(
    (key: string) => {
      controllersRef.current.get(key)?.abort();
      controllersRef.current.delete(key);
      const image = imagesRef.current.find((item) => item.key === key);
      if (image) URL.revokeObjectURL(image.previewUrl);
      commitImages((prev) => prev.filter((item) => item.key !== key));
    },
    [commitImages],
  );

  const uploading = images.some((image) => image.status === 'uploading');
  useEffect(() => {
    const onFocusRequest = () => focusField(true);
    window.addEventListener(FOCUS_PROMPT_EVENT, onFocusRequest);
    return () => window.removeEventListener(FOCUS_PROMPT_EVENT, onFocusRequest);
  }, [focusField]);
  usePointerGlow(wrapperRef);

  const working = busy || submitting;
  const canSubmit = text.trim().length > 0 && !working && !uploading;

  const submit = useCallback(async () => {
    const prompt = text.trim();
    if (!prompt || working) return;
    if (uploading) {
      toast.info(t('prompt.waitUploads'));
      return;
    }
    const attachmentIds = imagesRef.current.flatMap((image) => (image.attachmentId ? [image.attachmentId] : []));
    setSubmitting(true);
    try {
      await onSubmit({ prompt, attachmentIds, model });
    } finally {
      setSubmitting(false);
    }
  }, [model, onSubmit, t, text, uploading, working]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // Enter that confirms an IME composition must not send the prompt.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void submit();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (guest) return;
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (guest || !hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragging(true);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (guest || !hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (guest || !hasFiles(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (guest || !hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const fillExample = (prompt: string) => {
    setText(prompt);
    // Wait for the controlled value to land before moving the caret.
    window.requestAnimationFrame(() => focusField(true));
  };

  const attachFull = images.length >= LIMITS.attachmentsMax;

  return (
    <div className="w-full">
      <div ref={wrapperRef} className="group/prompt relative">
        {/* Warm halo behind the card; it brightens while typing */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-3 rounded-[2.25rem] bg-[radial-gradient(60%_80%_at_50%_100%,color-mix(in_oklab,var(--brand-to)_38%,transparent),transparent)] opacity-50 blur-2xl transition-opacity duration-500 group-focus-within/prompt:opacity-90"
        />

        <div
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            'glass-strong relative overflow-hidden rounded-[1.75rem] text-left transition-[border-color,box-shadow] duration-300',
            dragging && 'border-primary',
          )}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/prompt:opacity-100"
            style={{
              background:
                'radial-gradient(420px circle at var(--glow-x, 50%) var(--glow-y, 0%), color-mix(in oklab, var(--brand-to) 16%, transparent), transparent 70%)',
            }}
          />
          <label htmlFor={fieldId} className="sr-only">
            {t('prompt.label')}
          </label>

          {images.length > 0 ? (
            <ul className="flex flex-wrap gap-2 px-4 pt-4 sm:px-5">
              {images.map((image) => (
                <li
                  key={image.key}
                  className="group/thumb relative size-16 animate-scale-in overflow-hidden rounded-xl border border-border bg-muted"
                >
                  <img src={image.previewUrl} alt={image.name} className="size-full object-cover" draggable={false} />
                  {image.status === 'uploading' ? (
                    <span
                      role="status"
                      aria-label={t('prompt.uploading')}
                      className="absolute inset-0 flex items-center justify-center bg-background/70"
                    >
                      <LoaderCircle className="size-4 animate-spin text-foreground" />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeImage(image.key)}
                    aria-label={t('prompt.removeAttachment', { name: image.name })}
                    className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-90 shadow-sm transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring sm:opacity-0 sm:group-hover/thumb:opacity-90 sm:focus-visible:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="relative">
            {isEmpty ? (
              <span
                key={placeholderIndex}
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 line-clamp-3 animate-fade-in px-5 pt-5 text-base leading-relaxed text-foreground/50 sm:px-8 sm:pt-7 sm:text-xl"
              >
                {placeholders[placeholderIndex % placeholders.length]}
              </span>
            ) : null}
            <Textarea
              id={fieldId}
              unstyled
              autosize
              minRows={2}
              maxRows={12}
              autoFocus={autoFocus}
              value={text}
              readOnly={working}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              aria-describedby={`${fieldId}-hint`}
              className="scrollbar-thin relative block w-full resize-none border-0 bg-transparent px-5 pt-5 text-base leading-relaxed text-foreground outline-none sm:px-8 sm:pt-7 sm:text-xl"
            />
          </div>

          <div className="relative flex items-center gap-2.5 px-4 pb-4 pt-3 sm:px-7 sm:pb-6 sm:pt-4">
            {guest ? (
              <Hint label={t('prompt.attachGuest')}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-disabled="true"
                  aria-label={t('prompt.attachGuest')}
                  onClick={() => toast.info(t('prompt.attachGuest'))}
                  className="glass-control size-11 cursor-not-allowed rounded-xl text-foreground/80 opacity-60 sm:size-12 [&_svg]:size-5"
                >
                  <ImagePlus />
                </Button>
              </Hint>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_MIME.join(',')}
                  multiple
                  hidden
                  tabIndex={-1}
                  onChange={onFileInput}
                />
                <Hint label={attachFull ? t('prompt.attachLimit', { max: LIMITS.attachmentsMax }) : t('prompt.attach')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('prompt.attach')}
                    aria-disabled={attachFull}
                    onClick={() => {
                      if (attachFull) {
                        toast.error(t('prompt.attachLimit', { max: LIMITS.attachmentsMax }));
                        return;
                      }
                      fileInputRef.current?.click();
                    }}
                    className={cn('glass-control size-11 rounded-xl text-foreground/85 hover:text-foreground sm:size-12 [&_svg]:size-5', attachFull && 'opacity-50')}
                  >
                    <ImagePlus />
                  </Button>
                </Hint>
                <div className="min-w-0">
                  <ModelPicker value={model} onChange={setModel} onAddKey={() => setConnectOpen(true)} />
                </div>
              </>
            )}

            <p id={`${fieldId}-hint`} className="ml-auto hidden truncate pr-2 text-xs text-muted-foreground md:block">
              {t('prompt.hint')}
            </p>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              loading={working}
              disabled={!canSubmit && !working}
              onClick={(event) => {
                pulse(event.currentTarget);
                void submit();
              }}
              aria-label={working ? t('prompt.creating') : t('prompt.submit')}
              className="bg-send ml-auto size-12 shrink-0 rounded-full transition-transform duration-200 hover:scale-105 hover:brightness-105 disabled:opacity-55 disabled:saturate-[0.7] sm:size-14 md:ml-0 [&_svg]:size-5 sm:[&_svg]:size-6"
            >
              <ArrowUp />
            </Button>
          </div>

          {dragging ? (
            <div className="pointer-events-none absolute inset-0 flex animate-fade-in items-center justify-center gap-2 rounded-[1.75rem] bg-background/80 text-sm font-medium text-foreground backdrop-blur-sm">
              <ImagePlus className="size-5" />
              {t('prompt.dropHint')}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('prompt.examplesLabel')}</p>
        <ul className="flex flex-wrap justify-center gap-2">
          {EXAMPLES.map(({ key, icon: Icon }) => (
            <li key={key}>
              <button
                type="button"
                disabled={working}
                onClick={() => fillExample(t(`examples.${key}.prompt`))}
                className="glass-control inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm text-foreground/75 backdrop-blur-md hover:-translate-y-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <Icon className="size-3.5" />
                {t(`examples.${key}.label`)}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {guest ? null : <ConnectAiDialog open={connectOpen} onOpenChange={setConnectOpen} />}
    </div>
  );
}
