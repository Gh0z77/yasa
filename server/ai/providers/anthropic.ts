import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../../env';
import {
  isAbortError,
  kindFromStatus,
  ProviderError,
  type Provider,
  type ProviderEvent,
  type ProviderMessage,
  type ProviderRequest,
} from './types';

type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/** Minimal structural view of the stream events we consume (shared by stable and beta streams). */
interface StreamEventLike {
  type: string;
  message?: { usage?: UsageLike };
  delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string | null };
  usage?: UsageLike;
}

interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

function toMessages(messages: ProviderMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((part): Anthropic.ContentBlockParam =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'image', source: { type: 'base64', media_type: part.mime as ImageMime, data: part.data } },
    ),
  }));
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError('auth', 'The Anthropic API key was rejected. Check the key in Settings.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError('rate_limit', 'Anthropic rate limit reached. Try again in a moment.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError('network', 'Could not reach Anthropic. Check the network connection.');
  }
  if (err instanceof Anthropic.APIError) {
    const kind = err.status === 529 ? 'overloaded' : kindFromStatus(err.status);
    return new ProviderError(kind, err.message || 'Anthropic request failed');
  }
  return new ProviderError('unknown', (err as Error)?.message ?? 'Anthropic request failed');
}

function client(apiKey: string, baseUrl?: string | null): Anthropic {
  return new Anthropic({ apiKey, baseURL: baseUrl || undefined, maxRetries: 2 });
}

/** Haiku 4.5 does not take adaptive thinking / effort; every other current model does. */
function supportsAdaptiveThinking(model: string): boolean {
  return !model.includes('haiku');
}

export const anthropicProvider: Provider = {
  id: 'anthropic',

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const anthropic = client(req.apiKey, req.baseUrl);
    const adaptive = supportsAdaptiveThinking(req.model);
    const base = {
      model: req.model,
      max_tokens: req.maxOutputTokens,
      // The system prompt is static per project, so cache it.
      system: [{ type: 'text' as const, text: req.system, cache_control: { type: 'ephemeral' as const } }],
      messages: toMessages(req.messages),
      ...(adaptive
        ? {
            thinking: { type: 'adaptive' as const, display: 'summarized' as const },
            output_config: { effort: getConfig().anthropicEffort },
          }
        : {}),
    };

    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;

    try {
      // Opus 5 can decline requests via safety classifiers; server-side fallbacks reroute those automatically.
      const events: AsyncIterable<StreamEventLike> =
        req.model === 'claude-opus-5'
          ? anthropic.beta.messages.stream(
              { ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
              { signal: req.signal },
            )
          : anthropic.messages.stream(base, { signal: req.signal });

      for await (const event of events) {
        if (event.type === 'message_start' && event.message?.usage) {
          const u = event.message.usage;
          inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
          outputTokens = u.output_tokens ?? 0;
        } else if (event.type === 'content_block_delta' && event.delta) {
          if (event.delta.type === 'text_delta' && event.delta.text) yield { type: 'text', delta: event.delta.text };
          else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
            yield { type: 'thinking', delta: event.delta.thinking };
          }
        } else if (event.type === 'message_delta') {
          if (event.usage?.output_tokens != null) outputTokens = event.usage.output_tokens;
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        }
      }
    } catch (err) {
      if (isAbortError(err) || req.signal.aborted) {
        yield { type: 'usage', inputTokens, outputTokens };
        yield { type: 'stop', reason: 'aborted' };
        return;
      }
      throw toProviderError(err);
    }

    yield { type: 'usage', inputTokens, outputTokens };
    if (stopReason === 'refusal') yield { type: 'stop', reason: 'refusal', detail: 'The model declined this request.' };
    else if (stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded') yield { type: 'stop', reason: 'max_tokens' };
    else yield { type: 'stop', reason: 'end' };
  },

  async test(key) {
    try {
      await client(key.apiKey, key.baseUrl).messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Hi' }],
      });
    } catch (err) {
      throw toProviderError(err);
    }
  },
};
