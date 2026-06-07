import { describe, it, expect, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('@/lib/email/send', () => ({ sendPartnerDocumentPublishedEmail: sendMock }));

import { notifyPartnerUsers } from '@/lib/notifications/partner';

function dbWith(users: Array<{ id: string; email: string | null }>) {
  const create = vi.fn().mockResolvedValue({});
  return {
    db: {
      partner: { findUnique: vi.fn().mockResolvedValue({ id: 'p-1', name: 'ООО Партнёр', users }) },
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
});
