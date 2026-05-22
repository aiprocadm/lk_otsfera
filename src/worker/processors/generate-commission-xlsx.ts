import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getServerClient, documentBucket } from '@/lib/storage/supabase';
import { renderStatementXlsx } from '@/lib/services/commission/xlsx';
import type { GenerateCommissionXlsxPayload } from '@/lib/jobs/types';

export type GenerateCommissionXlsxResult = {
  statementId: string;
  path: string;
};

export async function generateCommissionXlsxProcessor(
  job: Job<GenerateCommissionXlsxPayload>,
  db: PrismaClient = prisma
): Promise<GenerateCommissionXlsxResult> {
  const { statementId } = job.data;
  console.log('[worker] generate-commission-xlsx started', { id: job.id, statementId });

  const statement = await db.commissionStatement.findUnique({
    where: { id: statementId },
    include: { items: true, partner: true }
  });
  if (!statement) throw new Error(`NOT_FOUND: CommissionStatement ${statementId}`);

  const buf = await renderStatementXlsx({
    statement,
    items: statement.items,
    partner: { name: statement.partner.name }
  });

  const path = `partners/${statement.partnerId}/commission/${statementId}.xlsx`;
  const storage = getServerClient().storage.from(documentBucket);
  const { error } = await storage.upload(path, buf, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: true
  });
  if (error) throw new Error(`STORAGE_FAILURE: ${error.message}`);

  await db.commissionStatement.update({
    where: { id: statementId },
    data: { xlsxPath: path }
  });

  return { statementId, path };
}
