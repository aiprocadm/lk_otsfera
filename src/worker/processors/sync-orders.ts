import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { OneCOrderSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCOrderDto } from '@/lib/services/oneCSync/dto';
import { mapOrderDto } from '@/lib/services/oneCSync/mappers';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';
import { runRecordBatch, batchStatus, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { oneCMode } from '@/lib/services/oneCSync/config';
import { notifyOrgUsers } from '@/lib/notifications';

export type SyncOrdersResult = BatchSummary;

export async function syncOrdersProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncOrdersResult> {
  const startedAt = Date.now();
  const mode = oneCMode();
  console.log('[worker] sync-orders job started', { id: job.id, mode });

  try {
    const adapter = getOneCAdapter();
    const cursor = await getCursor(db, 'order');
    const raw = (await adapter.pullOrders(cursor)) as unknown[];

    let maxUpdatedAt: Date | null = null;
    const bump = (iso: string) => {
      const t = new Date(iso);
      if (!maxUpdatedAt || t > maxUpdatedAt) maxUpdatedAt = t;
    };

    const summary = await runRecordBatch<OneCOrderDto>(
      raw,
      OneCOrderSchema,
      (dto) => dto.externalId,
      async (dto, sum) => {
        const input = mapOrderDto(dto);
        const org = await db.organization.findUnique({
          where: { externalId: input.organizationExternalId },
          select: { id: true, partnerId: true, companyId: true }
        });
        if (!org || !org.companyId) {
          sum.skipped += 1;
          sum.skips.push({ externalId: input.externalId, reason: 'organization_not_found' });
          return;
        }
        const existing = await db.order.findUnique({
          where: { externalId: input.externalId },
          select: { id: true, organizationId: true, executionStatus: true, financialStatus: true, orderNumber: true, title: true }
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
          if (mode === 'live') {
            await db.order.update({
              where: { id: existing.id },
              data: existing.organizationId === null ? { ...ownedBy1C, organizationId: org.id } : ownedBy1C
            });
          }
          sum.updated += 1;
          bump(dto.updatedAt);

          const targetOrgId = existing.organizationId ?? org.id;
          if (mode === 'live' && targetOrgId && existing.financialStatus !== input.financialStatus) {
            await notifyOrgUsers(db, {
              organizationId: targetOrgId,
              type: 'order_status_changed',
              payload: {
                orderId: existing.id,
                orderNumber: existing.orderNumber,
                orderTitle: existing.title,
                dimension: 'financial',
                oldStatus: existing.financialStatus,
                newStatus: input.financialStatus
              }
            });
          }
        } else {
          if (mode === 'live') {
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
          }
          sum.created += 1;
          bump(dto.updatedAt);
        }
      }
    );

    if (mode === 'live') await advanceCursor(db, 'order', maxUpdatedAt);

    await writeSyncLog(
      {
        entity: 'order',
        direction: 'inbound',
        operation: mode === 'shadow' ? 'check' : summary.created > 0 ? 'create' : 'update',
        status: batchStatus(summary),
        payload: { mode, ...summary },
        durationMs: Date.now() - startedAt
      },
      db
    );

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markCursorError(db, 'order', message).catch((e) =>
      console.warn('[sync-orders] markCursorError failed', e)
    );
    await writeSyncLog(
      {
        entity: 'order',
        direction: 'inbound',
        operation: 'skip',
        status: 'error',
        errorMessage: message,
        durationMs: Date.now() - startedAt
      },
      db
    );
    throw err;
  }
}
