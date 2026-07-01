/**
 * Формирование комиссионной ведомости (§9.2). База партнёра за период =
 * Σ фактических платежей − Σ возвратов по дате `paidAt`; комиссия = база ×
 * ставка, действовавшая на дату платежа (`CommissionRateChange`, см.
 * rateResolve.ts). НДС НЕ вычитается (решение владельца 2026-06-26). Период —
 * календарный месяц по `paidAt`. Строка ведомости = один платёж. A6/§9.5:
 * applied-корректировки (поздний возврат в закрытый период), ещё не перенесённые
 * в живую approved/paid ведомость, добавляются сюда отрицательными строками
 * (детект — corrections.ts; цепочка остатка — lifecycle.approveStatement).
 */
import type { PrismaClient, CommissionStatement } from '@prisma/client';
import { calculateCommission, type PaymentForCalc, type CorrectionForCalc } from './calculator';
import { resolveEffectiveRate, type RateChange } from './rateResolve';
import { getQueue } from '@/lib/jobs/queues';
import { recordAudit } from '@/lib/auth/audit';

export type CalculateStatementInput = {
  partnerId: string;
  periodFrom: Date;
  periodTo: Date;
  calculatedByUserId: string | null;
  /**
   * C-05: reject a period that overlaps an existing (non-superseded) statement
   * with a DIFFERENT range — prevents double-counting from arbitrary manual
   * ranges. The exact same period is allowed (it is an in-place recalc, not an
   * overlap). Opt-in: the monthly cron omits this (canonical months never
   * overlap each other, and the cron must not be blocked by a manual range).
   */
  rejectOverlap?: boolean;
};

export type CalculateStatementResult = {
  statement: CommissionStatement;
  itemCount: number;
  isNew: boolean;
};

/** Duck-typed Prisma unique-violation check (avoids a runtime Prisma import). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Replace a draft statement's items and totals in place (single transaction).
 * Shared by the normal draft path and the C-01 race fallback. Nulls pdf/xlsx so
 * the worker regenerates them.
 */
async function updateDraftInPlace(
  prisma: PrismaClient,
  statementId: string,
  calc: ReturnType<typeof calculateCommission>,
  calculatedByUserId: string | null
): Promise<CommissionStatement> {
  return prisma.$transaction(async (tx) => {
    await tx.commissionStatementItem.deleteMany({ where: { statementId } });
    if (calc.items.length > 0) {
      await tx.commissionStatementItem.createMany({
        data: calc.items.map((item) => ({
          statementId,
          orderId: item.orderId,
          paymentId: item.paymentId,
          correctionId: item.correctionId,
          orderNumber: item.orderNumber,
          organizationName: item.organizationName,
          baseAmount: item.baseAmount,
          rate: item.rate,
          commissionAmount: item.commissionAmount
        }))
      });
    }
    return tx.commissionStatement.update({
      where: { id: statementId },
      data: {
        totalBaseAmount: calc.totals.totalBaseAmount,
        totalCommissionAmount: calc.totals.totalCommissionAmount,
        averageRate: calc.totals.averageRate,
        calculatedAt: new Date(),
        calculatedByUserId,
        pdfPath: null,
        xlsxPath: null
      }
    });
  });
}

export async function calculateStatementForPartner(
  prisma: PrismaClient,
  input: CalculateStatementInput
): Promise<
  | ({ ok: true } & CalculateStatementResult)
  | { ok: false; error: 'partner_not_found' | 'period_overlap' }
