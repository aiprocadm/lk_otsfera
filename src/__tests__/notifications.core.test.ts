/**
 * Unit tests for src/lib/notifications/core.ts
 *
 * Mocks: prisma (db) + email/send + telegram/client
 * None of these tests need a live Postgres — purely unit.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  notificationCreate,
  userFindUnique,
  sendNotificationEmailMock,
  isTelegramEnabledMock,
  sendTelegramMessageMock,
} = vi.hoisted(() => ({
  notificationCreate: vi.fn(),
  userFindUnique: vi.fn(),
  sendNotificationEmailMock: vi.fn(),
  isTelegramEnabledMock: vi.fn(),
  sendTelegramMessageMock: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    notification: { create: notificationCreate },
    user: { findUnique: userFindUnique },
  },
}));

vi.mock('@/lib/email/send', () => ({
  sendNotificationEmail: sendNotificationEmailMock,
}));

vi.mock('@/lib/telegram/client', () => ({
  isTelegramEnabled: isTelegramEnabledMock,
  sendTelegramMessage: sendTelegramMessageMock,
}));

// ---------------------------------------------------------------------------
// SUT — imported AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  createNotification,
  notifyDocumentCreated,
  notifyStatusChanged,
  notifyMessageCreated,
  deliverNotificationToUser,
} from '@/lib/notifications/core';
// Import via barrel (src/lib/notifications/index.ts) to ensure coverage instruments it.
// The barrel is a pure re-export module; importing it is sufficient to hit its branch.
import { createNotification as createNotificationViaBarrel } from '@/lib/notifications';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.clearAllMocks();
});

const BASE_INPUT = {
  userId: 'u-1',
  organizationId: 'org-1',
  partnerId: null,
  title: 'Test title',
  body: 'Test body',
} as const;

// ---------------------------------------------------------------------------
// createNotification
// ---------------------------------------------------------------------------

describe('createNotification', () => {
  it('calls prisma.notification.create with JsonNull when meta is undefined', async () => {
    const fakeRow = { id: 'n-1' };
    notificationCreate.mockResolvedValue(fakeRow);

    const result = await createNotification({
      ...BASE_INPUT,
      type: 'document_created',
      meta: null,
    });

    expect(notificationCreate).toHaveBeenCalledOnce();
    const callData = notificationCreate.mock.calls[0][0].data;
    // meta: null → Prisma.JsonNull (sentinel object, not plain null)
    expect(callData.meta).not.toBe(null);
    expect(callData.type).toBe('document_created');
    expect(result).toBe(fakeRow);
  });

  it('passes a non-null meta object as InputJsonValue', async () => {
    const fakeRow = { id: 'n-2' };
    notificationCreate.mockResolvedValue(fakeRow);
    const meta = { key: 'value' };

    await createNotification({ ...BASE_INPUT, type: 'status_changed', meta });

    const callData = notificationCreate.mock.calls[0][0].data;
    expect(callData.meta).toBe(meta);
  });
});

// ---------------------------------------------------------------------------
// Barrel re-export coverage (notifications/index.ts)
// ---------------------------------------------------------------------------

describe('notifications barrel (index.ts)', () => {
  it('createNotification imported via barrel is the same function as the named export', async () => {
    // Both imports resolve to the same function — verifying the barrel re-exports correctly.
    expect(createNotificationViaBarrel).toBe(createNotification);
  });
});

// ---------------------------------------------------------------------------
// Type-specific wrappers
// ---------------------------------------------------------------------------

describe('notifyDocumentCreated', () => {
  it('delegates to createNotification with type=document_created', async () => {
    notificationCreate.mockResolvedValue({ id: 'n-3' });
    const params = { ...BASE_INPUT, meta: null };
    await notifyDocumentCreated(params);

    const callData = notificationCreate.mock.calls[0][0].data;
    expect(callData.type).toBe('document_created');
    expect(callData.userId).toBe('u-1');
  });
});

describe('notifyStatusChanged', () => {
  it('delegates to createNotification with type=status_changed', async () => {
    notificationCreate.mockResolvedValue({ id: 'n-4' });
    await notifyStatusChanged({ ...BASE_INPUT, meta: undefined });

    const callData = notificationCreate.mock.calls[0][0].data;
    expect(callData.type).toBe('status_changed');
  });
});

describe('notifyMessageCreated', () => {
  it('delegates to createNotification with type=message_created', async () => {
    notificationCreate.mockResolvedValue({ id: 'n-5' });
    await notifyMessageCreated({ ...BASE_INPUT });

    const callData = notificationCreate.mock.calls[0][0].data;
    expect(callData.type).toBe('message_created');
  });
});

// ---------------------------------------------------------------------------
// deliverNotificationToUser (D1 — замена triggerNotificationEmail/Telegram)
// ---------------------------------------------------------------------------

describe('deliverNotificationToUser', () => {
  const PAYLOAD = {
    userId: 'u-1',
    title: 'Уведомление',
    body: 'Тело',
    type: 'document_created',
    url: 'https://lk.example.ru/orders/42',
  };

  function mockUser(overrides: Record<string, unknown> = {}) {
    userFindUnique.mockResolvedValue({
      id: 'u-1',
      email: 'partner@test.ru',
      name: 'Тест Пользователь',
      telegramChatId: null,
      maxChatId: null,
      whatsappPhone: null,
      notificationChannels: null,
      ...overrides,
    });
  }

  it('загружает получателя узким канальным select-ом', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser();
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-1' });

    await deliverNotificationToUser(PAYLOAD);

    expect(userFindUnique).toHaveBeenCalledWith({
      where: { id: PAYLOAD.userId },
      select: {
        id: true,
        email: true,
        name: true,
        telegramChatId: true,
        maxChatId: true,
        whatsappPhone: true,
        notificationChannels: true,
      },
    });
  });

  it('пользователь не найден → пустой результат, каналы не вызываются', async () => {
    userFindUnique.mockResolvedValue(null);

    const results = await deliverNotificationToUser(PAYLOAD);

    expect(results).toEqual({});
    expect(sendNotificationEmailMock).not.toHaveBeenCalled();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('шлёт generic-email с recipientName из user.name', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser();
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-1' });

    const results = await deliverNotificationToUser(PAYLOAD);

    expect(sendNotificationEmailMock).toHaveBeenCalledOnce();
    expect(sendNotificationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'partner@test.ru',
        recipientName: 'Тест Пользователь',
        title: PAYLOAD.title,
        body: PAYLOAD.body,
        url: PAYLOAD.url,
      })
    );
    expect(results.email).toEqual({ status: 'sent' });
  });

  it('fallback recipientName «партнёр», когда user.name пуст', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser({ name: null, email: 'anon@test.ru' });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-2' });

    await deliverNotificationToUser({ ...PAYLOAD, url: undefined });

    expect(sendNotificationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipientName: 'партнёр' })
    );
  });

  it('выключенный email-пайплайн → канал возвращает skipped (гейт внутри send())', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser();
    sendNotificationEmailMock.mockResolvedValue({ status: 'skipped', reason: 'disabled' });

    const results = await deliverNotificationToUser(PAYLOAD);

    expect(results.email).toEqual({ status: 'skipped', reason: 'disabled' });
  });

  it('Telegram выключен (env) → sendTelegramMessage не вызывается', async () => {
    isTelegramEnabledMock.mockReturnValue(false);
    mockUser({ telegramChatId: '123456789' });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-3' });

    const results = await deliverNotificationToUser(PAYLOAD);

    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(results.telegram).toBeUndefined();
  });

  it('Telegram включён, чата нет → канал пропущен', async () => {
    isTelegramEnabledMock.mockReturnValue(true);
    mockUser({ telegramChatId: null });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-4' });

    const results = await deliverNotificationToUser(PAYLOAD);

    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(results.telegram).toBeUndefined();
  });

  it('Telegram включён и привязан → шлёт "title\\n\\nbody" в чат', async () => {
    isTelegramEnabledMock.mockReturnValue(true);
    mockUser({ telegramChatId: '123456789' });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-5' });
    sendTelegramMessageMock.mockResolvedValue({ ok: true });

    const results = await deliverNotificationToUser(PAYLOAD);

    expect(sendTelegramMessageMock).toHaveBeenCalledOnce();
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      '123456789',
      `${PAYLOAD.title}\n\n${PAYLOAD.body}`
    );
    expect(results.telegram).toEqual({ status: 'sent' });
  });

  it('channels: ["email"] сужает веер — Telegram не трогается даже при привязке', async () => {
    isTelegramEnabledMock.mockReturnValue(true);
    mockUser({ telegramChatId: '123456789' });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-6' });

    const results = await deliverNotificationToUser({ ...PAYLOAD, channels: ['email'] });

    expect(sendNotificationEmailMock).toHaveBeenCalledOnce();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(results.telegram).toBeUndefined();
  });
});
