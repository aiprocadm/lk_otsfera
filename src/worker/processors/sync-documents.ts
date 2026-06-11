import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { OneCDocumentSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCDocumentDto } from '@/lib/services/oneCSync/dto';
import { mapDocumentDto } from '@/lib/services/oneCSync/mappers';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';
import { runRecordBatch, batchStatus, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { oneCMode } from '@/lib/services/oneCSync/config';
import { notifyOrgUsers } from '@/lib/notifications';

export type SyncDocumentsResult = BatchSummary;

export async function syncDocumentsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncDocumentsResult> {
  const startedAt = Date.now();
  const mode = oneCMode();
  console.log('[worker] sync-documents job started', { id: job.id, mode });

  try {
    const adapter = getOneCAdapter();
    const cursor = await getCursor(db, 'document');
    const raw = (await adapter.pullDocuments(cursor)) as unknown[];

    let maxUpdatedAt: Date | null = null;
    const bump = (iso: string) => {
      const t = new Date(iso);
      if (!maxUpdatedAt || t > maxUpdatedAt) maxUpdatedAt = t;
    };

    const summary = await runRecordBatch<OneCDocumentDto>(
      raw,
      OneCDocumentSchema,
      (dto) => dto.externalId,
      async (dto, sum) => {
        const input = mapDocumentDto(dto);
        const order = await db.order.findUnique({
          where: { externalId: input.orderExternalId },
          select: { id: true, organizationId: true, orderNumber: true, title: true }
        });
        if (!order) {
          sum.skipped += 1;
          sum.skips.push({ externalId: input.externalId, reason: 'order_not_found' });
          return;
        }
        const existing = await db.document.findUnique({ where: { externalId: input.externalId }, select: { id: true } });
        const updatable = {
          name: input.name, path: input.downloadUrl, mimeType: input.mimeType,
          size: input.size, type: input.type, signedAt: input.signedAt
        };

        if (existing) {
          if (mode === 'live') await db.document.update({ where: { id: existing.id }, data: updatable });
          sum.updated += 1;
          bump(dto.updatedAt);
        } else {
          if (mode === 'live') {
            await db.document.create({
              data: { ...updatable, externalId: input.externalId, orderId: order.id, direction: 'incoming', generatedBy: 'system', counterpartyType: 'organization', counterpartyId: order.organizationId }
            });
          }
          sum.created += 1;
          bump(dto.updatedAt);

          if (mode === 'live' && order.organizationId) {
            await notifyOrgUsers(db, {
              organizationId: order.organizationId,
              type: 'document_published',
              payload: {
                orderId: order.id, orderNumber: order.orderNumber, orderTitle: order.title,
                documentName: input.name, documentType: input.type
              }
            });
          }
        }
      }
    );

    if (mode === 'live') await advanceCursor(db, 'document', maxUpdatedAt);

    await writeSyncLog(
      {
        entity: 'document',
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
    await markCursorError(db, 'document', message).catch((e) =>
      console.warn('[sync-documents] markCursorError failed', e)
    );
    await writeSyncLog(
      { entity: 'document', direction: 'inbound', operation: 'skip', status: 'error', errorMessage: message, durationMs: Date.now() - startedAt },
      db
    );
    throw err;
  }
}
