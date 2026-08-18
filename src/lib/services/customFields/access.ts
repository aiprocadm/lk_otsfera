/**
 * §11 ТЗ v0.5 — «кто вообще видит эту карточку».
 *
 * До этапа 1 значения полей умели жить только у заказа, и скоуп был вшит в
 * `values.ts` (`resolveWritableOrder`). Сущностей стало пять, поэтому скоуп
 * вынесен сюда и опирается на СУЩЕСТВУЮЩИЕ политики (`canSeeOrder`,
 * `canManagerAccessOrg`, `canSeeDocument`, привязки партнёра/организации) —
 * новых правил доступа этап не изобретает (§4 CLAUDE.md, defense-in-depth).
 *
 * Возвращает только «доступ к карточке». Второй сомножитель права записи —
 * роль в `editableByRoles` конкретного поля (см. roles.ts). Итог:
 *
 *     право записи = доступ к карточке ∧ роль ∈ editableByRoles
 *
 * Ни одно из двух не ослабляет другое.
 */

import type { PrismaClient } from '@prisma/client';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  canSeeOrder,
  canManagerAccessOrg,
  getCompanyTeamVisibility,
  isLeaderSameCompany,
} from '@/lib/auth/managerPolicy';
import type { CustomFieldEntity } from './entities';

export type EntityAccess = {
  /** Доступна ли карточка на чтение. */
  canRead: boolean;
};

const DENIED: EntityAccess = { canRead: false };
const GRANTED: EntityAccess = { canRead: true };

/**
 * Доступ к карточке сущности.
 *
 * Отсутствующая запись и запись вне скоупа дают ОДИН и тот же результат
 * (`canRead: false`) — вызывающий отвечает `not_found`, не раскрывая
 * существование чужой карточки.
 */
export async function resolveEntityAccess(
  prisma: PrismaClient,
  session: SessionPayload,
  entityType: CustomFieldEntity,
  entityId: string
): Promise<EntityAccess> {
  if (session.role === 'student') return DENIED;
  if (session.role === 'admin') {
    // Model A (§4 CLAUDE.md): администратор управляет всем. Проверяем только
    // существование записи.
    return (await entityExists(prisma, entityType, entityId)) ? GRANTED : DENIED;
  }

  switch (entityType) {
    case 'order':
      return resolveOrder(prisma, session, entityId);
    case 'organization':
      return resolveOrganization(prisma, session, entityId);
    case 'partner':
      return resolvePartner(prisma, session, entityId);
    case 'student':
      return resolveStudent(prisma, session, entityId);
    case 'document':
      return resolveDocument(prisma, session, entityId);
  }
}

// ─── Существование записи (для admin) ────────────────────────────────────────

async function entityExists(
  prisma: PrismaClient,
  entityType: CustomFieldEntity,
  entityId: string
): Promise<boolean> {
  const sel = { id: true } as const;
  switch (entityType) {
    case 'order':
      return !!(await prisma.order.findUnique({ where: { id: entityId }, select: sel }));
    case 'organization':
      return !!(await prisma.organization.findUnique({ where: { id: entityId }, select: sel }));
    case 'partner':
      return !!(await prisma.partner.findUnique({ where: { id: entityId }, select: sel }));
    case 'student':
      return !!(await prisma.student.findUnique({ where: { id: entityId }, select: sel }));
    case 'document':
      return !!(await prisma.document.findUnique({ where: { id: entityId }, select: sel }));
  }
}

// ─── Заказ ───────────────────────────────────────────────────────────────────

async function resolveOrder(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<EntityAccess> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      managerId: true,
      organizationId: true,
      companyId: true,
      partnerId: true,
      // Историческая ветка видимости менеджера (комментировал заказ). Выбираем
      // всегда: условный select оставил бы в типе `false` и мёртвую ветку.
      comments: { where: { authorId: session.sub }, take: 1, select: { id: true } },
    },
  });
  if (!order) return DENIED;

  if (isStaffManagerSide(session)) {
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    const commentsCountByMe = order.comments.length;
    if (isLeaderSameCompany(session, order.companyId)) return GRANTED;
    return canSeeOrder(session, { ...order, commentsCountByMe }, teamMode) ? GRANTED : DENIED;
  }

  if (session.role === 'partner') {
    return !!session.partnerId && order.partnerId === session.partnerId ? GRANTED : DENIED;
  }

  // organization
  return orgInSession(session, order.organizationId) ? GRANTED : DENIED;
}

