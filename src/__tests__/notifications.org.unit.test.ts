import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Счётчики вызовов почты не должны перетекать между случаями: проверка
// «письмо НЕ ушло» иначе увидит письмо соседнего теста.
beforeEach(() => {
  vi.clearAllMocks();
});

function dbWith(
  users: Array<{ id: string; email: string | null; telegramChatId?: string | null }>
) {
  const create = vi.fn().mockResolvedValue({});
  // Единая точка `recordNotification` (`У-231`): повтор ищется до создания.
  const findFirst = vi.fn().mockResolvedValue(null);
  const update = vi.fn().mockResolvedValue({ id: 'n-dup' });
  const organizationUsers = users.map((u) => ({
    user: { role: 'organization', telegramChatId: null, ...u },
  }));
  return {
    db: {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'org-1', name: 'ООО Орг', organizationUsers }),
      },
      notification: { create, findFirst, update },
    } as never,
    create,
    findFirst,
    update,
  };
}

describe('notifyOrgUsers — unit (mocked prisma)', () => {
  it('order-less document_published: url points to /organization/documents?tab=general, title is «Новый общий документ»', async () => {
    sendDocMock.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { db, create, findFirst } = dbWith([{ id: 'u1', email: 'a@org.ru' }]);
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
    // Заказа нет — ключа дедупа нет, повтор не ищется (`У-231`).
    expect(data.entityId).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
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
        documentId: 'doc-42',
      },
    });
    const data = create.mock.calls[0][0].data;
    expect(data.title).toContain('Новый документ по заказу');
    const meta = data.meta as Record<string, unknown>;
    expect(meta.url).toContain('/organization/orders/ord-42');
    expect(meta.url).not.toContain('/documents?tab=general');
    // `У-231`: ключ дедупа документа — сам документ; строка привязана к организации.
    expect(data.entityId).toBe('doc-42');
    expect(meta.documentId).toBe('doc-42');
    expect(data.organizationId).toBe('org-1');
    expect(data.lastOccurredAt).toEqual(expect.any(Date));
  });

  it('повтор в окне (У-231): findFirst нашёл строку → update, create нет, письмо не шлётся, emailsSkipped', async () => {
    sendDocMock.mockResolvedValue({ status: 'sent' });
    const { db, create, findFirst, update } = dbWith([{ id: 'u3', email: 'c@org.ru' }]);
    findFirst.mockResolvedValue({ id: 'n-old' });

    const r = await notifyOrgUsers(db, {
      organizationId: 'org-1',
      type: 'document_published',
      payload: {
        orderId: 'ord-42',
        orderNumber: '42',
        orderTitle: 'Тест',
        documentName: 'акт-v2.pdf',
        documentType: 'act',
        documentId: 'doc-42',
      },
    });

    expect(r).toEqual({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 1 });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u3',
          type: 'document_published',
          entityId: 'doc-42',
        }),
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'n-old' },
        data: expect.objectContaining({
          dedupCount: { increment: 1 },
          isRead: false,
          body: expect.stringContaining('акт-v2.pdf'),
        }),
      })
    );
    expect(create).not.toHaveBeenCalled();
    expect(sendDocMock).not.toHaveBeenCalled();
  });
});
