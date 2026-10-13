import { SignIn, SignUp } from '@clerk/react';
import { Navigate, useSearchParams } from 'react-router';
import { safeNextPath } from '@/components/common/ProtectedRoute';
import { AuthShell } from '@/features/home/AuthShell';
import { useMe } from '@/lib/queries';

/** `/login` and `/signup` when Clerk signs people in: Clerk's screen inside the app's own frame. */
export default function ClerkAuth({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [params] = useSearchParams();
  const rawNext = params.get('next');
  const next = safeNextPath(rawNext);
  const suffix = rawNext ? `?next=${encodeURIComponent(next)}` : '';
  const me = useMe();

  // Already signed in (or just finished: the session change refreshes `me`).
  if (me.data) return <Navigate to={next} replace />;

  return (
    <AuthShell bare>
      {mode === 'sign-in' ? (
        <SignIn routing="hash" signUpUrl={`/signup${suffix}`} forceRedirectUrl={next} />
      ) : (
        <SignUp routing="hash" signInUrl={`/login${suffix}`} forceRedirectUrl={next} />
      )}
    </AuthShell>
  );
}
