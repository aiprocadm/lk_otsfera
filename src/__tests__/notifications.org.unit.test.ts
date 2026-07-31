import { describe, it, expect, vi } from 'vitest';

const { sendDocMock } = vi.hoisted(() => ({ sendDocMock: vi.fn() }));
vi.mock('@/lib/email/send', () => ({
  sendOrgDocumentPublishedEmail: sendDocMock,
  sendOrgPaymentReceivedEmail: vi.fn(),
  sendOrgManagerRepliedEmail: vi.fn(),
  sendOrgOrderStatusChangedEmail: vi.fn(),
  sendNotificationEmail: vi.fn(),
}));
vi.mock('@/lib/telegram/client', () => ({
  isTelegramEnabled: vi.fn().mockReturnValue(false),
  sendTelegramMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

import { notifyOrgUsers } from '@/lib/notifications/org';

function dbWith(
  users: Array<{ id: string; email: string | null; telegramChatId?: string | null }>
) {
  const create = vi.fn().mockResolvedValue({});
  const organizationUsers = users.map((u) => ({ user: { telegramChatId: null, ...u } }));
  return {
    db: {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'org-1', name: 'ООО Орг', organizationUsers }),
      },
      notification: { create },
    } as never,
    create,
  };
}

describe('notifyOrgUsers — unit (mocked prisma)', () => {
  it('order-less document_published: url points to /organization/documents?tab=general, title is «Новый общий документ»', async () => {
    sendDocMock.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { db, create } = dbWith([{ id: 'u1', email: 'a@org.ru' }]);
    await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'document_published',
      payload: {
        orderId: null,
        orderNumber: null,
        orderTitle: null,
        documentName: 'общий.pdf',
        documentType: 'other',
      },
    });
    const data = create.mock.calls[0][0].data;
    expect(data.title).toBe('Новый общий документ');
    const meta = data.meta as Record<string, unknown>;
    expect(meta.url).toContain('/organization/documents?tab=general');
    expect(meta.url).not.toContain('/orders/null');
    expect(meta.url).not.toContain('/orders/undefined');
  });

  it('order-bound document_published: url points to /organization/orders/:id, title says «по заказу»', async () => {
    sendDocMock.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { db, create } = dbWith([{ id: 'u2', email: 'b@org.ru' }]);
    await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'document_published',
      payload: {
        orderId: 'ord-42',
        orderNumber: '42',
        orderTitle: 'Тест',
        documentName: 'акт.pdf',
        documentType: 'act',
      },
    });
    const data = create.mock.calls[0][0].data;
    expect(data.title).toContain('Новый документ по заказу');
    const meta = data.meta as Record<string, unknown>;
    expect(meta.url).toContain('/organization/orders/ord-42');
    expect(meta.url).not.toContain('/documents?tab=general');
  });
});
