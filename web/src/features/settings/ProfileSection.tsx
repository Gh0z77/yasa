import { useEffect, useId, useRef, useState, type ChangeEvent, type ComponentProps, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { LIMITS } from '@shared/constants';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage, useLocale, useT } from '@/i18n';
import { isApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { clerkEnabled, openClerkAccount, signOutOfClerk } from '@/lib/auth';
import { useChangePassword, useDeleteAccount, useMe, useUpdateMe } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { FieldError, SettingsCard } from './SettingsCard';

// ---------------------------------------------------------------------------
// Password input with a show / hide toggle
// ---------------------------------------------------------------------------
function PasswordInput({ className, ref, ...props }: ComponentProps<typeof Input>) {
  const t = useT('settings');
  const [visible, setVisible] = useState(false);
  const label = visible ? t('password.hide') : t('password.show');
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? 'text' : 'password'} className={cn('pr-11', className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/45"
      >
        {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Name + email
// ---------------------------------------------------------------------------
function ProfileForm() {
  const t = useT('settings');
  const { locale } = useLocale();
  const errorMessage = useErrorMessage();
  const uid = useId();
  const { data: user } = useMe();
  const updateMe = useUpdateMe();
  const [name, setName] = useState(user?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Follow the server value (first load, another tab) while the field is untouched.
  const serverName = user?.name ?? '';
  const lastServerName = useRef(serverName);
  useEffect(() => {
    if (lastServerName.current === serverName) return;
    setName((current) => (current === lastServerName.current ? serverName : current));
    lastServerName.current = serverName;
  }, [serverName]);

  if (!user) {
    return (
      <SettingsCard title={t('profile.title')} description={t('profile.description')}>
        <div className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </SettingsCard>
    );
  }

  const trimmed = name.trim();
  const dirty = trimmed !== user.name;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (updateMe.isPending) return;
    if (!trimmed) {
      setError(t('profile.nameRequired'));
      nameRef.current?.focus();
      return;
    }
    if (trimmed.length > LIMITS.nameMax) {
      setError(t('profile.nameTooLong', { max: LIMITS.nameMax }));
      nameRef.current?.focus();
      return;
    }
    if (!dirty) return;
    try {
      const res = await updateMe.mutateAsync({ name: trimmed });
      setName(res.user.name);
      toast.success(t('profile.saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const formId = `${uid}-form`;
  return (
    <SettingsCard
      title={t('profile.title')}
      description={t('profile.description')}
      footer={
        <Button type="submit" form={formId} loading={updateMe.isPending} disabled={!dirty || updateMe.isPending}>
          {t('profile.save')}
        </Button>
      }
    >
      <form id={formId} onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-5">
        <div className="flex items-center gap-3">
          <UserAvatar name={trimmed || user.name} seed={user.id} className="size-12 text-base" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{trimmed || user.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {t('profile.memberSince', { date: formatDate(user.createdAt, locale) })}
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${uid}-name`}>{t('profile.nameLabel')}</Label>
            <Input
              ref={nameRef}
              id={`${uid}-name`}
              name="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder={t('profile.namePlaceholder')}
              autoComplete="name"
              maxLength={LIMITS.nameMax + 20}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${uid}-name-error` : undefined}
            />
            <FieldError id={`${uid}-name-error`}>{error}</FieldError>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-email`}>{t('profile.emailLabel')}</Label>
            <Input
              id={`${uid}-email`}
              name="email"
              type="email"
              value={user.email}
              readOnly
              autoComplete="email"
              aria-describedby={`${uid}-email-hint`}
              className="bg-muted/60 text-muted-foreground"
            />
            <p id={`${uid}-email-hint`} className="text-xs text-muted-foreground">
              {t('profile.emailHint')}
            </p>
          </div>
        </div>
      </form>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------
type PasswordField = 'current' | 'next' | 'confirm';

function PasswordForm() {
  const t = useT('settings');
  const errorMessage = useErrorMessage();
  const uid = useId();
  const { data: user } = useMe();
  const changePassword = useChangePassword();
  const [values, setValues] = useState<Record<PasswordField, string>>({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<Partial<Record<PasswordField, string>>>({});
  const refs = {
    current: useRef<HTMLInputElement>(null),
    next: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };

  function setField(field: PasswordField, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function validate(): Partial<Record<PasswordField, string>> {
    const found: Partial<Record<PasswordField, string>> = {};
    if (!values.current) found.current = t('password.errors.currentRequired');
    if (values.next.length < LIMITS.passwordMin) found.next = t('password.errors.tooShort', { min: LIMITS.passwordMin });
    else if (values.next.length > LIMITS.passwordMax) found.next = t('password.errors.tooLong', { max: LIMITS.passwordMax });
    else if (values.current && values.next === values.current) found.next = t('password.errors.same');
    if (values.confirm !== values.next) found.confirm = t('password.errors.mismatch');
    return found;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (changePassword.isPending) return;
    const found = validate();
    setErrors(found);
    const firstInvalid = (['current', 'next', 'confirm'] as const).find((f) => found[f]);
    if (firstInvalid) {
      refs[firstInvalid].current?.focus();
      return;
    }
    try {
      await changePassword.mutateAsync({ currentPassword: values.current, newPassword: values.next });
      setValues({ current: '', next: '', confirm: '' });
      toast.success(t('password.success'));
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        setErrors({ current: t('password.errors.wrongCurrent') });
        refs.current.current?.focus();
      } else {
        toast.error(errorMessage(err));
      }
    }
  }

  const formId = `${uid}-form`;
  const field = (name: PasswordField) => ({
    id: `${uid}-${name}`,
    ref: refs[name],
    value: values[name],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setField(name, e.target.value),
    disabled: changePassword.isPending,
    'aria-invalid': errors[name] ? (true as const) : undefined,
  });

  return (
    <SettingsCard
      title={t('password.title')}
      description={t('password.description')}
      footer={
        <Button type="submit" form={formId} loading={changePassword.isPending} disabled={changePassword.isPending}>
          {t('password.submit')}
        </Button>
      }
    >
      <form id={formId} onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
        {/* Lets password managers attach the new password to the right account. */}
        <input type="text" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
        <div className="space-y-2 sm:max-w-sm">
          <Label htmlFor={`${uid}-current`}>{t('password.current')}</Label>
          <PasswordInput
            {...field('current')}
            name="current-password"
            autoComplete="current-password"
            aria-describedby={errors.current ? `${uid}-current-error` : undefined}
          />
          <FieldError id={`${uid}-current-error`}>{errors.current}</FieldError>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${uid}-next`}>{t('password.next')}</Label>
            <PasswordInput
              {...field('next')}
              name="new-password"
              autoComplete="new-password"
              aria-describedby={errors.next ? `${uid}-next-error` : `${uid}-next-hint`}
            />
            {errors.next ? (
              <FieldError id={`${uid}-next-error`}>{errors.next}</FieldError>
            ) : (
              <p id={`${uid}-next-hint`} className="text-xs text-muted-foreground">
                {t('password.hint', { min: LIMITS.passwordMin })}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-confirm`}>{t('password.confirm')}</Label>
            <PasswordInput
              {...field('confirm')}
              name="confirm-password"
              autoComplete="new-password"
              aria-describedby={errors.confirm ? `${uid}-confirm-error` : undefined}
            />
            <FieldError id={`${uid}-confirm-error`}>{errors.confirm}</FieldError>
          </div>
        </div>
      </form>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------
function DangerZone() {
  const t = useT('settings');
  const tc = useT('common');
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const uid = useId();
  const deleteAccount = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function onOpenChange(next: boolean) {
    if (deleteAccount.isPending) return;
    setOpen(next);
    if (!next) {
      setPassword('');
      setError(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleteAccount.isPending) return;
    if (!clerkEnabled && !password) {
      setError(t('danger.passwordRequired'));
      inputRef.current?.focus();
      return;
    }
    try {
      await deleteAccount.mutateAsync({ password });
      // The Clerk user is gone on the server; drop the browser's copy of the session too.
      if (clerkEnabled) await signOutOfClerk().catch(() => undefined);
      toast.success(t('danger.deleted'));
      void navigate('/', { replace: true });
    } catch (err) {
      setError(isApiError(err) && err.status === 401 ? t('danger.wrongPassword') : errorMessage(err));
      inputRef.current?.focus();
    }
  }

  return (
    <>
      <SettingsCard
        tone="danger"
        title={t('danger.title')}
        description={t('danger.description')}
        footer={
          <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
            {t('danger.deleteAccount')}
          </Button>
        }
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="sm">
          <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-5">
            <DialogHeader>
              <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <TriangleAlert className="size-5" aria-hidden="true" />
              </div>
              <DialogTitle>{t('danger.dialogTitle')}</DialogTitle>
              <DialogDescription>{t('danger.dialogDescription')}</DialogDescription>
            </DialogHeader>
            <div className={cn('space-y-2', clerkEnabled && 'hidden')}>
              <Label htmlFor={`${uid}-password`}>{t('danger.passwordLabel')}</Label>
              <PasswordInput
                ref={inputRef}
                id={`${uid}-password`}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                disabled={deleteAccount.isPending}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${uid}-password-error` : undefined}
              />
              <FieldError id={`${uid}-password-error`}>{error}</FieldError>
            </div>
            {clerkEnabled && error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={deleteAccount.isPending}>
                {tc('actions.cancel')}
              </Button>
              <Button type="submit" variant="destructive" loading={deleteAccount.isPending} disabled={deleteAccount.isPending}>
                {t('danger.confirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** With Clerk, the name, email, password and connected accounts are edited in Clerk's account screen. */
function ClerkAccountCard() {
  const t = useT('settings');
  const { data: user } = useMe();
  return (
    <SettingsCard
      title={t('clerk.title')}
      description={t('clerk.description')}
      footer={
        <Button type="button" onClick={openClerkAccount}>
          {t('clerk.manage')}
        </Button>
      }
    >
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t('profile.nameLabel')}</dt>
          <dd className="mt-1 truncate font-medium">{user?.name ?? '—'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t('profile.emailLabel')}</dt>
          <dd className="mt-1 truncate font-medium">{user?.email ?? '—'}</dd>
        </div>
      </dl>
    </SettingsCard>
  );
}

export function ProfileSection() {
  return (
    <div className="space-y-6">
      {clerkEnabled ? (
        <ClerkAccountCard />
      ) : (
        <>
          <ProfileForm />
          <PasswordForm />
        </>
      )}
      <DangerZone />
    </div>
  );
}
