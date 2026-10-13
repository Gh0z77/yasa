import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, useAuth, useClerk } from '@clerk/react';
import type { MeResponse } from '@shared/types';
import { useLocale } from '@/i18n';
import { CLERK_PUBLISHABLE_KEY, registerClerk } from '@/lib/auth';
import { clerkLocalization } from '@/lib/clerk-localization';
import { queryClient } from '@/lib/query-client';
import { qk } from '@/lib/queries';

/** Clerk's screens in the app's own tokens, so they follow the light and dark themes. */
const appearance = {
  variables: {
    colorBackground: 'var(--popover)',
    colorForeground: 'var(--foreground)',
    colorPrimary: 'var(--primary)',
    colorPrimaryForeground: 'var(--primary-foreground)',
    colorInput: 'var(--input)',
    colorInputForeground: 'var(--foreground)',
    colorMuted: 'var(--muted)',
    colorMutedForeground: 'var(--muted-foreground)',
    colorNeutral: 'var(--foreground)',
    colorDanger: 'var(--destructive)',
    colorRing: 'var(--ring)',
    borderRadius: '0.8rem',
    fontFamily: 'var(--font-sans)',
  },
};

/** Hands Clerk's session to the API client and keeps the cached data in step with who is signed in. */
function ClerkBridge() {
  const { isLoaded, userId, getToken, signOut } = useAuth();
  const clerk = useClerk();
  const identity = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    registerClerk({
      getToken: () => getToken(),
      signOut: () => signOut(),
      openAccount: () => clerk.openUserProfile(),
    });
    const current = userId ?? null;
    const previous = identity.current;
    identity.current = current;
    if (previous === undefined || previous === current) return;
    // Everything except `me` belongs to the previous identity.
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    if (current) void queryClient.resetQueries({ queryKey: qk.me });
    else queryClient.setQueryData<MeResponse>(qk.me, { user: null });
  }, [isLoaded, userId, getToken, signOut, clerk]);

  return null;
}

/**
 * Wraps the app in Clerk when a publishable key is configured; otherwise renders it as is and the server's
 * built-in accounts are used. `navigate` lets Clerk move between its screens through the app router.
 */
export function AuthProvider({ children, navigate }: { children: ReactNode; navigate: (to: string, replace?: boolean) => void }) {
  const { locale } = useLocale();
  if (!CLERK_PUBLISHABLE_KEY) return <>{children}</>;
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      signInUrl="/login"
      signUpUrl="/signup"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/"
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, true)}
      appearance={appearance}
      localization={clerkLocalization(locale)}
    >
      <ClerkBridge />
      {children}
    </ClerkProvider>
  );
}
