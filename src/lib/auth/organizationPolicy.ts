import type { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

export function isOrgMember(session: SessionPayload, orgId: string): boolean {
  return !!session.organizationMemberships?.some((m) => m.isActive && m.organizationId === orgId);
}

export function isOrgAdmin(session: SessionPayload, orgId: string): boolean {
  return !!session.organizationMemberships?.some(
    (m) => m.isActive && m.organizationId === orgId && m.roleInOrg === 'admin'
  );
}

export function isOrgLeader(session: SessionPayload, orgId: string): boolean {
  return !!session.organizationMemberships?.some(
    (m) => m.isActive && m.organizationId === orgId && m.roleInOrg === 'leader'
  );
}

export function canSeeIntermediaryCommission(session: SessionPayload, orgId: string): boolean {
  return isOrgAdmin(session, orgId) || isOrgLeader(session, orgId);
}

export function activeOrgIds(session: SessionPayload): string[] {
  return (session.organizationMemberships ?? [])
    .filter((m) => m.isActive)
    .map((m) => m.organizationId);
}

export function organizationOrgScopeFilter(session: SessionPayload): { id: { in: string[] } } {
  return { id: { in: activeOrgIds(session) } };
}

export function organizationOrderScopeFilter(session: SessionPayload): {
  organizationId: { in: string[] };
} {
  return { organizationId: { in: activeOrgIds(session) } };
}

/**
 * Граница видимости заказов для участника организации (`У-236`, `Р-Э6-2`).
 *
 * `null` — ограничения нет: настройка выключена ЛИБО смотрит администратор или
 * руководитель организации. Иначе — фрагмент `where`, сужающий выборку до
 * «своих» заказов: где человек указан контактным лицом либо сам подал
 * обращение, из которого вырос заказ.
 *
 * Роль считается по членству: всё, что не `admin` и не `leader`, — участник.
 * Направление выбрано осознанно: членство без роли (`roleInOrg = null`)
 * попадает под ограничение, а не мимо него.
 *
 * `viewerUserId` возвращается рядом с `where`, потому что тем же скоупом
 * пользуется лента событий главной — она собирается raw-запросом, и одного
 * фрагмента Prisma ей мало.
 */
export type OrgOrderScope = { where: Prisma.OrderWhereInput; viewerUserId: string } | null;

export function memberOrderScope(
  session: SessionPayload,
  orgId: string,
  membersSeeOwnOrdersOnly: boolean
): OrgOrderScope {
  if (!membersSeeOwnOrdersOnly) return null;
  if (isOrgAdmin(session, orgId) || isOrgLeader(session, orgId)) return null;
  return {
    viewerUserId: session.sub,
    where: {
      OR: [
        { primaryContact: { userId: session.sub } },
        { promotedFromLead: { sourceRequest: { submittedByUserId: session.sub } } },
      ],
    },
  };
}

/**
 * Видит ли клиент заказ. Третий аргумент обязателен намеренно (`У-236`): со
 * значением по умолчанию забывчивость молча открывала бы участнику чужие
 * заказы, и ни типы, ни ревью этого не поймали бы — ровно та же ошибка, что
 * однажды случилась с `teamMode` у менеджерского скоупа (§4).
 *
 * `restricted` — результат `memberOrderScope(...) !== null`, то есть «этот
 * зритель ограничен»; `ownedByViewer` считает сервис заказа по тем же двум
 * правилам, что и скоуп выборки.
 */
export function canSeeOrder(
  session: SessionPayload,
  order: { organizationId: string | null; ownedByViewer?: boolean | undefined },
  restricted: boolean
): boolean {
  if (order.organizationId === null) return false;
  if (!isOrgMember(session, order.organizationId)) return false;
  if (!restricted) return true;
  return order.ownedByViewer === true;
}

export function canSeeDocument(
  session: SessionPayload,
  doc: { order: { organizationId: string | null } }
): boolean {
  if (doc.order.organizationId === null) return false;
  return isOrgMember(session, doc.order.organizationId);
}
