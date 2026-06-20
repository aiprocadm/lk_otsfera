import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getObjectStorage } from '@/lib/storage';
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
  // Throws StorageError on provider failure → propagates so BullMQ retries the
  // job (same failure semantics as the prior Supabase `if (error) throw`).
  await getObjectStorage().upload(path, buf, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  await db.commissionStatement.update({
    where: { id: statementId },
    data: { xlsxPath: path }
  });

  return { statementId, path };
}
