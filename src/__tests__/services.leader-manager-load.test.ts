import { describe, it, expect, vi } from 'vitest';
import { getManagerLoad } from '@/lib/services/leader/managerLoad';

/**
 * Загрузка менеджеров (`У-244`, отчёт `manager_load`).
 *
 * Проверяется ровно то, ради чего сервис написан: четыре группировки на всю
 * компанию вместо обхода по человеку (`У-248`), строка нулями у того, у кого
 * работы нет, и пометка у уволенного.
 */
function makeDb(opts: {
  managers: Array<{ id: string; name: string; email: string; isActive: boolean }>;
  orders?: Array<{ managerId: string | null; _count: { _all: number } }>;
  tasks?: Array<{ userId: string; _count: { _all: number } }>;
  overdue?: Array<{ userId: string; _count: { _all: number } }>;
  dialogs?: Array<{ assigneeId: string | null; _count: { _all: number } }>;
}) {
  const calls: Array<{ model: string; where: unknown }> = [];
  const groupBy = (model: string, rows: unknown[]) =>
    vi.fn(async (args: { where: unknown }) => {
      calls.push({ model, where: args.where });
      return rows;
    });

  return {
    db: {
      user: { findMany: vi.fn(async () => opts.managers) },
      order: { groupBy: groupBy('order', opts.orders ?? []) },
      taskAssignee: {
        groupBy: vi
          .fn()
          .mockImplementationOnce(groupBy('taskAssignee.open', opts.tasks ?? []))
          .mockImplementationOnce(groupBy('taskAssignee.overdue', opts.overdue ?? [])),
      },
      messengerDialog: { groupBy: groupBy('messengerDialog', opts.dialogs ?? []) },
    } as never,
    calls,
  };
}

describe('getManagerLoad — кто перегружен, а у кого есть место', () => {
  it('складывает четыре группировки в строку на человека', async () => {
    const { db, calls } = makeDb({
      managers: [
        { id: 'm1', name: 'Иванов', email: 'i@x.ru', isActive: true },
        { id: 'm2', name: 'Петров', email: 'p@x.ru', isActive: true },
      ],
      orders: [{ managerId: 'm1', _count: { _all: 3 } }],
      tasks: [{ userId: 'm1', _count: { _all: 5 } }],
      overdue: [{ userId: 'm1', _count: { _all: 2 } }],
      dialogs: [{ assigneeId: 'm1', _count: { _all: 4 } }],
    });

    const rows = await getManagerLoad(db, { companyId: 'c1' });

    expect(rows).toEqual([
      {
        managerId: 'm1',
        managerName: 'Иванов',
        orders: 3,
        tasks: 5,
        overdueTasks: 2,
        dialogs: 4,
      },
      // Менеджер без единой строки показывается нулями, а не пропадает.
      {
        managerId: 'm2',
        managerName: 'Петров',
        orders: 0,
        tasks: 0,
        overdueTasks: 0,
        dialogs: 0,
      },
    ]);

    // Четыре группировки на компанию — не по запросу на человека (`У-248`).
    expect(calls).toHaveLength(4);
  });

  it('уволенный остаётся с пометкой; без имени показывается почта', async () => {
    const { db } = makeDb({
      managers: [{ id: 'm3', name: '', email: 'byv@x.ru', isActive: false }],
    });

    const rows = await getManagerLoad(db, { companyId: 'c1' });

    expect(rows[0]?.managerName).toBe('byv@x.ru (не работает)');
  });

  it('просроченность считается от переданного момента, а не от часов машины', async () => {
    const now = new Date('2026-09-20T09:00:00.000Z');
    const { db, calls } = makeDb({
      managers: [{ id: 'm1', name: 'Иванов', email: 'i@x.ru', isActive: true }],
    });

    await getManagerLoad(db, { companyId: 'c1', now });

    // Прогон сопровождения №36 (`Р-М-3`): граница — начало московских суток
    // «сегодня», а не сам момент. Прежнее `dueDate: { lt: now }` закрепляло
    // дефект: задача со сроком «20.09» из формы (полночь UTC = 03:00 МСК)
    // считалась просроченной уже 20.09 — в сам день срока.
    const overdue = calls.find((c) => c.model === 'taskAssignee.overdue');
    expect(overdue?.where).toMatchObject({
      task: {
        companyId: 'c1',
        status: { not: 'done' },
        dueDate: { lt: new Date('2026-09-20T00:00:00+03:00') },
      },
    });
  });

  it('срок просрочен, только когда закончился его московский день (прогон №36)', async () => {
    async function overdueBoundary(now: Date): Promise<Date> {
      const { db, calls } = makeDb({
        managers: [{ id: 'm1', name: 'Иванов', email: 'i@x.ru', isActive: true }],
      });
      await getManagerLoad(db, { companyId: 'c1', now });
      return (
        calls.find((c) => c.model === 'taskAssignee.overdue')?.where as {
          task: { dueDate: { lt: Date } };
        }
      ).task.dueDate.lt;
    }
    // Срок из формы задачи — `new Date(<input type="date">)`, полночь UTC.
    // Поздно вечером 20.09 по Москве он ещё не просрочен (прежнее «< now»
    // считало его просроченным с 03:00 МСК), а вчерашний — просрочен.
    const evening = await overdueBoundary(new Date('2026-09-20T23:30:00+03:00'));
    expect(new Date('2026-09-20') < evening).toBe(false);
    expect(new Date('2026-09-19') < evening).toBe(true);
    // Срок из Битрикс24 «21.09 01:30 МСК» (= 20.09 22:30 UTC) в 02:00 МСК 21.09
    // (сервер ещё в 20.09) — сегодняшний, не просрочен; а срок «20.09» — уже да.
    const night = await overdueBoundary(new Date('2026-09-21T02:00:00+03:00'));
    expect(new Date('2026-09-21T01:30:00+03:00') < night).toBe(false);
    expect(new Date('2026-09-20') < night).toBe(true);
  });
});