> {
  const { partnerId, periodFrom, periodTo, calculatedByUserId, rejectOverlap } = input;

  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { commissionRate: true }
  });
  if (!partner) {
    return { ok: false, error: 'partner_not_found' };
  }
  const partnerDefaultRate = partner.commissionRate;

  // C-05: fail fast on an overlapping (but not identical) period before any calc.
  // Ranges overlap when from <= other.to AND to >= other.from; the exact same
  // period is excluded (that path is a legitimate in-place recalc below).
  if (rejectOverlap) {
    const overlap = await prisma.commissionStatement.findFirst({
      where: {
        partnerId,
        supersededBy: null,
        periodFrom: { lte: periodTo },
        periodTo: { gte: periodFrom },
        NOT: { periodFrom, periodTo }
      },
      select: { id: true }
    });
    if (overlap) {
      return { ok: false, error: 'period_overlap' };
    }
  }

  const rateChanges: RateChange[] = await prisma.commissionRateChange.findMany({
    where: { partnerId },
    select: { effectiveFrom: true, oldRate: true, newRate: true },
    orderBy: { effectiveFrom: 'asc' },
  });

  // A1/A4: фактические платежи за период по paidAt, отнесённые этому партнёру.
  // Партнёр платежа = order?.partnerId ?? organization.partnerId.
  const payments = await prisma.payment.findMany({
    where: {
      paidAt: { gte: periodFrom, lte: periodTo },
      OR: [
        { order: { partnerId } },
        { order: { partnerId: null }, organization: { partnerId } },
        { orderId: null, organization: { partnerId } },
      ],
    },
    select: {
      id: true,
      amount: true,
      paidAt: true,
      isRefund: true,
      orderId: true,
      order: { select: { orderNumber: true, partnerId: true } },
      // A2 (§6.2): partnerCommissionRate — индивидуальная ставка организации
      // (договорная скидка под клиента), высший приоритет в resolveEffectiveRate.
      organization: { select: { name: true, partnerId: true, partnerCommissionRate: true } },
    },
    orderBy: { paidAt: 'asc' },
  });

  const paymentInputs: PaymentForCalc[] = payments.map((p) => ({
    paymentId: p.id,
    orderId: p.orderId,
    orderNumber: p.order?.orderNumber ?? null,
    organizationName: p.organization.name,
    amount: p.amount,
    isRefund: p.isRefund,
    rate: resolveEffectiveRate({
      // The override is THIS org's договорная скидка with ITS OWN partner. A payment
      // can be attributed to `partnerId` via order.partnerId even when its organization
      // belongs to a different partner — honor the override only when the org's partner
      // is the statement's partner, so partner Y's discount never bleeds onto partner X.
      orgOverride: p.organization.partnerId === partnerId ? p.organization.partnerCommissionRate : null,
      changes: rateChanges,
      paidAt: p.paidAt,
      partnerDefault: partnerDefaultRate,
    }),
  }));

  // A6/§9.5: applied-корректировки, ещё не перенесённые в живую approved/paid
  // ведомость, добавляем отрицательными строками в текущий draft.
  const pendingCorrections = await prisma.commissionCorrection.findMany({
    where: {
      partnerId,
      status: 'applied',
      items: { none: { statement: { status: { in: ['approved', 'paid'] }, supersededBy: null } } },
    },
    select: { id: true, amount: true, rate: true, commissionAmount: true },
  });

  const correctionInputs: CorrectionForCalc[] = pendingCorrections.map((c) => ({
    correctionId: c.id,
    organizationName: 'Корректировка §9.5',
    baseAmount: c.amount.negated(),
    rate: c.rate,
    commissionAmount: c.commissionAmount.negated(),
  }));

  const calc = calculateCommission(paymentInputs, correctionInputs);

  // Find latest non-superseded statement for this partner+period
  const existing = await prisma.commissionStatement.findFirst({
    where: {
      partnerId,
      periodFrom,
      periodTo,
      supersededBy: null
    },
    orderBy: { calculatedAt: 'desc' }
  });

  let statement: CommissionStatement;
  let isNew: boolean;

  if (existing && existing.status === 'draft') {
    // Update draft in place: delete items, insert new, update totals
    statement = await updateDraftInPlace(prisma, existing.id, calc, calculatedByUserId);
    isNew = false;
  } else {
    // Either: no existing, or existing is approved/paid → create new + supersede.
    try {
      statement = await prisma.$transaction(async (tx) => {
        // C-01: vacate the old live row's unique slot BEFORE inserting the new one,
        // so the partial-unique (one live statement per period, WHERE supersededBy
        // IS NULL) never sees two NULL rows at once. Temp self-reference is fixed up
        // to the new id below; supersededBy is not an FK, so self-ref is safe.
        if (existing) {
          await tx.commissionStatement.update({
            where: { id: existing.id },
            data: { supersededBy: existing.id }
          });
        }
        const created = await tx.commissionStatement.create({
          data: {
            partnerId,
            periodFrom,
            periodTo,
            calculatedAt: new Date(),
            calculatedByUserId,
            totalBaseAmount: calc.totals.totalBaseAmount,
            totalCommissionAmount: calc.totals.totalCommissionAmount,
            averageRate: calc.totals.averageRate,
            status: 'draft'
          }
        });
        if (calc.items.length > 0) {
          await tx.commissionStatementItem.createMany({
            data: calc.items.map((item) => ({
              statementId: created.id,
              orderId: item.orderId,
              paymentId: item.paymentId,
              correctionId: item.correctionId,
              orderNumber: item.orderNumber,
              organizationName: item.organizationName,
              baseAmount: item.baseAmount,
              rate: item.rate,
              commissionAmount: item.commissionAmount
            }))
          });
        }
        if (existing) {
          await tx.commissionStatement.update({
            where: { id: existing.id },
            data: { supersededBy: created.id }
          });
        }
        return created;
      });
      isNew = true;
    } catch (err) {
      // C-01: we lost a race — another writer created the live statement for this
      // (partner, period) between our findFirst and create, and the partial-unique
      // index rejected our insert (P2002). Re-read the now-existing live row and
      // fall back to an in-place update, matching the draft path above. Any other
      // error propagates unchanged.
      if (!isUniqueViolation(err)) throw err;
      const winner = await prisma.commissionStatement.findFirst({
        where: { partnerId, periodFrom, periodTo, supersededBy: null },
        orderBy: { calculatedAt: 'desc' }
      });
      if (!winner) throw err;
      statement = await updateDraftInPlace(prisma, winner.id, calc, calculatedByUserId);
      isNew = false;
    }
  }

  // Audit log — only when triggered by a user (cron runs anonymous; sync-log captures cron events)
  if (calculatedByUserId) {
    await recordAudit(prisma, {
      userId: calculatedByUserId,
      action: 'commission_statement_calculated',
      entity: 'commission_statement',
      entityId: statement.id,
      after: {
        partnerId,
        periodFrom: periodFrom.toISOString(),
        periodTo: periodTo.toISOString(),
        itemCount: calc.items.length,
        totalCommission: calc.totals.totalCommissionAmount.toString(),
        isNew,
        supersededOldId: !isNew ? null : existing?.id ?? null,
      },
    });
  }

  // Enqueue PDF/XLSX generation (fire-and-forget — failures retried by BullMQ).
  // Skip silently in environments without Redis (tests, partial dev) — operator
  // can manually trigger regen via API or re-calc later.
  if (process.env.REDIS_URL) {
    try {
      await Promise.all([
        getQueue('docs.generateCommissionPdf').add('generate', { statementId: statement.id }),
        getQueue('docs.generateCommissionXlsx').add('generate', { statementId: statement.id })
      ]);
    } catch (err) {
      console.warn('[commission] failed to enqueue PDF/XLSX jobs:', err);
    }
  }

  return {
    ok: true,
    statement,
    itemCount: calc.items.length,
    isNew
  };
}
