// Build result cache + content hashing + build concurrency primitives for the preview pipeline.
// Depends only on node built-ins and shared/types.
import { createHash } from 'node:crypto';
import type { ProjectFile } from '../../shared/types';

/** Minimal LRU keyed by string. `get` refreshes recency; inserting beyond a limit evicts the oldest entries. */
export class LruCache<V> {
  private readonly map = new Map<string, { value: V; size: number }>();
  private bytes = 0;

  constructor(
    private readonly maxEntries: number,
    /** Optional soft cap on the summed `size` of all entries (the newest entry is always kept). */
    private readonly maxBytes: number = Number.POSITIVE_INFINITY,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V, size = 0): void {
    const prev = this.map.get(key);
    if (prev) {
      this.bytes -= prev.size;
      this.map.delete(key);
    }
    this.map.set(key, { value, size });
    this.bytes += size;
    while (this.map.size > this.maxEntries || (this.bytes > this.maxBytes && this.map.size > 1)) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const entry = this.map.get(oldest.value);
      if (entry) this.bytes -= entry.size;
      this.map.delete(oldest.value);
    }
  }

  delete(key: string): boolean {
    const prev = this.map.get(key);
    if (!prev) return false;
    this.bytes -= prev.size;
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  get size(): number {
    return this.map.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }
}

/** Counting semaphore (FIFO). */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      // Hand the slot straight to the next waiter (active count unchanged) or release it.
      if (next) next();
      else this.active--;
    }
  }

  get pending(): number {
    return this.waiters.length;
  }

  get running(): number {
    return this.active;
  }
}

export class BuildTimeoutError extends Error {
  constructor(ms: number) {
    super(`Build timed out after ${Math.round(ms / 1000)} s`);
    this.name = 'BuildTimeoutError';
  }
}

/** Rejects with BuildTimeoutError when `promise` does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BuildTimeoutError(ms)), ms);
    timer.unref?.();
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Content hash of a file set: sha256 over the files sorted by path, each contributing
 * path + encoding + content (length-prefixed so boundaries are unambiguous).
 * Independent of file order, `size` and `updatedAt`.
 */
export function hashFiles(files: readonly ProjectFile[]): string {
  const h = createHash('sha256');
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of sorted) {
    h.update(`${f.path.length}:${f.path}\n${f.encoding}\n${f.content.length}:`);
    h.update(f.content);
    h.update('\n');
  }
  return h.digest('hex');
}

/** Cache key = content hash + everything else that influences the output. */
export function buildCacheKey(
  contentHash: string,
  mode: string,
  appOrigin: string,
  project: { name: string; emoji: string; description: string } | undefined,
): string {
  return sha256Hex(JSON.stringify([contentHash, mode, appOrigin, project ? [project.name, project.emoji, project.description] : null]));
}
