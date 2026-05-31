import type { ZodType } from 'zod';
import { oneCHttpTimeoutMs } from './config';

export class OneCHttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly retryAfter?: number) {
    super(message);
    this.name = 'OneCHttpError';
  }
}

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number = oneCHttpTimeoutMs()
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function isTransient(err: unknown): boolean {
  if (err instanceof OneCHttpError) {
    return err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504;
  }
  return true; // network / abort / unknown → transient
}

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? realSleep;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransient(err)) throw err;
      const retryAfterMs =
        err instanceof OneCHttpError && typeof err.retryAfter === 'number'
          ? err.retryAfter * 1000
          : baseDelayMs * 2 ** i;
      await sleep(retryAfterMs);
    }
  }
  throw lastErr;
}

export type ParseResult<T> = { valid: T[]; invalid: Array<{ externalId: string | null; issue: string }> };

export function parseRecords<T>(schema: ZodType<T>, raw: unknown[]): ParseResult<T> {
  const valid: T[] = [];
  const invalid: Array<{ externalId: string | null; issue: string }> = [];
  for (const item of raw) {
    const res = schema.safeParse(item);
    if (res.success) {
      valid.push(res.data);
    } else {
      const externalId =
        item && typeof item === 'object' && 'externalId' in item
          ? String((item as { externalId: unknown }).externalId)
          : null;
      invalid.push({ externalId, issue: res.error.issues[0]?.message ?? 'invalid' });
    }
  }
  return { valid, invalid };
}
