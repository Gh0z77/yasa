import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

export interface ErrorFallbackProps {
  error: unknown;
  /** Clears the boundary and re-renders its children. */
  reset?: () => void;
  /** `page` fills the viewport, `panel` fits inside a panel/card. */
  variant?: 'page' | 'panel';
  className?: string;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** A stale tab after a deploy fails to fetch lazy chunks; only a reload helps. */
function isChunkLoadError(error: unknown): boolean {
  const message = describe(error);
  return /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|ChunkLoadError/i.test(message);
}

export function ErrorFallback({ error, reset, variant = 'page', className }: ErrorFallbackProps) {
  const t = useT('common');
  const page = variant === 'page';
  const chunk = isChunkLoadError(error);
  return (
    <div
      role="alert"
      className={cn(
        'flex w-full flex-col items-center justify-center gap-3 px-6 text-center',
        page ? 'min-h-dvh py-16' : 'h-full min-h-48 py-8',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" aria-hidden="true" />
      </div>
      <h2 className={cn('font-semibold tracking-tight', page ? 'text-xl' : 'text-base')}>{t('errors.boundaryTitle')}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{t('errors.boundaryDescription')}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {reset && !chunk ? (
          <Button variant="outline" onClick={reset}>
            {t('actions.tryAgain')}
          </Button>
        ) : null}
        <Button onClick={() => window.location.reload()}>
          <RotateCw />
          {t('actions.reload')}
        </Button>
      </div>
      {import.meta.env.DEV ? (
        <details className="mt-4 w-full max-w-xl text-left">
          <summary className="text-xs text-muted-foreground">{t('errors.details')}</summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-border bg-muted p-3 text-xs whitespace-pre-wrap text-muted-foreground">
            {error instanceof Error ? (error.stack ?? error.message) : describe(error)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback; receives the error and a reset callback. */
  fallback?: (props: { error: unknown; reset: () => void }) => ReactNode;
  variant?: 'page' | 'panel';
  /** Changing this value clears a caught error (e.g. the route pathname or project id). */
  resetKey?: unknown;
  onError?: (error: unknown, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: unknown;
  hasError: boolean;
}

/** Catches render errors below it. Wrap panels separately so one crash does not take down the workspace. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) this.reset();
  }

  reset = (): void => {
    this.setState({ error: null, hasError: false });
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ error: this.state.error, reset: this.reset });
    return <ErrorFallback error={this.state.error} reset={this.reset} variant={this.props.variant} />;
  }
}

/** `errorElement` for the router: loader/render errors of a route end up here. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const normalized = isRouteErrorResponse(error) ? new Error(`${error.status} ${error.statusText}`) : error;
  return <ErrorFallback error={normalized} />;
}
