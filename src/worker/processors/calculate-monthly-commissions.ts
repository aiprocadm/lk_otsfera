import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';
import { detectLateRefundCorrections } from '@/lib/services/commission/corrections';
import { notifyPartnerUsers } from '@/lib/notifications/partner';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { fmtMoney } from '@/lib/format';
import type { SyncJobPayload } from '@/lib/jobs/types';

/** Russian month-year label, e.g. "май 2026" (no «г.» suffix). */
function formatPeriod(periodFrom: Date): string {
  const month = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'Europe/Moscow' }).format(periodFrom);
  return `${month} ${periodFrom.getFullYear()}`;
}

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

  // A6: подобрать поздние возвраты в закрытые периоды → очередь корректировок.
  // Best-effort: падение детекта не валит месячный батч (§3 graceful degrade).
  try {
    const detected = await detectLateRefundCorrections(db);
    if (detected > 0) console.log('[worker] late-refund corrections detected', { detected });
  } catch (e) {
    console.warn('[worker] correction detection failed', { error: e instanceof Error ? e.message : String(e) });
  }

  // Партнёры, у кого есть хотя бы один платёж в периоде (по paidAt). При истории
  // ставок текущая ставка 0 ≠ ноль заработка в периоде, поэтому фильтр по
  // commissionRate>0 заменён на «есть платёж».
  const paymentRows = await db.payment.findMany({
    where: {
      paidAt: { gte: periodFrom, lte: periodTo },
      // Только платежи с разрешимым партнёром (order?.partnerId ?? organization.partnerId).
      // Неотнесённые платежи всё равно отсеялись бы в дедупе ниже — не тянем их из БД.
      OR: [
        { order: { partnerId: { not: null } } },
        { order: { partnerId: null }, organization: { partnerId: { not: null } } },
        { orderId: null, organization: { partnerId: { not: null } } }
      ]
    },
    select: { order: { select: { partnerId: true } }, organization: { select: { partnerId: true } } }
  });
  const partnerIdSet = new Set<string>();
  for (const p of paymentRows) {
    const pid = p.order?.partnerId ?? p.organization?.partnerId ?? null;
    if (pid) partnerIdSet.add(pid);
  }
  const activePartners = Array.from(partnerIdSet).map((id) => ({ id }));

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
      if (!result.ok) {
        // partner_not_found only — the partner vanished mid-batch; record and move on.
        errors.push({ partnerId, error: result.error });
        continue;
      }
      if (result.itemCount === 0) {
        partnersSkipped++;
      } else {
        partnersProcessed++;
        // C-02: tell the partner a fresh statement is waiting for review. Only on a
        // newly-created statement — an in-place recalc of an existing draft is not a
        // new event. Cron is the system actor, so this is the right place (not the
        // self-triggered manual path). Best-effort: a notify failure (incl. payload
        // build) must never fail the monthly batch (§3 graceful degrade).
        if (result.isNew) {
          try {
            await notifyPartnerUsers(db, {
              partnerId,
              type: 'commission_statement_ready',
              payload: {
                statementId: result.statement.id,
                period: formatPeriod(result.statement.periodFrom),
                amount: fmtMoney(result.statement.totalCommissionAmount.toString())
              }
            });
          } catch (e) {
            console.warn('[worker] commission-ready notify failed', {
              partnerId,
              error: e instanceof Error ? e.message : String(e)
            });
          }
        }
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
