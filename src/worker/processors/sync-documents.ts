import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { mapDocumentDto } from '@/lib/services/oneCSync/mappers';
import { writeSyncLog } from '@/lib/services/oneCSync/log';

export type SyncDocumentsResult = {
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
};

type SkipReason = 'order_not_found';

export async function syncDocumentsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncDocumentsResult> {
  const startedAt = Date.now();
  console.log('[worker] sync-documents job started', { id: job.id });

  const summary: SyncDocumentsResult = {
    pulled: 0,
    created: 0,
    updated: 0,
    skipped: 0
  };
  const skips: Array<{ externalId: string; reason: SkipReason }> = [];

  try {
    const adapter = getOneCAdapter();
    const dtos = await adapter.pullDocuments({});
    summary.pulled = dtos.length;

    for (const dto of dtos) {
      const input = mapDocumentDto(dto);
      const order = await db.order.findUnique({
        where: { externalId: input.orderExternalId },
        select: { id: true }
      });

      if (!order) {
        summary.skipped += 1;
        skips.push({ externalId: input.externalId, reason: 'order_not_found' });
        continue;
      }

      const existing = await db.document.findUnique({
        where: { externalId: input.externalId },
        select: { id: true }
      });

      const updatable = {
        name: input.name,
        path: input.downloadUrl,
        mimeType: input.mimeType,
        size: input.size,
        type: input.type,
        signedAt: input.signedAt
      };

      if (existing) {
        await db.document.update({ where: { id: existing.id }, data: updatable });
        summary.updated += 1;
      } else {
        await db.document.create({
          data: {
            ...updatable,
            externalId: input.externalId,
            orderId: order.id,
            direction: 'incoming',
            generatedBy: 'system'
          }
        });
        summary.created += 1;
      }
    }

    await writeSyncLog({
      entity: 'document',
      direction: 'inbound',
      operation: summary.created > 0 ? 'create' : 'update',
      status: skips.length > 0 ? 'warn' : 'success',
      payload: { ...summary, skips },
      durationMs: Date.now() - startedAt
    });

    return summary;
  } catch (err) {
    await writeSyncLog({
      entity: 'document',
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
