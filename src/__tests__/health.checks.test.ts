import { describe, it, expect, vi } from 'vitest';

const { pingMock, s3PingMock } = vi.hoisted(() => ({ pingMock: vi.fn(), s3PingMock: vi.fn() }));
vi.mock('@/lib/jobs/connection', () => ({
  getRedisConnection: () => ({ ping: pingMock })
}));
vi.mock('@/lib/storage/s3', () => ({
  s3HealthPing: s3PingMock
}));

import { withTimeout, checkDb, checkRedis, checkS3 } from '@/lib/health/checks';

describe('withTimeout', () => {
  it('resolves ok when fn resolves in time', async () => {
    const r = await withTimeout(() => Promise.resolve('PONG'), 1000);
    expect(r.ok).toBe(true);
    expect(typeof r.ms).toBe('number');
  });

  it('returns ok:false error="timeout" when fn is too slow', async () => {
    const r = await withTimeout(() => new Promise((res) => setTimeout(res, 100)), 10);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('timeout');
  });

  it('returns ok:false with the error message when fn rejects', async () => {
    const r = await withTimeout(() => Promise.reject(new Error('boom')), 1000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('boom');
  });
});

describe('checkDb', () => {
  it('ok when $queryRaw resolves', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]) } as never;
    const r = await checkDb(prisma, 1000);
    expect(r.ok).toBe(true);
  });

  it('not ok when $queryRaw throws', async () => {
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error('db down')) } as never;
    const r = await checkDb(prisma, 1000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('db down');
  });
});

describe('checkRedis', () => {
  it('ok when ping resolves', async () => {
    pingMock.mockResolvedValue('PONG');
    const r = await checkRedis(1000);
    expect(r.ok).toBe(true);
  });

  it('not ok when ping rejects', async () => {
    pingMock.mockRejectedValue(new Error('redis down'));
    const r = await checkRedis(1000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('redis down');
  });
});

describe('checkS3 (R1.1)', () => {
  it('ok when s3HealthPing resolves', async () => {
    s3PingMock.mockResolvedValue(undefined);
    const r = await checkS3(1000);
    expect(r.ok).toBe(true);
  });

  it('not ok when s3HealthPing rejects', async () => {
    s3PingMock.mockRejectedValue(new Error('STORAGE_PING: bucket unreachable'));
    const r = await checkS3(1000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('STORAGE_PING: bucket unreachable');
  });
});

describe('withTimeout — non-Error rejection', () => {
  it('converts a non-Error rejection to a string error message', async () => {
    const r = await withTimeout(() => Promise.reject('raw string error'), 1000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('raw string error');
  });

  it('uses the default timeout when timeoutMs is omitted', async () => {
    // withTimeout with default (2000ms) — fn resolves quickly
    const r = await withTimeout(() => Promise.resolve('OK'));
    expect(r.ok).toBe(true);
  });
});
