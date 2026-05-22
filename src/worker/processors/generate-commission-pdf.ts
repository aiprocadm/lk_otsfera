import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getServerClient, documentBucket } from '@/lib/storage/supabase';
import { renderStatementPdf } from '@/lib/services/commission/pdf';
import type { GenerateCommissionPdfPayload } from '@/lib/jobs/types';

export type GenerateCommissionPdfResult = {
  statementId: string;
  path: string;
};

export async function generateCommissionPdfProcessor(
  job: Job<GenerateCommissionPdfPayload>,
  db: PrismaClient = prisma
): Promise<GenerateCommissionPdfResult> {
  const { statementId } = job.data;
  console.log('[worker] generate-commission-pdf started', { id: job.id, statementId });

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
  const storage = getServerClient().storage.from(documentBucket);
  const { error } = await storage.upload(path, buf, {
    contentType: 'application/pdf',
    upsert: true
  });
  if (error) throw new Error(`STORAGE_FAILURE: ${error.message}`);

  await db.commissionStatement.update({
    where: { id: statementId },
    data: { pdfPath: path }
  });

  return { statementId, path };
}
