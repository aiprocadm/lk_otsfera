import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 2 ТЗ 13.10.2026 (`У-273`, `У-286`): краевые ветки уведомлений слушателя —
 * пустой список адресатов, повтор в окне дедупа, сбой базы (best-effort §3).
 * Основной путь — на живой базе в services.students.cabinet.integration.test.ts.
 */
const { recordNotification, deliverNotificationToUser, warn } = vi.hoisted(() => ({
  recordNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({
  recordNotification,
  deliverNotificationToUser,
  resolveOrgManagerRecipients: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({ log: { warn } }));

import { notifyStudentsTrainingAssigned } from '@/lib/services/enrollments/notify';
import { runTrainingEndingSoon } from '@/lib/services/training/endingSoon';

beforeEach(() => {
  vi.clearAllMocks();
  recordNotification.mockResolvedValue({ row: { id: 'n1' }, deduped: false });
});

describe('notifyStudentsTrainingAssigned', () => {
  it('без связанных учёток — ни одного запроса', async () => {
    const findMany = vi.fn();
    await notifyStudentsTrainingAssigned(
      { enrollmentRequestItem: { findMany } } as never,
      'E1',
      []
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('повтор в окне дедупа — без второго письма', async () => {
    recordNotification.mockResolvedValue({ row: { id: 'n1' }, deduped: true });
    const prisma = {
      enrollmentRequestItem: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'i1', studentId: 's1', direction: { name: 'ОТ' } }]),
      },
    };
    await notifyStudentsTrainingAssigned(prisma as never, 'E1', [
      { studentId: 's1', userId: 'u1' },
    ]);
    expect(recordNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ userId: 'u1', type: 'training_assigned', entityId: 'i1' })
    );
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
  });

  it('сбой базы — пишем в журнал и не роняем подтверждение', async () => {
    const prisma = {
      enrollmentRequestItem: { findMany: vi.fn().mockRejectedValue(new Error('db down')) },
    };
    await expect(
      notifyStudentsTrainingAssigned(prisma as never, 'E1', [{ studentId: 's1', userId: 'u1' }])
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[enrollments/notify] student notify failed', {
      requestId: 'E1',
      error: 'db down',
    });
    // Не-Error тоже превращается в строку.
    prisma.enrollmentRequestItem.findMany.mockRejectedValue('строка');
    await notifyStudentsTrainingAssigned(prisma as never, 'E1', [
      { studentId: 's1', userId: 'u1' },
    ]);
    expect(warn).toHaveBeenLastCalledWith('[enrollments/notify] student notify failed', {
      requestId: 'E1',
      error: 'строка',
    });
  });
});

describe('runTrainingEndingSoon', () => {
  it('нет обучений в окне — без второго запроса', async () => {
    const prisma = {
      enrollmentRequestItem: { findMany: vi.fn().mockResolvedValue([]) },
      notification: { findMany: vi.fn() },
    };
    expect(await runTrainingEndingSoon(prisma as never, new Date('2026-11-12T07:00:00Z'))).toEqual({
      remindersSent: 0,
    });
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
    // Окно — московские дни с 12.11 по 15.11 включительно, полночь UTC (`@db.Date`).
    expect(prisma.enrollmentRequestItem.findMany.mock.calls[0]![0].where.endsOn).toEqual({
      gte: new Date('2026-11-12T00:00:00.000Z'),
      lte: new Date('2026-11-15T00:00:00.000Z'),
    });
  });

  it('за один день — «через 1 день»', async () => {
    const prisma = {
      enrollmentRequestItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'i1',
            endsOn: new Date('2026-11-13T00:00:00Z'),
            direction: { name: 'ОТ' },
            student: { userId: 'u1' },
          },
        ]),
      },
      notification: { findMany: vi.fn().mockResolvedValue([]) },
    };
    expect(await runTrainingEndingSoon(prisma as never, new Date('2026-11-12T07:00:00Z'))).toEqual({
      remindersSent: 1,
    });
    expect(recordNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'u1',
        body: 'Обучение «ОТ» заканчивается через 1 день. Успейте пройти курс на учебной площадке.',
      })
    );
  });
});
