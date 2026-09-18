import type { PrismaClient } from '@prisma/client';

/**
 * Загрузка менеджеров (`У-244`, отчёт `manager_load`).
 *
 * Отвечает на вопрос «кто перегружен, а у кого есть место»: активные заказы,
 * задачи в работе, из них просроченные, открытые переписки.
 *
 * Четыре группировки на всю компанию, а не по запросу на человека (`У-248`):
 * в компании бывает три менеджера, а бывает тридцать, и обход по одному
 * превращает отчёт в тридцать походов в базу.
 *
 * Менеджер без единой строки показывается нулями — «нет данных» и «ничего не
 * делает» человек прочитает одинаково, поэтому строка должна быть.
 */
export type ManagerLoadRow = {
  managerId: string;
  managerName: string;
  orders: number;
  tasks: number;
  overdueTasks: number;
  dialogs: number;
};

/** Заказы, которые ещё в работе: закрытые нагрузкой не считаются. */
const ACTIVE_ORDER_STATUSES = ['pending', 'in_progress'] as const;

export async function getManagerLoad(
  prisma: PrismaClient,
  args: { companyId: string; now?: Date }
): Promise<ManagerLoadRow[]> {
  const now = args.now ?? new Date();

  const [managers, orders, tasks, overdue, dialogs] = await Promise.all([
    prisma.user.findMany({
      where: { companyId: args.companyId, role: { in: ['manager', 'leader'] } },
      select: { id: true, name: true, email: true, isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    }),
    prisma.order.groupBy({
      by: ['managerId'],
      where: { companyId: args.companyId, executionStatus: { in: [...ACTIVE_ORDER_STATUSES] } },
      _count: { _all: true },
    }),
    prisma.taskAssignee.groupBy({
      by: ['userId'],
      where: { task: { companyId: args.companyId, status: { not: 'done' } } },
      _count: { _all: true },
    }),
    prisma.taskAssignee.groupBy({
      by: ['userId'],
      where: {
        task: { companyId: args.companyId, status: { not: 'done' }, dueDate: { lt: now } },
      },
      _count: { _all: true },
    }),
    prisma.messengerDialog.groupBy({
      by: ['assigneeId'],
      where: { companyId: args.companyId, status: { not: 'closed' } },
      _count: { _all: true },
    }),
  ]);

  const count = <T extends { _count: { _all: number } }>(
    rows: T[],
    key: keyof T,
    id: string
  ): number => rows.find((r) => r[key] === id)?._count._all ?? 0;

  return managers.map((m) => ({
    managerId: m.id,
    // Уволенный остаётся с пометкой: иначе его нагрузка исчезает вместе с ним,
    // а заказы и задачи никуда не делись.
    managerName: `${m.name || m.email}${m.isActive ? '' : ' (не работает)'}`,
    orders: count(orders, 'managerId', m.id),
    tasks: count(tasks, 'userId', m.id),
    overdueTasks: count(overdue, 'userId', m.id),
    dialogs: count(dialogs, 'assigneeId', m.id),
  }));
}
