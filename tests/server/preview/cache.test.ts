import { describe, expect, it } from 'vitest';
import { BuildTimeoutError, LruCache, Semaphore, buildCacheKey, hashFiles, withTimeout } from '../../../server/preview/cache';
import { file } from './fixture';

describe('LruCache', () => {
  it('evicts the least recently used entry beyond the entry limit', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1); // refresh a
    c.set('c', 3);
    expect(c.has('b')).toBe(false);
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });

  it('respects the byte budget but always keeps the newest entry', () => {
    const c = new LruCache<string>(100, 10);
    c.set('a', 'x', 6);
    c.set('b', 'y', 6);
    expect(c.has('a')).toBe(false);
    expect(c.totalBytes).toBe(6);
    c.set('huge', 'z', 50);
    expect(c.size).toBe(1);
    expect(c.get('huge')).toBe('z');
    c.set('huge', 'w', 1);
    expect(c.totalBytes).toBe(1);
    expect(c.delete('huge')).toBe(true);
    expect(c.totalBytes).toBe(0);
    c.clear();
    expect(c.size).toBe(0);
  });
});

describe('Semaphore', () => {
  it('limits concurrency and releases slots on failure', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const task = (i: number) =>
      sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        order.push(i);
        if (i === 1) throw new Error('boom');
        return i;
      });
    const results = await Promise.allSettled([0, 1, 2, 3, 4, 5].map(task));
    expect(peak).toBe(2);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(results[1]?.status).toBe('rejected');
    expect(order).toHaveLength(6);
    expect(sem.running).toBe(0);
    expect(sem.pending).toBe(0);
  });
});

describe('withTimeout', () => {
  it('resolves, rejects and times out', async () => {
    await expect(withTimeout(Promise.resolve(1), 50)).resolves.toBe(1);
    await expect(withTimeout(Promise.reject(new Error('x')), 50)).rejects.toThrow('x');
    await expect(withTimeout(new Promise(() => undefined), 20)).rejects.toBeInstanceOf(BuildTimeoutError);
  });
});

describe('hashing', () => {
  it('is independent of file order and metadata, sensitive to path, encoding and content', () => {
    const a = file('a.ts', 'one');
    const b = file('b.ts', 'two');
    const h = hashFiles([a, b]);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFiles([b, a])).toBe(h);
    expect(hashFiles([{ ...a, size: 99, updatedAt: 'later' }, b])).toBe(h);
    expect(hashFiles([file('a.ts', 'ONE'), b])).not.toBe(h);
    expect(hashFiles([file('c.ts', 'one'), b])).not.toBe(h);
    expect(hashFiles([{ ...a, encoding: 'base64' }, b])).not.toBe(h);
    // boundaries are unambiguous
    expect(hashFiles([file('a', 'bc')])).not.toBe(hashFiles([file('ab', 'c')]));
  });

  it('derives distinct cache keys for mode, origin and project meta', () => {
    const p = { name: 'n', emoji: 'e', description: 'd' };
    const keys = new Set([
      buildCacheKey('h', 'preview', 'http://a', undefined),
      buildCacheKey('h', 'publish', 'http://a', undefined),
      buildCacheKey('h', 'preview', 'http://b', undefined),
      buildCacheKey('h2', 'preview', 'http://a', undefined),
      buildCacheKey('h', 'publish', 'http://a', p),
      buildCacheKey('h', 'publish', 'http://a', { ...p, name: 'other' }),
      buildCacheKey('h', 'publish', 'http://a', { ...p, emoji: 'x' }),
      buildCacheKey('h', 'publish', 'http://a', { ...p, description: 'x' }),
    ]);
    expect(keys.size).toBe(8);
    expect(buildCacheKey('h', 'publish', 'http://a', p)).toBe(buildCacheKey('h', 'publish', 'http://a', { ...p }));
  });
});
