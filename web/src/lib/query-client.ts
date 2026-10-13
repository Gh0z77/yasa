import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-error';

function shouldRetry(failureCount: number, error: unknown): boolean {
  // Only transient failures are worth retrying; 4xx answers will not change.
  if (error instanceof ApiError) {
    if (error.code === 'network') return failureCount < 2;
    if (error.status >= 500 && error.status !== 503) return failureCount < 1;
    return false;
  }
  return failureCount < 1;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: shouldRetry,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      // An errored query is not re-run just because another component mounts with the same key. Otherwise
      // "parent shows a spinner while pending, child uses the same query" loops forever when the API is down.
      retryOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: false,
    },
  },
});
