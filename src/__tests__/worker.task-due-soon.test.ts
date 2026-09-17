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

const NOW = new Date('2026-07-26T07:00:00');

function makePrisma(tasks: unknown[], claimCount = 1) {
  const findMany = vi.fn().mockResolvedValue(tasks);
  const updateMany = vi.fn().mockResolvedValue({ count: claimCount });
  const prisma = { task: { findMany, updateMany } } as unknown as PrismaClient;
  return { prisma, findMany, updateMany };
}

const TASK = {
  id: 't1',
  title: 'Позвонить',
  dueDate: new Date('2026-07-27T00:00:00'),
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
    // Горизонт — конец завтрашнего дня (23:59:59.999 от NOW+1д).
    const lte: Date = where.dueDate.lte;
    expect(lte.getDate()).toBe(27);
    expect(lte.getHours()).toBe(23);
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
