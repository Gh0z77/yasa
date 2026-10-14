import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { stopAllJobs } from './ai/jobs';
import { createApp } from './app';
import { closeDb, getDb } from './db';
import { getConfig, previewUrlFor } from './env';
import { logger } from './lib/logger';
import { markStreamingMessagesInterrupted } from './services/messages';
import { deleteExpiredSessions } from './services/sessions';

// Load .env before the configuration is read (config is lazy, so this is early enough).
// `.env.local` first: loadEnvFile never overrides a variable that is already set, so local values win.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (existsSync('.env')) process.loadEnvFile('.env');

// `--port=3000` wins over the PORT variable: dev tools often export PORT for the web server they launch,
// which must not move the API away from the port Vite proxies to.
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
if (portArg) process.env.PORT = portArg.slice('--port='.length);

const config = getConfig();
getDb();

const interrupted = markStreamingMessagesInterrupted(0);
if (interrupted > 0) logger.warn(`Marked ${interrupted} unfinished generation(s) as interrupted`);
deleteExpiredSessions();

const app = createApp();
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, () => {
  const providers = [
    config.anthropicApiKey ? 'Anthropic' : null,
    config.geminiApiKey ? 'Gemini' : null,
    config.nvidiaApiKey ? 'NVIDIA NIM' : null,
    config.openrouterApiKey ? 'OpenRouter' : null,
    config.openaiApiKey ? 'OpenAI-compatible' : null,
    config.enableMockProvider ? 'Demo' : null,
  ].filter(Boolean);
  logger.info(`Yasa server listening on port ${config.port}`);
  logger.info(`Builder:  ${config.appUrl}`);
  logger.info(`Previews: ${previewUrlFor('<token>')}`);
  logger.info(`AI providers: ${providers.join(', ') || 'none — add a key in Settings or .env'}`);
  logger.info(`Accounts: ${config.clerk ? 'Clerk' : 'built-in email + password'}`);
});

const sweep = setInterval(() => deleteExpiredSessions(), 6 * 60 * 60 * 1000);
sweep.unref();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await stopAllJobs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    closeDb();
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', { error: reason }));
