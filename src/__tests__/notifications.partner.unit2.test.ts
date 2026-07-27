/**
 * Additional unit tests for src/lib/notifications/partner.ts
 *
 * Covers remaining branches not hit by notifications.partner.test.ts:
 *  - lead_status_changed type (in-app only, no sendEmail)
 *  - Best-effort email throw → emailsSkipped, no re-throw
 *  - Recipient with no email + sendEmail exists → emailsSkipped
 *  - send returns status=skipped → emailsSkipped
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendDocMock, sendCommissionMock } = vi.hoisted(() => ({
  sendDocMock: vi.fn(),
  sendCommissionMock: vi.fn(),
}));

vi.mock('@/lib/email/send', () => ({
  sendPartnerDocumentPublishedEmail: sendDocMock,
  sendCommissionReadyEmail: sendCommissionMock,
}));

import { notifyPartnerUsers } from '@/lib/notifications/partner';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dbWith(users: Array<{ id: string; email: string | null }>) {
  const create = vi.fn().mockResolvedValue({});
  const partnerUsers = users.map((u) => ({ user: u }));
  return {
    db: {
      partner: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'p-1',
          name: 'ООО Партнёр',
          partnerUsers,
        }),
      },
      notification: { create },
    } as never,
    create,
  };
}

// ---------------------------------------------------------------------------
// lead_status_changed (in-app only)
// ---------------------------------------------------------------------------

describe('notifyPartnerUsers — best-effort email failure', () => {
  it('sendEmail throws → resolves normally, emailsSkipped++, no re-throw', async () => {
    sendDocMock.mockRejectedValue(new Error('Mail server unreachable'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, create } = dbWith([{ id: 'u3', email: 'b@p.ru' }]);

    const r = await notifyPartnerUsers(db, {
      partnerId: 'p-1',
      type: 'document_published',
      payload: {
        orderId: 'o1',
        orderNumber: '42',
        orderTitle: 'Тест',
        documentName: 'act.pdf',
        documentType: 'act',
      },
    });

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsSent).toBe(0);
    expect(r.emailsSkipped).toBe(1);
    expect(consoleSpy).toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce(); // in-app row still created
    consoleSpy.mockRestore();
  });

  it('sendEmail returns status=skipped → emailsSkipped++', async () => {
    sendDocMock.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const { db } = dbWith([{ id: 'u4', email: 'c@p.ru' }]);

    const r = await notifyPartnerUsers(db, {
      partnerId: 'p-1',
      type: 'document_published',
      payload: {
        orderId: 'o2',
        orderNumber: null,
        orderTitle: 'T',
        documentName: 'k.pdf',
        documentType: 'other',
      },
    });

    expect(r.emailsSent).toBe(0);
    expect(r.emailsSkipped).toBe(1);
  });

  it('sendEmail throws a non-Error value → emailsSkipped, String(err) branch covered', async () => {
    sendDocMock.mockRejectedValue('non-error-string'); // not an Error instance
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, create } = dbWith([{ id: 'u6', email: 'e@p.ru' }]);

    const r = await notifyPartnerUsers(db, {
      partnerId: 'p-1',
      type: 'document_published',
      payload: {
        orderId: 'o-str',
        orderNumber: '1',
        orderTitle: 'T',
        documentName: 'x.pdf',
        documentType: 'act',
      },
    });

    expect(r.emailsSkipped).toBe(1);
    expect(consoleSpy).toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});
