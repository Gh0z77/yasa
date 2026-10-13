import type { ChatErrorCode, ProviderId } from '../../../shared/types';
import { redact } from '../../lib/logger';

export interface ProviderContentText {
  type: 'text';
  text: string;
}

export interface ProviderContentImage {
  type: 'image';
  mime: string;
  /** base64 without data: prefix */
  data: string;
}

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: Array<ProviderContentText | ProviderContentImage>;
}

export interface ProviderRequest {
  model: string;
  system: string;
  messages: ProviderMessage[];
  maxOutputTokens: number;
  apiKey: string;
  baseUrl?: string | null;
  signal: AbortSignal;
}

export type ProviderStopReason = 'end' | 'max_tokens' | 'refusal' | 'aborted';

export type ProviderEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'stop'; reason: ProviderStopReason; detail?: string };

export interface Provider {
  id: ProviderId;
  stream(req: ProviderRequest): AsyncIterable<ProviderEvent>;
  /** Cheapest possible request proving the key works. */
  test(key: { apiKey: string; baseUrl: string | null; model: string | null }): Promise<void>;
}

export type ProviderErrorKind = 'auth' | 'rate_limit' | 'overloaded' | 'bad_request' | 'network' | 'unknown';

const CHAT_CODE: Record<ProviderErrorKind, ChatErrorCode> = {
  auth: 'provider_auth',
  rate_limit: 'provider_rate_limit',
  overloaded: 'provider_overloaded',
  bad_request: 'provider_bad_request',
  network: 'provider_network',
  unknown: 'provider_error',
};

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;

  constructor(kind: ProviderErrorKind, message: string) {
    // Upstream messages can echo request data: redact key-looking strings and cap the length.
    super(redact(message).slice(0, 300));
    this.name = 'ProviderError';
    this.kind = kind;
  }

  get chatCode(): ChatErrorCode {
    return CHAT_CODE[this.kind];
  }
}

export function kindFromStatus(status: number | undefined): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429 || status === 402) return 'rate_limit';
  if (status === 400 || status === 404 || status === 413 || status === 422) return 'bad_request';
  if (status !== undefined && status >= 500) return 'overloaded';
  return 'unknown';
}

export function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; code?: string } | null;
  return e?.name === 'AbortError' || e?.name === 'APIUserAbortError' || e?.code === 'ABORT_ERR';
}
