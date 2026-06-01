import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { OneCPaymentSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCPaymentDto } from '@/lib/services/oneCSync/dto';
import { mapPaymentDto } from '@/lib/services/oneCSync/mappers';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';
import { runRecordBatch, batchStatus, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { oneCMode } from '@/lib/services/oneCSync/config';
import { notifyManagers, notifyOrgUsers } from '@/lib/notifications';

export type SyncPaymentsResult = BatchSummary;

export async function syncPaymentsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncPaymentsResult> {
  const startedAt = Date.now();
  const mode = oneCMode();
  console.log('[worker] sync-payments job started', { id: job.id, mode });

  try {
    const adapter = getOneCAdapter();
    const cursor = await getCursor(db, 'payment');
    const raw = (await adapter.pullPayments(cursor)) as unknown[];

    let maxUpdatedAt: Date | null = null;
    const bump = (iso: string) => {
      const t = new Date(iso);
      if (!maxUpdatedAt || t > maxUpdatedAt) maxUpdatedAt = t;
    };

    const summary = await runRecordBatch<OneCPaymentDto>(
      raw,
      OneCPaymentSchema,
      (dto) => dto.externalId,
      async (dto, sum) => {
        const input = mapPaymentDto(dto);
        const order = await db.order.findUnique({
          where: { externalId: input.orderExternalId },
          select: { id: true, organizationId: true, orderNumber: true, title: true }
        });
        if (!order) {
          sum.skipped += 1;
          sum.skips.push({ externalId: input.externalId, reason: 'order_not_found' });
          return;
        }
        const existing = await db.payment.findUnique({
          where: { externalId: input.externalId },
          select: { id: true }
        });
        const updatable = { amount: input.amount, paidAt: input.paidAt, method: input.method, isRefund: input.isRefund };

        if (existing) {
          if (mode === 'live') await db.payment.update({ where: { id: existing.id }, data: updatable });
          sum.updated += 1;
          bump(dto.updatedAt);
        } else {
          if (mode === 'live') {
            await db.payment.create({ data: { ...updatable, externalId: input.externalId, orderId: order.id } });
          }
          sum.created += 1;
          bump(dto.updatedAt);

          if (mode === 'live' && order.organizationId && !input.isRefund) {
            try {
              await notifyOrgUsers(db, {
                organizationId: order.organizationId,
                type: 'payment_received',
                payload: {
                  orderId: order.id, orderNumber: order.orderNumber, orderTitle: order.title,
                  amount: input.amount.toString(), paidAt: input.paidAt
                }
              });
            } catch (err) {
              console.warn('[worker] sync-payments notifyOrgUsers failed', {
                orderId: order.id, externalId: input.externalId, error: err instanceof Error ? err.message : String(err)
              });
            }
          }
          if (mode === 'live' && !input.isRefund) {
            try {
              await notifyManagers(db, {
                orderId: order.id, type: 'order_marked_paid_by_1c',
                payload: { amount: Number(input.amount), paidAt: input.paidAt }
              });
            } catch (err) {
              console.warn('[worker] sync-payments notifyManagers failed', {
                orderId: order.id, externalId: input.externalId, error: err instanceof Error ? err.message : String(err)
              });
            }
          }
        }
      }
    );

    if (mode === 'live') await advanceCursor(db, 'payment', maxUpdatedAt);

    await writeSyncLog(
      {
        entity: 'payment',
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
    await markCursorError(db, 'payment', message).catch(() => {});
    await writeSyncLog(
      { entity: 'payment', direction: 'inbound', operation: 'skip', status: 'error', errorMessage: message, durationMs: Date.now() - startedAt },
      db
    );
    throw err;
  }
}
