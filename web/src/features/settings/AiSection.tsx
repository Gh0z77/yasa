import { useId, useMemo } from 'react';
import { toast } from 'sonner';
import type { ModelId, ModelInfo, ProviderId } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage, useT } from '@/i18n';
import { useMe, useModels, useUpdateMe } from '@/lib/queries';
import { KEY_PROVIDER_ORDER, ProviderKeyCard } from './ProviderKeyCard';
import { SettingsCard } from './SettingsCard';

const AUTO = '__auto__';
const GROUP_ORDER: readonly ProviderId[] = ['gemini', 'openrouter', 'nvidia', 'openai', 'anthropic', 'mock'];

function DefaultModelCard() {
  const t = useT('settings');
  const tc = useT('common');
  const errorMessage = useErrorMessage();
  const uid = useId();
  const { data: user } = useMe();
  const modelsQuery = useModels();
  const updateMe = useUpdateMe();

  const groups = useMemo(() => {
    const models = modelsQuery.data?.models ?? [];
    return GROUP_ORDER.map((provider) => ({
      provider,
      models: models.filter((m: ModelInfo) => m.provider === provider),
    })).filter((group) => group.models.length > 0);
  }, [modelsQuery.data]);

  const hasAvailable = modelsQuery.data?.models.some((m) => m.available) ?? false;
  const resolved = modelsQuery.data?.models.find((m) => m.id === modelsQuery.data?.defaultModel) ?? null;
  const value = user?.defaultModel ?? AUTO;

  async function handleChange(next: string) {
    if (next === value || updateMe.isPending) return;
    try {
      await updateMe.mutateAsync({ defaultModel: next === AUTO ? null : (next as ModelId) });
      toast.success(t('ai.defaultModel.saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  let body;
  if (modelsQuery.isPending || !user) {
    body = <Skeleton className="h-9 w-full sm:max-w-md" />;
  } else if (modelsQuery.isError) {
    body = (
      <div className="flex flex-wrap items-center gap-3" role="alert">
        <p className="text-sm text-destructive">{t('ai.defaultModel.loadError')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void modelsQuery.refetch()}>
          {tc('actions.retry')}
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="space-y-2 sm:max-w-md">
        <Label htmlFor={`${uid}-model`}>{t('ai.defaultModel.label')}</Label>
        <Select value={value} onValueChange={(next) => void handleChange(next)} disabled={updateMe.isPending}>
          <SelectTrigger id={`${uid}-model`} className="w-full" aria-describedby={`${uid}-model-hint`}>
            <SelectValue placeholder={t('ai.defaultModel.placeholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO}>{t('ai.defaultModel.auto')}</SelectItem>
            {groups.map((group) => (
              <SelectGroup key={group.provider}>
                <SelectSeparator />
                <SelectLabel>{tc(`models.provider.${group.provider}`)}</SelectLabel>
                {group.models.map((m) => (
                  <SelectItem key={m.id} value={m.id} disabled={!m.available}>
                    {m.available ? m.label : `${m.label} · ${t('ai.defaultModel.unavailable')}`}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <p id={`${uid}-model-hint`} className="text-xs text-muted-foreground">
          {!hasAvailable
            ? t('ai.defaultModel.empty')
            : value === AUTO && resolved
              ? t('ai.defaultModel.autoResolved', { model: resolved.label })
              : (modelsQuery.data.models.find((m) => m.id === value)?.description ?? '')}
        </p>
      </div>
    );
  }

  return (
    <SettingsCard title={t('ai.defaultModel.title')} description={t('ai.defaultModel.description')}>
      {body}
    </SettingsCard>
  );
}

export function AiSection() {
  const t = useT('settings');
  const uid = useId();
  return (
    <div className="space-y-8">
      <DefaultModelCard />
      <section aria-labelledby={`${uid}-keys`} className="space-y-4">
        <div className="space-y-1">
          <h2 id={`${uid}-keys`} className="text-lg font-semibold tracking-tight">
            {t('ai.keys.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('ai.keys.description')}</p>
        </div>
        {KEY_PROVIDER_ORDER.map((provider) => (
          <ProviderKeyCard key={provider} provider={provider} />
        ))}
      </section>
    </div>
  );
}
