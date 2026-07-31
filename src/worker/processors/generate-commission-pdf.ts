import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from '@/lib/db/prisma';
import { getObjectStorage } from '@/lib/storage';
import { renderStatementPdf } from '@/lib/services/commission/pdf';
import type { GenerateCommissionPdfPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';

export type GenerateCommissionPdfResult = {
  statementId: string;
  path: string;
};

export async function generateCommissionPdfProcessor(
  job: Job<GenerateCommissionPdfPayload>,
  db: PrismaClient = prisma
): Promise<GenerateCommissionPdfResult> {
  const { statementId } = job.data;
  log.info('[worker] generate-commission-pdf started', { id: job.id, statementId });

  const statement = await db.commissionStatement.findUnique({
    where: { id: statementId },
    include: { items: true, partner: true }
  });
  if (!statement) throw new Error(`NOT_FOUND: CommissionStatement ${statementId}`);

  const buf = await renderStatementPdf({
    statement,
    items: statement.items,
    partner: { name: statement.partner.name, legalName: statement.partner.legalName },
    verifyUrl: null
  });

  const path = `partners/${statement.partnerId}/commission/${statementId}.pdf`;
  // Throws StorageError on provider failure → propagates so BullMQ retries the
  // job (fail-loud upload semantics; historically the Supabase client's `if (error) throw`).
  await getObjectStorage().upload(path, buf, { contentType: 'application/pdf' });

  await db.commissionStatement.update({
    where: { id: statementId },
    data: { pdfPath: path }
  });

  return { statementId, path };
}
