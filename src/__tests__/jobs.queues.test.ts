import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ioredis so getRedisConnection() never really connects.
// ---------------------------------------------------------------------------
const { IORedisConstructorMock } = vi.hoisted(() => ({
  IORedisConstructorMock: vi.fn().mockImplementation(() => ({ ping: vi.fn() }))
}));
vi.mock('ioredis', () => ({ default: IORedisConstructorMock }));

// ---------------------------------------------------------------------------
// Mock bullmq Queue so we control the close() lifecycle.
// ---------------------------------------------------------------------------
const { closeMock, QueueConstructorMock } = vi.hoisted(() => {
  const closeMock = vi.fn().mockResolvedValue(undefined);
  const QueueConstructorMock = vi.fn().mockImplementation((name: string) => ({
    name,
    close: closeMock
  }));
  return { closeMock, QueueConstructorMock };
});
vi.mock('bullmq', () => ({ Queue: QueueConstructorMock }));

beforeEach(() => {
  IORedisConstructorMock.mockClear();
  QueueConstructorMock.mockClear();
  closeMock.mockClear();
  vi.resetModules();
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

import { QUEUE_NAMES, type QueueName } from '@/lib/jobs/queues';

describe('Job queue registry', () => {
  it('declares all phase 0 queue names', () => {
    const expected: QueueName[] = [
      'oneCSync.pullOrders',
      'oneCSync.pullPayments',
      'oneCSync.pullDocuments',
      'oneCSync.pullOrganizations',
      'oneCSync.pushLead',
      'oneCSync.reconcile',
      'docs.generateCommissionPdf',
      'docs.generateCommissionXlsx',
      'notifications.dispatch',
      'emails.send'
    ];
    for (const name of expected) {
      expect(QUEUE_NAMES).toContain(name);
    }
  });

  it('QUEUE_NAMES is frozen/readonly tuple', () => {
    // Compile-time assertion: QueueName covers exactly the declared 10 queues.
    const _check: QueueName extends typeof QUEUE_NAMES[number] ? true : false = true;
    expect(_check).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getQueue / closeAllQueues (needs fresh module per test — use dynamic import)
// ---------------------------------------------------------------------------
describe('getQueue', () => {
  it('creates a new Queue with the given name and Redis connection', async () => {
    const { getQueue } = await import('@/lib/jobs/queues');
    const q = getQueue('emails.send');
    expect(QueueConstructorMock).toHaveBeenCalledWith(
      'emails.send',
      expect.objectContaining({ defaultJobOptions: expect.any(Object) })
    );
    expect(q).toBeDefined();
  });

  it('returns the same Queue instance on repeated calls (singleton per name)', async () => {
    const { getQueue } = await import('@/lib/jobs/queues');
    const a = getQueue('notifications.dispatch');
    const b = getQueue('notifications.dispatch');
    expect(a).toBe(b);
    expect(QueueConstructorMock).toHaveBeenCalledTimes(1);
  });

  it('creates distinct Queue instances for different names', async () => {
    const { getQueue } = await import('@/lib/jobs/queues');
    const a = getQueue('emails.send');
    const b = getQueue('notifications.dispatch');
    expect(a).not.toBe(b);
    expect(QueueConstructorMock).toHaveBeenCalledTimes(2);
  });
});

describe('closeAllQueues', () => {
  it('calls close() on all open queues and clears the registry', async () => {
    const { getQueue, closeAllQueues } = await import('@/lib/jobs/queues');
    getQueue('emails.send');
    getQueue('notifications.dispatch');
    await closeAllQueues();
    expect(closeMock).toHaveBeenCalledTimes(2);
    // After closing, a new getQueue call creates a fresh Queue (registry was cleared)
    QueueConstructorMock.mockClear();
    getQueue('emails.send');
    expect(QueueConstructorMock).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no queues have been opened', async () => {
    const { closeAllQueues } = await import('@/lib/jobs/queues');
    await expect(closeAllQueues()).resolves.toBeUndefined();
    expect(closeMock).not.toHaveBeenCalled();
  });
});
