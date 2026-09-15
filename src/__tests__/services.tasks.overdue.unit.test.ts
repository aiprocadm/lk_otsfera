import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listOverdueTasks, OVERDUE_BLOCK_CAP } from '@/lib/services/tasks/overdue';

/**
 * Блок «Просроченные задачи» на главной руководителя (`У-225`).
 *
 * До этого просрочка жила одной цифрой в «Моём дне» менеджера — у руководителя
 * её не было вовсе. Здесь проверяется, что блок показывает СВОИ задачи (охват
 * профиля, а не «все подряд»), самые старые первыми и с честным числом дней.
 */

const findMany = vi.fn();
const count = vi.fn();
const prisma = { task: { findMany, count } } as unknown as PrismaClient;

const NOW = new Date('2026-09-15T12:00:00Z');
const leader = { sub: 'boss', role: 'leader', companyId: 'co-1' } as SessionPayload;

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
});

describe('listOverdueTasks', () => {
  it('без компании — пусто, база не спрашивается', async () => {
    const res = await listOverdueTasks(
      prisma,
      { ...leader, companyId: null } as SessionPayload,
      NOW
    );
    expect(res).toEqual({ rows: [], total: 0 });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('берёт незакрытые с прошедшим сроком, поверх охвата профиля', async () => {
    await listOverdueTasks(prisma, leader, NOW);
    const where = findMany.mock.calls[0][0].where;
    // Две части: охват задач роли И собственно просрочка. Убрать первую значило
    // бы показать руководителю с суженным охватом чужие задачи.
    expect(where.AND).toHaveLength(2);
    expect(where.AND[1]).toEqual({ status: { not: 'done' }, dueDate: { lt: NOW } });
    // Счётчик считается по ТОМУ ЖЕ условию — иначе «показать все (N)» врёт.
    expect(count.mock.calls[0][0].where).toEqual(where);
  });

  it('САМЫЕ СТАРЫЕ первыми — они и есть проблема', async () => {
    await listOverdueTasks(prisma, leader, NOW);
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ dueDate: 'asc' }, { id: 'asc' }]);
    expect(findMany.mock.calls[0][0].take).toBe(OVERDUE_BLOCK_CAP);
  });

  it('считает дни просрочки и показывает исполнителей', async () => {
    findMany.mockResolvedValue([
      {
        id: 't1',
        title: 'Проверить документы',
        dueDate: new Date('2026-09-10T12:00:00Z'),
        assignees: [{ user: { name: 'Иван' } }, { user: { name: 'Пётр' } }],
      },
    ]);
    count.mockResolvedValue(12);
    const res = await listOverdueTasks(prisma, leader, NOW);
    expect(res.total).toBe(12);
    expect(res.rows[0]).toMatchObject({
      id: 't1',
      title: 'Проверить документы',
      overdueDays: 5,
      assigneeNames: ['Иван', 'Пётр'],
    });
  });

  it('просрочка меньше суток — это ОДИН день, а не ноль', async () => {
    // «Просрочена на 0 дней» выглядит как ошибка счёта.
    findMany.mockResolvedValue([
      {
        id: 't1',
        title: 'Сегодняшняя',
        dueDate: new Date('2026-09-15T09:00:00Z'),
        assignees: [],
      },
    ]);
    const res = await listOverdueTasks(prisma, leader, NOW);
    expect(res.rows[0]?.overdueDays).toBe(1);
    expect(res.rows[0]?.assigneeNames).toEqual([]);
  });
});
