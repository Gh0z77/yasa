// What changes when the server runs as a serverless function (Vercel) instead of one long-lived process.
import { waitUntil } from '@vercel/functions';
import { getConfig } from '../env';

/**
 * Keeps the function instance alive until the promise settles. A generation outlives the request that started
 * it; without this the platform may pause the instance as soon as the response has been sent.
 */
export function keepAlive(promise: Promise<unknown>): void {
  if (!getConfig().hosted) return;
  try {
    waitUntil(promise);
  } catch {
    // outside a request (start-up work): nothing to extend
  }
}

/**
 * How long an unfinished generation is believed to be running somewhere. On a single server every unfinished
 * message found at start-up is dead; with several instances only one older than any request can last is.
 */
export function staleGenerationMs(): number {
  const config = getConfig();
  return config.hosted ? Math.max(config.generationTimeLimitMs, 300_000) + 120_000 : 0;
}
