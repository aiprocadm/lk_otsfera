import type { Queue } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/db/prisma';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload, ScanDocumentTarget } from '@/lib/jobs/types';

export type BackfillResult = {
  enqueued: number;
  documents: number;
  leadAttachments: number;
  inboundAttachments: number;
  staffAttachments: number;
};

type PendingRow = { id: string };

/**
 * Walks a single table in cursor batches and enqueues a scan job per row.
 * Exported so unit tests can drive it with a mocked fetch + queue.
 */
export async function backfillTable(
  kind: ScanDocumentTarget,
  fetchBatch: (cursor: string | null, take: number) => Promise<PendingRow[]>,
  queue: Pick<Queue, 'add'>,
  batchSize: number
): Promise<number> {
  let cursor: string | null = null;
  let enqueued = 0;
  for (;;) {
    const rows = await fetchBatch(cursor, batchSize);
    if (rows.length === 0) return enqueued;
    for (const row of rows) {
      const payload: ScanDocumentPayload = { kind, id: row.id };
      await queue.add('scan', payload);
      enqueued += 1;
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < batchSize) return enqueued;
  }
}

/**
 * Enqueues a `docs.scanDocument` job for every Document, LeadAttachment,
 * inbound-attachment (InboundMessage), and staff-chat attachment (StaffMessage)
 * row stuck in `scanStatus='pending'`.
 * Idempotent by design — once the processor flips a row, the WHERE clause
 * naturally skips it on the next pass.
 */
export async function runBackfill(
  db: PrismaClient = defaultPrisma,
  queue: Pick<Queue, 'add'> = getQueue('docs.scanDocument'),
  batchSize: number = Number(process.env.BACKFILL_BATCH ?? '500')
): Promise<BackfillResult> {
  const documents = await backfillTable(
    'document',
    (cursor, take) =>
      db.document.findMany({
        where: { scanStatus: 'pending' },
        select: { id: true },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      }),
    queue,
    batchSize
  );

  const leadAttachments = await backfillTable(
    'leadAttachment',
    (cursor, take) =>
      db.leadAttachment.findMany({
        where: { scanStatus: 'pending' },
        select: { id: true },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      }),
    queue,
    batchSize
  );

  const inboundAttachments = await backfillTable(
    'inbound_attachment',
    (cursor, take) =>
      db.inboundMessage.findMany({
        where: { scanStatus: 'pending', attachmentPath: { not: null } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      }),
    queue,
    batchSize
  );

  const staffAttachments = await backfillTable(
    'staff_attachment',
    (cursor, take) =>
      db.staffMessage.findMany({
        where: { scanStatus: 'pending', attachmentPath: { not: null } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      }),
    queue,
    batchSize
  );

  return {
    enqueued: documents + leadAttachments + inboundAttachments + staffAttachments,
    documents,
    leadAttachments,
    inboundAttachments,
    staffAttachments,
  };
}
