import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe } from '@/lib/queries';
import { PageSpinner } from './Spinner';

/** Builds `/login?next=<current path>` (used by ProtectedRoute and "log in to continue" links). */
export function loginUrl(next: string, base: '/login' | '/signup' = '/login'): string {
  return next && next !== '/' ? `${base}?next=${encodeURIComponent(next)}` : base;
}

/**
 * Sanitizes a `?next=` value: only same-origin absolute paths are allowed (no `//host`, no schemes).
 * Login/Signup pages use it before navigating.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

/** Renders children for signed-in users; guests are redirected to `/login?next=<path>`. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data: user, isPending } = useMe();
  const location = useLocation();

  if (isPending) return <PageSpinner className="min-h-dvh" />;
  if (!user) {
    return <Navigate to={loginUrl(location.pathname + location.search)} replace />;
  }
  return <>{children}</>;
}
