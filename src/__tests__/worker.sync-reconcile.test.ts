import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';

const {
  primeIntegrationSettingsCache,
  reconcilePushedDocuments,
  reconcileStuckLeads,
  notifyPushLeadFinalFailure,
  logError,
} = vi.hoisted(() => ({
  primeIntegrationSettingsCache: vi.fn(),
  reconcilePushedDocuments: vi.fn(),
  reconcileStuckLeads: vi.fn(),
  notifyPushLeadFinalFailure: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/config/integrationSettingsCache', () => ({ primeIntegrationSettingsCache }));
vi.mock('@/lib/services/oneCSync/reconcile', () => ({
  reconcilePushedDocuments,
  reconcileStuckLeads,
}));
vi.mock('@/worker/processors/push-lead', () => ({ notifyPushLeadFinalFailure }));
vi.mock('@/lib/logging', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: logError } }));

import { syncReconcileProcessor } from '@/worker/processors/sync-reconcile';

const NO_DOCS = { checked: 0, missing: [], unchecked: 0, error: null };
const NO_LEADS = { requeued: [], stuck: [] };

beforeEach(() => {
  vi.clearAllMocks();
  reconcilePushedDocuments.mockResolvedValue(NO_DOCS);
  reconcileStuckLeads.mockResolvedValue(NO_LEADS);
  notifyPushLeadFinalFailure.mockResolvedValue(undefined);
});

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
      create: logSpy,
    },
  } as unknown as PrismaClient;
  return { prisma, logSpy };
}

function fakeJob(): Job {
  return { id: 'job-1', data: { triggeredAt: '2026-05-22T03:00:00Z', reason: 'cron' } } as Job;
}

describe('syncReconcileProcessor', () => {
  it('status=success when all 4 entities have fresh inbound success', async () => {
    const { prisma, logSpy } = makePrismaMock(
      new Set(['organization', 'order', 'payment', 'document'])
    );
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

  // Этап 8 (`У-172`, `Д-26`): после термометра — сверка документов и зависших
  // лидов, тем же клиентом базы и с адаптером из настроек.
  it('runs the document and lead reconciliation after the heartbeat and returns both results', async () => {
    const { prisma } = makePrismaMock(new Set(['organization', 'order', 'payment', 'document']));
    const documents = { checked: 3, missing: ['doc-lost'], unchecked: 0, error: null };
    const leads = { requeued: ['lead-1'], stuck: [] };
    reconcilePushedDocuments.mockResolvedValue(documents);
    reconcileStuckLeads.mockResolvedValue(leads);

    const result = await syncReconcileProcessor(fakeJob(), prisma);

    expect(primeIntegrationSettingsCache).toHaveBeenCalledWith(prisma);
    expect(reconcilePushedDocuments).toHaveBeenCalledWith(prisma);
    expect(reconcileStuckLeads).toHaveBeenCalledWith(prisma);
    expect(result.documents).toEqual(documents);
    expect(result.leads).toEqual(leads);
    expect(notifyPushLeadFinalFailure).not.toHaveBeenCalled();
    // Настройки читаются ДО сверки: адаптер выбирается по ним.
    expect(primeIntegrationSettingsCache.mock.invocationCallOrder[0]).toBeLessThan(
      reconcilePushedDocuments.mock.invocationCallOrder[0]
    );
  });

  it('notifies the partner about every lead the reconciliation gave up on', async () => {
    const { prisma } = makePrismaMock(new Set(['organization', 'order', 'payment', 'document']));
    reconcileStuckLeads.mockResolvedValue({ requeued: [], stuck: ['lead-a', 'lead-b'] });

    await syncReconcileProcessor(fakeJob(), prisma);

    expect(notifyPushLeadFinalFailure).toHaveBeenCalledTimes(2);
    expect(notifyPushLeadFinalFailure).toHaveBeenCalledWith(prisma, {
      leadId: 'lead-a',
      errorMessage: 'отправка зависла, повтор при сверке не помог',
    });
  });

  it('a failing notification is logged and does not fail the job', async () => {
    const { prisma } = makePrismaMock(new Set(['organization', 'order', 'payment', 'document']));
    reconcileStuckLeads.mockResolvedValue({ requeued: [], stuck: ['lead-a'] });
    notifyPushLeadFinalFailure.mockRejectedValue(new Error('smtp down'));

    const result = await syncReconcileProcessor(fakeJob(), prisma);

    expect(result.leads.stuck).toEqual(['lead-a']);
    expect(logError).toHaveBeenCalledWith(
      '[worker] notifyPushLeadFinalFailure failed',
      expect.any(Error)
    );
  });
});
