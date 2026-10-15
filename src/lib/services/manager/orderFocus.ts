import type { Prisma, PrismaClient } from '@prisma/client';
import {
  READINESS_SELECT,
  evaluateReadinessBatch,
  type OrderForReadiness,
} from '@/lib/services/manager/orderDelivery';
import type { OrderFocus } from '@/lib/orders/focus';
import { ACTIVE_EXEC, TERMINAL_EXEC, THREE_DAYS_MS } from './dashboard/constants';

/**
 * «Фокус» списка заказов менеджера (этап 4 ТЗ 13.10.2026, `У-295`, `У-297`,
 * `Р-4-3`).
 *
 * Карточки главной («Заказы в работе», «Просроченные заказы», «Срок в
 * ближайшие 3 дня», «Готово к передаче») вели в «Заказы» без фильтра: число на
 * карточке не совпадало ни с чем в списке. Теперь и карточка, и список берут
 * условие **отсюда** (подписи и адреса — в `lib/orders/focus.ts`) — поэтому число на карточке равно числу строк после
 * перехода. Второй копии условий в проекте нет.
 */

/** Условие фокуса, которое выражается запросом (всё, кроме «готово к передаче»). */
export function orderFocusWhere(
  focus: Exclude<OrderFocus, 'ready'>,
  now: Date
): Prisma.OrderWhereInput {
  if (focus === 'active') return { executionStatus: { in: [...ACTIVE_EXEC] } };
  const open: Prisma.OrderWhereInput = { executionStatus: { notIn: [...TERMINAL_EXEC] } };
  if (focus === 'overdue') return { AND: [open, { deadline: { lt: now } }] };
  return {
    AND: [open, { deadline: { gte: now, lt: new Date(now.getTime() + THREE_DAYS_MS) } }],
  };
}

/** Сколько заказов проверяем на готовность за раз (витрина, не отчёт). */
const READINESS_SCAN_CAP = 200;

/**
 * Заказы, готовые к передаче (`Р-4-4`): чек-лист закрыт, результат ещё не
 * передан. Не переданные и не отменённые, в скоупе менеджера; готовность
 * считается той же `evaluateReadinessBatch`, что блок на карточке заказа —
 * правила живут в одной чистой функции, дублировать их SQL-ом нельзя.
 * Порядок — свежие сверху.
 */
export async function readyToDeliverOrders(
  prisma: PrismaClient,
  scope: Prisma.OrderWhereInput
): Promise<{ id: string; orderNumber: string | null; title: string }[]> {
  const orders = await prisma.order.findMany({
    where: {
      AND: [scope, { resultDeliveredAt: null }, { executionStatus: { not: 'cancelled' } }],
    },
    select: READINESS_SELECT,
    orderBy: { updatedAt: 'desc' },
    take: READINESS_SCAN_CAP,
  });
  const readiness = await evaluateReadinessBatch(prisma, orders as OrderForReadiness[]);
  // evaluateReadinessBatch — это orders.map(): длины массивов совпадают.
  return orders
    .filter((_, i) => readiness[i]!.ready)
    .map((o) => ({ id: o.id, orderNumber: o.orderNumber, title: o.title }));
}

/** Условие фокуса для списка «Заказы» (с «готово к передаче» — по найденным id). */
export async function orderFocusFilter(
  prisma: PrismaClient,
  focus: OrderFocus,
  scope: Prisma.OrderWhereInput,
  now: Date
): Promise<Prisma.OrderWhereInput> {
  if (focus !== 'ready') return orderFocusWhere(focus, now);
  const ready = await readyToDeliverOrders(prisma, scope);
  return { id: { in: ready.map((o) => o.id) } };
}
