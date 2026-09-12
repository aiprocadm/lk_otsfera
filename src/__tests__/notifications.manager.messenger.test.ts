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
  const userFindMany = vi.fn().mockResolvedValue(managers);
  return {
    db: {
      organizationManager: { findMany: vi.fn().mockResolvedValue(assigned) },
      user: { findMany: userFindMany },
      notification: { create: createFn },
    } as never,
    createFn,
    userFindMany,
  };
}

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
    const { db, createFn } = makeDb(
      [{ id: 'm1', email: 'm@x.ru', name: 'Мария' }],
      [{ userId: 'm1' }]
    );

    const r = await notifyManagersMessengerMessage(db, INPUT);

    expect(r).toEqual({ recipientsNotified: 1, emailsSent: 1, emailsSkipped: 0 });
    expect(createFn).toHaveBeenCalledOnce();
    const row = createFn.mock.calls[0][0].data;
    expect(row).toMatchObject({
      userId: 'm1',
      type: 'messenger_message',
      title: 'Новое сообщение в Telegram от Иван Петров',
      body: 'нужен счёт',
      meta: { dialogId: 'd1', url: expect.stringContaining('/manager/messengers/d1') },
    });
    expect(sendNotification).toHaveBeenCalledOnce();
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
      [{ id: 'm2', email: null, name: 'Без почты' }],
      [{ userId: 'm1' }, { userId: 'm2' }]
    );
    const r = await notifyManagersMessengerMessage(db, INPUT, { excludeUserId: 'm1' });
    expect(r).toEqual({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 1 });
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['m2'] } }) })
    );
  });
});
