import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrgScope } from '@/lib/auth/managerPolicy';
import { can } from '@/lib/auth/accessProfile';
import {
  getOrgFinanceKpisForOrgs,
  listOrgPaymentsForOrgs,
  getOrgIntermediaryCommissionForOrgs,
  type OrgFinanceKpis,
  type OrgPaymentRow,
  type OrgIntermediaryCommission
} from '@/lib/services/organization/finance';

export type ManagerOrgFinanceSection = {
  orgId: string;
  orgName: string;
  kpis: OrgFinanceKpis;
  payments: OrgPaymentRow[];
  commission: OrgIntermediaryCommission | null;
};

export type ManagerFinanceOverview = {
  summary: OrgFinanceKpis;
  sections: ManagerOrgFinanceSection[];
  canSeeCommission: boolean;
};

/**
 * Финансовая витрина менеджера/руководителя: оплаты по организациям в scope +
 * (для руководителя/админа) проценты посредника. Тонкий агрегатор поверх
 * organization/finance.ts. Гейт комиссии — здесь (§4 service-layer): рядовой
 * менеджер физически не вызывает расчёт маржи (field-level).
 */
export async function getManagerFinanceOverview(
  prisma: PrismaClient,
  session: SessionPayload,
  opts: { teamMode: boolean }
): Promise<ManagerFinanceOverview> {
  const unscoped = session.role === 'admin';
  // G1: единый capability-gate. Для no-profile сессий тождественно старому
  // `unscoped || isManagerLeader` (admin/leader видят, рядовой — нет); профиль →
  // default-deny (флаг обязателен, перекрывает даже leader).
  const canSeeCommission = can(session, 'see_commission');

  const orgs = await prisma.organization.findMany({
    where: unscoped ? undefined : managerOrgScope(session, opts.teamMode),
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });

  // Батч: KPI, платежи (top-50 per-org оконным ROW_NUMBER) и комиссия
  // считаются 3-4 запросами на весь scope вместо 3×N.
  const orgIdList = orgs.map((org) => org.id);
  const [kpisByOrg, paymentsByOrg, commissionByOrg] = await Promise.all([
    getOrgFinanceKpisForOrgs(prisma, orgIdList),
    listOrgPaymentsForOrgs(prisma, orgIdList),
    canSeeCommission
      ? getOrgIntermediaryCommissionForOrgs(prisma, orgIdList)
      : Promise.resolve(null)
  ]);

  const sections = orgs.map((org): ManagerOrgFinanceSection => ({
    orgId: org.id,
    orgName: org.name,
    kpis: kpisByOrg.get(org.id)!,
    payments: paymentsByOrg.get(org.id)!,
    commission: commissionByOrg?.get(org.id) ?? null
  }));

  let billed = new Prisma.Decimal(0);
  let paid = new Prisma.Decimal(0);
  for (const s of sections) {
    billed = billed.plus(s.kpis.billed);
    paid = paid.plus(s.kpis.paid);
  }
  const summary: OrgFinanceKpis = {
    billed: billed.toFixed(2),
    paid: paid.toFixed(2),
    outstanding: billed.minus(paid).toFixed(2)
  };

  return { summary, sections, canSeeCommission };
}
