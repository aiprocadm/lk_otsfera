import type { PrismaClient } from '@prisma/client';
import { getRedisConnection } from '@/lib/jobs/connection';

export type CheckResult = { ok: boolean; ms: number; error?: string };

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Runs `fn` against a timeout and never rejects — returns a CheckResult.
 * The timeout is essential: ioredis is configured with
 * `maxRetriesPerRequest: null`, so a command to a down Redis hangs forever
 * otherwise (the probe would freeze exactly when the dependency is down).
 */
export async function withTimeout(
  fn: () => Promise<unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<CheckResult> {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      })
    ]);
    return { ok: true, ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err)
    };
  /* v8 ignore next 2 -- V8 marks the finally-block as a branch point; the !timer path is unreachable because timer is always assigned synchronously inside new Promise before the race resolves */
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function checkDb(prisma: PrismaClient, timeoutMs?: number): Promise<CheckResult> {
  return withTimeout(() => prisma.$queryRaw`SELECT 1`, timeoutMs);
}

export function checkRedis(timeoutMs?: number): Promise<CheckResult> {
  return withTimeout(() => getRedisConnection().ping(), timeoutMs);
}
