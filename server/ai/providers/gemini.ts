import { ApiError, GoogleGenAI, type Content, type Part } from '@google/genai';
import {
  isAbortError,
  kindFromStatus,
  ProviderError,
  type Provider,
  type ProviderEvent,
  type ProviderMessage,
  type ProviderRequest,
} from './types';

function toContents(messages: ProviderMessage[]): Content[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: m.content.map((part): Part =>
      part.type === 'text' ? { text: part.text } : { inlineData: { mimeType: part.mime, data: part.data } },
    ),
  }));
}

/** The SDK wraps the API's JSON error body in the message; dig out the human-readable part. */
function innerMessage(raw: string): string {
  let text = raw;
  for (let i = 0; i < 3; i++) {
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (typeof parsed?.error?.message !== 'string') break;
      text = parsed.error.message;
    } catch {
      break;
    }
  }
  return text.trim();
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof ApiError) {
    const status = err.status;
    if (status === 400 && /api key/i.test(err.message)) {
      return new ProviderError('auth', 'The Gemini API key was rejected. Check the key in Settings.');
    }
    const kind = kindFromStatus(status);
    if (kind === 'auth') return new ProviderError('auth', 'The Gemini API key was rejected. Check the key in Settings.');
    if (kind === 'rate_limit') {
      return new ProviderError('rate_limit', 'Gemini rate limit or quota reached for this model. Try Gemini Flash or wait a little.');
    }
    if (kind === 'overloaded') return new ProviderError('overloaded', 'Gemini is overloaded right now. Try again in a moment.');
    return new ProviderError(kind, innerMessage(err.message) || 'Gemini request failed');
  }
  const message = (err as Error)?.message ?? 'Gemini request failed';
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(message)) {
    return new ProviderError('network', 'Could not reach Gemini. Check the network connection.');
  }
  return new ProviderError('unknown', message);
}

export const geminiProvider: Provider = {
  id: 'gemini',

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const ai = new GoogleGenAI({ apiKey: req.apiKey });
    let inputTokens = 0;
    let outputTokens = 0;
    let finish: string | undefined;
    let blocked: string | undefined;

    try {
      const stream = await ai.models.generateContentStream({
        model: req.model,
        contents: toContents(req.messages),
        config: {
          systemInstruction: req.system,
          maxOutputTokens: Math.min(req.maxOutputTokens, 65_536),
          thinkingConfig: { includeThoughts: true },
          abortSignal: req.signal,
        },
      });

      for await (const chunk of stream) {
        const usage = chunk.usageMetadata;
        if (usage) {
          inputTokens = usage.promptTokenCount ?? inputTokens;
          outputTokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) || outputTokens;
        }
        if (chunk.promptFeedback?.blockReason) blocked = String(chunk.promptFeedback.blockReason);
        const candidate = chunk.candidates?.[0];
        if (candidate?.finishReason) finish = String(candidate.finishReason);
        for (const part of candidate?.content?.parts ?? []) {
          if (!part.text) continue;
          yield part.thought ? { type: 'thinking', delta: part.text } : { type: 'text', delta: part.text };
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
    if (blocked) yield { type: 'stop', reason: 'refusal', detail: `Blocked by Gemini (${blocked}).` };
    else if (finish === 'MAX_TOKENS') yield { type: 'stop', reason: 'max_tokens' };
    else if (finish && ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(finish)) {
      yield { type: 'stop', reason: 'refusal', detail: `Gemini stopped the response (${finish}).` };
    } else yield { type: 'stop', reason: 'end' };
  },

  async test(key) {
    try {
      const ai = new GoogleGenAI({ apiKey: key.apiKey });
      await ai.models.generateContent({
        model: 'gemini-flash-latest',
        contents: 'Hi',
        config: { maxOutputTokens: 8 },
      });
    } catch (err) {
      throw toProviderError(err);
    }
  },
};
