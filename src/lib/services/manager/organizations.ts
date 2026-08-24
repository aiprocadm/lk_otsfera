import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrgScope, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';

/**
 * Manager-facing organizations service.
 *
 * Visibility is governed strictly by the per-org assignment branch of the
 * manager RBAC scope (`managerOrgScopeFilter` = `id ∈ session.managedOrgIds`).
 * Unlike `services/manager/orders`, the historical-comments branch does NOT
 * grant org-level visibility: a manager who once commented on an org's order
 * can still see *that order* (and may follow links from there), but the
 * organization itself only appears in this list when the admin assigns them
 * via `OrganizationManager`.
 *
 * `getOrganization` performs a defensive in-process scope check on top of the
 * by-id `findUnique` so a foreign org id returns `null` (no existence-leak)
 * even though the prisma fetch crosses scope.
 */

const LIST_SELECT = {
  id: true,
  name: true,
  // `У-94`: список показывает, у кого ИНН не заполнен, и умеет отобрать таких —
  // это очередь работы после импорта выписки, а не справочная колонка.
  inn: true,
  _count: {
    select: {
      orders: true,
      students: true,
    },
  },
} satisfies Prisma.OrganizationSelect;

export type ManagerOrgListRow = Prisma.OrganizationGetPayload<{ select: typeof LIST_SELECT }>;

export async function listOrganizations(
  prisma: PrismaClient,
  session: SessionPayload,
  teamModeOverride?: boolean,
  opts?: { withoutInn?: boolean }
): Promise<ManagerOrgListRow[]> {
  const teamMode = teamModeOverride ?? (await getCompanyTeamVisibility(prisma, session.companyId));
  return prisma.organization.findMany({
    // Фильтр сужает скоуп, а не заменяет его: граница роли остаётся первой.
    where: opts?.withoutInn
      ? { AND: [managerOrgScope(session, teamMode), { inn: null }] }
      : managerOrgScope(session, teamMode),
    select: LIST_SELECT,
    orderBy: { name: 'asc' },
  });
}

export type CompanyOrgOption = { id: string; name: string };

/**
 * Узкий справочник «организации моей компании» для селектов форм (создание
 * лида/сделки на страницах менеджера и руководителя).
 *
 * Скоуп — компания сессии (C8), а не `managedOrgIds`: форма привязки лида/сделки
 * намеренно шире списка «моих» организаций, поэтому `managerOrgScope` здесь не
 * применяется. Сессия без компании (сотрудник ещё не привязан) даёт пустой
 * список **без обращения к БД** — иначе получился бы запрос `companyId: undefined`
 * (= все организации всех компаний).
 */
export async function listCompanyOrgOptions(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<CompanyOrgOption[]> {
  if (!session.companyId) return [];
  return prisma.organization.findMany({
    where: { companyId: session.companyId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

