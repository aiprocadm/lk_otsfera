import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { syncReconcileProcessor } from '@/worker/processors/sync-reconcile';

type FindFirstQuery = { where: { entity: string } };

function makePrismaMock(freshEntities: Set<string>): {
  prisma: PrismaClient;
  logSpy: ReturnType<typeof vi.fn>;
} {
  const logSpy = vi.fn().mockResolvedValue({});
  const prisma = {
    syncLog: {
      findFirst: vi.fn(async (q: FindFirstQuery) =>
        freshEntities.has(q.where.entity) ? { id: 'log-id' } : null
      ),
      create: logSpy
    }
  } as unknown as PrismaClient;
  return { prisma, logSpy };
}

function fakeJob(): Job {
  return { id: 'job-1', data: { triggeredAt: '2026-05-22T03:00:00Z', reason: 'cron' } } as Job;
}

describe('syncReconcileProcessor', () => {
  it('status=success when all 4 entities have fresh inbound success', async () => {
    const { prisma, logSpy } = makePrismaMock(new Set(['organization', 'order', 'payment', 'document']));
    const result = await syncReconcileProcessor(fakeJob(), prisma);
    expect(result.status).toBe('success');
    expect(result.staleEntities).toHaveLength(0);
    expect(result.freshEntities).toHaveLength(4);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].data.entity).toBe('reconcile');
    expect(logSpy.mock.calls[0][0].data.status).toBe('success');
  });

  it('status=warn with missing list when some entities are stale', async () => {
    const { prisma, logSpy } = makePrismaMock(new Set(['organization', 'order']));
    const result = await syncReconcileProcessor(fakeJob(), prisma);
    expect(result.status).toBe('warn');
    expect(result.staleEntities.sort()).toEqual(['document', 'payment'].sort());
    expect(logSpy.mock.calls[0][0].data.status).toBe('warn');
    expect(logSpy.mock.calls[0][0].data.payload.missing.sort()).toEqual(
      ['document', 'payment'].sort()
    );
  });

  it('all stale → still writes warn with all 4 in missing list', async () => {
    const { prisma, logSpy } = makePrismaMock(new Set());
    const result = await syncReconcileProcessor(fakeJob(), prisma);
    expect(result.status).toBe('warn');
    expect(result.staleEntities).toHaveLength(4);
    expect(logSpy.mock.calls[0][0].data.payload.missing).toHaveLength(4);
  });
});
