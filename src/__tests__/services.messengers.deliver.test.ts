import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  sendEmailReply: vi.fn(),
  deliverToCabinet: vi.fn(),
  sendToMessenger: vi.fn(),
}));
vi.mock('@/lib/services/inbound/emailReply', () => ({ sendEmailReply: m.sendEmailReply }));
vi.mock('@/lib/services/messengers/cabinet', () => ({ deliverToCabinet: m.deliverToCabinet }));
vi.mock('@/lib/services/messengers/transport', () => ({ sendToMessenger: m.sendToMessenger }));

import { deliverDialogText, type DialogForSend } from '@/lib/services/messengers/deliver';

/**
 * Доставка ответа по каналу диалога (`У-205`, `У-212`, этап 3 PR-7).
 *
 * У диалога теперь пять каналов, и уходят они РАЗНЫМИ путями: три мессенджера
 * транспортом, почта — письмом, кабинет — уведомлением внутрь системы. Место
 * развилки одно, поэтому и ошибка здесь одна на всё: перепутанная ветка
 * означает, что ответ сотрудника не доходит до клиента вообще.
 */
const dialog = (over: Partial<DialogForSend> = {}): DialogForSend => ({
  id: 'd1',
  peerRef: 'chat-1',
  userId: null,
  messages: [],
  ...over,
});

/** Почтовый диалог с историей: из последнего входящего берутся тема и связь. */
const emailDialog = dialog({
  peerRef: 'client@example.com',
  messages: [
    {
      inboundMessage: { subject: 'Счёт на оплату', externalMessageId: '<abc@mail>' },
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  m.sendEmailReply.mockResolvedValue({ ok: true });
  m.deliverToCabinet.mockResolvedValue({ ok: true });
  m.sendToMessenger.mockResolvedValue({ ok: true });
});

describe('deliverDialogText — мессенджеры', () => {
  it.each(['telegram', 'max', 'whatsapp'] as const)('%s уходит транспортом', async (channel) => {
    await expect(deliverDialogText(dialog(), channel, 'привет')).resolves.toEqual({ ok: true });
    expect(m.sendToMessenger).toHaveBeenCalledWith(channel, 'chat-1', 'привет');
    expect(m.sendEmailReply).not.toHaveBeenCalled();
    expect(m.deliverToCabinet).not.toHaveBeenCalled();
  });

  it('причина отказа транспорта доезжает наружу без переписывания', async () => {
    // Её показывают человеку и кладут в историю сообщения (`У-213`): подменять
    // текст провайдера общей фразой значит потерять единственную подсказку.
    m.sendToMessenger.mockResolvedValue({ ok: false, error: 'Клиент заблокировал бота' });
    await expect(deliverDialogText(dialog(), 'telegram', 'ау')).resolves.toEqual({
      ok: false,
      error: 'Клиент заблокировал бота',
    });
  });
});

describe('deliverDialogText — почта (`У-205`)', () => {
  /**
   * РЕГРЕСС ПОЧИНЕННОГО ДЕФЕКТА. Раньше на этом месте стоял единственный вызов
   * `sendToMessenger(dialog.channel as MessengerChannel, …)`. Приведение типа
   * проходило молча, а `switch` внутри транспорта знает только три мессенджера:
   * для канала `email` он не совпадал ни с одной веткой и возвращал `undefined`.
   * То есть ответ по почте ИЗ КАРТОЧКИ ДИАЛОГА не уходил никуда, а сотрудник
   * видел «не доставлено» и не понимал, почему ответ из «Входящих» работает, а
   * отсюда — нет.
   */
  it('ответ по почте уходит ПИСЬМОМ, а не в транспорт мессенджеров', async () => {
    const r = await deliverDialogText(emailDialog, 'email', 'ответ');
    expect(r).toEqual({ ok: true });
    expect(m.sendEmailReply).toHaveBeenCalledTimes(1);
    // Главная строка теста: транспорт мессенджеров к почте не имеет отношения.
    expect(m.sendToMessenger).not.toHaveBeenCalled();
  });

  it('письмо адресуется собеседнику и цепляется к последнему входящему', async () => {
    await deliverDialogText(emailDialog, 'email', 'ответ');
    expect(m.sendEmailReply).toHaveBeenCalledWith({
      to: 'client@example.com',
      subject: 'Счёт на оплату',
      text: 'ответ',
      // Без `Message-ID` почтовый клиент клиента покажет ответ отдельным
      // письмом, а не продолжением переписки.
      inReplyTo: '<abc@mail>',
    });
  });

  it('диалог без истории писем: темы и связи просто нет', async () => {
    await deliverDialogText(dialog({ peerRef: 'a@b.ru' }), 'email', 'ответ');
    expect(m.sendEmailReply).toHaveBeenCalledWith({
      to: 'a@b.ru',
      subject: null,
      text: 'ответ',
      inReplyTo: null,
    });
  });

  it('входящее без темы и без идентификатора не роняет отправку', async () => {
    const d = dialog({
      peerRef: 'a@b.ru',
      messages: [{ inboundMessage: { subject: null, externalMessageId: null } }],
    });
    await deliverDialogText(d, 'email', 'ответ');
    expect(m.sendEmailReply).toHaveBeenCalledWith({
      to: 'a@b.ru',
      subject: null,
      text: 'ответ',
      inReplyTo: null,
    });
  });

  it('строка истории без письма (`inboundMessage: null`) — тоже не помеха', async () => {
    const d = dialog({ peerRef: 'a@b.ru', messages: [{ inboundMessage: null }] });
    await deliverDialogText(d, 'email', 'ответ');
    expect(m.sendEmailReply).toHaveBeenCalledWith(
      expect.objectContaining({ subject: null, inReplyTo: null })
    );
  });

  it('почта не приняла письмо → понятная причина, а не пустой отказ', async () => {
    m.sendEmailReply.mockResolvedValue({ ok: false });
    await expect(deliverDialogText(emailDialog, 'email', 'ответ')).resolves.toEqual({
      ok: false,
      error: 'Почта не приняла письмо',
    });
  });
});

describe('deliverDialogText — кабинет (`У-212`)', () => {
  it('ответ кладётся внутрь кабинета, наружу ничего не уходит', async () => {
    const d = dialog({ peerRef: 'u-7', userId: 'u-7' });
    await expect(deliverDialogText(d, 'cabinet', 'ответ')).resolves.toEqual({ ok: true });
    expect(m.deliverToCabinet).toHaveBeenCalledWith(d, 'ответ');
    expect(m.sendToMessenger).not.toHaveBeenCalled();
    expect(m.sendEmailReply).not.toHaveBeenCalled();
  });

  it('отказ кабинета передаётся как есть', async () => {
    m.deliverToCabinet.mockResolvedValue({
      ok: false,
      error: 'Не удалось положить ответ в кабинет',
    });
    await expect(deliverDialogText(dialog(), 'cabinet', 'ответ')).resolves.toEqual({
      ok: false,
      error: 'Не удалось положить ответ в кабинет',
    });
  });
});
