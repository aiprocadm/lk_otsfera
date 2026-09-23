/**
 * Этап 7 (ФТ-7.2) — процессор «скоро срок задачи»: горизонт «конец завтра»,
 * атомарный claim dueSoonNotifiedAt (конкурирующий прогон не дублирует),
 * получатели: исполнители или (фолбэк) создатель. Prisma-фейк, unit-слой.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { recordNotification, deliverNotificationToUser } = vi.hoisted(() => ({
  recordNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ recordNotification, deliverNotificationToUser }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { task: { findMany: vi.fn().mockResolvedValue([]) } },
}));

import { runTaskDueSoon, taskDueSoonProcessor } from '@/worker/processors/task-due-soon';

// Прогон сопровождения №36 (`Р-М-3`): моменты — с явным московским поясом.
// Прежние `new Date('2026-07-26T07:00:00')` без пояса читались в зоне
// процесса, и тест проверял ровно то, что было сломано: «конец завтра» в UTC.
// 07:00 МСК — время расписания `notifications.taskDueSoon.cron`.
const NOW = new Date('2026-07-26T07:00:00+03:00');

function makePrisma(tasks: unknown[], claimCount = 1) {
  const findMany = vi.fn().mockResolvedValue(tasks);
  const updateMany = vi.fn().mockResolvedValue({ count: claimCount });
  const prisma = { task: { findMany, updateMany } } as unknown as PrismaClient;
  return { prisma, findMany, updateMany };
}

const TASK = {
  id: 't1',
  title: 'Позвонить',
  // Срок из формы задачи: `new Date(<input type="date">)` — полночь UTC.
  dueDate: new Date('2026-07-27'),
  createdById: 'creator',
  assignees: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u1' }],
};

beforeEach(() => {
  recordNotification.mockReset().mockResolvedValue({ row: { id: 'n1' }, deduped: false });
  deliverNotificationToUser.mockReset().mockResolvedValue({});
});

describe('runTaskDueSoon', () => {
  it('выбирает только неуведомлённые не-done задачи с dueDate ≤ конца завтра', async () => {
    const { prisma, findMany } = makePrisma([]);
    const res = await runTaskDueSoon(prisma, NOW);

    expect(res).toEqual({ notified: 0 });
    const where = findMany.mock.calls[0]![0].where;
    expect(where.status).toEqual({ not: 'done' });
    expect(where.dueSoonNotifiedAt).toBeNull();
    // Горизонт — конец завтрашнего МОСКОВСКОГО дня: до 00:00 МСК послезавтра.
    expect(where.dueDate).toEqual({ not: null, lt: new Date('2026-07-28T00:00:00+03:00') });
  });

  it('«до конца завтра» — по московскому календарю в любой час прогона (прогон №36)', async () => {
    async function pickedAt(now: Date): Promise<(due: Date) => boolean> {
      const { prisma, findMany } = makePrisma([]);
      await runTaskDueSoon(prisma, now);
      const { lt } = findMany.mock.calls[0]![0].where.dueDate as { lt: Date };
      return (due) => due < lt;
    }
    // Утренний прогон 26.07 07:00 МСК. Срок из Битрикс24 «28.07 01:30 МСК»
    // (= 27.07 22:30 UTC) — ПОСЛЕзавтра, не «скоро»; прежний «конец завтра»
    // через `setHours(23, 59, …)` в поясе процесса (UTC) его захватывал.
    const morning = await pickedAt(NOW);
    expect(morning(new Date('2026-07-28T01:30:00+03:00'))).toBe(false);
    // «Завтра 23:59 МСК» (27.07 20:59 UTC) — ещё завтра.
    expect(morning(new Date('2026-07-27T23:59:00+03:00'))).toBe(true);

    // Ночной прогон 26.07 01:30 МСК (сервер в UTC ещё живёт 25.07). Час прогона
    // — не часть правила: задача, догнавшая очередь после простоя воркера,
    // обязана ответить так же, как утренняя. Завтрашний срок из формы (27.07,
    // полночь UTC) — «скоро»; прежний код считал «завтра» от 25.07 и терял его.
    const night = await pickedAt(new Date('2026-07-26T01:30:00+03:00'));
    expect(night(new Date('2026-07-27'))).toBe(true);
    expect(night(new Date('2026-07-28'))).toBe(false);
  });

  it('дата в тексте — по Москве: срок Битрикс24 01:30 МСК не «съезжает» на вчера', async () => {
    // Срок «27.07 01:30 МСК» хранится как 26.07 22:30 UTC (так его отдаёт
    // адаптер Битрикс24: `new Date('2026-07-27T01:30:00+03:00')`).
    const { prisma } = makePrisma([{ ...TASK, dueDate: new Date('2026-07-27T01:30:00+03:00') }]);
    await runTaskDueSoon(prisma, NOW);
    expect(recordNotification.mock.calls[0]![1].body).toBe('«Позвонить» — срок 27.07.2026.');
  });

  it('повтор за час (deduped: true) — строка «×N», доставка не зовётся, задача засчитана', async () => {
    recordNotification.mockResolvedValue({ row: { id: 'n1' }, deduped: true });
    const { prisma } = makePrisma([TASK]);
    const res = await runTaskDueSoon(prisma, NOW);
    expect(res).toEqual({ notified: 1 });
    expect(recordNotification).toHaveBeenCalledTimes(2);
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
  });

  it('claim → уведомления уникальным исполнителям, notified=1', async () => {
    const { prisma, updateMany } = makePrisma([TASK]);
    const res = await runTaskDueSoon(prisma, NOW);

    expect(res).toEqual({ notified: 1 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 't1', dueSoonNotifiedAt: null },
      data: { dueSoonNotifiedAt: NOW },
    });
    // u1 дедуплицирован.
    expect(recordNotification).toHaveBeenCalledTimes(2);
    // `У-232`: адреса кабинета в строке нет — ссылку строит таблица маршрутов
    // по `taskId` от роли получателя; ключ дедупа — задача.
    expect(recordNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'u1',
        type: 'task_due_soon',
        title: 'Скоро срок задачи',
        meta: { taskId: 't1' },
        entityId: 't1',
      })
    );
    expect(deliverNotificationToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        type: 'task_due_soon',
        meta: { taskId: 't1' },
        dedupKey: 'n1',
      })
    );
    expect(deliverNotificationToUser.mock.calls[0]![0]).not.toHaveProperty('url');
    const body = recordNotification.mock.calls[0]![1].body as string;
    expect(body).toContain('«Позвонить»');
    expect(body).toContain('срок');
  });

  it('без исполнителей — фолбэк на создателя', async () => {
    const { prisma } = makePrisma([{ ...TASK, assignees: [] }]);
    await runTaskDueSoon(prisma, NOW);
    expect(recordNotification).toHaveBeenCalledTimes(1);
    expect(recordNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'creator' })
    );
  });

  it('конкурирующий прогон перехватил claim (count=0) → задача пропускается', async () => {
    const { prisma } = makePrisma([TASK], 0);
    const res = await runTaskDueSoon(prisma, NOW);
    expect(res).toEqual({ notified: 0 });
    expect(recordNotification).not.toHaveBeenCalled();
  });
});

describe('taskDueSoonProcessor (BullMQ wrapper)', () => {
  it('работает на глобальном prisma', async () => {
    const res = await taskDueSoonProcessor();
    expect(res).toEqual({ notified: 0 });
  });
});
