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
    // Прогон сопровождения №36 (`Р-М-3`): граница — 00:00 МСК «сегодня» (NOW =
    // 15.09 15:00 МСК). Прежнее `{ lt: NOW }` закрепляло дефект: задача со
    // сроком «15.09» из формы (полночь UTC) попадала в блок в сам день срока.
    expect(where.AND[1]).toEqual({
      status: { not: 'done' },
      dueDate: { lt: new Date('2026-09-15T00:00:00+03:00') },
    });
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

  it('первый день просрочки — это ОДИН день, а не ноль', async () => {
    // «Просрочена на 0 дней» выглядит как ошибка счёта. Прогон №36: прежний
    // пример («срок сегодня в 09:00 UTC») закреплял дефект — задача со сроком
    // сегодня вообще не просрочена, пока идёт её московский день. Первый день
    // просрочки — следующий: срок «14.09» из формы (полночь UTC) в 00:30 МСК
    // 15.09 (сервер ещё в 14.09, 21:30 UTC) просрочен на 1 день; прежняя
    // формула «полные сутки с момента срока» давала 0 и подпирала его max(1).
    findMany.mockResolvedValue([
      { id: 't1', title: 'Вчерашняя', dueDate: new Date('2026-09-14'), assignees: [] },
    ]);
    const res = await listOverdueTasks(prisma, leader, new Date('2026-09-15T00:30:00+03:00'));
    expect(res.rows[0]?.overdueDays).toBe(1);
    expect(res.rows[0]?.assigneeNames).toEqual([]);
  });

  it('дни просрочки — московские календарные, в любой час суток (прогон №36)', async () => {
    const days = async (due: Date, now: Date) => {
      findMany.mockResolvedValue([{ id: 't', title: 'T', dueDate: due, assignees: [] }]);
      return (await listOverdueTasks(prisma, leader, now)).rows[0]?.overdueDays;
    };
    // Срок «10.09» из формы 15.09 просрочен на 5 дней и в 00:30, и в 23:30 МСК.
    // Прежняя формула до 03:00 МСК давала 4.
    expect(await days(new Date('2026-09-10'), new Date('2026-09-15T00:30:00+03:00'))).toBe(5);
    expect(await days(new Date('2026-09-10'), new Date('2026-09-15T23:30:00+03:00'))).toBe(5);
    // Срок из Битрикс24 «11.09 01:30 МСК» (10.09 22:30 UTC) — его день 11.09,
    // значит 15.09 просрочен на 4 дня и в 00:30 МСК (прежние «полные сутки
    // с момента срока» давали 3), и днём.
    const BITRIX_DUE = new Date('2026-09-11T01:30:00+03:00');
    expect(await days(BITRIX_DUE, new Date('2026-09-15T00:30:00+03:00'))).toBe(4);
    expect(await days(BITRIX_DUE, NOW)).toBe(4);
  });
});

describe('охват профиля', () => {
  it('у сотрудника с суженным охватом выборка сужается ТОЖЕ', async () => {
    // Профиль «только свои» — самый опасный случай: без учёта охвата блок на
    // главной показал бы руководителю чужие задачи.
    const узкий = { ...leader, accessProfile: { tasks: 'own' } } as unknown as SessionPayload;
    await listOverdueTasks(prisma, узкий, NOW);
    const where = findMany.mock.calls[0][0].where;
    expect(where.AND).toHaveLength(2);
    // Первая часть — охват; вторая по-прежнему про просрочку.
    expect(where.AND[1]).toEqual({
      status: { not: 'done' },
      dueDate: { lt: new Date('2026-09-15T00:00:00+03:00') },
    });
    expect(JSON.stringify(where.AND[0])).not.toBe('{}');
  });
});