// ─── Организация ─────────────────────────────────────────────────────────────

async function resolveOrganization(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<EntityAccess> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, partnerId: true },
  });
  if (!org) return DENIED;

  if (isStaffManagerSide(session)) {
    return (await canManagerAccessOrg(prisma, session, orgId)) ? GRANTED : DENIED;
  }

  if (session.role === 'partner') {
    return !!session.partnerId && org.partnerId === session.partnerId ? GRANTED : DENIED;
  }

  // organization — только собственная карточка
  return orgInSession(session, orgId) ? GRANTED : DENIED;
}

// ─── Партнёр ─────────────────────────────────────────────────────────────────

async function resolvePartner(
  prisma: PrismaClient,
  session: SessionPayload,
  partnerId: string
): Promise<EntityAccess> {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { id: true },
  });
  if (!partner) return DENIED;

  if (session.role === 'partner') {
    return session.partnerId === partnerId ? GRANTED : DENIED;
  }

  if (isStaffManagerSide(session)) {
    // Карточка партнёра живёт только у администратора (решение Q4), но чтение
    // значений менеджеру не запрещаем, если партнёр относится к его компании:
    // иначе будущий экран пришлось бы «открывать» правкой этого файла.
    if (!session.companyId) return DENIED;
    const inCompany = await prisma.organization.findFirst({
      where: { partnerId, companyId: session.companyId },
      select: { id: true },
    });
    return inCompany ? GRANTED : DENIED;
  }

  // organization — карточку партнёра не читает
  return DENIED;
}

// ─── Сотрудник организации ───────────────────────────────────────────────────

async function resolveStudent(
  prisma: PrismaClient,
  session: SessionPayload,
  studentId: string
): Promise<EntityAccess> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, organizationId: true },
  });
  if (!student) return DENIED;

  // Доступ к сотруднику = доступ к его организации (та же политика, что у
  // карточки сотрудника в кабинетах).
  return resolveOrganization(prisma, session, student.organizationId);
}

// ─── Документ ────────────────────────────────────────────────────────────────

async function resolveDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  documentId: string
): Promise<EntityAccess> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      orderId: true,
      counterpartyType: true,
      counterpartyId: true,
      order: {
        select: {
          id: true,
          managerId: true,
          organizationId: true,
          companyId: true,
          partnerId: true,
          comments: { where: { authorId: session.sub }, take: 1, select: { id: true } },
        },
      },
    },
  });
  if (!doc) return DENIED;

  // Документ заказа — доступ наследуется от заказа.
  if (doc.order) {
    if (isStaffManagerSide(session)) {
      const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
      const commentsCountByMe = doc.order.comments.length;
      if (isLeaderSameCompany(session, doc.order.companyId)) return GRANTED;
      // canSeeDocument делегирует в canSeeOrder, но его тип не несёт
      // commentsCountByMe (историческая ветка видимости) — зовём напрямую.
      return canSeeOrder(session, { ...doc.order, commentsCountByMe }, teamMode) ? GRANTED : DENIED;
    }
    if (session.role === 'partner') {
      return !!session.partnerId && doc.order.partnerId === session.partnerId ? GRANTED : DENIED;
    }
    return orgInSession(session, doc.order.organizationId) ? GRANTED : DENIED;
  }

  // Общий документ (без заказа) — доступ по контрагенту. CounterpartyType —
  // закрытый enum из двух значений, третьей ветки не бывает.
  return doc.counterpartyType === 'organization'
    ? resolveOrganization(prisma, session, doc.counterpartyId)
    : resolvePartner(prisma, session, doc.counterpartyId);
}

// ─── Общее ───────────────────────────────────────────────────────────────────

/**
 * Принадлежит ли организация клиентской сессии (прямая привязка, активное
 * членство или закрепление). `orgId` — строка, а не `string | null`:
 * `Order.organizationId` в схеме обязателен, проверять пустоту нечего.
 */
function orgInSession(session: SessionPayload, orgId: string): boolean {
  if (session.organizationId === orgId) return true;
  if (
    (session.organizationMemberships ?? []).some((m) => m.organizationId === orgId && m.isActive)
  ) {
    return true;
  }
  return (session.assignedOrgIds ?? []).includes(orgId);
}
