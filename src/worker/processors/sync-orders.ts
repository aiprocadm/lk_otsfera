import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { mapOrderDto } from '@/lib/services/oneCSync/mappers';
import { writeSyncLog } from '@/lib/services/oneCSync/log';

export type SyncOrdersResult = {
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
};

type SkipReason = 'organization_not_found';

export async function syncOrdersProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncOrdersResult> {
  const startedAt = Date.now();
  console.log('[worker] sync-orders job started', { id: job.id });

  const summary: SyncOrdersResult = {
    pulled: 0,
    created: 0,
    updated: 0,
    skipped: 0
  };
  const skips: Array<{ externalId: string; reason: SkipReason }> = [];

  try {
    const adapter = getOneCAdapter();
    const dtos = await adapter.pullOrders({});
    summary.pulled = dtos.length;

    for (const dto of dtos) {
      const input = mapOrderDto(dto);
      const org = await db.organization.findUnique({
        where: { externalId: input.organizationExternalId },
        select: { id: true, partnerId: true, companyId: true }
      });

      if (!org || !org.companyId) {
        summary.skipped += 1;
        skips.push({ externalId: input.externalId, reason: 'organization_not_found' });
        continue;
      }

      const existing = await db.order.findUnique({
        where: { externalId: input.externalId },
        select: { id: true, organizationId: true }
      });

      const ownedBy1C = {
        orderNumber: input.orderNumber,
        title: input.title,
        totalAmount: input.totalAmount,
        paidAmount: input.paidAmount,
        paidAt: input.paidAt,
        contractSignedAt: input.contractSignedAt,
        completedAt: input.completedAt,
        closedAt: input.closedAt,
        vatIncluded: input.vatIncluded,
        vatRate: input.vatRate,
        financialStatus: input.financialStatus,
        productMix: input.productMix,
        lastSyncedAt: new Date()
      };

      if (existing) {
        await db.order.update({
          where: { id: existing.id },
          data: existing.organizationId === null
            ? { ...ownedBy1C, organizationId: org.id }
            : ownedBy1C
        });
        summary.updated += 1;
      } else {
        await db.order.create({
          data: {
            ...ownedBy1C,
            externalId: input.externalId,
            executionStatus: input.executionStatus,
            companyId: org.companyId,
            partnerId: org.partnerId,
            organizationId: org.id
          }
        });
        summary.created += 1;
      }
    }

    await writeSyncLog({
      entity: 'order',
      direction: 'inbound',
      operation: summary.created > 0 ? 'create' : 'update',
      status: skips.length > 0 ? 'warn' : 'success',
      payload: { ...summary, skips },
      durationMs: Date.now() - startedAt
    });

    return summary;
  } catch (err) {
    await writeSyncLog({
      entity: 'order',
      direction: 'inbound',
      operation: 'skip',
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      payload: summary,
      durationMs: Date.now() - startedAt
    });
    throw err;
  }
}
