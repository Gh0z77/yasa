// Tiny structured logger. Never log secrets: values under key-like names are redacted.
type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /(api[-_]?key|authorization|password|secret|token|cookie)/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,})\b/g;

function minLevel(): number {
  const env = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'error' : 'info')) as Level;
  return ORDER[env] ?? ORDER.info;
}

export function redact(text: string): string {
  return text.replace(SECRET_VALUE, '[redacted]');
}

function serialize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), stack: value.stack ? redact(value.stack) : undefined };
  }
  if (typeof value === 'string') return redact(value.length > 2000 ? `${value.slice(0, 2000)}…` : value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 3) return '[object]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => serialize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : serialize(v, depth + 1);
  }
  return out;
}

function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (ORDER[level] < minLevel()) return;
  const time = new Date().toISOString();
  const line = meta ? `${time} ${level.toUpperCase()} ${message} ${JSON.stringify(serialize(meta))}` : `${time} ${level.toUpperCase()} ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
};
