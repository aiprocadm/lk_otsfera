import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { mapPaymentDto } from '@/lib/services/oneCSync/mappers';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { notifyManagers, notifyOrgUsers } from '@/lib/notifications';

export type SyncPaymentsResult = {
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
};

type SkipReason = 'order_not_found';

export async function syncPaymentsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncPaymentsResult> {
  const startedAt = Date.now();
  console.log('[worker] sync-payments job started', { id: job.id });

  const summary: SyncPaymentsResult = {
    pulled: 0,
    created: 0,
    updated: 0,
    skipped: 0
  };
  const skips: Array<{ externalId: string; reason: SkipReason }> = [];

  try {
    const adapter = getOneCAdapter();
    const dtos = await adapter.pullPayments({});
    summary.pulled = dtos.length;

    for (const dto of dtos) {
      const input = mapPaymentDto(dto);
      const order = await db.order.findUnique({
        where: { externalId: input.orderExternalId },
        select: { id: true, organizationId: true, orderNumber: true, title: true }
      });

      if (!order) {
        summary.skipped += 1;
        skips.push({ externalId: input.externalId, reason: 'order_not_found' });
        continue;
      }

      const existing = await db.payment.findUnique({
        where: { externalId: input.externalId },
        select: { id: true }
      });

      const updatable = {
        amount: input.amount,
        paidAt: input.paidAt,
        method: input.method,
        isRefund: input.isRefund
      };

      if (existing) {
        await db.payment.update({ where: { id: existing.id }, data: updatable });
        summary.updated += 1;
      } else {
        await db.payment.create({
          data: {
            ...updatable,
            externalId: input.externalId,
            orderId: order.id
          }
        });
        summary.created += 1;

        if (order.organizationId && !input.isRefund) {
          await notifyOrgUsers(db, {
            organizationId: order.organizationId,
            type: 'payment_received',
            payload: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              orderTitle: order.title,
              amount: input.amount.toString(),
              paidAt: input.paidAt
            }
          });
        }

        // Manager-cabinet fan-out for the same event. Best-effort: a failure
        // here must not roll back the payment row or stop subsequent DTOs
        // from processing. `notifyManagers` returns an empty summary when
        // the order has no manager assignment (per-order, per-org, or
        // historical), so an unassigned order is not an error.
        if (!input.isRefund) {
          try {
            await notifyManagers(db, {
              orderId: order.id,
              type: 'order_marked_paid_by_1c',
              payload: {
                amount: Number(input.amount),
                paidAt: input.paidAt
              }
            });
          } catch (err) {
            console.warn('[worker] sync-payments notifyManagers failed', {
              orderId: order.id,
              externalId: input.externalId,
              error: err instanceof Error ? err.message : String(err)
            });
          }
        }
      }
    }

    await writeSyncLog({
      entity: 'payment',
      direction: 'inbound',
      operation: summary.created > 0 ? 'create' : 'update',
      status: skips.length > 0 ? 'warn' : 'success',
      payload: { ...summary, skips },
      durationMs: Date.now() - startedAt
    });

    return summary;
  } catch (err) {
    await writeSyncLog({
      entity: 'payment',
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
