import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Database } from 'lucide-react';
import { toast } from 'sonner';
import type { SupabaseFailure } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage, useT } from '@/i18n';
import { api, isApiError } from '@/lib/api';

export const supabaseAccountKey = ['supabase-account'] as const;

/** The user's Supabase account, shared by the settings page and the backend dialog. */
export function useSupabaseAccount(enabled = true) {
  return useQuery({ queryKey: supabaseAccountKey, queryFn: ({ signal }) => api.supabaseAccount.get({ signal }), enabled, staleTime: 30_000 });
}

/** Turns an error from the Supabase endpoints into the sentence the user should see. */
export function useSupabaseError() {
  const t = useT('shell');
  const errorMessage = useErrorMessage();
  return (err: unknown): string => {
    const code = isApiError(err) ? (err.details as { supabase?: SupabaseFailure } | null)?.supabase : undefined;
    return code ? t(`supabase.errors.${code}`) : errorMessage(err);
  };
}

/**
 * Coming back from Supabase's consent page (`?supabase=connected|error`): tells the user how it went, refreshes the
 * account and cleans the address. Returns true once when the account was just connected.
 */
export function useSupabaseReturn(): boolean {
  const t = useT('shell');
  const qc = useQueryClient();
  const [justConnected, setJustConnected] = useState(false);
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get('supabase');
    if (outcome !== 'connected' && outcome !== 'error') return;
    handled.current = true;
    url.searchParams.delete('supabase');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (outcome === 'connected') {
      toast.success(t('supabase.accountConnected'));
      void qc.invalidateQueries({ queryKey: supabaseAccountKey });
      setJustConnected(true);
    } else {
      toast.error(t('supabase.connectFailed'));
    }
  }, [qc, t]);
  return justConnected;
}

/** "Connect Supabase": the user approves Yasa on Supabase's own page and comes back here. No keys to copy. */
export function SupabaseAccountForm({ returnTo }: { returnTo?: string }) {
  const t = useT('shell');
  const qc = useQueryClient();
  const explain = useSupabaseError();
  const account = useSupabaseAccount();

  const connect = useMutation({
    mutationFn: () => api.supabaseAccount.startConnect(returnTo ?? `${window.location.pathname}${window.location.search}`),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
    onError: (err) => toast.error(explain(err)),
  });
  const disconnect = useMutation({
    mutationFn: () => api.supabaseAccount.disconnect(),
    onSuccess: (next) => {
      qc.setQueryData(supabaseAccountKey, next);
      toast.success(t('supabase.accountDisconnected'));
    },
    onError: (err) => toast.error(explain(err)),
  });

  if (account.isPending) return <Skeleton className="h-11 w-full" />;

  if (account.data?.connected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <Check className="size-4 shrink-0 text-success" aria-hidden />
          <span className="min-w-0">
            <span className="block font-medium">{t('supabase.accountConnected')}</span>
            {account.data.organizations.length > 0 ? (
              <span className="block truncate text-xs text-muted-foreground">{t('supabase.accountOrgs', { names: account.data.organizations.map((o) => o.name).join(', ') })}</span>
            ) : null}
          </span>
        </span>
        <Button type="button" variant="outline" size="sm" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
          {t('supabase.accountDisconnect')}
        </Button>
      </div>
    );
  }

  if (account.data && !account.data.canConnect) {
    return <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">{t('supabase.oauthMissing')}</p>;
  }

  return (
    <Button
      type="button"
      className="h-11 w-full gap-2 bg-[#3ecf8e] text-[#0b1f15] hover:bg-[#36b87e] sm:w-auto sm:px-6"
      loading={connect.isPending}
      onClick={() => connect.mutate()}
    >
      <Database className="size-4" aria-hidden />
      {t('supabase.connectWithSupabase')}
    </Button>
  );
}
