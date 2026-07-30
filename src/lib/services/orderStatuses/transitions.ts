/**
 * §10 ТЗ v0.5 (этап 2) — смена рабочего статуса заявки.
 *
 * Матрица переходов из старого `orderLifecycle.ts` заменена **порядком в
 * справочнике**: вперёд — на любой следующий активный, назад — только
 * администратору и руководителю («возврат на предыдущую стадию», §10).
 *
 * Решение заказчика Q4: **отменить заявку может и менеджер, но обязан указать
 * причину**; вернуть её из отмены — только администратор или руководитель.
 *
 * Каждая смена пишет строку в `OrderStatusChange` (§10 требует хранить прежний
 * и новый статус, дату, пользователя и причину) плюс обычный аудит.
 */

import type { PrismaClient, OrderStatusDefinition } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, getCompanyTeamVisibility, isManagerLeader } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { evaluateOrderCompletion, type CompletionCondition } from '@/lib/orders/completion';
import { getOrderedStatuses, findByAnchor, type StatusAnchor } from './definitions';

export type TransitionError =
  | 'not_found'
  | 'forbidden'
  | 'invalid_status'
  | 'status_inactive'
  | 'reason_required'
  | 'backward_forbidden';

export type TransitionResult =
  | { ok: true; changed: boolean; statusId: string }
  | { ok: false; error: TransitionError }
  | { ok: false; error: 'completion_conditions_unmet'; unmet: CompletionCondition[] };

/** Может ли роль двигать статус вообще (клиенты — нет). */
function isStaff(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
}

/** Админ и руководитель: возврат назад и подъём из отмены. */
function isElevated(session: SessionPayload): boolean {
  return session.role === 'admin' || isManagerLeader(session);
}

/** Порядок «вперёд» — только активные нетерминальные строки. */
function pipeline(all: OrderStatusDefinition[]): OrderStatusDefinition[] {
  return all.filter((s) => s.isActive && !s.isTerminal);
}

export type TransitionArgs = {
  orderId: string;
  /** id строки справочника. */
  toId: string;
  reason?: string;
};

export async function transitionOrderStatus(
  prisma: PrismaClient,
  session: SessionPayload,
  args: TransitionArgs
): Promise<TransitionResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };

  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      managerId: true,
      organizationId: true,
      companyId: true,
      statusId: true,
      // Для проверки условий закрытия (§5.6 ТЗ v1.0) — она была в старой
      // панели жизненного цикла и НЕ должна пропасть вместе с ней.
      serviceType: true,
      accountingSignedAt: true,
      documents: { select: { scanStatus: true } },
      items: { select: { trainingStatus: true } }
    }
  });
  if (!order) return { ok: false, error: 'not_found' };

  if (session.role === 'manager') {
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    const inScope =
      (isManagerLeader(session) && !!session.companyId && order.companyId === session.companyId) ||
      canSeeOrder(session, order, teamMode);
    if (!inScope) return { ok: false, error: 'not_found' };
  }

  const all = await getOrderedStatuses(prisma);
  const target = all.find((s) => s.id === args.toId);
  if (!target) return { ok: false, error: 'invalid_status' };

  // Уже стоящий статус можно оставить, даже если он деактивирован; выбрать
  // деактивированный заново — нельзя.
  if (order.statusId === target.id) return { ok: true, changed: false, statusId: target.id };
  if (!target.isActive) return { ok: false, error: 'status_inactive' };

  // find по null-статусу и так вернёт undefined — тернарник добавлял бы
  // недостижимую ветку.
  const current = all.find((s) => s.id === order.statusId) ?? null;
  const reason = args.reason?.trim() || null;

  // Отмена — терминальная строка, доступна с любой стадии. Менеджеру — только
  // с причиной (решение Q4); администратору и руководителю причина желательна,
  // но не обязательна: они правят чужие ошибки, а не оформляют отказ клиента.
  if (target.isTerminal) {
    if (!isElevated(session) && !reason) return { ok: false, error: 'reason_required' };
  } else if (current) {
    // Выход из терминального статуса — только админ и руководитель.
    if (current.isTerminal && !isElevated(session)) {
      return { ok: false, error: 'backward_forbidden' };
    }
    if (!current.isTerminal) {
      const order_ = pipeline(all);
      const fromIdx = order_.findIndex((s) => s.id === current.id);
      const toIdx = order_.findIndex((s) => s.id === target.id);
      // Возврат на предыдущую стадию (§10) — только админ и руководитель.
      if (fromIdx !== -1 && toIdx !== -1 && toIdx < fromIdx && !isElevated(session)) {
        return { ok: false, error: 'backward_forbidden' };
      }
    }
  }

  // Закрыть заявку можно только при выполненных условиях (§5.6): есть чистый
  // документ, подписана бухгалтерия, у обучения выданы удостоверения. Раньше
  // это проверяла панель жизненного цикла — при переезде на справочник
  // проверка обязана переехать вместе с ней, иначе она тихо исчезнет.
  if (target.anchor === 'closed') {
    const { ready, unmet } = evaluateOrderCompletion(order);
    if (!ready) return { ok: false, error: 'completion_conditions_unmet', unmet };
  }

  await prisma.order.update({ where: { id: order.id }, data: { statusId: target.id } });

  await prisma.orderStatusChange.create({
    data: {
      orderId: order.id,
      fromId: current?.id ?? null,
      toId: target.id,
      userId: session.sub,
      reason
    }
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_status_changed',
    entity: 'order',
    entityId: order.id,
    after: { from: current?.key ?? null, to: target.key, reason }
  });

  return { ok: true, changed: true, statusId: target.id };
}

