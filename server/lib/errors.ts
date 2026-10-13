import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiErrorBody, ApiErrorCode } from '../../shared/types';
import { getConfig } from '../env';
import { logger } from './logger';

export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Please sign in') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, 'conflict', message, details);
export const tooLarge = (message = 'Payload too large') => new HttpError(413, 'payload_too_large', message);
export const rateLimited = (message = 'Too many requests, slow down') => new HttpError(429, 'rate_limited', message);

export function errorBody(code: ApiErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Hono onError handler: maps everything to ApiErrorBody. */
export function handleError(err: unknown, c: Context): Response {
  if (err instanceof HttpError) {
    return c.json(errorBody(err.code, err.message, err.details), err.status as ContentfulStatusCode);
  }
  // hono's HTTPException (e.g. body limit) exposes status + message
  const maybe = err as { status?: number; message?: string; getResponse?: () => Response };
  if (typeof maybe?.status === 'number' && maybe.status >= 400 && maybe.status < 500) {
    const code: ApiErrorCode = maybe.status === 413 ? 'payload_too_large' : maybe.status === 404 ? 'not_found' : 'bad_request';
    return c.json(errorBody(code, maybe.message || 'Request failed'), maybe.status as ContentfulStatusCode);
  }
  logger.error('Unhandled error', { path: c.req.path, method: c.req.method, error: err });
  const message = getConfig().isProd ? 'Something went wrong' : String((err as Error)?.message ?? err);
  return c.json(errorBody('internal', message), 500);
}
