import { describe, it, expect, vi, beforeEach } from 'vitest';

// D5: при включённой очереди диспетчер не шлёт сам, а ставит задачу — сводка
// должна отличать «письмо в очереди» от «письма не будет».
const { dispatchToRecipient, allowedChannels } = vi.hoisted(() => ({
  dispatchToRecipient: vi.fn(),
  allowedChannels: vi.fn(),
}));
vi.mock('@/lib/notifications/channels/dispatch', () => ({ dispatchToRecipient }));
// `У-127`: правила уведомлений — по умолчанию их нет (доставка по умолчанию).
vi.mock('@/lib/notifications/routing', () => ({ allowedChannels }));
vi.mock('@/lib/email/send', () => ({
  sendManagerDocumentUploadedByOrgEmail: vi.fn(),
  sendManagerDocumentUploadedByPartnerEmail: vi.fn(),
  sendManagerCommentFromOrgEmail: vi.fn(),
  sendManagerOrderMarkedPaidBy1CEmail: vi.fn(),
  sendManagerOrderStatusChangedEmail: vi.fn(),
  sendNotificationEmail: vi.fn(),
}));

import {
  notifyManagersMessengerMessage,
  notifyManagersPartnerOrderLess,
} from '@/lib/notifications/manager';

/** Очередь доставки (D5) для уведомления о сообщении в мессенджере (Р-М-9). */
function makeDb() {
  return {
    organizationManager: { findMany: vi.fn().mockResolvedValue([{ userId: 'm1' }]) },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', email: 'm@x.ru', name: 'Мария' }]) },
    notification: { create: vi.fn().mockResolvedValue({ id: 'n1' }) },
  } as never;
}

const INPUT = {
  organizationId: 'org1',
  dialogId: 'd1',
  peerLabel: 'Иван',
  channelLabel: 'MAX',
  excerpt: 'вопрос',
};

describe('notifyManagersMessengerMessage — очередь доставки', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowedChannels.mockResolvedValue(undefined);
  });

  it('правила уведомлений заданы → диспетчер получает разрешённые каналы', async () => {
    allowedChannels.mockResolvedValue(['email']);
    dispatchToRecipient.mockResolvedValue({
      mode: 'inline',
      results: { email: { status: 'sent' } },
    });
    const r = await notifyManagersMessengerMessage(makeDb(), INPUT);
    expect(r).toEqual({ recipientsNotified: 1, emailsSent: 1, emailsSkipped: 0 });
    expect(allowedChannels).toHaveBeenCalledWith(expect.anything(), {
      eventType: 'messenger_message',
      audience: 'manager',
    });
    expect(dispatchToRecipient).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ channels: ['email'] })
    );
  });

  it('письмо поставлено в очередь → emailsQueued, не emailsSent', async () => {
    dispatchToRecipient.mockResolvedValue({ mode: 'queued', channels: ['email', 'telegram'] });
    const r = await notifyManagersMessengerMessage(makeDb(), INPUT);
    expect(r).toEqual({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 0, emailsQueued: 1 });
    expect(dispatchToRecipient).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1' }),
      expect.objectContaining({
        type: 'messenger_message',
        title: 'Новое сообщение в MAX от Иван',
      }),
      expect.objectContaining({ dedupKey: 'n1' })
    );
  });

  it('в очередь ушёл только Telegram → письма не будет: emailsSkipped', async () => {
    dispatchToRecipient.mockResolvedValue({ mode: 'queued', channels: ['telegram'] });
    const r = await notifyManagersMessengerMessage(makeDb(), INPUT);
    expect(r).toEqual({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 1 });
  });
});

/**
 * Соседняя рассылка `У-115` (документ партнёра без заказа) — то же плечо
 * очереди, но тестом оно не держалось: полный замер покрытия показал строки
 * без единого прохода. Два случая здесь, раз файл и так открыт.
 */
describe('notifyManagersPartnerOrderLess — очередь доставки', () => {
  const INPUT_PARTNER = {
    partnerId: 'p1',
    partnerName: 'ООО Партнёр',
    documentName: 'gen.pdf',
    documentType: 'other',
  };
  function partnerDb() {
    return {
      organization: { findMany: vi.fn().mockResolvedValue([{ id: 'org1' }]) },
      organizationManager: { findMany: vi.fn().mockResolvedValue([{ userId: 'm1' }]) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', email: 'm@x.ru', name: 'Мария' }]) },
      notification: { create: vi.fn().mockResolvedValue({ id: 'n2' }) },
    } as never;
  }

  beforeEach(() => vi.clearAllMocks());

  it('письмо в очереди → emailsQueued', async () => {
    dispatchToRecipient.mockResolvedValue({ mode: 'queued', channels: ['email'] });
    await expect(notifyManagersPartnerOrderLess(partnerDb(), INPUT_PARTNER)).resolves.toEqual({
      recipientsNotified: 1,
      emailsSent: 0,
      emailsSkipped: 0,
      emailsQueued: 1,
    });
  });

  it('в очереди только Telegram → emailsSkipped', async () => {
    dispatchToRecipient.mockResolvedValue({ mode: 'queued', channels: ['telegram'] });
    await expect(notifyManagersPartnerOrderLess(partnerDb(), INPUT_PARTNER)).resolves.toEqual({
      recipientsNotified: 1,
      emailsSent: 0,
      emailsSkipped: 1,
    });
  });
});
