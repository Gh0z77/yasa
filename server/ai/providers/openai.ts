import OpenAI from 'openai';
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

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart;

function toMessages(system: string, messages: ProviderMessage[]): ChatMessageParam[] {
  const out: ChatMessageParam[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content.map((p) => (p.type === 'text' ? p.text : '')).join('') });
      continue;
    }
    const parts: ContentPart[] = m.content.map((p) =>
      p.type === 'text'
        ? { type: 'text', text: p.text }
        : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } },
    );
    out.push({ role: 'user', content: parts });
  }
  return out;
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof OpenAI.APIConnectionError) {
    return new ProviderError('network', 'Could not reach the AI provider. Check the base URL and network.');
  }
  if (err instanceof OpenAI.APIError) {
    // Some compatible servers report a busy model with an unusual status: go by the wording as well.
    const busy = /overload|temporarily|unavailable|capacity|too busy|try again later/i.test(err.message ?? '');
    const kind = busy && err.status !== 401 && err.status !== 403 && err.status !== 429 ? 'overloaded' : kindFromStatus(err.status);
    if (kind === 'overloaded') return new ProviderError('overloaded', 'The AI provider is overloaded right now. Try again in a moment.');
    if (kind === 'auth') return new ProviderError('auth', 'The API key was rejected by the provider. Check the key in Settings.');
    if (kind === 'rate_limit') return new ProviderError('rate_limit', 'Provider rate limit or quota reached. Try again later.');
    return new ProviderError(kind, err.message || 'Provider request failed');
  }
  const message = (err as Error)?.message ?? '';
  // A stream that dies mid-response surfaces as a bare fetch error ("terminated", ECONNRESET, …).
  if (/terminated|econnreset|socket|premature|fetch failed|network/i.test(message)) {
    return new ProviderError('network', 'The connection to the AI provider was lost.');
  }
  return new ProviderError('unknown', message || 'Provider request failed');
}

function isOfficial(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

function client(apiKey: string, baseUrl?: string | null): OpenAI {
  return new OpenAI({ apiKey, baseURL: baseUrl || getConfig().openaiBaseUrl, maxRetries: 2 });
}

export const openaiProvider: Provider = {
  id: 'openai',

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    let inputTokens = 0;
    let outputTokens = 0;
    let finish: string | null = null;

    try {
      // Compatible servers disagree on the output-limit parameter and its maximum, so it is only sent to OpenAI itself.
      const official = isOfficial(req.baseUrl || getConfig().openaiBaseUrl);
      const stream = await client(req.apiKey, req.baseUrl).chat.completions.create(
        {
          model: req.model,
          messages: toMessages(req.system, req.messages),
          stream: true,
          stream_options: { include_usage: true },
          ...(official ? { max_completion_tokens: req.maxOutputTokens } : {}),
        },
        { signal: req.signal },
      );

      for await (const chunk of stream) {
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
          outputTokens = chunk.usage.completion_tokens ?? outputTokens;
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;
        // Some compatible servers stream reasoning in a non-standard field.
        const delta = choice.delta as { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (reasoning) yield { type: 'thinking', delta: reasoning };
        if (delta.content) yield { type: 'text', delta: delta.content };
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
    if (finish === 'length') yield { type: 'stop', reason: 'max_tokens' };
    else if (finish === 'content_filter') yield { type: 'stop', reason: 'refusal', detail: 'The provider filtered this response.' };
    else yield { type: 'stop', reason: 'end' };
  },

  async test(key) {
    try {
      await client(key.apiKey, key.baseUrl).chat.completions.create({
        model: key.model || getConfig().openaiModel,
        messages: [{ role: 'user', content: 'Hi' }],
      });
    } catch (err) {
      throw toProviderError(err);
    }
  },
};
