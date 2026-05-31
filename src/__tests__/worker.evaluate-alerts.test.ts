import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import type { SyncJobPayload } from '@/lib/jobs/types';

const { getQueueStatsMock, getSyncLagMock, deliverAlertMock } = vi.hoisted(() => ({
  getQueueStatsMock: vi.fn(),
  getSyncLagMock: vi.fn(),
  deliverAlertMock: vi.fn()
}));
vi.mock('@/lib/services/admin/queueStats', () => ({ getQueueStats: getQueueStatsMock }));
vi.mock('@/lib/services/admin/syncHealth', () => ({ getSyncLag: getSyncLagMock }));
vi.mock('@/lib/monitoring/deliver', () => ({ deliverAlert: deliverAlertMock }));

import { evaluateAlertsProcessor } from '@/worker/processors/evaluate-alerts';

const KEY = 'dlq:emails.send';
const noCounts = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
let prisma: PrismaClient;

function job(): Job<SyncJobPayload> {
  return { id: 'alert-test', data: { triggeredAt: new Date().toISOString(), reason: 'manual' } } as Job<SyncJobPayload>;
}
function withFailure() {
  getQueueStatsMock.mockResolvedValue([{ queue: 'emails.send', counts: { ...noCounts, failed: 3 } }]);
  getSyncLagMock.mockResolvedValue([]);
}
function healthy() {
  getQueueStatsMock.mockResolvedValue([{ queue: 'emails.send', counts: { ...noCounts } }]);
  getSyncLagMock.mockResolvedValue([]);
}

beforeEach(async () => {
  if (!prisma) prisma = new PrismaClient();
  await prisma.alertState.deleteMany({ where: { key: KEY } });
  getQueueStatsMock.mockReset();
  getSyncLagMock.mockReset();
  deliverAlertMock.mockReset().mockResolvedValue(undefined);
  process.env.ALERT_RENOTIFY_COOLDOWN_HOURS = '6';
});

afterAll(async () => {
  await prisma.alertState.deleteMany({ where: { key: KEY } });
  await prisma.$disconnect();
});

describe('evaluateAlertsProcessor', () => {
  it('fires a new breach and persists firing AlertState', async () => {
    withFailure();
    const r = await evaluateAlertsProcessor(job(), prisma);
    expect(r.fired).toBe(1);
    expect(deliverAlertMock).toHaveBeenCalledTimes(1);
    const row = await prisma.alertState.findUnique({ where: { key: KEY } });
    expect(row?.status).toBe('firing');
  });

  it('stays silent on the next run within cooldown', async () => {
    withFailure();
    await evaluateAlertsProcessor(job(), prisma); // fire
    deliverAlertMock.mockClear();
    withFailure();
    const r = await evaluateAlertsProcessor(job(), prisma); // within cooldown
    expect(r.fired + r.renotified).toBe(0);
    expect(deliverAlertMock).not.toHaveBeenCalled();
  });

  it('resolves when the breach clears', async () => {
    withFailure();
    await evaluateAlertsProcessor(job(), prisma); // fire
    deliverAlertMock.mockClear();
    healthy();
    const r = await evaluateAlertsProcessor(job(), prisma); // resolve
    expect(r.resolved).toBe(1);
    expect(deliverAlertMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'resolve' })
    );
    const row = await prisma.alertState.findUnique({ where: { key: KEY } });
    expect(row?.status).toBe('resolved');
  });
});
