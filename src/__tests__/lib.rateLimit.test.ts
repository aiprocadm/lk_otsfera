import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRateLimited, type RateLimiterClient } from '@/lib/rateLimit';

// Mock connection module so defaultClient() tests don't need real Redis
const { getRedisConnectionMock } = vi.hoisted(() => ({
  getRedisConnectionMock: vi.fn()
}));
vi.mock('@/lib/jobs/connection', () => ({
  getRedisConnection: getRedisConnectionMock
}));

beforeEach(() => {
  getRedisConnectionMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('isRateLimited — in-memory backend (no redis client)', () => {
  it('allows up to max, then limits the next request', async () => {
    const opts = { windowMs: 60_000, max: 2 };
    expect(await isRateLimited('mem-a', opts, { client: null })).toBe(false);
    expect(await isRateLimited('mem-a', opts, { client: null })).toBe(false);
    expect(await isRateLimited('mem-a', opts, { client: null })).toBe(true);
  });

  it('evicts expired entries when store reaches MAX_MEMORY_ENTRIES (10,000)', async () => {
    vi.useFakeTimers();
    const opts = { windowMs: 100, max: 100 };
    // Fill store to MAX_MEMORY_ENTRIES (10,000) with short-lived entries
    for (let i = 0; i < 10_000; i++) {
      await isRateLimited(`evict-fill-${i}`, opts, { client: null });
    }
    // Advance time past windowMs so all entries are expired
    vi.advanceTimersByTime(200);
    // The next call must trigger the eviction path (size >= 10,000)
    // After eviction all 10,000 old entries are deleted; this new key is fresh
    const result = await isRateLimited('evict-after', opts, { client: null });
    expect(result).toBe(false); // first hit for this key
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
  it('falls back to in-memory when the redis command throws an Error', async () => {
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
    const warnMsg = (warn.mock.calls[0][1] as { error: string }).error;
    expect(warnMsg).toBe('redis down');
  });

  it('falls back to in-memory when the redis command throws a non-Error value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client: RateLimiterClient = {
      incr: async () => { throw 'string error'; }, // non-Error throw — intentional
      pexpire: async () => 1
    };
    const limited = await isRateLimited('deg-non-error', { windowMs: 60_000, max: 2 }, { client });
    expect(limited).toBe(false);
    expect(warn).toHaveBeenCalled();
    const warnMsg = (warn.mock.calls[0][1] as { error: string }).error;
    expect(warnMsg).toBe('string error'); // String(err) branch
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

// ---------------------------------------------------------------------------
// defaultClient() path — exercises the REDIS_URL branch inside isRateLimited
// when no explicit `deps` are passed.
// ---------------------------------------------------------------------------
describe('isRateLimited — defaultClient() auto-resolution', () => {
  it('uses in-memory when REDIS_URL is not set (defaultClient returns null)', async () => {
    vi.stubEnv('REDIS_URL', '');
    const result = await isRateLimited('dc-no-url', { windowMs: 60_000, max: 10 });
    expect(result).toBe(false); // first hit → not limited
    expect(getRedisConnectionMock).not.toHaveBeenCalled();
  });

  it('uses the Redis connection from getRedisConnection when REDIS_URL is set', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    let count = 0;
    getRedisConnectionMock.mockReturnValue({
      incr: async () => { count += 1; return count; },
      pexpire: async () => 1
    });
    const result = await isRateLimited('dc-with-url', { windowMs: 60_000, max: 10 });
    expect(result).toBe(false);
    expect(getRedisConnectionMock).toHaveBeenCalled();
  });

  it('degrades to in-memory when getRedisConnection throws (REDIS_URL set but connection fails)', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    getRedisConnectionMock.mockImplementation(() => { throw new Error('no redis'); });
    // defaultClient() catches the throw and returns null → in-memory path
    const result = await isRateLimited('dc-throw', { windowMs: 60_000, max: 10 });
    expect(result).toBe(false);
  });
});
