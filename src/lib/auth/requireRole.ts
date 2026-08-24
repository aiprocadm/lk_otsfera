import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import {
  canSeeOrder,
  canManagerAccessOrg,
  isOrgInScope,
  getCompanyTeamVisibility,
  isLeaderSameCompany,
  isManagerLeader,
  isStaffManagerSide,
} from '@/lib/auth/managerPolicy';
import { getSession } from './session';
import type { SessionPayload } from './jwt';

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== 'admin') redirect('/forbidden');
  return session;
}

/**
 * Администратор **или** руководитель (`У-99`): ставку комиссии по организации
 * ведут оба. Гард проверяет только роль — **границу компании руководителя
 * (C8) обязан проверить вызывающий**, иначе руководитель одной компании
 * дотянется до организации другой. Отдельный гард, а не список в `requireRole`,
 * потому что `requireRole` не мостит роли и не умеет говорить «менеджер — нет,
 * руководитель — да» (§4).
 */
export async function requireAdminOrManagerLeader(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== 'admin' && !isManagerLeader(session)) redirect('/forbidden');
  return session;
}

/**
 * Узкий тип сессии партнёра: `partnerId` гарантированно `string` (не null/undefined).
 * Гарды `requirePartner`/`requirePartnerAdmin` отдают именно его, чтобы страницы
 * использовали `session.partnerId` как `string` без `!` (defense-in-depth §4).
 */
export type PartnerSession = SessionPayload & { partnerId: string };

/**
 * Любой активный партнёр (role=partner + есть partnerId). Канон-замена ручному
 * `getSession() + if(!session?.partnerId) redirect('/login')` на partner-страницах.
 * Отказ по роли/под-роли → `/forbidden` (единый контракт под-ролей, ось 1 аудита).
 */
export async function requirePartner(): Promise<PartnerSession> {
  const session = await requireSession();
  if (session.role !== 'partner' || !session.partnerId) redirect('/forbidden');
  return session as PartnerSession;
}

export async function requirePartnerAdmin(): Promise<PartnerSession> {
  const session = await requireSession();
  const isPartnerAdmin =
    session.role === 'partner' && session.partnerRole === 'admin' && !!session.partnerId;
  if (!isPartnerAdmin) redirect('/forbidden');
  return session as PartnerSession;
}

export async function requireOrganization(): Promise<SessionPayload> {
  const session = await requireSession();
  const hasActiveMembership =
    session.role === 'organization' && !!session.organizationMemberships?.some((m) => m.isActive);
  if (!hasActiveMembership) redirect('/forbidden');
  return session;
}

export async function requireOrganizationAdmin(orgId?: string): Promise<SessionPayload> {
  const session = await requireOrganization();
  /* v8 ignore next -- requireOrganization() guards against missing memberships; ?? [] is a defensive fallback that is structurally unreachable */
  const memberships = session.organizationMemberships ?? [];
  const isAdmin = orgId
    ? memberships.some((m) => m.isActive && m.roleInOrg === 'admin' && m.organizationId === orgId)
    : memberships.some((m) => m.isActive && m.roleInOrg === 'admin');
  if (!isAdmin) redirect('/forbidden');
  return session;
}

export async function requireOrganizationAdminOrLeader(orgId?: string): Promise<SessionPayload> {
  const session = await requireOrganization();
  /* v8 ignore next -- requireOrganization() guards against missing memberships; ?? [] is a defensive fallback that is structurally unreachable */
  const memberships = session.organizationMemberships ?? [];
  const ok = memberships.some(
    (m) =>
      m.isActive &&
      (m.roleInOrg === 'admin' || m.roleInOrg === 'leader') &&
      (!orgId || m.organizationId === orgId)
  );
  if (!ok) redirect('/forbidden');
  return session;
}

/**
 * Manager cabinet guards (Phase 8).
 *
 * `managedOrgIds` is populated by the session loader from the
 * `OrganizationManager` table. Its absence means the loader did not run for
 * this session — treat as unauthenticated and bounce to /login so the next
 * request re-loads. An *empty* array, however, is a valid manager session
 * (the user is a manager with no per-org assignments yet — they may still
 * see orders via direct `Order.managerId` ownership or historical comments).
 */
export async function requireManager(): Promise<SessionPayload> {
  const session = await requireSession();
  // Кабинет менеджера открыт всему менеджерскому контуру: и рядовому, и
  // руководителю («играющий тренер», Р-Л-3 ТЗ 2026-08-17).
  if (!isStaffManagerSide(session)) redirect('/forbidden');
  if (session.managedOrgIds === undefined) redirect('/login');
  return session;
}

export async function requireManagerLeader(): Promise<SessionPayload> {
  const session = await requireManager();
  // Единый redirect-контракт под-ролей (ось 1 аудита): нехватка elevation →
  // /forbidden, как requirePartnerAdmin и requireOrganizationAdminOrLeader.
  if (!isManagerLeader(session)) redirect('/forbidden');
  return session;
}

export async function requireManagerForOrg(orgId: string): Promise<SessionPayload> {
  const session = await requireManager();
  // Mode-aware решение (C8) — общий предикат с API-роутами выгрузок (§4).
  if (!(await canManagerAccessOrg(prisma, session, orgId))) redirect('/manager/dashboard');
  return session;
}

export async function requireManagerForOrder(orderId: string): Promise<{
  session: SessionPayload;
  order: { id: string; managerId: string | null; organizationId: string | null; companyId: string };
}> {
  const session = await requireManager();
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, managerId: true, organizationId: true, companyId: true },
  });
  if (!order) notFound();

  // Руководитель открывает любой заказ своей компании (лидер-инвариант C8:
  // граница — компания). Личные СПИСКИ менеджера это не расширяет — только деталь.
  // Cross-company держится `order.companyId === session.companyId`; при
  // companyId=null правило не срабатывает → нормальный three-way (deny).
  if (isLeaderSameCompany(session, order.companyId)) {
    return { session, order };
  }

  // Three-way visibility check (scoped mode only): managerId, org scope, or
  // historical comments. Company-wide mode skips straight to the companyId check.
  let commentsCountByMe = 0;
  if (!teamMode && order.managerId !== session.sub) {
    const inOrgScope = order.organizationId !== null && isOrgInScope(session, order.organizationId);
    if (!inOrgScope) {
      commentsCountByMe = await prisma.comment.count({
        where: { orderId: order.id, authorId: session.sub },
      });
    }
  }

  if (!canSeeOrder(session, { ...order, commentsCountByMe }, teamMode)) notFound();

  return { session, order };
}
