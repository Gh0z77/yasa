import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Brain,
  CircleCheck,
  CircleX,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  Plug,
  Server,
  Sparkles,
  Trash,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { KeyProvider } from '@shared/types';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage, useLocale, useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { useApiKeys, useDeleteApiKey, useModels, useSetApiKey, useTestApiKey } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Static provider metadata (shared with ConnectAiDialog)
// ---------------------------------------------------------------------------
export const KEY_PROVIDER_ORDER: readonly KeyProvider[] = ['gemini', 'openai', 'anthropic'];

export const PROVIDER_KEY_LINKS: Record<KeyProvider, string> = {
  gemini: 'https://aistudio.google.com/apikey',
  openai: 'https://openrouter.ai/keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
};

const PROVIDER_ICONS: Record<KeyProvider, LucideIcon> = {
  gemini: Sparkles,
  openai: Plug,
  anthropic: Brain,
};

export function ProviderIcon({ provider, className }: { provider: KeyProvider; className?: string }) {
  const Icon = PROVIDER_ICONS[provider];
  return <Icon className={className} aria-hidden="true" />;
}

interface Preset {
  id: string;
  /** Brand name — not translated. */
  label: string;
  baseUrl: string;
  model: string;
}

const PRESETS: readonly Preset[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: '' },
  { id: 'nvidia', label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'nvidia/nemotron-3-super-120b-a12b' },
  ...(import.meta.env.DEV
    ? [{ id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: '' }]
    : []),
];

/** The preset the OpenAI-compatible form starts with inside the onboarding dialog. */
export const OPENROUTER_PRESET = { baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' } as const;

const KEY_MIN = 8;
const KEY_MAX = 500;
const BASE_URL_MAX = 300;
const MODEL_MAX = 120;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, '').toLowerCase();

type KeyError = 'keyRequired' | 'keyTooShort' | 'keyTooLong' | 'keyWhitespace';
type UrlError = 'urlInvalid' | 'urlHttps';
type ModelError = 'modelRequired' | 'modelTooLong';

interface FormErrors {
  apiKey?: KeyError;
  baseUrl?: UrlError;
  model?: ModelError;
}

/** Mirrors `SetApiKeySchema` + the provider rules of `PUT /api/me/api-keys/:provider`. */
export function validateKeyForm(
  provider: KeyProvider,
  values: { apiKey: string; baseUrl: string; model: string },
  allowLocalHttp: boolean = import.meta.env.DEV,
): FormErrors {
  const errors: FormErrors = {};
  const apiKey = values.apiKey.trim();
  if (!apiKey) errors.apiKey = 'keyRequired';
  else if (/\s/.test(apiKey)) errors.apiKey = 'keyWhitespace';
  else if (apiKey.length < KEY_MIN) errors.apiKey = 'keyTooShort';
  else if (apiKey.length > KEY_MAX) errors.apiKey = 'keyTooLong';

  if (provider !== 'openai') return errors;

  const baseUrl = values.baseUrl.trim();
  const model = values.model.trim();
  let official = true;
  if (baseUrl) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(baseUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || baseUrl.length > BASE_URL_MAX || !parsed.hostname || parsed.username || parsed.password) {
      errors.baseUrl = 'urlInvalid';
    } else if (parsed.protocol === 'https:') {
      official = parsed.hostname === 'api.openai.com';
    } else if (parsed.protocol === 'http:' && allowLocalHttp && LOCAL_HOSTS.has(parsed.hostname)) {
      official = false;
    } else {
      // Plain http (outside local development) and every other scheme are rejected by the server.
      errors.baseUrl = 'urlHttps';
    }
  }
  if (model.length > MODEL_MAX) errors.model = 'modelTooLong';
  else if (!errors.baseUrl && !official && !model) errors.model = 'modelRequired';
  return errors;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export interface ProviderKeyCardProps {
  provider: KeyProvider;
  /** Borderless variant for the onboarding dialog: no header, one "Save and test" action. */
  compact?: boolean;
  /** Test the key right after saving it (always on in `compact` mode). */
  autoTest?: boolean;
  /** Prefill for the OpenAI-compatible form when no key is saved yet. */
  initialPreset?: { baseUrl: string; model: string };
  /** Runs after the key was saved AND passed the test (only with `autoTest` / `compact`). */
  onConnected?: (provider: KeyProvider) => void | Promise<void>;
  className?: string;
}

