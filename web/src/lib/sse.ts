// Server-Sent Events over fetch (works for POST and GET, unlike EventSource).
import { authHeaders } from './auth';

export interface SSEMessage {
  /** Value of the `event:` field; "message" when absent (as in the SSE spec). */
  event: string;
  /** `data:` lines joined with "\n". */
  data: string;
  /** Last seen `id:` field, if any. */
  id: string | null;
}

export interface SSEParser {
  /** Feed a decoded text chunk; chunk boundaries may fall anywhere (mid-line, between CR and LF…). */
  feed(chunk: string): void;
  /** Call at end of stream: processes a trailing line without a terminator. An unterminated event is dropped (per spec). */
  flush(): void;
  /** Forget buffered state. */
  reset(): void;
}

/**
 * Incremental, pure SSE parser. Handles LF / CRLF / CR line endings (also when split across chunks),
 * comment lines (`: ping`), multi-line `data:`, `event:`, `id:`, a leading BOM, and ignores `retry:`.
 */
export function createSSEParser(onEvent: (message: SSEMessage) => void): SSEParser {
  let buffer = '';
  let dataLines: string[] = [];
  let eventName = '';
  let lastId: string | null = null;
  let skipLeadingLF = false;
  let started = false;

  function dispatch(): void {
    if (dataLines.length > 0) {
      onEvent({ event: eventName || 'message', data: dataLines.join('\n'), id: lastId });
    }
    dataLines = [];
    eventName = '';
  }

  function processLine(line: string): void {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.charCodeAt(0) === 58 /* ':' → comment */) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.charCodeAt(0) === 32) value = value.slice(1);
    switch (field) {
      case 'data':
        dataLines.push(value);
        break;
      case 'event':
        eventName = value;
        break;
      case 'id':
        if (!value.includes('\0')) lastId = value;
        break;
      default:
        break; // retry + unknown fields are ignored
    }
  }

  function drain(final: boolean): void {
    let start = 0;
    const len = buffer.length;
    for (let i = 0; i < len; i++) {
      const code = buffer.charCodeAt(i);
      if (code === 10 /* \n */) {
        processLine(buffer.slice(start, i));
        start = i + 1;
      } else if (code === 13 /* \r */) {
        processLine(buffer.slice(start, i));
        if (i + 1 < len) {
          if (buffer.charCodeAt(i + 1) === 10) i++;
        } else {
          // CR was the last char of this chunk: a following LF belongs to the same line ending.
          skipLeadingLF = true;
        }
        start = i + 1;
      }
    }
    buffer = buffer.slice(start);
    if (final && buffer !== '') {
      processLine(buffer);
      buffer = '';
    }
  }

  return {
    feed(chunk: string): void {
      if (chunk === '') return;
      if (!started) {
        started = true;
        if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
      }
      if (skipLeadingLF) {
        skipLeadingLF = false;
        if (chunk.charCodeAt(0) === 10) chunk = chunk.slice(1);
      }
      buffer += chunk;
      drain(false);
    },
    flush(): void {
      drain(true);
      // Incomplete event (no blank line) is discarded.
      dataLines = [];
      eventName = '';
    },
    reset(): void {
      buffer = '';
      dataLines = [];
      eventName = '';
      lastId = null;
      skipLeadingLF = false;
      started = false;
    },
  };
}

/**
 * Performs `fetch(url, init)` and, when the response is a successful stream, parses it as SSE and calls
 * `onEvent` for every message until the stream ends. Resolves with the Response.
 *
 * - Non-2xx, 204 or body-less responses are returned **unconsumed** (caller inspects status / reads the body).
 * - Aborting `signal` rejects with the fetch `AbortError` (check `signal.aborted` in the caller's catch).
 */
export async function streamSSE(
  url: string,
  init: RequestInit,
  onEvent: (message: SSEMessage) => void,
  signal?: AbortSignal,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'text/event-stream');
  for (const [name, value] of Object.entries(await authHeaders())) headers.set(name, value);
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init, headers, signal });
  if (!res.ok || res.status === 204 || !res.body) return res;

  const parser = createSSEParser(onEvent);
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
    parser.flush();
  } finally {
    reader.releaseLock();
  }
  return res;
}
