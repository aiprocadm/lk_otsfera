/**
 * Этап 7 (ФТ-7.2) — notifyTaskAssigned: диф-получатели без самоназначения,
 * graceful degrade (ошибка канала логируется и не пробрасывается); с этапа 5
 * PR-3 (`У-232`) в строке нет адреса кабинета — только `meta.taskId`, ссылку
 * строит таблица маршрутов от роли получателя; ключ дедупа — задача.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordNotification, deliverNotificationToUser, logError } = vi.hoisted(() => ({
  recordNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ recordNotification, deliverNotificationToUser }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, info: vi.fn(), warn: vi.fn() } }));
// Клиент базы уходит первым аргументом в recordNotification; сам он здесь не нужен.
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { notifyTaskAssigned } from '@/lib/services/tasks/notify';

const base = {
  taskId: 't1',
  taskTitle: 'Позвонить клиенту',
  dueDate: null as Date | null,
  actorUserId: 'actor',
};

describe('notifyTaskAssigned', () => {
  beforeEach(() => {
    recordNotification.mockReset().mockResolvedValue({ row: { id: 'n1' }, deduped: false });
    deliverNotificationToUser.mockReset().mockResolvedValue({});
    logError.mockReset();
  });

  it('шлёт уведомление каждому новому исполнителю, кроме автора действия', async () => {
    await notifyTaskAssigned({ ...base, assigneeUserIds: ['u1', 'actor', 'u2'] });

    expect(recordNotification).toHaveBeenCalledTimes(2);
    expect(recordNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'u1',
        type: 'task_assigned',
        title: 'Вам назначена задача',
        body: '«Позвонить клиенту».',
        meta: { taskId: 't1' },
        entityId: 't1',
      })
    );
    expect(deliverNotificationToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        type: 'task_assigned',
        meta: { taskId: 't1' },
        dedupKey: 'n1',
      })
    );
    expect(deliverNotificationToUser.mock.calls[0]![0]).not.toHaveProperty('url');
  });

  it('повтор за час (deduped: true) — строка помечена «×N», доставка не зовётся', async () => {
    recordNotification.mockResolvedValue({ row: { id: 'n1' }, deduped: true });
    await notifyTaskAssigned({ ...base, assigneeUserIds: ['u1'] });
    expect(recordNotification).toHaveBeenCalledTimes(1);
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
  });

  it('дедуплицирует получателей', async () => {
    await notifyTaskAssigned({ ...base, assigneeUserIds: ['u1', 'u1', 'u1'] });
    expect(recordNotification).toHaveBeenCalledTimes(1);
  });

  it('срок попадает в текст, когда dueDate задан', async () => {
    await notifyTaskAssigned({
      ...base,
      dueDate: new Date('2026-08-15T00:00:00Z'),
      assigneeUserIds: ['u1'],
    });
    const body = recordNotification.mock.calls[0]![1].body as string;
    expect(body).toContain('срок до');
    expect(body).toContain('«Позвонить клиенту»');
  });

  it('дата срока в тексте — по Москве (прогон №36)', async () => {
    // Срок из Битрикс24 «16.08 01:30 МСК» адаптер хранит как 15.08 22:30 UTC;
    // сервер в UTC без пояса написал бы «до 15.08» — на день раньше экрана.
    await notifyTaskAssigned({
      ...base,
      dueDate: new Date('2026-08-16T01:30:00+03:00'),
      assigneeUserIds: ['u1'],
    });
    // Срок из формы задачи (`new Date(<input type="date">)`) — свой же день.
    await notifyTaskAssigned({ ...base, dueDate: new Date('2026-08-15'), assigneeUserIds: ['u2'] });
    expect(recordNotification.mock.calls[0]![1].body).toBe(
      '«Позвонить клиенту», срок до 16.08.2026.'
    );
    expect(recordNotification.mock.calls[1]![1].body).toBe(
      '«Позвонить клиенту», срок до 15.08.2026.'
    );
  });

  it('без получателей (только самоназначение) — ни одного вызова', async () => {
    await notifyTaskAssigned({ ...base, assigneeUserIds: ['actor'] });
    await notifyTaskAssigned({ ...base, assigneeUserIds: [] });
    expect(recordNotification).not.toHaveBeenCalled();
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
  });

  it('ошибка доставки логируется и не роняет вызов; остальные получатели обслуживаются', async () => {
    recordNotification
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ row: { id: 'n2' }, deduped: false });

    await expect(
      notifyTaskAssigned({ ...base, assigneeUserIds: ['u1', 'u2'] })
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    expect(deliverNotificationToUser).toHaveBeenCalledTimes(1);
    expect(deliverNotificationToUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u2' })
    );
  });
});
