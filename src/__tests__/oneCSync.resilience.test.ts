import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { withTimeout, withRetry, parseRecords, OneCHttpError, isTransient } from '@/lib/services/oneCSync/resilience';

describe('withTimeout', () => {
  it('resolves when fn finishes before deadline', async () => {
    await expect(withTimeout(async () => 'ok', 50)).resolves.toBe('ok');
  });
  it('aborts the signal when fn exceeds the deadline', async () => {
    const aborted = await withTimeout(
      (signal) => new Promise<boolean>((resolve) => {
        signal.addEventListener('abort', () => resolve(true));
      }),
      10
    );
    expect(aborted).toBe(true);
  });
});

describe('isTransient', () => {
  it('treats 429/503 as transient and 400 as fatal', () => {
    expect(isTransient(new OneCHttpError(429, 'rate'))).toBe(true);
    expect(isTransient(new OneCHttpError(503, 'down'))).toBe(true);
    expect(isTransient(new OneCHttpError(400, 'bad'))).toBe(false);
  });
  it('treats unknown (network) errors as transient', () => {
    expect(isTransient(new TypeError('fetch failed'))).toBe(true);
  });
});

describe('withRetry', () => {
  it('retries transient failures then succeeds (injected sleep, no real delay)', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n < 3) throw new OneCHttpError(503, 'down');
      return 'ok';
    });
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1, sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it('does not retry a fatal error', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn(async () => { throw new OneCHttpError(400, 'bad'); });
    await expect(withRetry(fn, { attempts: 3, sleep })).rejects.toThrow('bad');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('honours Retry-After (seconds → ms) for the delay', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let n = 0;
    const fn = vi.fn(async () => { n += 1; if (n < 2) throw new OneCHttpError(429, 'rate', 2); return 'ok'; });
    await withRetry(fn, { attempts: 2, baseDelayMs: 1, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
  });
});

describe('parseRecords', () => {
  const schema = z.object({ externalId: z.string(), n: z.number() });
  it('splits valid from invalid and extracts externalId best-effort', () => {
    const res = parseRecords(schema, [
      { externalId: 'a', n: 1 },
      { externalId: 'b', n: 'NOPE' },
      'totally-bad'
    ]);
    expect(res.valid).toEqual([{ externalId: 'a', n: 1 }]);
    expect(res.invalid).toHaveLength(2);
    expect(res.invalid[0].externalId).toBe('b');
    expect(res.invalid[1].externalId).toBeNull();
  });
});
