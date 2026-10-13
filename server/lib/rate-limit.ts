import { rateLimited } from './errors';

interface Bucket {
  hits: number[];
}

/** In-memory sliding-window limiter. One instance per logical limit. */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit and returns true when the key is still within the limit. */
  hit(key: string, now: number = Date.now()): boolean {
    this.sweep(now);
    const bucket = this.buckets.get(key) ?? { hits: [] };
    const cutoff = now - this.windowMs;
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    if (bucket.hits.length >= this.limit) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.hits.push(now);
    this.buckets.set(key, bucket);
    return true;
  }

  /** Throws HttpError 429 when over the limit. */
  check(key: string, message?: string): void {
    if (!this.hit(key)) throw rateLimited(message);
  }

  reset(): void {
    this.buckets.clear();
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    const cutoff = now - this.windowMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.hits.every((t) => t <= cutoff)) this.buckets.delete(key);
    }
  }
}
