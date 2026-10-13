import { lazy, Suspense } from 'react';
import { createBrowserRouter, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ErrorBoundary, RouteErrorBoundary } from '@/components/common/ErrorBoundary';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { PageSpinner } from '@/components/common/Spinner';
import { clerkEnabled } from '@/lib/auth';
import { useMe } from '@/lib/queries';
import Community from '@/pages/Community';
import Home from '@/pages/Home';
import Landing from '@/pages/Landing';
import ClerkAuth from '@/pages/ClerkAuth';
import Login from '@/pages/Login';
import NotFound from '@/pages/NotFound';
import Projects from '@/pages/Projects';
import Signup from '@/pages/Signup';

// Heavy routes (editor, resizable panels, markdown…) are split out of the entry chunk.
const Workspace = lazy(() => import('@/pages/Workspace'));
const Settings = lazy(() => import('@/pages/Settings'));
const Templates = lazy(() => import('@/pages/Templates'));
const Docs = lazy(() => import('@/pages/Docs'));

/** Shared frame of every route: error boundary (reset on navigation), suspense fallback, scroll restoration. */
function RootLayout() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<PageSpinner className="min-h-dvh" />}>
        <Outlet />
      </Suspense>
      <ScrollRestoration />
    </ErrorBoundary>
  );
}

/** `/` → Landing for guests, Home for signed-in users (SPEC §11.1). */
function RootIndex() {
  const { data: user, isPending } = useMe();
  if (isPending) return <PageSpinner className="min-h-dvh" />;
  return user ? <Home /> : <Landing />;
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: '/', element: <RootIndex /> },
      { path: '/login', element: clerkEnabled ? <ClerkAuth mode="sign-in" /> : <Login /> },
      { path: '/signup', element: clerkEnabled ? <ClerkAuth mode="sign-up" /> : <Signup /> },
      {
        path: '/projects',
        element: (
          <ProtectedRoute>
            <Projects />
          </ProtectedRoute>
        ),
      },
      { path: '/community', element: <Community /> },
      { path: '/templates', element: <Templates /> },
      { path: '/docs', element: <Docs /> },
      // Guests may open public projects, so the workspace is not protected.
      { path: '/project/:id', element: <Workspace /> },
      {
        path: '/settings',
        element: (
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        ),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
