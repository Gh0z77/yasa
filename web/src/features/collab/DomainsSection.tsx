import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Globe, X } from 'lucide-react';
import { toast } from 'sonner';
import type { DomainFailure, DomainsResponse, Project, ProjectDomain } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useErrorMessage, useT } from '@/i18n';
import { api, isApiError } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';

const domainsKey = (projectId: string) => ['domains', projectId] as const;

function DnsRow({ type, name, value }: { type: string; name: string; value: string }) {
  const tc = useT('common');
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2 font-mono text-[11px]">
      <span className="text-muted-foreground">{type}</span>
      <span className="truncate" title={name}>
        {name}
      </span>
      <span className="truncate" title={value}>
        {value}
      </span>
      <button
        type="button"
        aria-label={tc('actions.copy')}
        title={tc('actions.copy')}
        onClick={() => void copyToClipboard(value)}
        className="grid size-6 place-items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/45"
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

/** Custom domains of a published project: add, show the DNS records to create, verify, remove. */
export function DomainsSection({ project, enabled }: { project: Project; enabled: boolean }) {
  const t = useT('shell');
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const uid = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const domains = useQuery({
    queryKey: domainsKey(project.id),
    queryFn: ({ signal }) => api.domains.list(project.id, { signal }),
    enabled,
  });
  const put = (domain: ProjectDomain) =>
    qc.setQueryData<DomainsResponse>(domainsKey(project.id), (old) => ({
      domains: [...(old?.domains ?? []).filter((d) => d.domain !== domain.domain), domain],
    }));
  const explain = (err: unknown): string => {
    const failure = isApiError(err) ? (err.details as { domain?: DomainFailure } | null)?.domain : undefined;
    return failure ? t(`domains.errors.${failure}`) : errorMessage(err);
  };

  const add = useMutation({
    mutationFn: (domain: string) => api.domains.add(project.id, domain),
    onSuccess: ({ domain }) => {
      put(domain);
      setValue('');
      setError(null);
    },
    onError: (err) => setError(explain(err)),
  });
  const verify = useMutation({
    mutationFn: (domain: string) => api.domains.verify(project.id, domain),
    onSuccess: ({ domain }) => {
      put(domain);
      toast.success(t('domains.verified', { domain: domain.domain }));
    },
    onError: (err) => toast.error(explain(err)),
  });
  const remove = useMutation({
    mutationFn: (domain: string) => api.domains.remove(project.id, domain),
    onSuccess: () => void qc.invalidateQueries({ queryKey: domainsKey(project.id) }),
    onError: (err) => toast.error(explain(err)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim().length >= 4 && !add.isPending) add.mutate(value.trim());
  };

  return (
    <div className="mt-5 rounded-xl border border-border p-3">
      <div className="flex items-start gap-3">
        <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <Label htmlFor={`${uid}-domain`} className="text-[13px]">
            {t('domains.title')}
          </Label>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('domains.hint')}</p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-3 flex items-center gap-2">
        <Input
          id={`${uid}-domain`}
          name="custom-domain"
          autoComplete="off"
          spellCheck={false}
          placeholder="shop.example.com"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          className="h-9 flex-1 font-mono"
        />
        <Button type="submit" size="sm" loading={add.isPending} disabled={value.trim().length < 4}>
          {t('domains.add')}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {(domains.data?.domains ?? []).map((domain) => (
        <div key={domain.domain} className="mt-3 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium">{domain.domain}</span>
            {domain.verified ? (
              <span className="flex shrink-0 items-center gap-1 text-xs text-success">
                <Check className="size-3.5" aria-hidden />
                {t('domains.connected')}
              </span>
            ) : (
              <Button type="button" size="sm" variant="outline" loading={verify.isPending && verify.variables === domain.domain} onClick={() => verify.mutate(domain.domain)}>
                {t('domains.verify')}
              </Button>
            )}
            <button
              type="button"
              aria-label={t('domains.remove', { domain: domain.domain })}
              title={t('domains.remove', { domain: domain.domain })}
              onClick={() => remove.mutate(domain.domain)}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/45"
            >
              <X className="size-4" />
            </button>
          </div>
          {!domain.verified ? (
            <div className="mt-3 space-y-1.5">
              <p className="text-[12px] text-muted-foreground">{t('domains.dnsHint')}</p>
              <DnsRow type="TXT" name={domain.txtName} value={domain.txtValue} />
              <DnsRow type="CNAME" name={domain.domain} value={domain.target} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
