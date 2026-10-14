import { SupabaseAccountForm, useSupabaseReturn } from '@/features/collab/SupabaseAccount';
import { useT } from '@/i18n';
import { SettingsCard } from './SettingsCard';

/** Accounts of other services that Yasa works with on the user's behalf. */
export function IntegrationsSection() {
  const t = useT('shell');
  useSupabaseReturn();
  return (
    <div className="space-y-6">
      <SettingsCard title={t('supabase.accountTitle')} description={t('supabase.accountDescription')}>
        <SupabaseAccountForm />
      </SettingsCard>
    </div>
  );
}
