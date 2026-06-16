/**
 * Unit tests for src/lib/jobs/connection.ts
 *
 * Uses vi.resetModules() + dynamic import so each test scenario gets a fresh
 * singleton (the module-level `connection` variable is reset on re-import).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ioredis is mocked globally — the constructor returns a fake Redis instance.
const { IORedisConstructorMock, fakeQuit } = vi.hoisted(() => {
  const fakeQuit = vi.fn().mockResolvedValue('OK');
  const IORedisConstructorMock = vi.fn().mockImplementation(() => ({
    quit: fakeQuit,
    ping: vi.fn().mockResolvedValue('PONG')
  }));
  return { IORedisConstructorMock, fakeQuit };
});

vi.mock('ioredis', () => ({
  default: IORedisConstructorMock
}));

beforeEach(() => {
  IORedisConstructorMock.mockClear();
  fakeQuit.mockClear();
  vi.resetModules();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getRedisConnection', () => {
  it('throws when REDIS_URL is not set', async () => {
    vi.stubEnv('REDIS_URL', '');
    const { getRedisConnection } = await import('@/lib/jobs/connection');
    expect(() => getRedisConnection()).toThrow('REDIS_URL is not set');
  });

  it('creates a new IORedis instance with the configured URL', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    const { getRedisConnection } = await import('@/lib/jobs/connection');
    const conn = getRedisConnection();
    expect(IORedisConstructorMock).toHaveBeenCalledWith(
      'redis://localhost:6379',
      { maxRetriesPerRequest: null, enableReadyCheck: false }
    );
    expect(conn).toBeDefined();
  });

  it('returns the same instance on repeated calls (singleton)', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    const { getRedisConnection } = await import('@/lib/jobs/connection');
    const a = getRedisConnection();
    const b = getRedisConnection();
    expect(a).toBe(b);
    expect(IORedisConstructorMock).toHaveBeenCalledTimes(1);
  });
});

describe('closeRedisConnection', () => {
  it('calls quit() and resets the singleton', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    const { getRedisConnection, closeRedisConnection } = await import('@/lib/jobs/connection');
    getRedisConnection(); // initialise
    await closeRedisConnection();
    expect(fakeQuit).toHaveBeenCalledTimes(1);
    // After closing, a new connection can be created
    getRedisConnection();
    expect(IORedisConstructorMock).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when connection is null (never opened)', async () => {
    const { closeRedisConnection } = await import('@/lib/jobs/connection');
    // Should not throw even though no connection was ever created
    await expect(closeRedisConnection()).resolves.toBeUndefined();
    expect(fakeQuit).not.toHaveBeenCalled();
  });
});