/**
 * Автоперевод по наступившему факту: оплата пришла, документы выданы,
 * бухгалтерия подписала, заявка закрыта.
 *
 * Вызывается системой, а не пользователем, поэтому прав не спрашивает — но и
 * **назад не двигает**: если заявка уже дальше по порядку, факт не должен
 * откатывать её (оплата, пришедшая после выдачи документов, не возвращает
 * заявку на шаг назад).
 */
export async function applyStatusAnchor(
  prisma: PrismaClient,
  orderId: string,
  anchor: StatusAnchor,
  userId?: string
): Promise<{ ok: true; changed: boolean } | { ok: false; error: 'not_found' | 'invalid_status' }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, statusId: true }
  });
  if (!order) return { ok: false, error: 'not_found' };

  const target = await findByAnchor(prisma, anchor);
  if (!target) return { ok: false, error: 'invalid_status' };
  if (order.statusId === target.id) return { ok: true, changed: false };

  const all = await getOrderedStatuses(prisma);
  // find по null-статусу и так вернёт undefined — тернарник добавлял бы
  // недостижимую ветку.
  const current = all.find((s) => s.id === order.statusId) ?? null;

  // Терминальную заявку факты не воскрешают.
  if (current?.isTerminal) return { ok: true, changed: false };

  const order_ = pipeline(all);
  const fromIdx = current ? order_.findIndex((s) => s.id === current.id) : -1;
  const toIdx = order_.findIndex((s) => s.id === target.id);
  if (fromIdx !== -1 && toIdx !== -1 && toIdx <= fromIdx) return { ok: true, changed: false };

  await prisma.order.update({ where: { id: order.id }, data: { statusId: target.id } });
  await prisma.orderStatusChange.create({
    data: {
      orderId: order.id,
      fromId: current?.id ?? null,
      toId: target.id,
      userId: userId ?? null,
      reason: 'Автоматически: наступило событие'
    }
  });

  return { ok: true, changed: true };
}

/** История смен статуса для карточки заявки — свежие сверху. */
export async function listStatusHistory(prisma: PrismaClient, orderId: string) {
  return prisma.orderStatusChange.findMany({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      reason: true,
      from: { select: { id: true, label: true } },
      to: { select: { id: true, label: true } },
      user: { select: { name: true, email: true } }
    }
  });
}
