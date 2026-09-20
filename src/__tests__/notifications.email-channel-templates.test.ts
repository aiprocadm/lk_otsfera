import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Реестр «ключ письма → отправитель» и свой текст письма (`У-128`).
 *
 * Соседний тест (`notifications.channels`) проверяет канал целиком на паре
 * писем. Здесь — две вещи, которые там не видны.
 *
 * **Каждый ключ ведёт к СВОЕМУ отправителю.** Реестр — четырнадцать строк
 * подряд, и опечатка в одной из них (два ключа на один отправитель) не ломает
 * ни типы, ни сборку: письмо просто уходит не то. Поэтому проверяются все
 * четырнадцать, а не «характерные».
 *
 * **Свой текст письма не отменяет вёрстку.** Переопределение даёт только тему
 * и текст, а конверт остаётся общий — иначе первое же отредактированное письмо
 * выглядело бы как спам. В коде это выражено тем, что при переопределении
 * зовётся `sendNotificationEmail`, а не отправитель ключа.
 */
const senders = vi.hoisted(() => {
  const keys = [
    'sendNotificationEmail',
    'sendDailyDigestEmail',
    'sendOrgDocumentPublishedEmail',
    'sendOrgDocumentSentEmail',
    'sendOrgPaymentReceivedEmail',
    'sendOrgManagerRepliedEmail',
    'sendOrgOrderStatusChangedEmail',
    'sendManagerCommentFromOrgEmail',
    'sendManagerDocumentUploadedByOrgEmail',
    'sendManagerDocumentUploadedByPartnerEmail',
    'sendManagerOrderMarkedPaidBy1CEmail',
    'sendManagerOrderStatusChangedEmail',
    'sendPartnerDocumentPublishedEmail',
    'sendCommissionReadyEmail',
  ] as const;
  const out = {} as Record<(typeof keys)[number], ReturnType<typeof vi.fn>>;
  for (const k of keys) out[k] = vi.fn(async () => ({ status: 'sent', id: 'e1' }));
  return out;
});

const overrides = vi.hoisted(() => ({
  getTemplateOverride: vi.fn(),
  applyOverride: vi.fn(),
}));

vi.mock('@/lib/email/send', () => senders);
vi.mock('@/lib/email/templateOverrides', () => overrides);
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { emailChannel } from '@/lib/notifications/channels/email';
import type { ChannelPayload, ChannelRecipient } from '@/lib/notifications/channels/types';

const user: ChannelRecipient = {
  id: 'u1',
  email: 'user@example.ru',
  name: 'Иван',
  role: 'organization',
  telegramChatId: null,
  maxChatId: null,
  whatsappPhone: null,
  notificationChannels: null,
};

/** Письмо-заготовка: меняем только ключ шаблона и props. */
function payload(template: string, props: Record<string, unknown> = {}): ChannelPayload {
  return {
    type: 'payment_received',
    title: 'Тема',
    body: 'Текст',
    email: { template, props } as never,
  } as ChannelPayload;
}

beforeEach(() => {
  vi.clearAllMocks();
  overrides.getTemplateOverride.mockResolvedValue(null);
});

describe('Реестр шаблон → отправитель', () => {
  it.each([
    ['notification', 'sendNotificationEmail'],
    ['orgDocumentPublished', 'sendOrgDocumentPublishedEmail'],
    ['orgDocumentSent', 'sendOrgDocumentSentEmail'],
    ['orgPaymentReceived', 'sendOrgPaymentReceivedEmail'],
    ['orgManagerReplied', 'sendOrgManagerRepliedEmail'],
    ['orgOrderStatusChanged', 'sendOrgOrderStatusChangedEmail'],
    ['managerCommentFromOrg', 'sendManagerCommentFromOrgEmail'],
    ['managerDocumentUploadedByOrg', 'sendManagerDocumentUploadedByOrgEmail'],
    ['managerDocumentUploadedByPartner', 'sendManagerDocumentUploadedByPartnerEmail'],
    ['managerOrderMarkedPaidBy1C', 'sendManagerOrderMarkedPaidBy1CEmail'],
    ['managerOrderStatusChanged', 'sendManagerOrderStatusChangedEmail'],
    ['partnerDocumentPublished', 'sendPartnerDocumentPublishedEmail'],
    ['commissionReady', 'sendCommissionReadyEmail'],
    ['dailyDigest', 'sendDailyDigestEmail'],
  ])('«%s» уходит через %s, и только через него', async (template, senderName) => {
    const res = await emailChannel.send(user, payload(template, { orderNumber: '42' }));

    expect(res).toEqual({ status: 'sent' });
    const sender = senders[senderName as keyof typeof senders];
    expect(sender).toHaveBeenCalledWith({ to: 'user@example.ru', orderNumber: '42' });
    // Ни один другой отправитель не потревожен: письмо ушло ровно одно.
    const others = Object.entries(senders).filter(([k]) => k !== senderName);
    for (const [, fn] of others) expect(fn).not.toHaveBeenCalled();
  });
});

describe('Свой текст письма', () => {
  beforeEach(() => {
    overrides.getTemplateOverride.mockResolvedValue({ subject: 'Тема-{{n}}', body: 'Тело' });
    overrides.applyOverride.mockReturnValue({ subject: 'Тема-42', text: 'Тело' });
  });

  it('тема и текст берутся свои, а конверт остаётся общий', async () => {
    const res = await emailChannel.send(
      user,
      payload('orgPaymentReceived', { orderNumber: '42', orderUrl: 'https://lk/o/1' })
    );

    expect(res).toEqual({ status: 'sent' });
    // Именно `sendNotificationEmail` — это и есть «в той же вёрстке».
    expect(senders.sendNotificationEmail).toHaveBeenCalledWith({
      to: 'user@example.ru',
      recipientName: 'Иван',
      title: 'Тема-42',
      body: 'Тело',
      url: 'https://lk/o/1',
    });
    expect(senders.sendOrgPaymentReceivedEmail).not.toHaveBeenCalled();
  });

  it('ссылки в письме нет — кнопки тоже нет, а не пустая', async () => {
    await emailChannel.send(user, payload('notification', { orderUrl: 42 }));

    expect(senders.sendNotificationEmail.mock.calls[0]?.[0]).not.toHaveProperty('url');
  });

  it('имени получателя нет — обращаемся «коллега», а не пустотой', async () => {
    await emailChannel.send({ ...user, name: null }, payload('notification'));

    expect(senders.sendNotificationEmail.mock.calls[0]?.[0]).toMatchObject({
      recipientName: 'коллега',
    });
  });

  it('почта выключена — отказ с причиной, а не «отправлено»', async () => {
    senders.sendNotificationEmail.mockResolvedValue({ status: 'skipped', reason: 'disabled' });

    const res = await emailChannel.send(user, payload('notification'));

    expect(res).toEqual({ status: 'skipped', reason: 'disabled' });
  });

  it('свой текст ищется для своей компании', async () => {
    await emailChannel.send(user, {
      ...payload('notification'),
      companyId: 'c1',
    } as ChannelPayload);

    expect(overrides.getTemplateOverride).toHaveBeenCalledWith({}, 'notification', 'c1');
  });
});
