import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  sendNotificationEmail,
  sendOrgPaymentReceivedEmail,
  isTelegramEnabled,
  sendTelegramMessage,
  isMaxEnabled,
  sendMaxMessage,
  isWhatsAppEnabled,
  sendWhatsAppMessage,
} = vi.hoisted(() => ({
  sendNotificationEmail: vi.fn(),
  sendOrgPaymentReceivedEmail: vi.fn(),
  isTelegramEnabled: vi.fn(),
  sendTelegramMessage: vi.fn(),
  isMaxEnabled: vi.fn(),
  sendMaxMessage: vi.fn(),
  isWhatsAppEnabled: vi.fn(),
  sendWhatsAppMessage: vi.fn(),
}));

vi.mock('@/lib/email/send', () => ({
  sendNotificationEmail,
  sendOrgPaymentReceivedEmail,
}));

vi.mock('@/lib/telegram/client', () => ({
  isTelegramEnabled,
  sendTelegramMessage,
}));

vi.mock('@/lib/max/client', () => ({ isMaxEnabled, sendMaxMessage }));
vi.mock('@/lib/whatsapp/aggregator', () => ({ isWhatsAppEnabled, sendWhatsAppMessage }));

import { emailChannel } from '@/lib/notifications/channels/email';
import { telegramChannel } from '@/lib/notifications/channels/telegram';
import { maxChannel } from '@/lib/notifications/channels/max';
import { whatsappChannel } from '@/lib/notifications/channels/whatsapp';
import { getChannels } from '@/lib/notifications/channels/registry';
import { deliverToRecipient } from '@/lib/notifications/channels/deliver';
import type { ChannelPayload, ChannelRecipient } from '@/lib/notifications/channels/types';

function makeUser(overrides: Partial<ChannelRecipient> = {}): ChannelRecipient {
  return {
    id: 'u1',
    email: 'user@example.ru',
    name: 'Иван',
    telegramChatId: null,
    maxChatId: null,
    whatsappPhone: null,
    notificationChannels: null,
    ...overrides,
  };
}

const basePayload: ChannelPayload = {
  type: 'payment_received',
  title: 'Оплата по заказу № 42',
  body: 'Получена оплата 100 ₽.',
  url: 'https://lk.otsfera.ru/organization/orders/o1',
};

beforeEach(() => {
  vi.clearAllMocks();
  isTelegramEnabled.mockReturnValue(false);
  isMaxEnabled.mockReturnValue(false);
  isWhatsAppEnabled.mockReturnValue(false);
});

