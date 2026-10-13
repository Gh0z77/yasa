import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { safeNextPath } from '@/components/common/ProtectedRoute';
import { PageSpinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { AuthLink, AuthShell, EMAIL_PATTERN, FormError, FormField } from '@/features/home/AuthShell';
import { useErrorMessage, useT } from '@/i18n';
import { isApiError } from '@/lib/api';
import { useLogin, useMe } from '@/lib/queries';
import { copyToClipboard } from '@/lib/utils';

export default function Login() {
  const t = useT('auth');
  const tc = useT('common');
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const [params] = useSearchParams();
  const rawNext = params.get('next');
  const next = safeNextPath(rawNext);

  const me = useMe();
  const login = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const [serverError, setServerError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (me.isPending) return <PageSpinner />;
  // Already signed in (or just logged in: the mutation fills the `me` cache).
  if (me.data) return <Navigate to={next} replace />;

  const trimmedEmail = email.trim();
  const errors = {
    email: !trimmedEmail ? t('validation.emailRequired') : !EMAIL_PATTERN.test(trimmedEmail) ? t('validation.emailInvalid') : null,
    password: !password ? t('validation.passwordRequired') : null,
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ email: true, password: true });
    if (errors.email || errors.password || login.isPending) return;
    setServerError(null);
    login.mutate(
      { email: trimmedEmail, password },
      {
        onSuccess: ({ user }) => {
          toast.success(t('login.success', { name: user.name.trim().split(/\s+/)[0] ?? user.name }));
          void navigate(next, { replace: true });
        },
        onError: (error) => {
          const wrongCredentials = isApiError(error) && (error.code === 'unauthorized' || error.code === 'not_found');
          setServerError(wrongCredentials ? t('errors.invalidCredentials') : errorMessage(error));
        },
      },
    );
  };

  const resetCommand = `npm run admin -- reset-password ${EMAIL_PATTERN.test(trimmedEmail) ? trimmedEmail : '<email>'}`;
  const copyCommand = async () => {
    const ok = await copyToClipboard(resetCommand);
    if (!ok) {
      toast.error(tc('status.copyFailed'));
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const signupHref = rawNext ? `/signup?next=${encodeURIComponent(next)}` : '/signup';

  return (
    <AuthShell
      title={t('login.title')}
      subtitle={t('login.subtitle')}
      footer={
        <>
          {t('login.noAccount')} <AuthLink to={signupHref}>{t('login.signupLink')}</AuthLink>
        </>
      }
    >
      <FormError message={serverError} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <FormField
          label={t('fields.email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          placeholder={t('fields.emailPlaceholder')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
          error={touched.email ? errors.email : null}
        />
        <FormField
          label={t('fields.password')}
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder={t('fields.passwordPlaceholder')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
          error={touched.password ? errors.password : null}
          labelAction={
            <button
              type="button"
              aria-expanded={forgotOpen}
              aria-controls="forgot-password-note"
              onClick={() => setForgotOpen((open) => !open)}
              className="rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/45"
            >
              {t('forgot.link')}
            </button>
          }
        />

        {forgotOpen ? (
          <div
            id="forgot-password-note"
            className="animate-fade-in rounded-xl border border-border bg-muted/50 p-3.5 text-sm text-muted-foreground"
          >
            <p className="font-medium text-foreground">{t('forgot.title')}</p>
            <p className="mt-1">{t('forgot.note')}</p>
            <div className="mt-2.5 flex items-center gap-1 rounded-lg border border-border bg-background py-1 pl-3 pr-1">
              <code className="scrollbar-none min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">
                {resetCommand}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={copied ? tc('status.copied') : tc('actions.copy')}
                onClick={() => void copyCommand()}
              >
                {copied ? <Check className="text-success" /> : <Copy />}
              </Button>
            </div>
            <p className="mt-2.5">{t('forgot.after')}</p>
          </div>
        ) : null}

        <Button type="submit" size="lg" loading={login.isPending} className="mt-1 w-full">
          {t('login.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
