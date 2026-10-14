import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { Gauge, KeyRound, Palette, Plug, User, type LucideIcon } from 'lucide-react';
import { PageHeading, PageShell } from '@/components/common/PageShell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiSection } from '@/features/settings/AiSection';
import { AppearanceSection } from '@/features/settings/AppearanceSection';
import { IntegrationsSection } from '@/features/settings/IntegrationsSection';
import { ProfileSection } from '@/features/settings/ProfileSection';
import { UsageSection } from '@/features/settings/UsageSection';
import { useT } from '@/i18n';

const TABS = ['profile', 'ai', 'integrations', 'usage', 'appearance'] as const;
type SettingsTab = (typeof TABS)[number];

const TAB_ICONS: Record<SettingsTab, LucideIcon> = {
  profile: User,
  ai: KeyRound,
  integrations: Plug,
  usage: Gauge,
  appearance: Palette,
};

const isTab = (value: string | null): value is SettingsTab => TABS.includes(value as SettingsTab);

export default function Settings() {
  const t = useT('settings');
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const tab: SettingsTab = isTab(rawTab) ? rawTab : 'profile';

  useEffect(() => {
    document.title = `${t('title')} · Yasa`;
  }, [t]);

  function selectTab(value: string) {
    if (!isTab(value)) return;
    void setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', value);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  }

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-3xl">
        <PageHeading title={t('title')} description={t('subtitle')} />
        <Tabs value={tab} onValueChange={selectTab}>
          <div className="-mx-4 mb-6 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
            <TabsList variant="underline" aria-label={t('tabs.label')} className="w-max min-w-full justify-start">
              {TABS.map((value) => {
                const Icon = TAB_ICONS[value];
                return (
                  <TabsTrigger key={value} value={value} className="gap-1.5 whitespace-nowrap">
                    <Icon className="size-4" aria-hidden="true" />
                    {t(`tabs.${value}`)}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          <TabsContent value="profile" className="animate-fade-in outline-none">
            <ProfileSection />
          </TabsContent>
          <TabsContent value="ai" className="animate-fade-in outline-none">
            <AiSection />
          </TabsContent>
          <TabsContent value="integrations" className="animate-fade-in outline-none">
            <IntegrationsSection />
          </TabsContent>
          <TabsContent value="usage" className="animate-fade-in outline-none">
            <UsageSection onConnectKey={() => selectTab('ai')} />
          </TabsContent>
          <TabsContent value="appearance" className="animate-fade-in outline-none">
            <AppearanceSection />
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
