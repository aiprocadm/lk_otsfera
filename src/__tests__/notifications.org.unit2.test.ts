/**
 * Additional unit tests for src/lib/notifications/org.ts
 *
 * Covers remaining branches not hit by notifications.org.unit.test.ts:
 *  - payment_received notification type
 *  - manager_replied notification type
 *  - order_status_changed with dimension='financial'
 *  - chat_message notification type
 *  - Best-effort email throw → emailsSkipped, no re-throw
 *  - Recipient with no email address → emailsSkipped
 *  - organization not found → zero summary
 *  - organization with no active members → zero summary
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  sendPayment,
  sendManagerReplied,
  sendStatusChanged,
  sendDocPublished,
  sendNotification,
} = vi.hoisted(() => ({
  sendPayment: vi.fn(),
  sendManagerReplied: vi.fn(),
  sendStatusChanged: vi.fn(),
  sendDocPublished: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock('@/lib/email/send', () => ({
  sendOrgPaymentReceivedEmail: sendPayment,
  sendOrgManagerRepliedEmail: sendManagerReplied,
  sendOrgOrderStatusChangedEmail: sendStatusChanged,
  sendOrgDocumentPublishedEmail: sendDocPublished,
  sendNotificationEmail: sendNotification,
}));

vi.mock('@/lib/telegram/client', () => ({
  isTelegramEnabled: vi.fn().mockReturnValue(false),
  sendTelegramMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

import { notifyOrgUsers } from '@/lib/notifications/org';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dbWith(users: Array<{ id: string; email: string | null; telegramChatId?: string | null }>, orgName = 'ООО Орг') {
  const create = vi.fn().mockResolvedValue({});
  const organizationUsers = users.map((u) => ({ user: { telegramChatId: null, ...u } }));
  return {
    db: {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'org-1', name: orgName, organizationUsers }),
      },
      notification: { create },
    } as never,
    create,
  };
}

const ORDER_PAYLOAD_BASE = {
  orderId: 'ord-1',
  orderNumber: '007',
  orderTitle: 'Тест заказ',
};

// ---------------------------------------------------------------------------
// payment_received
// ---------------------------------------------------------------------------

describe('notifyOrgUsers — payment_received', () => {
  it('creates notification with correct title/body and dispatches payment email', async () => {
    sendPayment.mockResolvedValue({ status: 'sent' });
    const { db, create } = dbWith([{ id: 'u1', email: 'a@org.ru' }]);

    const r = await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'payment_received',
      payload: {
        ...ORDER_PAYLOAD_BASE,
        amount: '100 000',
        paidAt: new Date('2026-06-01T00:00:00Z'),
      },
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsSent).toBe(1);
    const row = create.mock.calls[0][0].data;
    expect(row.type).toBe('payment_received');
    expect(row.title).toContain('007');
    expect(row.body).toContain('100 000');
    const meta = row.meta as Record<string, unknown>;
    expect(meta.paidAt).toBe('2026-06-01T00:00:00.000Z');
    expect(sendPayment).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// manager_replied
// ---------------------------------------------------------------------------

describe('notifyOrgUsers — manager_replied', () => {
  it('creates notification with excerpt in body and dispatches manager-replied email', async () => {
    sendManagerReplied.mockResolvedValue({ status: 'sent' });
    const { db, create } = dbWith([{ id: 'u1', email: 'b@org.ru' }]);

    const r = await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'manager_replied',
      payload: {
        ...ORDER_PAYLOAD_BASE,
        commentExcerpt: 'Привет от менеджера',
      },
    });

    expect(r.recipientsNotified).toBe(1);
    const row = create.mock.calls[0][0].data;
    expect(row.type).toBe('manager_replied');
    expect(row.body).toBe('Привет от менеджера');
    expect(sendManagerReplied).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// order_status_changed — financial dimension
// ---------------------------------------------------------------------------

describe('notifyOrgUsers — order_status_changed financial dimension', () => {
  it('uses «Финансы» label in title for financial dimension', async () => {
    sendStatusChanged.mockResolvedValue({ status: 'sent' });
    const { db, create } = dbWith([{ id: 'u1', email: 'c@org.ru' }]);

    await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'order_status_changed',
      payload: {
        ...ORDER_PAYLOAD_BASE,
        dimension: 'financial',
        oldStatus: 'pending',
        newStatus: 'paid',
      },
    });

    const row = create.mock.calls[0][0].data;
    expect(row.title).toContain('Финансы');
    expect(sendStatusChanged).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// order_status_changed — execution dimension (covers the 'Статус' ternary arm)
// ---------------------------------------------------------------------------

describe('notifyOrgUsers — order_status_changed execution dimension', () => {
  it('uses «Статус» label in title for execution dimension', async () => {
    sendStatusChanged.mockResolvedValue({ status: 'sent' });
    const { db, create } = dbWith([{ id: 'u1', email: 'c2@org.ru' }]);

    await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'order_status_changed',
      payload: {
        ...ORDER_PAYLOAD_BASE,
        dimension: 'execution',
        oldStatus: 'pending',
        newStatus: 'active',
      },
    });

    const row = create.mock.calls[0][0].data;
    expect(row.title).toContain('Статус');
    expect(sendStatusChanged).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// chat_message
// ---------------------------------------------------------------------------

describe('notifyOrgUsers — chat_message', () => {
  it('creates chat_message notification and dispatches generic sendNotificationEmail', async () => {
    sendNotification.mockResolvedValue({ status: 'sent' });
    const { db, create } = dbWith([{ id: 'u1', email: 'd@org.ru' }]);

    const r = await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'chat_message',
      payload: {
        ...ORDER_PAYLOAD_BASE,
        excerpt: 'Новое сообщение',
      },
    });

    expect(r.recipientsNotified).toBe(1);
    const row = create.mock.calls[0][0].data;
    expect(row.type).toBe('chat_message');
    expect(row.body).toBe('Новое сообщение');
    expect(sendNotification).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Best-effort failure paths
// ---------------------------------------------------------------------------

describe('notifyOrgUsers — best-effort failure arms', () => {
  it('email dispatch throws → resolves normally, emailsSkipped++, does not re-throw', async () => {
    sendPayment.mockRejectedValue(new Error('SMTP timeout'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, create } = dbWith([{ id: 'u1', email: 'e@org.ru' }]);

    const r = await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'payment_received',
      payload: { ...ORDER_PAYLOAD_BASE, amount: '0', paidAt: new Date() },
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsSent).toBe(0);
    expect(r.emailsSkipped).toBe(1);
    expect(consoleSpy).toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce(); // in-app row still created
    consoleSpy.mockRestore();
  });

  it('email dispatch throws a non-Error value → emailsSkipped, no re-throw (String branch)', async () => {
    sendPayment.mockRejectedValue('string-error'); // throws a string, not an Error
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, create } = dbWith([{ id: 'u-str', email: 'str@org.ru' }]);

    const r = await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'payment_received',
      payload: { ...ORDER_PAYLOAD_BASE, amount: '0', paidAt: new Date() },
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsSkipped).toBe(1);
    expect(consoleSpy).toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });

  it('recipient with no email address → emailsSkipped, no dispatch', async () => {
    const { db, create } = dbWith([{ id: 'u2', email: null }]);

    const r = await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'payment_received',
      payload: { ...ORDER_PAYLOAD_BASE, amount: '0', paidAt: new Date() },
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsSent).toBe(0);
    expect(r.emailsSkipped).toBe(1);
    expect(sendPayment).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('notifyOrgUsers — organization not found', () => {
  it('returns zero summary when org does not exist', async () => {
    const db = {
      organization: { findUnique: vi.fn().mockResolvedValue(null) },
      notification: { create: vi.fn() },
    } as never;

    const r = await notifyOrgUsers(db, {
      organizationId: 'org-missing',
      type: 'payment_received',
      payload: { ...ORDER_PAYLOAD_BASE, amount: '0', paidAt: new Date() },
    });

    expect(r).toEqual({ recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 });
  });

  it('returns zero summary when org has no active members', async () => {
    const { db } = dbWith([]); // no users

    const r = await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'payment_received',
      payload: { ...ORDER_PAYLOAD_BASE, amount: '0', paidAt: new Date() },
    });

    expect(r).toEqual({ recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 });
  });
});
