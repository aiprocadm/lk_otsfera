import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { resolveRateAt, type RateChange } from './rateResolve';

const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/**
 * A6/§9.5: находит возвраты (isRefund), чей paidAt попал в УЖЕ закрытый
 * (approved/paid, живой) период партнёра и ещё не имеет корректировки. Создаёт
 * needs_review-корректировку (идемпотентно по paymentId @unique). Возвраты в
 * draft-период не трогаются — это обычная отрицательная строка (SP-1).
 */
export async function detectLateRefundCorrections(prisma: PrismaClient): Promise<number> {
  const refunds = await prisma.payment.findMany({
    where: { isRefund: true, commissionCorrection: { is: null } },
    select: {
      id: true, amount: true, paidAt: true, orderId: true,
      order: { select: { partnerId: true } },
      organization: { select: { partnerId: true } },
    },
  });

  let created = 0;
  for (const r of refunds) {
    const partnerId = r.order?.partnerId ?? r.organization?.partnerId ?? null;
    if (!partnerId) continue;

    const stmt = await prisma.commissionStatement.findFirst({
      where: {
        partnerId,
        supersededBy: null,
        status: { in: ['approved', 'paid'] },
        periodFrom: { lte: r.paidAt },
        periodTo: { gte: r.paidAt },
      },
      select: { id: true, periodFrom: true, periodTo: true },
    });
    if (!stmt) continue;

    const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { commissionRate: true } });
    const changes: RateChange[] = await prisma.commissionRateChange.findMany({
      where: { partnerId }, select: { effectiveFrom: true, oldRate: true, newRate: true }, orderBy: { effectiveFrom: 'asc' },
    });
    const rate = resolveRateAt(changes, r.paidAt, partner?.commissionRate ?? new Prisma.Decimal(0));
    const commissionAmount = r.amount.mul(rate).toDecimalPlaces(2, HALF_UP);

    try {
      await prisma.commissionCorrection.create({
        data: {
          partnerId, paymentId: r.id, originalStatementId: stmt.id,
          originalPeriodFrom: stmt.periodFrom, originalPeriodTo: stmt.periodTo,
          amount: r.amount, rate, commissionAmount, status: 'needs_review',
        },
      });
      created++;
    } catch (err) {
      if (!(typeof err === 'object' && err && 'code' in err && (err as { code?: unknown }).code === 'P2002')) throw err;
    }
  }
  return created;
}
