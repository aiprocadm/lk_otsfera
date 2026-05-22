import type { PrismaClient, CommissionStatement, Prisma } from '@prisma/client';
import { calculateCommission, type OrderForCalc } from './calculator';
import { getQueue } from '@/lib/jobs/queues';

export type CommissionTrigger = 'paid_and_closed' | 'paid' | 'completed';

export type CalculateStatementInput = {
  partnerId: string;
  periodFrom: Date;
  periodTo: Date;
  calculatedByUserId: string | null;
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
  partnerDefaultRate: number
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

  const byCompany = new Map<string, { name: string; rate: number | null }>();
  for (const org of orgs) {
    if (!org.companyId) continue;
    byCompany.set(org.companyId, {
      name: org.name,
      rate: org.partnerCommissionRate ? Number(org.partnerCommissionRate) : null
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
      totalAmount: Number(o.totalAmount),
      vatIncluded: o.vatIncluded,
      vatRate: o.vatRate ? Number(o.vatRate) : null,
      rate
    };
  });
}

export async function calculateStatementForPartner(
  prisma: PrismaClient,
  input: CalculateStatementInput
): Promise<CalculateStatementResult> {
  const { partnerId, periodFrom, periodTo, calculatedByUserId } = input;

  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { commissionRate: true }
  });
  if (!partner) {
    throw new Error('PARTNER_NOT_FOUND');
  }
  const partnerDefaultRate = Number(partner.commissionRate);

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
    statement = await prisma.$transaction(async (tx) => {
      await tx.commissionStatementItem.deleteMany({
        where: { statementId: existing.id }
      });
      if (calc.items.length > 0) {
        await tx.commissionStatementItem.createMany({
          data: calc.items.map((item) => ({
            statementId: existing.id,
            orderId: item.orderId,
            orderNumber: item.orderNumber,
            organizationName: item.organizationName,
            baseAmount: item.baseAmount,
            rate: item.rate,
            commissionAmount: item.commissionAmount
          }))
        });
      }
      const updated = await tx.commissionStatement.update({
        where: { id: existing.id },
        data: {
          totalBaseAmount: calc.totals.totalBaseAmount,
          totalCommissionAmount: calc.totals.totalCommissionAmount,
          averageRate: calc.totals.averageRate,
          calculatedAt: new Date(),
          calculatedByUserId,
          // pdf/xlsx are stale → null them so worker regenerates
          pdfPath: null,
          xlsxPath: null
        }
      });
      return updated;
    });
    isNew = false;
  } else {
    // Either: no existing, or existing is approved/paid → create new + supersede
    statement = await prisma.$transaction(async (tx) => {
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
  }

  // Audit log — only when triggered by a user (cron runs anonymous; sync-log captures cron events)
  if (calculatedByUserId) {
    await prisma.auditLog.create({
      data: {
        userId: calculatedByUserId,
        action: 'commission_statement_calculated',
        entity: 'CommissionStatement',
        entityId: statement.id,
        meta: {
          partnerId,
          periodFrom: periodFrom.toISOString(),
          periodTo: periodTo.toISOString(),
          itemCount: calc.items.length,
          totalCommission: calc.totals.totalCommissionAmount,
          isNew,
          supersededOldId: !isNew ? null : existing?.id ?? null
        }
      }
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
