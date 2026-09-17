import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('@/lib/email/send', () => ({
  sendManagerDocumentUploadedByOrgEmail: vi.fn(),
  sendManagerDocumentUploadedByPartnerEmail: vi.fn(),
  sendManagerCommentFromOrgEmail: vi.fn(),
  sendManagerOrderMarkedPaidBy1CEmail: vi.fn(),
  sendManagerOrderStatusChangedEmail: vi.fn(),
  sendNotificationEmail: sendNotification,
}));
vi.mock('@/lib/telegram/client', () => ({
  isTelegramEnabled: vi.fn().mockReturnValue(false),
  sendTelegramMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

import { notifyManagersMessengerMessage } from '@/lib/notifications/manager';

/**
 * Уведомление менеджерам о новом сообщении в диалоге мессенджера (спека
 * 2026-09-12, Р-М-9) — зеркало `notifyManagersOrderLess`: получатели —
 * закреплённые за организацией, ссылка в диалог, общий шаблон письма.
 */
function makeDb(managers: unknown[], assigned: { userId: string }[]) {
  const createFn = vi.fn().mockResolvedValue({ id: 'n1' });
  // Единая точка `recordNotification` (`У-231`): для сообщений повтор не
  // ищется (`noDedup`), но таблица фейка честно умеет всё, что зовёт ядро.
  const findFirst = vi.fn().mockResolvedValue(null);
  const userFindMany = vi.fn().mockResolvedValue(managers);
  return {
    db: {
      organizationManager: { findMany: vi.fn().mockResolvedValue(assigned) },
      user: { findMany: userFindMany },
      notification: { create: createFn, findFirst, update: vi.fn() },
    } as never,
    createFn,
    findFirst,
    userFindMany,
  };
}

// Роль получателя обязательна: по ней таблица маршрутов строит ссылку (`Р-Э5-7`).
const MARIA = { id: 'm1', email: 'm@x.ru', name: 'Мария', role: 'manager' };

const INPUT = {
  organizationId: 'org1',
  dialogId: 'd1',
  peerLabel: 'Иван Петров',
  channelLabel: 'Telegram',
  excerpt: 'нужен счёт',
};

describe('notifyManagersMessengerMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('пишет уведомление со ссылкой в диалог и шлёт письмо закреплённым менеджерам', async () => {
    sendNotification.mockResolvedValue({ status: 'sent', id: 'e1' });
    const { db, createFn, findFirst } = makeDb([MARIA], [{ userId: 'm1' }]);

    const r = await notifyManagersMessengerMessage(db, INPUT);

    expect(r).toEqual({ recipientsNotified: 1, emailsSent: 1, emailsSkipped: 0 });
    expect(createFn).toHaveBeenCalledOnce();
    const row = createFn.mock.calls[0][0].data;
    expect(row).toMatchObject({
      userId: 'm1',
      type: 'messenger_message',
      title: 'Новое сообщение в Telegram от Иван Петров',
      body: 'нужен счёт',
      entityId: 'd1',
    });
    // `Р-Э5-7`: в строке только идентификатор диалога — адрес считается по роли.
    expect(row.meta).toEqual({ dialogId: 'd1' });
    // Сообщения — `noDedup`: каждое важно само по себе, повтор не ищется.
    expect(findFirst).not.toHaveBeenCalled();
    // А в письме адрес есть — и ведёт в сам диалог.
    expect(sendNotification).toHaveBeenCalledOnce();
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'm@x.ru',
        url: expect.stringMatching(/\/manager\/messengers\/d1$/),
      })
    );
  });

  it('некому слать → нулевая сводка без записи', async () => {
    const { db, createFn } = makeDb([], []);
    expect(await notifyManagersMessengerMessage(db, INPUT)).toEqual({
      recipientsNotified: 0,
      emailsSent: 0,
      emailsSkipped: 0,
    });
    expect(createFn).not.toHaveBeenCalled();
  });

  it('excludeUserId убирает автора из получателей; без почты — письмо пропущено', async () => {
    sendNotification.mockResolvedValue({ status: 'skipped' });
    const { db, userFindMany } = makeDb(
      [{ id: 'm2', email: null, name: 'Без почты', role: 'manager' }],
      [{ userId: 'm1' }, { userId: 'm2' }]
    );
    const r = await notifyManagersMessengerMessage(db, INPUT, { excludeUserId: 'm1' });
    expect(r).toEqual({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 1 });
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['m2'] } }) })
    );
  });

  it('ответственный сам написал (excludeUserId = assigneeId) → откат на менеджеров организации', async () => {
    sendNotification.mockResolvedValue({ status: 'sent', id: 'e1' });
    const { db, userFindMany } = makeDb(
      [{ id: 'm2', email: 'b@x.ru', name: 'Борис', role: 'manager' }],
      [{ userId: 'm1' }, { userId: 'm2' }]
    );
    const r = await notifyManagersMessengerMessage(
      db,
      { ...INPUT, assigneeId: 'm1' },
      { excludeUserId: 'm1' }
    );
    // Ветка ответственного вернула пусто без запроса в базу — адресаты из организации.
    expect(r.recipientsNotified).toBe(1);
    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['m2'] } }) })
    );
  });
});
