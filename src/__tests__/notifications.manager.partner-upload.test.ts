import { describe, it, expect, vi } from 'vitest';

const { sendOrg, sendPartner } = vi.hoisted(() => ({ sendOrg: vi.fn(), sendPartner: vi.fn() }));
vi.mock('@/lib/email/send', () => ({
  sendManagerCommentFromOrgEmail: vi.fn(),
  sendManagerDocumentUploadedByOrgEmail: sendOrg,
  sendManagerDocumentUploadedByPartnerEmail: sendPartner,
  sendManagerOrderMarkedPaidBy1CEmail: vi.fn(),
  sendManagerOrderStatusChangedEmail: vi.fn(),
  sendNotificationEmail: vi.fn()
}));

import { notifyManagers } from '@/lib/notifications/manager';

describe('notifyManagers — document_uploaded_by_partner', () => {
  it('creates rows + dispatches the partner-upload email to managers in scope', async () => {
    sendPartner.mockResolvedValue({ status: 'sent', id: 'e1' });
    const create = vi.fn().mockResolvedValue({});
    const db = {
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', orderNumber: '42', title: 'T', managerId: 'm1', organizationId: 'org1' }) },
      organizationManager: { findMany: vi.fn().mockResolvedValue([]) },
      comment: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', email: 'm@x.ru', name: 'M' }]) },
      notification: { create }
    } as never;

    const r = await notifyManagers(db, {
      orderId: 'o1',
      type: 'document_uploaded_by_partner',
      payload: { partnerName: 'ООО Партнёр', documentName: 'k.pdf', documentType: 'commission_statement' }
    });

    expect(r.recipientsNotified).toBe(1);
    expect(create.mock.calls[0][0].data.type).toBe('document_uploaded_by_partner');
    expect(sendPartner).toHaveBeenCalledOnce();
  });
});
