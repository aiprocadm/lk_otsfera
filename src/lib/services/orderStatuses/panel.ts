/**
 * §10 ТЗ v0.5 — данные панели статуса на карточке заявки.
 *
 * Что показать кнопками, решает сервер: тот же порядок и те же права, что
 * применит `transitionOrderStatus`. Иначе кнопка «Вернуть» показалась бы
 * менеджеру и отвалилась бы с ошибкой при нажатии.
 */

import type { PrismaClient } from '@prisma/client';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isManagerLeader } from '@/lib/auth/managerPolicy';
import { buildStatusSteps, type StatusSteps } from '@/lib/orders/statusSteps';
import { getOrderedStatuses } from './definitions';
import { listStatusHistory } from './transitions';

type StatusOptionView = {
  id: string;
  label: string;
  isTerminal: boolean;
  isAuto: boolean;
};

export type OrderStatusPanelData = {
  current: { id: string; label: string; isTerminal: boolean } | null;
  forward: StatusOptionView[];
  backward: StatusOptionView[];
  terminal: StatusOptionView | null;
  history: {
    id: string;
    createdAt: Date;
    fromLabel: string | null;
    toLabel: string;
    userName: string | null;
    reason: string | null;
  }[];
  /**
   * Этап 6 ТЗ 13.10.2026 (`У-304`, `Р-6-3`): где редактируют справочник
   * статусов. Администратору и руководителю — ссылка в свой кабинет,
   * менеджеру — `null`: панель скажет словами, кто и где их настраивает.
   */
  statusesHref: string | null;
  /**
   * Этап 5 ТЗ 28.10.2026 (`У-353`): шкала этапов шапки карточки — из того же
   * справочника и того же текущего статуса, что и кнопки панели.
   */
  steps: StatusSteps;
};

/** Справочник статусов в «Настройках» — у тех, кто вправе его править. */
function statusesHrefFor(session: SessionPayload): string | null {
  if (session.role === 'admin') return '/admin/settings/catalogs/application-statuses';
  if (isManagerLeader(session)) return '/leader/settings/catalogs/application-statuses';
  return null;
}

function view(s: {
  id: string;
  label: string;
  isTerminal: boolean;
  anchor: string | null;
}): StatusOptionView {
  return { id: s.id, label: s.label, isTerminal: s.isTerminal, isAuto: s.anchor !== null };
}

export async function getOrderStatusPanel(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<OrderStatusPanelData> {
  // Статус достаём сами: страница не должна ходить в базу ради одного поля
  // (§2 CLAUDE.md — страницы тонкие).
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, statusId: true },
  });

  const all = await getOrderedStatuses(prisma);
  const current = all.find((s) => s.id === order?.statusId) ?? null;

  const pipeline = all.filter((s) => s.isActive && !s.isTerminal);
  const terminalRow = all.find((s) => s.isActive && s.isTerminal) ?? null;

  const elevated = session.role === 'admin' || isManagerLeader(session);
  const staff = session.role === 'admin' || isStaffManagerSide(session);

  const idx = current ? pipeline.findIndex((s) => s.id === current.id) : -1;

  // Вперёд: все следующие стадии. Не одна: заказчик может закрыть заявку,
  // пропустив промежуточные (§10 не требует шагать строго по одной).
  const forward = staff && !current?.isTerminal ? pipeline.slice(idx + 1).map(view) : [];

  // Назад: только elevated и только до текущей стадии.
  const backward =
    elevated && idx > 0
      ? pipeline.slice(0, idx).map(view)
      : elevated && current?.isTerminal
        ? pipeline.map(view)
        : [];

  const historyRows = await listStatusHistory(prisma, orderId);

  return {
    current: current
      ? { id: current.id, label: current.label, isTerminal: current.isTerminal }
      : null,
    forward,
    backward,
    terminal: staff && terminalRow ? view(terminalRow) : null,
    statusesHref: statusesHrefFor(session),
    steps: buildStatusSteps(all, order?.statusId ?? null),
    history: historyRows.map((h) => ({
      id: h.id,
      createdAt: h.createdAt,
      fromLabel: h.from?.label ?? null,
      toLabel: h.to.label,
      userName: h.user?.name ?? h.user?.email ?? null,
      reason: h.reason,
    })),
  };
}

/**
 * Шкала этапов для карточек заказчика и партнёра (`У-353`): только чтение, без
 * кнопок и истории. Доступ к заказу проверяет страница своим сервисом ДО этого
 * вызова — здесь читается лишь статус уже разрешённого заказа.
 */
export async function getOrderStatusSteps(
  prisma: PrismaClient,
  orderId: string
): Promise<StatusSteps> {
  const [order, all] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId }, select: { statusId: true } }),
    getOrderedStatuses(prisma),
  ]);
  return buildStatusSteps(all, order?.statusId ?? null);
}
