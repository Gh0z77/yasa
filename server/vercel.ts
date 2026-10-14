// Entry point of the serverless function (Vercel). The same Hono app as `server/index.ts`, without a listening
// socket: the platform calls the exported handler for every request that is not a static asset.
import { getRequestListener } from '@hono/node-server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app';
import { getDb } from './db';
import { getConfig } from './env';
import { staleGenerationMs } from './lib/hosting';
import { logger } from './lib/logger';
import { markStreamingMessagesInterrupted } from './services/messages';
import { deleteExpiredSessions } from './services/sessions';

type Listener = (incoming: IncomingMessage, outgoing: ServerResponse) => Promise<void>;

let listener: Listener | null = null;

/** Start-up work of one instance: open the database, tidy up what earlier instances left behind. */
function boot(): Listener {
  getDb();
  try {
    // Other instances may be generating right now: only what is older than any request can last is dead.
    const interrupted = markStreamingMessagesInterrupted(staleGenerationMs());
    if (interrupted > 0) logger.warn(`Marked ${interrupted} unfinished generation(s) as interrupted`);
    deleteExpiredSessions();
  } catch (err) {
    logger.error('Start-up clean-up failed', { error: err });
  }
  const { sandboxDomain } = getConfig();
  if (/(^|\.)localhost(:\d+)?$/.test(sandboxDomain)) {
    logger.error('SANDBOX_DOMAIN is not set: previews and published apps cannot load. Add a second domain and set SANDBOX_DOMAIN and SANDBOX_MODE=path (docs/VERCEL.md).');
  }
  const app = createApp();
  return getRequestListener(app.fetch) as Listener;
}

export default function handler(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
  listener ??= boot();
  return listener(incoming, outgoing);
}