type Phase = 'idle' | 'saving' | 'testing' | 'finishing';

export function ProviderKeyCard({
  provider,
  compact = false,
  autoTest = compact,
  initialPreset,
  onConnected,
  className,
}: ProviderKeyCardProps) {
  const t = useT('settings');
  const { locale } = useLocale();
  const errorMessage = useErrorMessage();
  const uid = useId();
  const ids = {
    key: `${uid}-key`,
    keyError: `${uid}-key-error`,
    url: `${uid}-url`,
    urlHint: `${uid}-url-hint`,
    urlError: `${uid}-url-error`,
    model: `${uid}-model`,
    modelHint: `${uid}-model-hint`,
    modelError: `${uid}-model-error`,
    title: `${uid}-title`,
  };

  const keysQuery = useApiKeys();
  const modelsQuery = useModels();
  const setKey = useSetApiKey();
  const testKey = useTestApiKey();
  const deleteKey = useDeleteApiKey();

  const keyInfo = useMemo(
    () => keysQuery.data?.find((k) => k.provider === provider) ?? null,
    [keysQuery.data, provider],
  );
  const usesServerKey = useMemo(
    () =>
      !keyInfo &&
      (modelsQuery.data?.models.some((m) => m.provider === provider && m.available && m.keySource === 'server') ?? false),
    [keyInfo, modelsQuery.data, provider],
  );

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(initialPreset?.baseUrl ?? '');
  const [model, setModel] = useState(initialPreset?.model ?? '');
  const [errors, setErrors] = useState<FormErrors>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<{ ok: boolean; title: string; message?: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const keyRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const touchedRef = useRef(false);

  // Show the saved base URL / model until the user starts editing them.
  const savedBaseUrl = keyInfo?.baseUrl ?? null;
  const savedModel = keyInfo?.model ?? null;
  const hasSavedKey = keyInfo !== null;
  useEffect(() => {
    if (provider !== 'openai' || touchedRef.current || !hasSavedKey) return;
    setBaseUrl(savedBaseUrl ?? '');
    setModel(savedModel ?? '');
  }, [provider, hasSavedKey, savedBaseUrl, savedModel]);

  const busy = phase !== 'idle';
  const providerName = t(`providers.${provider}.name`);
  const activePreset = PRESETS.find((p) => normalizeUrl(p.baseUrl) === normalizeUrl(baseUrl))?.id ?? null;

  function applyPreset(preset: Preset) {
    touchedRef.current = true;
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setErrors((prev) => ({ ...prev, baseUrl: undefined, model: undefined }));
    setResult(null);
    // Move on to whatever is still missing.
    (preset.model || preset.id === 'openai' ? keyRef : modelRef).current?.focus();
  }

  async function runTest(): Promise<boolean> {
    setPhase('testing');
    try {
      const res = await testKey.mutateAsync(provider);
      setResult({
        ok: res.ok,
        title: res.ok ? t('key.testOk') : autoTest ? t('connect.failed') : t('key.testFailed'),
        message: res.message,
      });
      return res.ok;
    } catch (err) {
      setResult({
        ok: false,
        title: autoTest ? t('connect.failed') : t('key.testFailed'),
        message: errorMessage(err),
      });
      return false;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const found = validateKeyForm(provider, { apiKey, baseUrl, model });
    setErrors(found);
    if (found.apiKey) return void keyRef.current?.focus();
    if (found.baseUrl) return void urlRef.current?.focus();
    if (found.model) return void modelRef.current?.focus();

    setResult(null);
    setPhase('saving');
    try {
      await setKey.mutateAsync(
        provider === 'openai'
          ? { provider, apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || null, model: model.trim() || null }
          : { provider, apiKey: apiKey.trim() },
      );
    } catch (err) {
      setPhase('idle');
      setResult({ ok: false, title: errorMessage(err) });
      return;
    }

    if (!autoTest) {
      setApiKey('');
      setShowKey(false);
      setPhase('idle');
      toast.success(t('key.saved'));
      return;
    }

    const ok = await runTest();
    if (ok) {
      setApiKey('');
      setShowKey(false);
      if (onConnected) {
        setPhase('finishing');
        try {
          await onConnected(provider);
        } catch {
          // The key itself is saved and works; the caller reports its own errors.
        }
      }
    }
    setPhase('idle');
  }

  async function handleTest() {
    if (busy || !keyInfo) return;
    setResult(null);
    await runTest();
    setPhase('idle');
  }

  async function handleRemove() {
    try {
      await deleteKey.mutateAsync(provider);
      touchedRef.current = false;
      setApiKey('');
      setBaseUrl(initialPreset?.baseUrl ?? '');
      setModel(initialPreset?.model ?? '');
      setErrors({});
      setResult(null);
      toast.success(t('key.removed'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // ---- pieces -------------------------------------------------------------
  let status: ReactNode;
  if (keysQuery.isPending) {
    status = <Skeleton className="h-6 w-28 rounded-full" />;
  } else if (keyInfo) {
    status = (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="success" className="gap-1">
          <CircleCheck className="size-3.5" aria-hidden="true" />
          <span>{t('key.status.connectedMask', { last4: keyInfo.last4 })}</span>
        </Badge>
        <span className="text-xs text-muted-foreground">
          {t('key.status.since', { date: formatDate(keyInfo.createdAt, locale) })}
        </span>
      </span>
    );
  } else if (usesServerKey) {
    status = (
      <Badge variant="info" className="gap-1">
        <Server className="size-3.5" aria-hidden="true" />
        <span>{t('key.status.server')}</span>
      </Badge>
    );
  } else {
    status = <Badge variant="outline">{t('key.status.none')}</Badge>;
  }

  const fieldError = (id: string, message: string | null) =>
    message ? (
      <p id={id} role="alert" className="text-sm text-destructive">
        {message}
      </p>
    ) : null;

  const form = (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4" aria-labelledby={compact ? undefined : ids.title}>
      {provider === 'openai' && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground" id={`${uid}-presets`}>
            {t('key.presets')}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${uid}-presets`}>
            {PRESETS.map((preset) => {
              const active = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={active}
                  disabled={busy}
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                    'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45 disabled:pointer-events-none disabled:opacity-50',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:bg-muted',
                  )}
                >
                  {preset.id === 'groq' && <Zap className="size-3" aria-hidden="true" />}
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={ids.key}>{keyInfo ? t('key.replaceLabel') : t('key.label')}</Label>
        <div className="relative">
          <Input
            ref={keyRef}
            id={ids.key}
            name={`${provider}-api-key`}
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              if (errors.apiKey) setErrors((prev) => ({ ...prev, apiKey: undefined }));
            }}
            placeholder={keyInfo ? t('key.replacePlaceholder') : t(`providers.${provider}.keyPlaceholder`)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            disabled={busy}
            aria-invalid={errors.apiKey ? true : undefined}
            aria-describedby={errors.apiKey ? ids.keyError : undefined}
            className="pr-11 font-mono text-sm"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            aria-label={showKey ? t('key.hide') : t('key.show')}
            aria-pressed={showKey}
            title={showKey ? t('key.hide') : t('key.show')}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45"
          >
            {showKey ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        </div>
        {fieldError(ids.keyError, errors.apiKey ? t(`key.errors.${errors.apiKey}`) : null)}
      </div>

      {provider === 'openai' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={ids.url}>{t('key.baseUrl')}</Label>
            <Input
              ref={urlRef}
              id={ids.url}
              name="openai-base-url"
              type="url"
              inputMode="url"
              value={baseUrl}
              onChange={(e) => {
                touchedRef.current = true;
                setBaseUrl(e.target.value);
                if (errors.baseUrl || errors.model) setErrors((prev) => ({ ...prev, baseUrl: undefined, model: undefined }));
              }}
              placeholder={t('key.baseUrlPlaceholder')}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={BASE_URL_MAX}
              disabled={busy}
              aria-invalid={errors.baseUrl ? true : undefined}
              aria-describedby={errors.baseUrl ? ids.urlError : ids.urlHint}
              className="font-mono text-sm"
            />
            {errors.baseUrl ? (
              fieldError(ids.urlError, t(`key.errors.${errors.baseUrl}`))
            ) : (
              <p id={ids.urlHint} className="text-xs text-muted-foreground">
                {t('key.baseUrlHint')}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.model}>{t('key.model')}</Label>
            <Input
              ref={modelRef}
              id={ids.model}
              name="openai-model"
              value={model}
              onChange={(e) => {
                touchedRef.current = true;
                setModel(e.target.value);
                if (errors.model) setErrors((prev) => ({ ...prev, model: undefined }));
              }}
              placeholder={t('key.modelPlaceholder')}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={MODEL_MAX}
              disabled={busy}
              aria-invalid={errors.model ? true : undefined}
              aria-describedby={errors.model ? ids.modelError : ids.modelHint}
              className="font-mono text-sm"
            />
            {errors.model ? (
              fieldError(ids.modelError, t(`key.errors.${errors.model}`))
            ) : (
              <p id={ids.modelHint} className="text-xs text-muted-foreground">
                {t('key.modelHint')}
              </p>
            )}
          </div>
        </div>
      )}

      <div aria-live="polite" role="status">
        {phase === 'testing' && compact && (
          <p className="text-sm text-muted-foreground">{t('connect.checking')}</p>
        )}
        {result && phase !== 'testing' && (
          <div
            className={cn(
              'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm animate-fade-in',
              result.ok ? 'border-success/30 bg-success/10' : 'border-destructive/30 bg-destructive/10',
            )}
          >
            {result.ok ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            )}
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium text-foreground">{result.title}</p>
              {result.message ? <p className="break-words text-muted-foreground">{result.message}</p> : null}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={phase === 'saving' || (autoTest && busy)} disabled={busy} className={cn(compact && 'w-full sm:w-auto')}>
          {autoTest ? t('key.saveAndTest') : keyInfo ? t('key.update') : t('key.save')}
        </Button>
        {!compact && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleTest()}
            loading={phase === 'testing' && !autoTest}
            disabled={busy || !keyInfo}
          >
            {phase === 'testing' ? t('key.testing') : t('key.test')}
          </Button>
        )}
        {!compact && keyInfo && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirmRemove(true)}
            disabled={busy}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive sm:ml-auto"
          >
            <Trash className="size-4" aria-hidden="true" />
            {t('key.remove')}
          </Button>
        )}
      </div>

      <ul className="space-y-1 text-xs text-muted-foreground">
        <li className="flex items-start gap-1.5">
          <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>{t('key.notes.encrypted')}</span>
        </li>
        <li className="flex items-start gap-1.5">
          <Zap className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>{t('key.notes.noLimit')}</span>
        </li>
      </ul>
    </form>
  );

  if (compact) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex min-h-6 items-center">{status}</div>
        {form}
      </div>
    );
  }

  return (
    <section
      aria-labelledby={ids.title}
      className={cn('rounded-xl border border-border bg-card text-card-foreground shadow-sm', className)}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6 sm:pb-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground">
            <ProviderIcon provider={provider} className="size-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <h3 id={ids.title} className="text-base font-semibold leading-tight text-foreground">
              {providerName}
            </h3>
            <p className="text-sm text-muted-foreground">{t(`providers.${provider}.description`)}</p>
            <a
              href={PROVIDER_KEY_LINKS[provider]}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45"
            >
              {t(`providers.${provider}.linkLabel`)}
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only">({t('key.opensInNewTab')})</span>
            </a>
          </div>
        </div>
        <div className="shrink-0 sm:pt-0.5">{status}</div>
      </div>
      <div className="border-t border-border p-4 sm:p-6">{form}</div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('key.removeTitle', { provider: providerName })}
        description={t('key.removeDescription')}
        confirmLabel={t('key.remove')}
        destructive
        onConfirm={handleRemove}
      />
    </section>
  );
}
