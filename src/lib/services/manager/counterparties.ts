import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managedOrgIds, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';

type CounterpartyOption = { id: string; name: string };
export type ManagerCounterparties = {
  organizations: CounterpartyOption[];
  partners: CounterpartyOption[];
};

/**
 * Resolves the counterparties a manager may target with an order-less document.
 * Organizations: the manager's scoped orgs (company-wide when teamMode=ON, else
 * the per-manager managed set). Partners: any partner whose company-union
 * (organizations[].companyId ∪ orders[].companyId) contains the manager's
 * company — write pins companyId=session.companyId, so a multi-company partner
 * is offered to each company's managers but the doc stays company-isolated.
 */
export async function listManagerCounterparties(
  prisma: PrismaClient,
  session: SessionPayload,
  /**
   * `У-110`: кабинет руководителя видит контрагентов всей компании независимо
   * от toggle — иначе на его экране документов список получателей оказался бы
   * уже, чем список самих документов.
   */
  teamModeOverride?: boolean
): Promise<ManagerCounterparties> {
  const companyId = session.companyId;
  if (!companyId) return { organizations: [], partners: [] };

  const teamMode = teamModeOverride ?? (await getCompanyTeamVisibility(prisma, companyId));
  const orgs = await prisma.organization.findMany({
    where: teamMode ? { companyId } : { id: { in: managedOrgIds(session) } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const partners = await prisma.partner.findMany({
    where: {
      isActive: true,
      OR: [{ organizations: { some: { companyId } } }, { orders: { some: { companyId } } }],
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return {
    organizations: orgs.map((o) => ({ id: o.id, name: o.name })),
    partners: partners.map((p) => ({ id: p.id, name: p.name })),
  };
}
