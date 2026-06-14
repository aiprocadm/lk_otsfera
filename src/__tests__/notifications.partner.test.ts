import { describe, it, expect, vi } from 'vitest';

const { sendMock, sendCommissionMock } = vi.hoisted(() => ({ sendMock: vi.fn(), sendCommissionMock: vi.fn() }));
vi.mock('@/lib/email/send', () => ({
  sendPartnerDocumentPublishedEmail: sendMock,
  sendCommissionReadyEmail: sendCommissionMock
}));

import { notifyPartnerUsers } from '@/lib/notifications/partner';

function dbWith(users: Array<{ id: string; email: string | null }>) {
  const create = vi.fn().mockResolvedValue({});
  const partnerUsers = users.map((u) => ({ user: u }));
  return {
    db: {
      partner: { findUnique: vi.fn().mockResolvedValue({ id: 'p-1', name: 'ООО Партнёр', partnerUsers }) },
      notification: { create }
    } as never,
    create
  };
}

describe('notifyPartnerUsers', () => {
  it('creates an in-app notification per active partner user', async () => {
    sendMock.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { db, create } = dbWith([
      { id: 'u1', email: 'a@p.ru' },
      { id: 'u2', email: null }
    ]);
    const r = await notifyPartnerUsers(db, {
      partnerId: 'p-1',
      type: 'document_published',
      payload: { orderId: 'o1', orderNumber: '42', orderTitle: 'T', documentName: 'k.pdf', documentType: 'commission_statement' }
    });
    expect(r.recipientsNotified).toBe(2);
    expect(r.emailsSent).toBe(0);
    expect(r.emailsSkipped).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].data.partnerId).toBe('p-1');
  });

  it('returns zeroes for an unknown partner', async () => {
    const db = { partner: { findUnique: vi.fn().mockResolvedValue(null) }, notification: { create: vi.fn() } } as never;
    const r = await notifyPartnerUsers(db, {
      partnerId: 'missing',
      type: 'document_published',
      payload: { orderId: 'o', orderNumber: null, orderTitle: 'T', documentName: 'k', documentType: 'other' }
    });
    expect(r).toEqual({ recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 });
  });

  it('order-less document_published: links to /partner/documents?tab=general and uses «Новый общий документ» title', async () => {
    sendMock.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { db, create } = dbWith([{ id: 'u3', email: 'b@p.ru' }]);
    await notifyPartnerUsers(db, {
      partnerId: 'p-1',
      type: 'document_published',
      payload: { orderId: null, orderNumber: null, orderTitle: null, documentName: 'общий.pdf', documentType: 'other' }
    });
    const data = create.mock.calls[0][0].data;
    expect(data.title).toBe('Новый общий документ');
    const meta = data.meta as Record<string, unknown>;
    expect(meta.url).toContain('/partner/documents?tab=general');
    expect(meta.url).not.toContain('/portfolio');
    expect(meta.url).not.toContain('/null');
  });

  it('order-bound document_published: title still says «Новый документ по заказу»', async () => {
    sendMock.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { db, create } = dbWith([{ id: 'u4', email: 'c@p.ru' }]);
    await notifyPartnerUsers(db, {
      partnerId: 'p-1',
      type: 'document_published',
      payload: { orderId: 'o99', orderNumber: '99', orderTitle: 'Проект', documentName: 'акт.pdf', documentType: 'act' }
    });
    const data = create.mock.calls[0][0].data;
    expect(data.title).toContain('Новый документ по заказу');
    const meta = data.meta as Record<string, unknown>;
    expect(meta.url).toContain('/partner/portfolio');
    expect(meta.url).not.toContain('/documents?tab=general');
  });

  // C-02: partner must be told when a commission statement is ready to review.
  it('commission_statement_ready: in-app notification with period/amount and finance deep link', async () => {
    sendCommissionMock.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { db, create } = dbWith([{ id: 'u5', email: 'd@p.ru' }]);
    const r = await notifyPartnerUsers(db, {
      partnerId: 'p-1',
      type: 'commission_statement_ready',
      payload: { statementId: 's-7', period: 'май 2026', amount: '125 000 ₽' }
    });
    expect(r.recipientsNotified).toBe(1);
    const data = create.mock.calls[0][0].data;
    expect(data.type).toBe('commission_statement_ready');
    expect(data.title).toBe('Отчёт по комиссии готов');
    expect(data.body).toContain('май 2026');
    expect(data.body).toContain('125 000 ₽');
    const meta = data.meta as Record<string, unknown>;
    expect(meta.url).toContain('/partner/finance');
    expect(meta.statementId).toBe('s-7');
  });

  it('commission_statement_ready: dispatches the commission-ready email (not the document email)', async () => {
    sendMock.mockClear(); // no beforeEach reset in this file; isolate the cross-type assertion
    sendCommissionMock.mockResolvedValue({ status: 'sent' });
    const { db } = dbWith([{ id: 'u6', email: 'e@p.ru' }]);
    const r = await notifyPartnerUsers(db, {
      partnerId: 'p-1',
      type: 'commission_statement_ready',
      payload: { statementId: 's-8', period: 'июнь 2026', amount: '90 000 ₽' }
    });
    expect(r.emailsSent).toBe(1);
    expect(sendCommissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'e@p.ru', partnerName: 'ООО Партнёр', period: 'июнь 2026', amount: '90 000 ₽' })
    );
    expect(sendMock).not.toHaveBeenCalled();
  });
});
