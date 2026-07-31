/**
 * Этап 7 (ФТ-7.2) — notifyTaskAssigned: диф-получатели без самоназначения,
 * graceful degrade (ошибка канала логируется и не пробрасывается), meta.url.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createNotification, deliverNotificationToUser, logError } = vi.hoisted(() => ({
  createNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ createNotification, deliverNotificationToUser }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, info: vi.fn(), warn: vi.fn() } }));

import { notifyTaskAssigned, TASKS_BOARD_URL } from '@/lib/services/tasks/notify';

const base = {
  taskId: 't1',
  taskTitle: 'Позвонить клиенту',
  dueDate: null as Date | null,
  actorUserId: 'actor',
};

describe('notifyTaskAssigned', () => {
  beforeEach(() => {
    createNotification.mockReset().mockResolvedValue({ id: 'n1' });
    deliverNotificationToUser.mockReset().mockResolvedValue({});
    logError.mockReset();
  });

  it('шлёт уведомление каждому новому исполнителю, кроме автора действия', async () => {
    await notifyTaskAssigned({ ...base, assigneeUserIds: ['u1', 'actor', 'u2'] });

    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        type: 'task_assigned',
        title: 'Вам назначена задача',
        body: '«Позвонить клиенту».',
        meta: { taskId: 't1', url: TASKS_BOARD_URL },
      })
    );
    expect(deliverNotificationToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        type: 'task_assigned',
        url: TASKS_BOARD_URL,
        dedupKey: 'n1',
      })
    );
  });

  it('дедуплицирует получателей', async () => {
    await notifyTaskAssigned({ ...base, assigneeUserIds: ['u1', 'u1', 'u1'] });
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('срок попадает в текст, когда dueDate задан', async () => {
    await notifyTaskAssigned({
      ...base,
      dueDate: new Date('2026-08-15T00:00:00Z'),
      assigneeUserIds: ['u1'],
    });
    const body = createNotification.mock.calls[0]![0].body as string;
    expect(body).toContain('срок до');
    expect(body).toContain('«Позвонить клиенту»');
  });

  it('без получателей (только самоназначение) — ни одного вызова', async () => {
    await notifyTaskAssigned({ ...base, assigneeUserIds: ['actor'] });
    await notifyTaskAssigned({ ...base, assigneeUserIds: [] });
    expect(createNotification).not.toHaveBeenCalled();
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
  });

  it('ошибка доставки логируется и не роняет вызов; остальные получатели обслуживаются', async () => {
    createNotification
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ id: 'n2' });

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
