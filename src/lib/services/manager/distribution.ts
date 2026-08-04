import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import {
  canSeeOrder,
  getCompanyTeamVisibility,
  isLeaderSameCompany,
} from '@/lib/auth/managerPolicy';

/**
 * §5.3 ТЗ — распределение заявок:
 *  - АВТО по закреплению: организация закреплена за менеджером (OrganizationManager)
 *    → назначаем его; аналогично через партнёра (единственный менеджер по орг-ам партнёра);
 *  - ВРУЧНУЮ: руководитель/администратор задают Order.managerId (assignOrderManager);
 *  - SELF-ASSIGN: менеджер забирает заявку сам, ТОЛЬКО если она не закреплена за другим.
 *
 * Автоназначение срабатывает лишь при ОДНОЗНАЧНОМ закреплении; при неоднозначности
 * (несколько менеджеров) возвращаем null → ручное распределение (безопаснее, чем угадывать).
 */

/** Однозначный авто-менеджер по закреплению, либо null. */
export async function resolveAutoManager(
  prisma: PrismaClient,
  args: { organizationId: string; partnerId?: string | null }
): Promise<string | null> {
  const byOrg = await prisma.organizationManager.findMany({
    where: { organizationId: args.organizationId, isActive: true },
    select: { userId: true },
  });
  const orgUserIds = [...new Set(byOrg.map((r) => r.userId))];
  if (orgUserIds.length === 1) return orgUserIds[0]!; // длина проверена строкой выше

  // Никого по организации — пробуем закрепление через партнёра.
  if (orgUserIds.length === 0 && args.partnerId) {
    const byPartner = await prisma.organizationManager.findMany({
      where: { isActive: true, organization: { partnerId: args.partnerId } },
      select: { userId: true },
    });
    const partnerUserIds = [...new Set(byPartner.map((r) => r.userId))];
    if (partnerUserIds.length === 1) return partnerUserIds[0]!; // длина проверена строкой выше
  }

  return null;
}

export type AssignManagerResult =
  { ok: true; changed: boolean } | { ok: false; error: 'order_not_found' | 'invalid_manager' };

/**
 * Ручное назначение менеджера (руководитель/администратор). Роль вызывающего
 * проверяется на уровне server-action; здесь — валидация кандидата и запись.
 * `managerUserId=null` снимает назначение.
 *
 * `restrictToCompanyId` (C8): когда задан (руководитель), кандидат обязан
 * принадлежать той же компании — иначе менеджер чужой компании получил бы доступ
 * к заявке (cross-company leak). Admin (Model A) параметр не передаёт.
 */
export async function assignOrderManager(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; managerUserId: string | null; restrictToCompanyId?: string | null }
): Promise<AssignManagerResult> {
  if (args.managerUserId !== null) {
    const candidate = await prisma.user.findUnique({
      where: { id: args.managerUserId },
      select: { role: true, isActive: true, companyId: true },
    });
    if (!candidate || candidate.role !== 'manager' || !candidate.isActive) {
      return { ok: false, error: 'invalid_manager' };
    }
    if (
      args.restrictToCompanyId !== undefined &&
      candidate.companyId !== args.restrictToCompanyId
    ) {
      return { ok: false, error: 'invalid_manager' };
    }
  }

  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: { managerId: true },
  });
  if (!order) return { ok: false, error: 'order_not_found' };
  if (order.managerId === args.managerUserId) return { ok: true, changed: false };

  await prisma.order.update({
    where: { id: args.orderId },
    data: { managerId: args.managerUserId },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_manager_changed',
    entity: 'order',
    entityId: args.orderId,
    before: { managerId: order.managerId },
    after: { managerId: args.managerUserId },
  });
  return { ok: true, changed: true };
}

export type ClaimOrderResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: 'not_found' | 'forbidden' | 'already_assigned' };

/**
 * Self-assign: менеджер забирает заявку. Разрешено только если (1) заявка в зоне
 * видимости менеджера — company-scoped при C8, иначе 3-way scope (defense-in-depth,
 * §4/C8: без этой проверки любой менеджер мог бы забрать чужую заявку другой компании,
 * IDOR); и (2) заявка НЕ закреплена за другим менеджером (§5.3).
 */
export async function claimOrder(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string }
): Promise<ClaimOrderResult> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: { managerId: true, organizationId: true, companyId: true },
  });
  if (!order) return { ok: false, error: 'not_found' };
  // Scope gate BEFORE mutation: claiming would set managerId=sub, which itself
  // grants canSeeOrder — so the visibility check must precede the write.
  // Leader bypass зеркалит getOrder (orders.ts): лидер открывает деталку любого
  // заказа СВОЕЙ компании (isLeaderSameCompany), значит и claim обязан принимать
  // ту же границу — иначе при teamMode=false лидер видит кнопку «Взять в работу»
  // на незакреплённом заказе вне своих орг, а клик даёт forbidden. Привилегий это
  // НЕ расширяет: лидер уже может назначить себя на любой заказ своей компании
  // через assignOrderManager (leader-экшен). Прекондиции claim ниже не трогаем.
  const leaderSameCompany = isLeaderSameCompany(session, order.companyId);
  if (!leaderSameCompany && !canSeeOrder(session, order, teamMode)) {
    return { ok: false, error: 'forbidden' };
  }
  if (order.managerId && order.managerId !== session.sub) {
    return { ok: false, error: 'already_assigned' };
  }
  if (order.managerId === session.sub) return { ok: true, changed: false };

  await prisma.order.update({ where: { id: args.orderId }, data: { managerId: session.sub } });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_self_assigned',
    entity: 'order',
    entityId: args.orderId,
    after: { managerId: session.sub },
  });
  return { ok: true, changed: true };
}
