import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';
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

  console.log('[worker] calculate-monthly-commissions done', summary);
  return summary;
}
