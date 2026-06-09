import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrgScope, isManagerLeader } from '@/lib/auth/managerPolicy';
import {
  getOrgFinanceKpis,
  listOrgPayments,
  getOrgIntermediaryCommission,
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
  const canSeeCommission = unscoped || isManagerLeader(session);

  const orgs = await prisma.organization.findMany({
    where: unscoped ? undefined : managerOrgScope(session, opts.teamMode),
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });

  const sections = await Promise.all(
    orgs.map(async (org): Promise<ManagerOrgFinanceSection> => {
      const [kpis, payments, commission] = await Promise.all([
        getOrgFinanceKpis(prisma, org.id),
        listOrgPayments(prisma, { organizationId: org.id }),
        canSeeCommission ? getOrgIntermediaryCommission(prisma, org.id) : Promise.resolve(null)
      ]);
      return { orgId: org.id, orgName: org.name, kpis, payments, commission };
    })
  );

  let billed = 0;
  let paid = 0;
  for (const s of sections) {
    billed += Number(s.kpis.billed);
    paid += Number(s.kpis.paid);
  }
  const summary: OrgFinanceKpis = {
    billed: billed.toFixed(2),
    paid: paid.toFixed(2),
    outstanding: (billed - paid).toFixed(2)
  };

  return { summary, sections, canSeeCommission };
}
