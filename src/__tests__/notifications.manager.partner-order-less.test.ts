import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendPartner } = vi.hoisted(() => ({ sendPartner: vi.fn() }));
vi.mock('@/lib/email/send', () => ({
  sendManagerCommentFromOrgEmail: vi.fn(),
  sendManagerDocumentUploadedByOrgEmail: vi.fn(),
  sendManagerDocumentUploadedByPartnerEmail: sendPartner,
  sendManagerOrderMarkedPaidBy1CEmail: vi.fn(),
  sendManagerOrderStatusChangedEmail: vi.fn(),
  sendNotificationEmail: vi.fn(),
}));
vi.mock('@/lib/telegram/client', () => ({
  isTelegramEnabled: vi.fn().mockReturnValue(false),
  sendTelegramMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

import {
  notifyManagersPartnerOrderLess,
  resolvePartnerManagerRecipients,
} from '@/lib/notifications/manager';

/**
 * `У-115`: у общего документа партнёра нет заказа, поэтому обычный поиск
 * получателей (он весь построен вокруг заказа) неприменим. Целимся в
 * менеджеров организаций этого партнёра — тех, кто с ним работает.
 */
function makeDb(over: Record<string, unknown> = {}) {
  return {
    organization: { findMany: vi.fn().mockResolvedValue([{ id: 'org1' }]) },
    organizationManager: { findMany: vi.fn().mockResolvedValue([{ userId: 'm1' }]) },
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: 'm1', email: 'm@x.ru', name: 'M' }]),
    },
    notification: { create: vi.fn().mockResolvedValue({ id: 'n1' }) },
    ...over,
  } as never;
}

const input = {
  partnerId: 'p1',
  partnerName: 'ООО Партнёр',
  documentName: 'dogovor.pdf',
  documentType: 'contract',
};

beforeEach(() => {
  vi.clearAllMocks();
  sendPartner.mockResolvedValue({ status: 'sent', id: 'e1' });
});

describe('resolvePartnerManagerRecipients (У-115)', () => {
  it('партнёр без организаций — получателей нет, в БД за пользователями не ходим', async () => {
    const db = makeDb({ organization: { findMany: vi.fn().mockResolvedValue([]) } });
    expect(await resolvePartnerManagerRecipients(db, 'p1')).toEqual([]);
    expect((db as never as { user: { findMany: unknown } }).user.findMany).not.toHaveBeenCalled();
  });

  it('организации есть, но назначенных менеджеров нет — тоже пусто', async () => {
    const db = makeDb({ organizationManager: { findMany: vi.fn().mockResolvedValue([]) } });
    expect(await resolvePartnerManagerRecipients(db, 'p1')).toEqual([]);
  });

  it('автора события можно исключить из рассылки', async () => {
    const db = makeDb();
    expect(await resolvePartnerManagerRecipients(db, 'p1', { excludeUserId: 'm1' })).toEqual([]);
  });

  it('берёт только активные назначения и только менеджеров с руководителями', async () => {
    const db = makeDb();
    await resolvePartnerManagerRecipients(db, 'p1');
    const om = (db as never as { organizationManager: { findMany: ReturnType<typeof vi.fn> } })
      .organizationManager;
    expect(om.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: { in: ['org1'] }, isActive: true } })
    );
    const users = (db as never as { user: { findMany: ReturnType<typeof vi.fn> } }).user;
    expect(users.findMany.mock.calls[0]![0].where.role).toEqual({ in: ['manager', 'leader'] });
  });
});

describe('notifyManagersPartnerOrderLess (У-115)', () => {
  it('без получателей ничего не создаёт и не шлёт', async () => {
    const db = makeDb({ organization: { findMany: vi.fn().mockResolvedValue([]) } });
    const r = await notifyManagersPartnerOrderLess(db, input);
    expect(r).toEqual({ recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 });
    expect(
      (db as never as { notification: { create: unknown } }).notification.create
    ).not.toHaveBeenCalled();
  });

  it('создаёт запись и шлёт письмо, вместо номера заказа — «Общий документ»', async () => {
    const db = makeDb();
    const r = await notifyManagersPartnerOrderLess(db, input);

    expect(r.recipientsNotified).toBe(1);
    expect(r.emailsSent).toBe(1);
    const create = (db as never as { notification: { create: ReturnType<typeof vi.fn> } })
      .notification.create;
    const data = create.mock.calls[0]![0].data;
    expect(data.type).toBe('document_uploaded_by_partner');
    expect(data.meta.orderId).toBeNull();
    expect(sendPartner.mock.calls[0]![0].orderNumber).toBe('Общий документ');
    expect(sendPartner.mock.calls[0]![0].orderUrl).toContain('/manager/documents?tab=general');
  });

  it('неотправленное письмо считается пропущенным, но запись остаётся', async () => {
    sendPartner.mockResolvedValue({ status: 'skipped' });
    const db = makeDb();
    const r = await notifyManagersPartnerOrderLess(db, input);
    expect(r).toMatchObject({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 1 });
  });
});
