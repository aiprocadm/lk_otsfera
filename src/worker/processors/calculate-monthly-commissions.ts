import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import type { SyncJobPayload } from '@/lib/jobs/types';

export type CalculateMonthlyCommissionsResult = {
  periodFrom: string;
  periodTo: string;
  partnersProcessed: number;
  partnersSkipped: number;
  errors: Array<{ partnerId: string; error: string }>;
};

function prevMonthRange(): { periodFrom: Date; periodTo: Date } {
  const now = new Date();
  const periodFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const periodTo = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return { periodFrom, periodTo };
}

export async function calculateMonthlyCommissionsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<CalculateMonthlyCommissionsResult> {
  console.log('[worker] calculate-monthly-commissions started', { id: job.id });

  const { periodFrom, periodTo } = prevMonthRange();

  const activePartners = await db.partner.findMany({
    where: { commissionRate: { gt: 0 } },
    select: { id: true }
  });

  let partnersProcessed = 0;
  let partnersSkipped = 0;
  const errors: Array<{ partnerId: string; error: string }> = [];

  for (const { id: partnerId } of activePartners) {
    try {
      const result = await calculateStatementForPartner(db, {
        partnerId,
        periodFrom,
        periodTo,
        calculatedByUserId: null
      });
      if (result.itemCount === 0) {
        partnersSkipped++;
      } else {
        partnersProcessed++;
      }
    } catch (err) {
      errors.push({ partnerId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const summary: CalculateMonthlyCommissionsResult = {
    periodFrom: periodFrom.toISOString(),
    periodTo: periodTo.toISOString(),
    partnersProcessed,
    partnersSkipped,
    errors
  };

  // Continue-on-error per partner is intentional (one broken partner must not
  // block the monthly batch), but failures have to surface somewhere durable:
  // completed-job payloads rotate away (removeOnComplete), so persist a syncLog
  // row that /admin/sync and operators can see. 'error' when the whole batch
  // failed, 'warn' for partial failures.
  if (errors.length > 0) {
    const allFailed = partnersProcessed === 0 && partnersSkipped === 0;
    console.error('[worker] calculate-monthly-commissions partner failures', {
      failed: errors.length,
      processed: partnersProcessed,
      skipped: partnersSkipped,
      errors
    });
    await writeSyncLog(
      {
        entity: 'commission',
        direction: 'inbound',
        operation: 'skip',
        status: allFailed ? 'error' : 'warn',
        errorMessage: `monthly commissions: ${errors.length} partner(s) failed${allFailed ? ' (ALL failed)' : ''}: ${errors
          .slice(0, 5)
          .map((e) => `${e.partnerId}: ${e.error}`)
          .join('; ')}`
      },
      db
    ).catch((e) => console.warn('[worker] calculate-monthly-commissions writeSyncLog failed', e));
  }

  console.log('[worker] calculate-monthly-commissions done', summary);
  return summary;
}
