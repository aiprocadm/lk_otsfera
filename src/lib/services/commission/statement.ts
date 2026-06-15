import type { PrismaClient, CommissionStatement, Prisma } from '@prisma/client';
import { calculateCommission, type OrderForCalc } from './calculator';
import { getQueue } from '@/lib/jobs/queues';
import { recordAudit } from '@/lib/auth/audit';

export type CommissionTrigger = 'paid_and_closed' | 'paid' | 'completed';

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

function getTrigger(): CommissionTrigger {
  const raw = (process.env.COMMISSION_TRIGGER ?? 'paid_and_closed').trim().toLowerCase();
  if (raw === 'paid' || raw === 'completed' || raw === 'paid_and_closed') return raw;
  return 'paid_and_closed';
}

function getVatMode(): 'full' | 'exclude_vat' {
  return process.env.COMMISSION_VAT_MODE === 'exclude_vat' ? 'exclude_vat' : 'full';
}

function buildOrdersWhere(
  partnerId: string,
  periodFrom: Date,
  periodTo: Date
): Prisma.OrderWhereInput {
  const trigger = getTrigger();
  if (trigger === 'paid') {
    return {
      partnerId,
      financialStatus: 'paid',
      paidAt: { gte: periodFrom, lte: periodTo }
    };
  }
  if (trigger === 'completed') {
    return {
      partnerId,
      executionStatus: 'completed',
      completedAt: { gte: periodFrom, lte: periodTo }
    };
  }
  // paid_and_closed (default)
  return {
    partnerId,
    financialStatus: 'paid',
    closedAt: { gte: periodFrom, lte: periodTo }
  };
}

type OrderWithCompany = {
  id: string;
  orderNumber: string | null;
  totalAmount: Prisma.Decimal;
  vatIncluded: boolean;
  vatRate: Prisma.Decimal | null;
  partnerId: string | null;
  companyId: string;
  company: { name: string };
};

async function resolveRatesAndOrgNames(
  prisma: PrismaClient,
  orders: OrderWithCompany[],
  partnerDefaultRate: Prisma.Decimal
): Promise<OrderForCalc[]> {
  const companyIds = Array.from(new Set(orders.map((o) => o.companyId)));
  const partnerId = orders[0]?.partnerId ?? null;

  const orgs = partnerId
    ? await prisma.organization.findMany({
        where: { partnerId, companyId: { in: companyIds } },
        select: {
          companyId: true,
          name: true,
          partnerCommissionRate: true
        }
      })
    : [];

  const byCompany = new Map<string, { name: string; rate: Prisma.Decimal | null }>();
  for (const org of orgs) {
    if (!org.companyId) continue;
    byCompany.set(org.companyId, {
      name: org.name,
      // Keep the override as Decimal — coercing to number here was half of the
      // precision-loss bug; the calculator consumes Decimal end-to-end now.
      rate: org.partnerCommissionRate ?? null
    });
  }

  return orders.map((o) => {
    const orgInfo = byCompany.get(o.companyId);
    const organizationName = orgInfo?.name ?? o.company.name;
    const rate = orgInfo?.rate ?? partnerDefaultRate;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      organizationName,
      totalAmount: o.totalAmount,
      vatIncluded: o.vatIncluded,
      vatRate: o.vatRate,
      rate
    };
  });
}

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
): Promise<CalculateStatementResult> {
  const { partnerId, periodFrom, periodTo, calculatedByUserId, rejectOverlap } = input;

  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { commissionRate: true }
  });
  if (!partner) {
    throw new Error('PARTNER_NOT_FOUND');
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
      throw new Error(`PERIOD_OVERLAP: overlaps statement ${overlap.id}`);
    }
  }

  const orders = await prisma.order.findMany({
    where: buildOrdersWhere(partnerId, periodFrom, periodTo),
    select: {
      id: true,
      orderNumber: true,
      totalAmount: true,
      vatIncluded: true,
      vatRate: true,
      partnerId: true,
      companyId: true,
      company: { select: { name: true } }
    }
  });

  const orderInputs = await resolveRatesAndOrgNames(prisma, orders, partnerDefaultRate);
  const calc = calculateCommission(orderInputs, { vatMode: getVatMode() });

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
    statement,
    itemCount: calc.items.length,
    isNew
  };
}
