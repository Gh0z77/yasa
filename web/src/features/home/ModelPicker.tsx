import { Fragment, useMemo } from 'react';
import { Check, ChevronDown, FlaskConical, KeyRound, Lock, Rabbit, Scale, Sparkles, type LucideIcon } from 'lucide-react';
import type { ModelId, ModelInfo, ModelTier, ProviderId } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import { useModels } from '@/lib/queries';
import { cn } from '@/lib/utils';

const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'gemini', 'openrouter', 'nvidia', 'openai', 'mock'];

const TIER_ICONS: Record<ModelTier, LucideIcon> = {
  best: Sparkles,
  balanced: Scale,
  fast: Rabbit,
  demo: FlaskConical,
};

/** The model that is effectively used when `value` is null or no longer available. */
export function resolveSelectedModel(models: ModelInfo[], value: ModelId | null, defaultModel: ModelId | null): ModelInfo | null {
  const byId = (id: ModelId | null) => (id ? models.find((m) => m.id === id && m.available) : undefined);
  return byId(value) ?? byId(defaultModel) ?? models.find((m) => m.available) ?? null;
}

export function ModelPicker(props: {
  value: ModelId | null;
  onChange: (id: ModelId) => void;
  compact?: boolean;
  onAddKey?: () => void;
}) {
  const { value, onChange, compact = false, onAddKey } = props;
  const t = useT('common');
  const { data, isPending } = useModels();

  const models = useMemo(() => data?.models ?? [], [data]);
  const selected = useMemo(() => resolveSelectedModel(models, value, data?.defaultModel ?? null), [models, value, data]);

  const groups = useMemo(() => {
    const out: Array<{ provider: ProviderId; models: ModelInfo[] }> = [];
    for (const provider of PROVIDER_ORDER) {
      const list = models.filter((m) => m.provider === provider);
      if (list.length > 0) out.push({ provider, models: list });
    }
    return out;
  }, [models]);

  if (isPending) {
    return <Skeleton className={cn('rounded-md', compact ? 'h-7 w-24' : 'h-8 w-36')} />;
  }

  const SelectedIcon = selected ? TIER_ICONS[selected.tier] : Sparkles;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${t('models.label')}: ${selected?.label ?? t('models.choose')}`}
          className={cn(
            'max-w-full gap-1.5 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
            compact ? 'h-7 px-2 text-xs' : 'px-2.5',
          )}
        >
          <SelectedIcon className={compact ? 'size-3.5' : 'size-4'} />
          <span className={cn('truncate', compact ? 'max-w-28' : 'max-w-44')}>{selected?.label ?? t('models.choose')}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-1rem)]">
        {groups.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">{t('models.none')}</p>
        ) : null}
        {groups.map((group, index) => (
          <Fragment key={group.provider}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{t(`models.provider.${group.provider}`)}</DropdownMenuLabel>
            {group.models.map((model) => {
              const Icon = TIER_ICONS[model.tier];
              const isSelected = selected?.id === model.id;
              const locked = !model.available;
              return (
                <DropdownMenuItem
                  key={model.id}
                  role="menuitemradio"
                  aria-checked={isSelected}
                  disabled={locked && !onAddKey}
                  onSelect={() => (locked ? onAddKey?.() : onChange(model.id))}
                  className={cn('items-start gap-2.5 py-2', locked && 'text-muted-foreground')}
                >
                  <Icon className={cn('mt-0.5 size-4', isSelected && 'text-foreground')} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className={cn('truncate font-medium', !locked && 'text-foreground')}>{model.label}</span>
                      {model.id === data?.defaultModel ? (
                        <Badge variant="secondary" className="px-1.5 text-[10px]">
                          {t('models.default')}
                        </Badge>
                      ) : null}
                      {model.available && model.keySource === 'user' ? (
                        <Badge variant="outline" className="px-1.5 text-[10px]">
                          <KeyRound />
                          {t('models.yourKey')}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-xs leading-snug text-muted-foreground">
                      {locked ? t('models.locked') : t(`models.tierHint.${model.tier}`)}
                    </span>
                  </span>
                  {locked ? (
                    <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs font-medium text-foreground">
                      <Lock className="size-3.5" />
                      {onAddKey ? t('models.addKey') : null}
                    </span>
                  ) : isSelected ? (
                    <Check className="mt-0.5 size-4 text-foreground" />
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
