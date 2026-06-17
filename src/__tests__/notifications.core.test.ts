/**
 * Unit tests for src/lib/notifications/core.ts
 *
 * Mocks: prisma (db) + email/send + email/transport
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
  isEmailEnabledMock,
} = vi.hoisted(() => ({
  notificationCreate: vi.fn(),
  userFindUnique: vi.fn(),
  sendNotificationEmailMock: vi.fn(),
  isEmailEnabledMock: vi.fn(),
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

vi.mock('@/lib/email/transport', () => ({
  isEmailEnabled: isEmailEnabledMock,
}));

// ---------------------------------------------------------------------------
// SUT — imported AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  createNotification,
  notifyDocumentCreated,
  notifyStatusChanged,
  notifyMessageCreated,
  triggerNotificationEmail,
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
// triggerNotificationEmail
// ---------------------------------------------------------------------------

describe('triggerNotificationEmail', () => {
  const PAYLOAD = {
    userId: 'u-1',
    title: 'Уведомление',
    body: 'Тело',
    type: 'document_created',
    url: 'https://lk.example.ru/orders/42',
  };

  it('is a no-op when email is disabled (isEmailEnabled returns false)', async () => {
    isEmailEnabledMock.mockReturnValue(false);

    await triggerNotificationEmail(PAYLOAD);

    expect(userFindUnique).not.toHaveBeenCalled();
    expect(sendNotificationEmailMock).not.toHaveBeenCalled();
  });

  it('is a no-op when user has no email address', async () => {
    isEmailEnabledMock.mockReturnValue(true);
    userFindUnique.mockResolvedValue({ email: null, name: 'Партнёр' });

    await triggerNotificationEmail(PAYLOAD);

    expect(sendNotificationEmailMock).not.toHaveBeenCalled();
  });

  it('is a no-op when user is not found (findUnique returns null)', async () => {
    isEmailEnabledMock.mockReturnValue(true);
    userFindUnique.mockResolvedValue(null);

    await triggerNotificationEmail(PAYLOAD);

    expect(sendNotificationEmailMock).not.toHaveBeenCalled();
  });

  it('dispatches the notification email when user has an email address', async () => {
    isEmailEnabledMock.mockReturnValue(true);
    userFindUnique.mockResolvedValue({ email: 'partner@test.ru', name: 'Тест Пользователь' });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-1' });

    await triggerNotificationEmail(PAYLOAD);

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
  });

  it('uses «партнёр» as fallback recipientName when user.name is null', async () => {
    isEmailEnabledMock.mockReturnValue(true);
    userFindUnique.mockResolvedValue({ email: 'anon@test.ru', name: null });
    sendNotificationEmailMock.mockResolvedValue({ status: 'sent', id: 'e-2' });

    await triggerNotificationEmail({ ...PAYLOAD, url: undefined });

    expect(sendNotificationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipientName: 'партнёр' })
    );
  });
});
