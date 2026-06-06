import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRateLimited, type RateLimiterClient } from '@/lib/rateLimit';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('isRateLimited — in-memory backend (no redis client)', () => {
  it('allows up to max, then limits the next request', async () => {
    const opts = { windowMs: 60_000, max: 2 };
    expect(await isRateLimited('mem-a', opts, { client: null })).toBe(false);
    expect(await isRateLimited('mem-a', opts, { client: null })).toBe(false);
    expect(await isRateLimited('mem-a', opts, { client: null })).toBe(true);
  });

  it('counts keys independently', async () => {
    const opts = { windowMs: 60_000, max: 1 };
    expect(await isRateLimited('mem-b1', opts, { client: null })).toBe(false);
    expect(await isRateLimited('mem-b1', opts, { client: null })).toBe(true);
    expect(await isRateLimited('mem-b2', opts, { client: null })).toBe(false);
  });

  it('resets the window after windowMs elapses', async () => {
    vi.useFakeTimers();
    const opts = { windowMs: 1_000, max: 1 };
    expect(await isRateLimited('mem-c', opts, { client: null })).toBe(false);
    expect(await isRateLimited('mem-c', opts, { client: null })).toBe(true);
    vi.advanceTimersByTime(1_001);
    expect(await isRateLimited('mem-c', opts, { client: null })).toBe(false);
  });
});

describe('isRateLimited — redis backend', () => {
  function fakeRedis(): RateLimiterClient & { count: number; pexpireCalls: number } {
    return {
      count: 0,
      pexpireCalls: 0,
      async incr() {
        this.count += 1;
        return this.count;
      },
      async pexpire() {
        this.pexpireCalls += 1;
        return 1;
      }
    };
  }

  it('uses INCR and refreshes PEXPIRE on every hit (avoids immortal keys)', async () => {
    const client = fakeRedis();
    const opts = { windowMs: 60_000, max: 3 };
    await isRateLimited('r-a', opts, { client });
    await isRateLimited('r-a', opts, { client });
    expect(client.count).toBe(2);
    // PEXPIRE on every call, not just the first: INCR+PEXPIRE are two non-atomic
    // round-trips, so a crash between them would otherwise leave a key with no
    // TTL (permanent rate-limit). Refreshing every hit removes that risk.
    expect(client.pexpireCalls).toBe(2);
  });

  it('limits when the shared counter exceeds max', async () => {
    const client = fakeRedis();
    const opts = { windowMs: 60_000, max: 2 };
    expect(await isRateLimited('r-b', opts, { client })).toBe(false); // 1
    expect(await isRateLimited('r-b', opts, { client })).toBe(false); // 2
    expect(await isRateLimited('r-b', opts, { client })).toBe(true); // 3 > 2
  });
});

describe('isRateLimited — graceful degradation', () => {
  it('falls back to in-memory when the redis command throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client: RateLimiterClient = {
      incr: async () => {
        throw new Error('redis down');
      },
      pexpire: async () => 1
    };
    const limited = await isRateLimited('deg-a', { windowMs: 60_000, max: 2 }, { client });
    expect(limited).toBe(false); // degraded to in-memory, first hit allowed
    expect(warn).toHaveBeenCalled();
  });

  it('falls back to in-memory when the redis command times out', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client: RateLimiterClient = {
      incr: () => new Promise<number>(() => {}), // never resolves → must time out
      pexpire: async () => 1
    };
    const p = isRateLimited('deg-b', { windowMs: 60_000, max: 2 }, { client, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    expect(await p).toBe(false);
  });
});
