import { ArrowLeft, Compass, Home } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { PageShell } from '@/components/common/PageShell';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

export interface NotFoundProps {
  /** Override the default copy (e.g. "Project not found" in the workspace). */
  title?: string;
  description?: string;
}

/** 404 page; also reusable inside pages for missing resources: `<NotFound title=… />`. */
export default function NotFound({ title, description }: NotFoundProps) {
  const t = useT('common');
  const navigate = useNavigate();
  return (
    <PageShell contained={false} mainClassName="relative flex items-center justify-center overflow-hidden">
      <div aria-hidden="true" className="brand-glow absolute inset-x-0 top-1/2 -z-10 mx-auto h-72 max-w-3xl -translate-y-1/2 opacity-30" />
      <div className="container-page flex animate-fade-up flex-col items-center py-20 text-center">
        <p className="text-brand-gradient text-7xl leading-none font-bold tracking-tighter sm:text-8xl">{t('notFound.code')}</p>
        <h1 className="mt-6 text-2xl font-extrabold tracking-[-0.035em] sm:text-3xl">{title ?? t('notFound.title')}</h1>
        <p className="mt-3 max-w-md text-sm text-balance text-muted-foreground sm:text-base">
          {description ?? t('notFound.description')}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          <Button variant="ghost" onClick={() => void navigate(-1)}>
            <ArrowLeft />
            {t('actions.back')}
          </Button>
          <Button asChild>
            <Link to="/">
              <Home />
              {t('notFound.goHome')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/community">
              <Compass />
              {t('notFound.browseCommunity')}
            </Link>
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
