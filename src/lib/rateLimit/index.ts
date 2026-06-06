import { getRedisConnection } from '@/lib/jobs/connection';

/**
 * Shared rate limiter for serverless-safe throttling.
 *
 * Backed by Redis (`INCR` + `PEXPIRE`) so the counter is shared across all
 * instances — an in-process `Map` resets on cold start and is per-instance,
 * which silently multiplies the real limit by the instance count.
 *
 * Degrades gracefully: if Redis is unavailable (no `REDIS_URL`, connection
 * error, or a hung command), it falls back to an in-memory fixed-window
 * counter. This is a *fail-open-to-in-memory* policy for the limiter only —
 * callers must keep their primary auth defenses (this is defense-in-depth,
 * not the lock). A Redis blip must not block legitimate traffic.
 *
 * The timeout is essential: ioredis is configured with
 * `maxRetriesPerRequest: null` (see jobs/connection.ts), so a command to a
 * down Redis hangs forever otherwise.
 */

export interface RateLimiterClient {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitDeps {
  /** Explicit backend (tests / DI). `null` forces the in-memory path. */
  client?: RateLimiterClient | null;
  /** Redis command timeout before degrading to in-memory. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1000;
const MAX_MEMORY_ENTRIES = 10_000;

const memoryStore = new Map<string, { count: number; resetAt: number }>();

function memoryIsLimited(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  if (memoryStore.size >= MAX_MEMORY_ENTRIES) {
    for (const [k, entry] of memoryStore) {
      if (entry.resetAt <= now) memoryStore.delete(k);
    }
  }
  const current = memoryStore.get(key);
  if (!current || current.resetAt <= now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > max;
}

async function redisIsLimited(
  client: RateLimiterClient,
  key: string,
  windowMs: number,
  max: number
): Promise<boolean> {
  const count = await client.incr(key);
  // Set the TTL exactly once, when the window opens (counter just hit 1).
  if (count === 1) await client.pexpire(key, windowMs);
  return count > max;
}

function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('rate-limit redis timeout')), timeoutMs);
    fn().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Resolve the default backend: Redis when configured, else in-memory (null). */
function defaultClient(): RateLimiterClient | null {
  if (!process.env.REDIS_URL?.trim()) return null;
  try {
    return getRedisConnection();
  } catch {
    return null;
  }
}

/**
 * Returns true when `key` has exceeded `max` requests within `windowMs`.
 * Never throws — a backend failure degrades to in-memory.
 */
export async function isRateLimited(
  key: string,
  opts: RateLimitOptions,
  deps?: RateLimitDeps
): Promise<boolean> {
  const client = deps && 'client' in deps ? deps.client : defaultClient();
  if (!client) return memoryIsLimited(key, opts.windowMs, opts.max);

  try {
    return await withTimeout(
      () => redisIsLimited(client, key, opts.windowMs, opts.max),
      deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
  } catch (err) {
    console.warn('[rateLimit] redis backend failed, degrading to in-memory', {
      error: err instanceof Error ? err.message : String(err)
    });
    return memoryIsLimited(key, opts.windowMs, opts.max);
  }
}