describe('emailChannel', () => {
  it('key = email', () => {
    expect(emailChannel.key).toBe('email');
  });

  it('isEnabledFor: включён при наличии email, выключен без него', () => {
    expect(emailChannel.isEnabledFor(makeUser())).toBe(true);
    expect(emailChannel.isEnabledFor(makeUser({ email: '' }))).toBe(false);
  });

  it('send без email-контента → skipped/no_email_content (in-app-only уведомления)', async () => {
    const result = await emailChannel.send(makeUser(), basePayload);
    expect(result).toEqual({ status: 'skipped', reason: 'no_email_content' });
    expect(sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('send резолвит шаблон в ту же sender-функцию с {to, ...props}', async () => {
    sendOrgPaymentReceivedEmail.mockResolvedValue({ status: 'sent', id: 'e1' });
    const paidAt = new Date('2026-07-01T10:00:00Z');
    const result = await emailChannel.send(makeUser(), {
      ...basePayload,
      email: {
        template: 'orgPaymentReceived',
        props: {
          organizationName: 'ООО Ромашка',
          orderNumber: '42',
          orderTitle: 'Обучение',
          amount: '100',
          paidAt,
          orderUrl: 'https://lk.otsfera.ru/organization/orders/o1',
        },
      },
    });
    expect(result).toEqual({ status: 'sent' });
    expect(sendOrgPaymentReceivedEmail).toHaveBeenCalledWith({
      to: 'user@example.ru',
      organizationName: 'ООО Ромашка',
      orderNumber: '42',
      orderTitle: 'Обучение',
      amount: '100',
      paidAt,
      orderUrl: 'https://lk.otsfera.ru/organization/orders/o1',
    });
  });

  it('send мапит skipped-результат пайплайна (EMAIL_ENABLED выключен) в skipped + reason', async () => {
    sendNotificationEmail.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    const result = await emailChannel.send(makeUser(), {
      ...basePayload,
      email: {
        template: 'notification',
        props: { recipientName: 'Иван', title: 'Т', body: 'Б' },
      },
    });
    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
  });
});

describe('telegramChannel', () => {
  it('key = telegram', () => {
    expect(telegramChannel.key).toBe('telegram');
  });

  it('isEnabledFor: только env включён И чат привязан', () => {
    isTelegramEnabled.mockReturnValue(true);
    expect(telegramChannel.isEnabledFor(makeUser({ telegramChatId: '123' }))).toBe(true);
    expect(telegramChannel.isEnabledFor(makeUser({ telegramChatId: null }))).toBe(false);
    isTelegramEnabled.mockReturnValue(false);
    expect(telegramChannel.isEnabledFor(makeUser({ telegramChatId: '123' }))).toBe(false);
  });

  it('isEnabledFor: пользовательская настройка (D2) — false выключает, отсутствие/мусор = включено', () => {
    isTelegramEnabled.mockReturnValue(true);
    const bound = { telegramChatId: '123' };
    expect(
      telegramChannel.isEnabledFor(makeUser({ ...bound, notificationChannels: { telegram: false } }))
    ).toBe(false);
    expect(
      telegramChannel.isEnabledFor(makeUser({ ...bound, notificationChannels: { telegram: true } }))
    ).toBe(true);
    expect(
      telegramChannel.isEnabledFor(makeUser({ ...bound, notificationChannels: { max: false } }))
    ).toBe(true);
    expect(
      telegramChannel.isEnabledFor(makeUser({ ...bound, notificationChannels: 'garbage' }))
    ).toBe(true);
  });

  it('send шлёт "title\\n\\nbody" в привязанный чат', async () => {
    sendTelegramMessage.mockResolvedValue({ ok: true });
    const result = await telegramChannel.send(makeUser({ telegramChatId: '123' }), basePayload);
    expect(result).toEqual({ status: 'sent' });
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      '123',
      'Оплата по заказу № 42\n\nПолучена оплата 100 ₽.'
    );
  });

  it('send: транспортный {ok:false} → failed/transport', async () => {
    sendTelegramMessage.mockResolvedValue({ ok: false });
    const result = await telegramChannel.send(makeUser({ telegramChatId: '123' }), basePayload);
    expect(result).toEqual({ status: 'failed', reason: 'transport' });
  });

  it('send без привязки → skipped/not_linked (защита при прямом вызове)', async () => {
    const result = await telegramChannel.send(makeUser(), basePayload);
    expect(result).toEqual({ status: 'skipped', reason: 'not_linked' });
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });
});

describe('maxChannel (D3)', () => {
  it('key = max', () => {
    expect(maxChannel.key).toBe('max');
  });

  it('isEnabledFor: флаг+привязка+настройка', () => {
    isMaxEnabled.mockReturnValue(true);
    expect(maxChannel.isEnabledFor(makeUser({ maxChatId: 'm1' }))).toBe(true);
    expect(maxChannel.isEnabledFor(makeUser({ maxChatId: null }))).toBe(false);
    expect(
      maxChannel.isEnabledFor(makeUser({ maxChatId: 'm1', notificationChannels: { max: false } }))
    ).toBe(false);
    isMaxEnabled.mockReturnValue(false);
    expect(maxChannel.isEnabledFor(makeUser({ maxChatId: 'm1' }))).toBe(false);
  });

  it('send → sendMaxMessage; ok→sent, !ok→failed', async () => {
    sendMaxMessage.mockResolvedValue({ ok: true });
    expect(await maxChannel.send(makeUser({ maxChatId: 'm1' }), basePayload)).toEqual({
      status: 'sent',
    });
    expect(sendMaxMessage).toHaveBeenCalledWith('m1', 'Оплата по заказу № 42\n\nПолучена оплата 100 ₽.');

    sendMaxMessage.mockResolvedValue({ ok: false });
    expect(await maxChannel.send(makeUser({ maxChatId: 'm1' }), basePayload)).toEqual({
      status: 'failed',
      reason: 'transport',
    });
  });

  it('send без привязки → skipped/not_linked', async () => {
    expect(await maxChannel.send(makeUser(), basePayload)).toEqual({
      status: 'skipped',
      reason: 'not_linked',
    });
  });
});

describe('whatsappChannel (D4)', () => {
  it('key = whatsapp', () => {
    expect(whatsappChannel.key).toBe('whatsapp');
  });

  it('isEnabledFor: флаг+номер+настройка', () => {
    isWhatsAppEnabled.mockReturnValue(true);
    expect(whatsappChannel.isEnabledFor(makeUser({ whatsappPhone: '+79991234567' }))).toBe(true);
    expect(whatsappChannel.isEnabledFor(makeUser({ whatsappPhone: null }))).toBe(false);
    expect(
      whatsappChannel.isEnabledFor(
        makeUser({ whatsappPhone: '+79991234567', notificationChannels: { whatsapp: false } })
      )
    ).toBe(false);
    isWhatsAppEnabled.mockReturnValue(false);
    expect(whatsappChannel.isEnabledFor(makeUser({ whatsappPhone: '+79991234567' }))).toBe(false);
  });

  it('send → sendWhatsAppMessage по номеру; ok→sent, !ok→failed', async () => {
    sendWhatsAppMessage.mockResolvedValue({ ok: true });
    expect(
      await whatsappChannel.send(makeUser({ whatsappPhone: '+79991234567' }), basePayload)
    ).toEqual({ status: 'sent' });
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      '+79991234567',
      'Оплата по заказу № 42\n\nПолучена оплата 100 ₽.'
    );

    sendWhatsAppMessage.mockResolvedValue({ ok: false });
    expect(
      await whatsappChannel.send(makeUser({ whatsappPhone: '+79991234567' }), basePayload)
    ).toEqual({ status: 'failed', reason: 'transport' });
  });

  it('send без номера → skipped/not_linked', async () => {
    expect(await whatsappChannel.send(makeUser(), basePayload)).toEqual({
      status: 'skipped',
      reason: 'not_linked',
    });
  });
});

describe('registry', () => {
  it('D1–D4: email, telegram, max, whatsapp зарегистрированы (в этом порядке)', () => {
    expect(getChannels().map((c) => c.key)).toEqual(['email', 'telegram', 'max', 'whatsapp']);
  });
});

describe('deliverToRecipient', () => {
  const emailRef: ChannelPayload['email'] = {
    template: 'notification',
    props: { recipientName: 'Иван', title: 'Т', body: 'Б' },
  };

  it('доставляет только по включённым каналам', async () => {
    sendNotificationEmail.mockResolvedValue({ status: 'sent', id: 'e1' });
    // telegram выключен (env) — не должен вызываться
    const results = await deliverToRecipient(makeUser({ telegramChatId: '123' }), {
      ...basePayload,
      email: emailRef,
    });
    expect(results.email).toEqual({ status: 'sent' });
    expect(results.telegram).toBeUndefined();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('ошибка telegram не роняет email (изоляция каналов)', async () => {
    isTelegramEnabled.mockReturnValue(true);
    sendNotificationEmail.mockResolvedValue({ status: 'sent', id: 'e1' });
    sendTelegramMessage.mockRejectedValue(new Error('tg down'));
    const results = await deliverToRecipient(makeUser({ telegramChatId: '123' }), {
      ...basePayload,
      email: emailRef,
    });
    expect(results.email).toEqual({ status: 'sent' });
    expect(results.telegram).toEqual({ status: 'failed', reason: 'tg down' });
  });

  it('ошибка email не роняет telegram и конвертируется в failed', async () => {
    isTelegramEnabled.mockReturnValue(true);
    sendNotificationEmail.mockRejectedValue('resend exploded');
    sendTelegramMessage.mockResolvedValue({ ok: true });
    const results = await deliverToRecipient(makeUser({ telegramChatId: '123' }), {
      ...basePayload,
      email: emailRef,
    });
    expect(results.email).toEqual({ status: 'failed', reason: 'resend exploded' });
    expect(results.telegram).toEqual({ status: 'sent' });
  });

  it('пользователь без каналов → пустой результат (только in-app строка)', async () => {
    const results = await deliverToRecipient(makeUser({ email: '' }), basePayload);
    expect(results).toEqual({});
  });
});
