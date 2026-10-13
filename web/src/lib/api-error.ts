import type { ApiErrorBody, ApiErrorCode, ChatErrorCode } from '@shared/types';

/** `network` = the request never produced an HTTP response (offline, DNS, server down). */
export type ClientErrorCode = ApiErrorCode | 'network';

const KNOWN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  'bad_request',
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'payload_too_large',
  'rate_limited',
  'limit_reached',
  'provider_error',
  'no_provider',
  'internal',
]);

function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 429:
      return 'rate_limited';
    case 502:
      return 'provider_error';
    case 503:
      return 'no_provider';
    default:
      return status >= 500 ? 'internal' : 'bad_request';
  }
}

export class ApiError extends Error {
  /** HTTP status; 0 for network failures. */
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ClientErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** `details.chatCode` sent by POST /chat failures (SPEC §15.2), if present. */
  get chatCode(): ChatErrorCode | null {
    const d = this.details;
    if (d && typeof d === 'object' && 'chatCode' in d && typeof (d as { chatCode: unknown }).chatCode === 'string') {
      return (d as { chatCode: ChatErrorCode }).chatCode;
    }
    return null;
  }

  /** Field issues of a 400 `validation_error` (`details.issues`): `[{ path: 'email', message: '…' }]`. */
  get issues(): Array<{ path: string; message: string }> {
    const d = this.details as { issues?: unknown } | null | undefined;
    if (!d || typeof d !== 'object' || !Array.isArray(d.issues)) return [];
    return d.issues.filter(
      (i): i is { path: string; message: string } =>
        !!i && typeof i === 'object' && typeof (i as { path?: unknown }).path === 'string' && typeof (i as { message?: unknown }).message === 'string',
    );
  }

  static network(cause?: unknown): ApiError {
    const err = new ApiError(0, 'network', 'Network error. Check your connection and try again.');
    if (cause !== undefined) (err as { cause?: unknown }).cause = cause;
    return err;
  }

  /** Builds an ApiError from a non-2xx response (consumes the body). */
  static async fromResponse(res: Response): Promise<ApiError> {
    let body: unknown = null;
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const e = (body as Partial<ApiErrorBody> | null)?.error;
    if (e && typeof e === 'object' && typeof e.code === 'string' && KNOWN_CODES.has(e.code)) {
      return new ApiError(res.status, e.code, typeof e.message === 'string' ? e.message : res.statusText, e.details);
    }
    // A gateway error without our JSON envelope means the API itself was not reached (proxy / server down).
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      return new ApiError(res.status, 'network', 'The server is not reachable right now. Try again in a moment.');
    }
    return new ApiError(res.status, codeForStatus(res.status), res.statusText || `Request failed (${res.status})`);
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** True for `AbortController.abort()` rejections. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError' : (err as { name?: string } | null)?.name === 'AbortError';
}
