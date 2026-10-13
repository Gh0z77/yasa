import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { LIMITS } from '@shared/constants';
import { safeNextPath } from '@/components/common/ProtectedRoute';
import { PageSpinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { AuthLink, AuthShell, EMAIL_PATTERN, FormError, FormField } from '@/features/home/AuthShell';
import { hasPendingPrompt } from '@/features/home/pending';
import { useErrorMessage, useT } from '@/i18n';
import { isApiError } from '@/lib/api';
import { useMe, useSignup } from '@/lib/queries';

export default function Signup() {
  const t = useT('auth');
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const [params] = useSearchParams();
  const rawNext = params.get('next');
  const next = safeNextPath(rawNext);

  const me = useMe();
  const signup = useSignup();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({ name: false, email: false, password: false });
  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingPrompt] = useState(hasPendingPrompt);

  if (me.isPending) return <PageSpinner />;
  // Already signed in (or just signed up: the mutation fills the `me` cache).
  if (me.data) return <Navigate to={next} replace />;

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const errors = {
    name: !trimmedName
      ? t('validation.nameRequired')
      : trimmedName.length > LIMITS.nameMax
        ? t('validation.nameTooLong', { max: LIMITS.nameMax })
        : null,
    email: !trimmedEmail ? t('validation.emailRequired') : !EMAIL_PATTERN.test(trimmedEmail) ? t('validation.emailInvalid') : null,
    password: !password
      ? t('validation.passwordRequired')
      : password.length < LIMITS.passwordMin
        ? t('validation.passwordTooShort', { min: LIMITS.passwordMin })
        : password.length > LIMITS.passwordMax
          ? t('validation.passwordTooLong', { max: LIMITS.passwordMax })
          : null,
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ name: true, email: true, password: true });
    if (errors.name || errors.email || errors.password || signup.isPending) return;
    setServerError(null);
    signup.mutate(
      { name: trimmedName, email: trimmedEmail, password },
      {
        onSuccess: ({ user }) => {
          toast.success(t('signup.success', { name: user.name.trim().split(/\s+/)[0] ?? user.name }));
          void navigate(next, { replace: true });
        },
        onError: (error) => {
          setServerError(isApiError(error) && error.code === 'conflict' ? t('errors.emailTaken') : errorMessage(error));
        },
      },
    );
  };

  const loginHref = rawNext ? `/login?next=${encodeURIComponent(next)}` : '/login';

  return (
    <AuthShell
      title={t('signup.title')}
      subtitle={t('signup.subtitle')}
      footer={
        <>
          {t('signup.haveAccount')} <AuthLink to={loginHref}>{t('signup.loginLink')}</AuthLink>
        </>
      }
    >
      {pendingPrompt ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3 text-sm text-muted-foreground">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />
          <span className="min-w-0">{t('signup.pendingPrompt')}</span>
        </div>
      ) : null}

      <FormError message={serverError} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <FormField
          label={t('fields.name')}
          name="name"
          autoComplete="name"
          autoFocus
          placeholder={t('fields.namePlaceholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
          error={touched.name ? errors.name : null}
        />
        <FormField
          label={t('fields.email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
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
          autoComplete="new-password"
          placeholder={t('fields.newPasswordPlaceholder', { min: LIMITS.passwordMin })}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
          error={touched.password ? errors.password : null}
          hint={t('fields.passwordHint', { min: LIMITS.passwordMin })}
        />

        <Button type="submit" variant="gradient" size="lg" loading={signup.isPending} className="mt-1 w-full">
          {t('signup.submit')}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t('signup.terms')}</p>
      </form>
    </AuthShell>
  );
}
