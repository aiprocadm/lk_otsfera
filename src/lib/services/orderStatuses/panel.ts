/**
 * §10 ТЗ v0.5 — данные панели статуса на карточке заявки.
 *
 * Что показать кнопками, решает сервер: тот же порядок и те же права, что
 * применит `transitionOrderStatus`. Иначе кнопка «Вернуть» показалась бы
 * менеджеру и отвалилась бы с ошибкой при нажатии.
 */

import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isManagerLeader } from '@/lib/auth/managerPolicy';
import { getOrderedStatuses } from './definitions';
import { listStatusHistory } from './transitions';

export type StatusOptionView = {
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
};

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
    select: { id: true, statusId: true }
  });

  const all = await getOrderedStatuses(prisma);
  const current = all.find((s) => s.id === order?.statusId) ?? null;

  const pipeline = all.filter((s) => s.isActive && !s.isTerminal);
  const terminalRow = all.find((s) => s.isActive && s.isTerminal) ?? null;

  const elevated = session.role === 'admin' || isManagerLeader(session);
  const staff = session.role === 'admin' || session.role === 'manager';

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
    current: current ? { id: current.id, label: current.label, isTerminal: current.isTerminal } : null,
    forward,
    backward,
    terminal: staff && terminalRow ? view(terminalRow) : null,
    history: historyRows.map((h) => ({
      id: h.id,
      createdAt: h.createdAt,
      fromLabel: h.from?.label ?? null,
      toLabel: h.to.label,
      userName: h.user?.name ?? h.user?.email ?? null,
      reason: h.reason
    }))
  };
}
