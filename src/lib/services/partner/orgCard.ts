import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

export type OrgCard = {
  id: string;
  name: string;
  inn: string | null;
  kpp: string | null;
  legalName: string | null;
  assignedManagerUserId: string | null;
  partnerCommissionRate: string | null;
  partnerCommissionRateNote: string | null;
  kpi: {
    ordersCount: number;
    debt: string;
  };
};

export async function getOrgCard(
  prisma: PrismaClient,
  args: { orgId: string; partnerId: string }
): Promise<OrgCard | null> {
  const org = await prisma.organization.findFirst({
    where: { id: args.orgId, partnerId: args.partnerId },
    select: {
      id: true, name: true, inn: true, kpp: true,
      assignedManagerUserId: true,
      partnerCommissionRate: true,
      partnerCommissionRateNote: true,
      companyId: true,
      company: { select: { name: true } }
    }
  });
  if (!org) return null;

  let ordersCount = 0;
  let debt = new Prisma.Decimal(0);
  if (org.companyId) {
    const orders = await prisma.order.findMany({
      where: { companyId: org.companyId, partnerId: args.partnerId },
      select: { totalAmount: true, paidAmount: true, executionStatus: true }
    });
    ordersCount = orders.length;
    debt = orders
      .filter((o) => o.executionStatus !== 'cancelled')
      .reduce((s, o) => s.plus(o.totalAmount).minus(o.paidAmount), new Prisma.Decimal(0));
  }

  return {
    id: org.id,
    name: org.name,
    inn: org.inn,
    kpp: org.kpp,
    legalName: org.company?.name ?? null,
    assignedManagerUserId: org.assignedManagerUserId,
    partnerCommissionRate: org.partnerCommissionRate?.toString() ?? null,
    partnerCommissionRateNote: org.partnerCommissionRateNote,
    kpi: { ordersCount, debt: debt.toFixed(2) }
  };
}
