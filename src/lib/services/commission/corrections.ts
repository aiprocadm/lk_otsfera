import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { resolveEffectiveRate, type RateChange, type OrgRateChange } from './rateResolve';

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
      id: true, amount: true, paidAt: true, orderId: true, organizationId: true,
      order: { select: { partnerId: true } },
      // A2 (§6.2): сторно возврата считаем по эффективной ставке. Override
      // организации резолвится по истории на paidAt (F4) → совпадает с исходным
      // платежом того же периода.
      // Для исторической ставки партнёра у возврата нет ссылки на исходный платёж
      // (в схеме нет refund→original), поэтому берём ставку на дату ВОЗВРАТА как
      // прокси: в общем случае (смена ставки на границе месяца) она совпадает с
      // исходной, т.к. период — календарный месяц.
      organization: { select: { partnerId: true, partnerCommissionRate: true } },
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
    // F4 (A5): org-override на дату возврата — из истории (зеркало statement.ts).
    const orgChanges: OrgRateChange[] = await prisma.organizationCommissionRateChange.findMany({
      where: { organizationId: r.organizationId },
      select: { effectiveFrom: true, oldRate: true, newRate: true },
      orderBy: { effectiveFrom: 'asc' },
    });
    const rate = resolveEffectiveRate({
      // Honor the org override only when the org belongs to the resolved partner
      // (mirror statement.ts: a payment can be attributed via order.partnerId to a
      // different partner than the org's own). F4: the same gate zeroes the history
      // (empty list, not undefined) so a foreign org's timeline never applies.
      orgOverride: r.organization?.partnerId === partnerId ? (r.organization?.partnerCommissionRate ?? null) : null,
      orgChanges: r.organization?.partnerId === partnerId ? orgChanges : [],
      changes,
      paidAt: r.paidAt,
      partnerDefault: partner?.commissionRate ?? new Prisma.Decimal(0),
    });
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

// ── A6/§9.5: Queue listing + manual resolve ───────────────────────────────────

export type CorrectionError = 'forbidden' | 'not_found' | 'invalid_state' | 'reason_required';

/** admin или руководитель (manager + managerRole='leader') могут разбирать очередь. */
function canResolve(s: SessionPayload): boolean {
  return s.role === 'admin' || (s.role === 'manager' && s.managerRole === 'leader');
}

/**
 * Список корректировок со статусом needs_review.
 * Admin видит все; leader ограничен партнёрами своей компании
 * (через partner→organizations.companyId).
 */
export async function listCorrectionQueue(prisma: PrismaClient, session: SessionPayload) {
  if (!canResolve(session)) return [];
  const where: Prisma.CommissionCorrectionWhereInput =
    session.role === 'admin'
      ? { status: 'needs_review' }
      : { status: 'needs_review', partner: { organizations: { some: { companyId: session.companyId ?? '__none__' } } } };
  return prisma.commissionCorrection.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, partnerId: true, amount: true, commissionAmount: true, rate: true,
      originalPeriodFrom: true, originalPeriodTo: true, paymentId: true, createdAt: true,
      partner: { select: { name: true } },
    },
  });
}

/**
 * Применить (apply → applied) или отклонить (waive → waived) корректировку.
 * waive требует непустой причины. Leader дополнительно проверяется на принадлежность
 * компании. Результат пишется в audit log внутри транзакции.
 */
export async function resolveCorrection(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { correctionId: string; action: 'apply' | 'waive'; reason?: string }
): Promise<{ ok: true } | { ok: false; error: CorrectionError }> {
  if (!canResolve(session)) return { ok: false, error: 'forbidden' };
  if (args.action === 'waive' && !args.reason?.trim()) return { ok: false, error: 'reason_required' };

  const corr = await prisma.commissionCorrection.findUnique({
    where: { id: args.correctionId },
    select: { id: true, status: true, partnerId: true },
  });
  if (!corr) return { ok: false, error: 'not_found' };
  if (corr.status !== 'needs_review') return { ok: false, error: 'invalid_state' };

  if (session.role === 'manager' && session.managerRole === 'leader') {
    const inScope = await prisma.commissionCorrection.findFirst({
      where: { id: corr.id, partner: { organizations: { some: { companyId: session.companyId ?? '__none__' } } } },
      select: { id: true },
    });
    if (!inScope) return { ok: false, error: 'forbidden' };
  }

  const next = args.action === 'apply' ? 'applied' : 'waived';
  await prisma.$transaction(async (tx) => {
    await tx.commissionCorrection.update({
      where: { id: corr.id },
      data: { status: next, reason: args.reason ?? null, resolvedByUserId: session.sub, resolvedAt: new Date() },
    });
    await recordAudit(tx, {
      userId: session.sub,
      action: `commission_correction_${next}`,
      entity: 'commission_correction',
      entityId: corr.id,
      after: { partnerId: corr.partnerId, action: args.action },
      reason: args.reason,
    });
  });
  return { ok: true };
}
