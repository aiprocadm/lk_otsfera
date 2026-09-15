import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { createNotification, deliverNotificationToUser } = vi.hoisted(() => ({
  createNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
  deliverNotificationToUser: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ createNotification, deliverNotificationToUser }));

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, warn: vi.fn(), info: vi.fn() } }));

import { runTaskOverdue } from '@/worker/processors/sla-escalation';

/**
 * СТРАЖ `У-225`: просроченная задача напоминает о себе ДВАЖДЫ и в разные дни —
 * исполнителю сразу, руководителю на N-й день, — и каждое напоминание ровно
 * один раз.
 *
 * Почему два поля, а не одно. Одно поле умеет сказать только «уже уведомляли»;
 * два разных повода в разные дни им не выражаются. Считать «который раз» по
 * датам на каждом прогоне — значит читать всю таблицу задач, ровно то, от чего
 * уходили в прогоне сопровождения №26.
 *
 * Почему claim атомарный. Ночной прогон может пойти дважды (ретрай очереди,
 * перезапуск воркера). `updateMany` по `null` возвращает 0, если строку уже
 * занял параллельный проход, — и тогда второе письмо не уходит. Проверка
 * «сначала прочитали, потом записали» такой гонки не выдержала бы.
 *
 * Мутация (проверено 15.09.2026): склеить два поля в одно (эскалация пишет и
 * проверяет `overdueNotifiedAt`) → руководитель перестаёт получать напоминание,
 * тест краснеет.
 */

const companyFindMany = vi.fn();
const taskFindMany = vi.fn();
const taskUpdateMany = vi.fn();

const prisma = {
  company: { findMany: companyFindMany },
  task: { findMany: taskFindMany, updateMany: taskUpdateMany },
} as unknown as PrismaClient;

const NOW = new Date('2026-09-15T09:00:00Z');

const COMPANY = {
  id: 'co-1',
  slaResponseHours: 24,
  taskOverdueEscalationDays: 3,
  users: [{ id: 'boss' }],
};

const TASK = {
  id: 't1',
  title: 'Проверить документы',
  dueDate: new Date('2026-09-10T09:00:00Z'),
  createdById: 'creator',
  assignees: [{ userId: 'worker' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  companyFindMany.mockResolvedValue([COMPANY]);
  taskUpdateMany.mockResolvedValue({ count: 1 });
  // `mockReset`, а не только `clearAllMocks`: очередь `mockResolvedValueOnce`
  // переживает очистку истории вызовов. Тест, у которого второй ответ не был
  // израсходован (эскалация не запускалась), отдавал свой остаток СЛЕДУЮЩЕМУ
  // тесту — и тот молча получал чужие данные.
  taskFindMany.mockReset();
  taskFindMany.mockResolvedValue([]);
});

/** Первый вызов findMany — исполнителям, второй — эскалация руководителю. */
function tasks(forAssignees: unknown[], forLeaders: unknown[]) {
  let call = 0;
  taskFindMany.mockImplementation(() => Promise.resolve(call++ === 0 ? forAssignees : forLeaders));
}

describe('страж: просрочка напоминает дважды и в разные дни', () => {
  it('исполнителю — в день просрочки, по своему полю-claim', async () => {
    tasks([TASK], []);
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.notified).toBe(1);

    // Выборка ищет незакрытые просроченные с ПУСТЫМ полем первого напоминания.
    const where = taskFindMany.mock.calls[0][0].where;
    expect(where.overdueNotifiedAt).toBeNull();
    expect(where.status).toEqual({ not: 'done' });
    // Claim — атомарный: условие повторяет `null`, а не полагается на выборку.
    expect(taskUpdateMany.mock.calls[0][0]).toEqual({
      where: { id: 't1', overdueNotifiedAt: null },
      data: { overdueNotifiedAt: NOW },
    });
    expect(createNotification.mock.calls[0][0].userId).toBe('worker');
    expect(createNotification.mock.calls[0][0].type).toBe('task_overdue');
  });

  it('РУКОВОДИТЕЛЮ — на N-й день, по ДРУГОМУ полю-claim', async () => {
    tasks([], [{ id: 't1', title: 'Проверить документы', dueDate: TASK.dueDate }]);
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.escalated).toBe(1);

    const where = taskFindMany.mock.calls[1][0].where;
    // Поле ДРУГОЕ — иначе второе напоминание никогда бы не ушло.
    expect(where.overdueEscalatedAt).toBeNull();
    // И порог другой: не «просрочена», а «просрочена дольше трёх дней».
    const deadline = where.dueDate.lt as Date;
    expect(Math.round((NOW.getTime() - deadline.getTime()) / 86_400_000)).toBe(3);
    expect(taskUpdateMany.mock.calls[0][0].data).toEqual({ overdueEscalatedAt: NOW });
    expect(createNotification.mock.calls[0][0].userId).toBe('boss');
  });

  it('ПОВТОРНЫЙ прогон ничего не шлёт: claim занят параллельным проходом', async () => {
    tasks([TASK], []);
    taskUpdateMany.mockResolvedValue({ count: 0 });
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.notified).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('задача без исполнителей напоминает СОЗДАТЕЛЮ, а не молчит', async () => {
    tasks([{ ...TASK, assignees: [] }], []);
    await runTaskOverdue(prisma, NOW);
    expect(createNotification.mock.calls[0][0].userId).toBe('creator');
  });

  it('порог 0 — компания выключила эскалацию: руководителя не тревожим', async () => {
    companyFindMany.mockResolvedValue([{ ...COMPANY, taskOverdueEscalationDays: 0 }]);
    tasks([], [TASK]);
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.escalated).toBe(0);
    // Второй выборки не было вовсе — лишний запрос к базе тоже цена.
    expect(taskFindMany).toHaveBeenCalledTimes(1);
  });

  it('в компании нет руководителей — эскалация не запускается', async () => {
    companyFindMany.mockResolvedValue([{ ...COMPANY, users: [] }]);
    tasks([], [TASK]);
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.escalated).toBe(0);
    expect(taskFindMany).toHaveBeenCalledTimes(1);
  });

  it('сбой доставки одному получателю не отменяет claim и не роняет прогон', async () => {
    tasks([{ ...TASK, assignees: [{ userId: 'a' }, { userId: 'b' }] }], []);
    createNotification.mockRejectedValueOnce(new Error('почта легла'));
    const res = await runTaskOverdue(prisma, NOW);
    expect(res.notified).toBe(1);
    expect(logError).toHaveBeenCalled();
    // Второму получателю письмо всё равно ушло.
    expect(deliverNotificationToUser).toHaveBeenCalledTimes(1);
  });

  it('обе половины считаются независимо и обе попадают в итог', async () => {
    tasks([TASK], [{ id: 't2', title: 'Старая', dueDate: TASK.dueDate }]);
    const res = await runTaskOverdue(prisma, NOW);
    expect(res).toEqual({ notified: 1, escalated: 1 });
  });
});
