import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import type { SyncJobPayload } from '@/lib/jobs/types';

const { getQueueStatsMock, getSyncLagMock, deliverAlertMock } = vi.hoisted(() => ({
  getQueueStatsMock: vi.fn(),
  getSyncLagMock: vi.fn(),
  deliverAlertMock: vi.fn(),
}));
vi.mock('@/lib/services/admin/queueStats', () => ({ getQueueStats: getQueueStatsMock }));
vi.mock('@/lib/services/admin/syncHealth', () => ({ getSyncLag: getSyncLagMock }));
vi.mock('@/lib/monitoring/deliver', () => ({ deliverAlert: deliverAlertMock }));

import { evaluateAlertsProcessor } from '@/worker/processors/evaluate-alerts';

const KEY = 'dlq:notifications.dispatch';
const DEAD_KEY = 'onec_dead_letters';
const PUSH_KEY = 'onec_push_failed';
const noCounts = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
let prisma: PrismaClient;

/**
 * Wrap the real prisma with a stub for oneCPendingRecord (table may not exist
 * locally yet). `document.count` тоже подставной: в общей базе могут лежать
 * чужие `failed`-документы, а порог `У-174` по умолчанию 0.
 */
function makeDb(base: PrismaClient, failedPushes = 0): PrismaClient {
  return Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
    oneCPendingRecord: { count: vi.fn().mockResolvedValue(0) },
    document: { count: vi.fn().mockResolvedValue(failedPushes) },
  }) as unknown as PrismaClient;
}

function job(): Job<SyncJobPayload> {
  return {
    id: 'alert-test',
    data: { triggeredAt: new Date().toISOString(), reason: 'manual' },
  } as Job<SyncJobPayload>;
}
function withFailure() {
  getQueueStatsMock.mockResolvedValue([
    { queue: 'notifications.dispatch', counts: { ...noCounts, failed: 3 } },
  ]);
  getSyncLagMock.mockResolvedValue([]);
}
function healthy() {
  getQueueStatsMock.mockResolvedValue([
    { queue: 'notifications.dispatch', counts: { ...noCounts } },
  ]);
  getSyncLagMock.mockResolvedValue([]);
}

beforeEach(async () => {
  if (!prisma) prisma = new PrismaClient();
  await prisma.alertState.deleteMany({ where: { key: { in: [KEY, DEAD_KEY, PUSH_KEY] } } });
  getQueueStatsMock.mockReset();
  getSyncLagMock.mockReset();
  deliverAlertMock.mockReset().mockResolvedValue(undefined);
  process.env.ALERT_RENOTIFY_COOLDOWN_HOURS = '6';
});

afterAll(async () => {
  await prisma.alertState.deleteMany({ where: { key: { in: [KEY, DEAD_KEY, PUSH_KEY] } } });
  await prisma.$disconnect();
});

describe('evaluateAlertsProcessor', () => {
  it('fires a new breach and persists firing AlertState', async () => {
    withFailure();
    const r = await evaluateAlertsProcessor(job(), makeDb(prisma));
    expect(r.fired).toBe(1);
    expect(deliverAlertMock).toHaveBeenCalledTimes(1);
    const row = await prisma.alertState.findUnique({ where: { key: KEY } });
    expect(row?.status).toBe('firing');
  });

  it('stays silent on the next run within cooldown', async () => {
    withFailure();
    await evaluateAlertsProcessor(job(), makeDb(prisma)); // fire
    deliverAlertMock.mockClear();
    withFailure();
    const r = await evaluateAlertsProcessor(job(), makeDb(prisma)); // within cooldown
    expect(r.fired + r.renotified).toBe(0);
    expect(deliverAlertMock).not.toHaveBeenCalled();
  });

  it('resolves when the breach clears', async () => {
    withFailure();
    await evaluateAlertsProcessor(job(), makeDb(prisma)); // fire
    deliverAlertMock.mockClear();
    healthy();
    const r = await evaluateAlertsProcessor(job(), makeDb(prisma)); // resolve
    expect(r.resolved).toBe(1);
    expect(deliverAlertMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'resolve' })
    );
    const row = await prisma.alertState.findUnique({ where: { key: KEY } });
    expect(row?.status).toBe('resolved');
  });

  it('fires onec_dead_letters alert when dead-lettered pending records exist', async () => {
    healthy();
    const mockDb = {
      oneCPendingRecord: { count: vi.fn().mockResolvedValue(2) },
      document: { count: vi.fn().mockResolvedValue(0) },
      alertState: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const r = await evaluateAlertsProcessor(job(), mockDb as unknown as PrismaClient);
    expect(r.fired).toBe(1);
    expect(deliverAlertMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'fire' })
    );
    expect(mockDb.alertState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: DEAD_KEY } })
    );
  });

  it('У-174: документы, которые 1С не приняла, выше порога — оповещение onec_push_failed', async () => {
    healthy();
    const db = makeDb(prisma, 2);
    const r = await evaluateAlertsProcessor(job(), db);
    expect(r.fired).toBe(1);
    expect(deliverAlertMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'fire',
        message: expect.stringContaining('2 документа не выгружено'),
      })
    );
    // Считаем только failed и действующие версии — той же функцией, что и светофор.
    expect((db.document.count as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
      where: { oneCPushStatus: 'failed', supersededAt: null },
    });
    const row = await prisma.alertState.findUnique({ where: { key: PUSH_KEY } });
    expect(row?.status).toBe('firing');
    expect(row?.severity).toBe('warning');
  });
});
