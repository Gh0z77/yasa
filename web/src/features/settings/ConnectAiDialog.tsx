import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import type { KeyProvider, ModelInfo, ModelTier } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useErrorMessage, useT } from '@/i18n';
import { useModels, useUpdateMe } from '@/lib/queries';
import { cn } from '@/lib/utils';
import {
  KEY_PROVIDER_ORDER,
  OPENROUTER_PRESET,
  PROVIDER_KEY_LINKS,
  ProviderIcon,
  ProviderKeyCard,
} from './ProviderKeyCard';

const TIER_RANK: Record<ModelTier, number> = { best: 0, balanced: 1, fast: 2, demo: 3 };

/** The strongest available model of a provider (tier `best` first). */
export function pickBestModel(models: readonly ModelInfo[], provider: KeyProvider): ModelInfo | null {
  const candidates = models.filter((m) => m.provider === provider && m.available);
  if (candidates.length === 0) return null;
  // Prefer models that run on the user's own key, then the better tier; keep catalog order otherwise.
  return [...candidates].sort(
    (a, b) =>
      Number(b.keySource === 'user') - Number(a.keySource === 'user') || TIER_RANK[a.tier] - TIER_RANK[b.tier],
  )[0] ?? null;
}

const LINK_SLOT = '%LINK%';

function ConnectAiBody({ onDone }: { onDone: () => void }) {
  const t = useT('settings');
  const errorMessage = useErrorMessage();
  const uid = useId();
  const [provider, setProvider] = useState<KeyProvider>('gemini');
  const radioRefs = useRef<Partial<Record<KeyProvider, HTMLButtonElement | null>>>({});
  const modelsQuery = useModels();
  const updateMe = useUpdateMe();

  function onRadioKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = KEY_PROVIDER_ORDER.indexOf(provider);
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % KEY_PROVIDER_ORDER.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (index - 1 + KEY_PROVIDER_ORDER.length) % KEY_PROVIDER_ORDER.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = KEY_PROVIDER_ORDER.length - 1;
    else return;
    event.preventDefault();
    const target = KEY_PROVIDER_ORDER[next];
    if (!target) return;
    setProvider(target);
    radioRefs.current[target]?.focus();
  }

  async function handleConnected(connected: KeyProvider) {
    const providerName = t(`providers.${connected}.name`);
    let best: ModelInfo | null = null;
    try {
      const fresh = await modelsQuery.refetch();
      best = fresh.data ? pickBestModel(fresh.data.models, connected) : null;
      if (best) await updateMe.mutateAsync({ defaultModel: best.id });
    } catch (err) {
      // The key works; only the "make it the default" step failed.
      best = null;
      toast.error(errorMessage(err));
    }
    toast.success(
      best
        ? t('connect.successModel', { provider: providerName, model: best.label })
        : t('connect.success', { provider: providerName }),
    );
    onDone();
  }

  const [beforeLink, afterLink] = t('connect.steps.open', { link: LINK_SLOT }).split(LINK_SLOT);
  const steps = [
    <>
      {beforeLink}
      <a
        href={PROVIDER_KEY_LINKS[provider]}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 hover:underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45"
      >
        {t(`connect.links.${provider}`)}
        <ExternalLink className="size-3.5" aria-hidden="true" />
        <span className="sr-only">({t('key.opensInNewTab')})</span>
      </a>
      {afterLink}
    </>,
    provider === 'gemini' ? t('connect.steps.createGemini') : t('connect.steps.create'),
    t('connect.steps.paste'),
  ];

  return (
    <div className="min-w-0 space-y-5">
      <div role="radiogroup" aria-label={t('connect.choose')} className="grid grid-cols-3 gap-2 sm:gap-3">
        {KEY_PROVIDER_ORDER.map((p) => {
          const selected = p === provider;
          return (
            <button
              key={p}
              ref={(el) => {
                radioRefs.current[p] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setProvider(p)}
              onKeyDown={onRadioKeyDown}
              className={cn(
                'relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-colors sm:items-start sm:px-3 sm:text-left',
                'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45',
                selected
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border bg-card hover:border-foreground/20 hover:bg-muted/60',
              )}
            >
              {p === 'gemini' && (
                <Badge variant="success" className="absolute -top-2 right-1.5 px-1.5 py-0 text-[0.6875rem] sm:right-2">
                  {t('connect.options.gemini.badge')}
                </Badge>
              )}
              <span
                className={cn(
                  'flex size-8 items-center justify-center rounded-lg border',
                  selected ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-foreground',
                )}
              >
                <ProviderIcon provider={p} className="size-4" />
              </span>
              <span className="w-full truncate text-sm font-semibold text-foreground">{t(`connect.options.${p}.name`)}</span>
              <span className="hidden w-full text-xs leading-snug text-muted-foreground sm:block">
                {t(`connect.options.${p}.hint`)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-border bg-muted/40 p-3 sm:p-4">
        <p id={`${uid}-steps`} className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('connect.stepsTitle')}
        </p>
        <ol aria-labelledby={`${uid}-steps`} className="space-y-2.5">
          {steps.map((step, index) => (
            <li key={index} className="flex items-start gap-2.5 text-sm text-foreground">
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[0.6875rem] font-semibold tabular-nums text-primary-foreground"
              >
                {index + 1}
              </span>
              <span className="min-w-0 leading-5">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <ProviderKeyCard
        key={provider}
        provider={provider}
        compact
        initialPreset={provider === 'openai' ? OPENROUTER_PRESET : undefined}
        onConnected={handleConnected}
      />

      <div className="border-t border-border pt-3">
        <Link
          to="/settings?tab=ai"
          onClick={onDone}
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45"
        >
          {t('connect.manage')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

export function ConnectAiDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { open, onOpenChange } = props;
  const t = useT('settings');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="p-4 scrollbar-thin sm:p-6">
        <DialogHeader>
          <DialogTitle>{t('connect.title')}</DialogTitle>
          <DialogDescription>{t('connect.description')}</DialogDescription>
        </DialogHeader>
        {open && <ConnectAiBody onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
