import type { Context } from 'hono';
import { z } from 'zod';
import { LIMITS } from '../../shared/constants';
import { normalizePath, pathError } from '../../shared/paths';
import { HttpError } from './errors';

function validationError(error: z.ZodError): HttpError {
  const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = issues[0];
  const message = first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Invalid request';
  return new HttpError(400, 'validation_error', message, { issues });
}

export function parseWith<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/** Reads and validates a JSON body. Empty bodies are treated as {}. */
export async function parseJson<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    const text = await c.req.text();
    raw = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_request', 'Request body must be valid JSON');
  }
  return parseWith(schema, raw);
}

export function parseQuery<T>(c: Context, schema: z.ZodType<T>): T {
  return parseWith(schema, c.req.query());
}

/** A project file path: normalized and validated against shared/paths rules. */
export const zProjectPath = z
  .string()
  .min(1)
  .max(LIMITS.pathMax + 8)
  .transform((value, ctx) => {
    // The API is strict about what users send; only a leading "./" is tolerated.
    const raw = value.trim();
    if (raw.startsWith('/') || raw.includes('\\')) {
      ctx.addIssue({ code: 'custom', message: 'Use a relative path with forward slashes' });
      return z.NEVER;
    }
    const normalized = normalizePath(raw);
    const err = pathError(normalized);
    if (err) {
      ctx.addIssue({ code: 'custom', message: err });
      return z.NEVER;
    }
    return normalized;
  });

export const zModelId = z
  .string()
  .max(120)
  .regex(/^(anthropic|gemini|openai|nvidia|openrouter|mock):[\w.\-/:@]+$/, 'Invalid model id');

export const zLocale = z.enum(['en', 'uz', 'ru']);
