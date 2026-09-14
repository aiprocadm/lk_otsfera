/**
 * Unit-тесты развилки каналов в `replyToInbound`
 * (`src/lib/services/inbound/reply.ts`) после `У-205`.
 *
 * До этапа 3 ветка `email` отвечала отказом. Теперь она отправляет письмо — и
 * важно, что при этом НИ ОДИН соседний канал не поменял поведение: мессенджеры
 * по-прежнему идут в `sendToMessenger`, кабинет — в уведомление, а незнакомый
 * канал остаётся отказом, а не «пробует почту».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  sendEmailReply: vi.fn(),
  sendToMessenger: vi.fn(),
  createNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
}));

vi.mock('@/lib/services/inbound/emailReply', () => ({ sendEmailReply: m.sendEmailReply }));
vi.mock('@/lib/services/messengers/transport', () => ({ sendToMessenger: m.sendToMessenger }));
vi.mock('@/lib/notifications', () => ({
  createNotification: m.createNotification,
  deliverNotificationToUser: m.deliverNotificationToUser,
}));

import { replyToInbound } from '@/lib/services/inbound/reply';

type InboundArg = Parameters<typeof replyToInbound>[0];

function inbound(over: Partial<InboundArg> & { channel: string }): InboundArg {
  return {
    senderRef: 'chat-1',
    subject: null,
    ...over,
  } as InboundArg;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.sendEmailReply.mockResolvedValue({ ok: true });
  m.sendToMessenger.mockResolvedValue({ ok: true });
  m.createNotification.mockResolvedValue({ id: 'n-1' });
  m.deliverNotificationToUser.mockResolvedValue(undefined);
});

describe('replyToInbound — канал «почта» (У-205)', () => {
  it('письмо уходит на адрес отправителя, с его темой и Message-ID', async () => {
    const result = await replyToInbound(
      inbound({
        channel: 'email',
        senderRef: 'client@mail.ru',
        subject: 'Вопрос по счёту',
        externalMessageId: '<abc@mail.ru>',
      }),
      'Счёт отправили'
    );

    expect(result).toEqual({ ok: true });
    expect(m.sendEmailReply).toHaveBeenCalledWith({
      to: 'client@mail.ru',
      subject: 'Вопрос по счёту',
      text: 'Счёт отправили',
      inReplyTo: '<abc@mail.ru>',
    });
    expect(m.sendToMessenger).not.toHaveBeenCalled();
  });

  it('письмо, принятое ДО миграции (Message-ID не сохранён), всё равно отправляется — но без сшивки', async () => {
    // Такие письма лежат во «Входящих» с пустым `externalMessageId`: колонка
    // появилась только сейчас. Ответ на них уходит, но у клиента встанет
    // отдельным письмом, а не в ту же ветку (`У-205` — в отчёт).
    await replyToInbound(
      inbound({ channel: 'email', senderRef: 'client@mail.ru', subject: 'Старое письмо' }),
      'Отвечаем'
    );
    expect(m.sendEmailReply).toHaveBeenCalledWith(
      expect.objectContaining({ inReplyTo: null, to: 'client@mail.ru' })
    );

    m.sendEmailReply.mockClear();
    await replyToInbound(
      inbound({ channel: 'email', senderRef: 'client@mail.ru', externalMessageId: null }),
      'Отвечаем'
    );
    expect(m.sendEmailReply).toHaveBeenCalledWith(expect.objectContaining({ inReplyTo: null }));
  });

  it('отказ отправки письма возвращается вызывающему как есть', async () => {
    m.sendEmailReply.mockResolvedValue({ ok: false });
    await expect(
      replyToInbound(inbound({ channel: 'email', senderRef: 'client@mail.ru' }), 'текст')
    ).resolves.toEqual({ ok: false });
  });
});

describe('replyToInbound — соседние каналы не затронуты', () => {
  it.each(['telegram', 'max', 'whatsapp'] as const)(
    '%s по-прежнему идёт в транспорт',
    async (channel) => {
      const result = await replyToInbound(inbound({ channel, senderRef: 'peer-7' }), 'привет');

      expect(result).toEqual({ ok: true });
      expect(m.sendToMessenger).toHaveBeenCalledWith(channel, 'peer-7', 'привет');
      expect(m.sendEmailReply).not.toHaveBeenCalled();
    }
  );

  it('вопрос из кабинета отвечается уведомлением автору, а не письмом', async () => {
    const result = await replyToInbound(
      inbound({ channel: 'cabinet', senderRef: 'u-1', subject: 'Счёт', resolvedUserId: 'u-1' }),
      'Готово'
    );

    expect(result).toEqual({ ok: true });
    expect(m.createNotification).toHaveBeenCalledWith({
      userId: 'u-1',
      type: 'inbound_reply',
      title: 'Ответ на ваше обращение',
      body: '«Счёт»: Готово',
    });
    expect(m.deliverNotificationToUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', dedupKey: 'n-1' })
    );
    expect(m.sendEmailReply).not.toHaveBeenCalled();
    expect(m.sendToMessenger).not.toHaveBeenCalled();
  });

  it('вопрос из кабинета без автора — отказ, как и раньше', async () => {
    await expect(
      replyToInbound(inbound({ channel: 'cabinet', senderRef: 'u-1' }), 'Готово')
    ).resolves.toEqual({ ok: false });
    expect(m.createNotification).not.toHaveBeenCalled();
  });
});

describe('replyToInbound — незнакомый канал', () => {
  it('отказ без единой попытки отправки', async () => {
    await expect(
      replyToInbound(inbound({ channel: 'sms', senderRef: '+79990001122' }), 'текст')
    ).resolves.toEqual({ ok: false });
    expect(m.sendEmailReply).not.toHaveBeenCalled();
    expect(m.sendToMessenger).not.toHaveBeenCalled();
    expect(m.createNotification).not.toHaveBeenCalled();
  });
});
