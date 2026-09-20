import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Заголовки ответного письма (`У-205`) — **поведенчески**, а не по тексту
 * исходника.
 *
 * Найдено прогоном сопровождения (проверка `С-5`, мутация стража): прежний
 * страж `messengers.email-two-way` искал в файле слово `inReplyTo` и потому
 * молчал на самом вероятном регрессе — заголовок убрали из письма, а условие
 * `args.inReplyTo ? …` осталось, и слово в файле нашлось.
 *
 * Что здесь проверяется по существу:
 *
 * — **`Reply-To` — адрес входящего ящика.** Без него ответ клиента уйдёт на
 *   `no-reply`, и переписка оборвётся ровно там, где требование обещало
 *   двусторонность.
 * — **`In-Reply-To` и `References`** сшивают ответ с письмом клиента. Без них
 *   ответ встанет в почтовом клиенте отдельным письмом, и человек решит, что
 *   ему не ответили.
 * — **Ящик не настроен — честный отказ.** «Отправлено» с `no-reply` хуже
 *   отказа: сотрудник не узнает, что письмо ушло в никуда.
 */
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getSettingValue: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@/lib/email/send', () => ({ send: mocks.send }));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingValue: mocks.getSettingValue }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/logging', () => ({
  log: { warn: mocks.logWarn, error: vi.fn(), info: vi.fn() },
}));

import { sendEmailReply } from '@/lib/services/inbound/emailReply';

const ARGS = {
  to: 'client@mail.ru',
  subject: 'Вопрос по счёту',
  text: 'Здравствуйте! Счёт отправлен.',
  inReplyTo: '<abc@mail.ru>',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettingValue.mockResolvedValue('  support@otsfera.ru  ');
  mocks.send.mockResolvedValue({ status: 'sent', id: 'e1' });
});

describe('sendEmailReply — заголовки письма', () => {
  it('ответ несёт Reply-To на входящий ящик и сшивку с письмом клиента', async () => {
    const res = await sendEmailReply(ARGS);

    expect(res).toEqual({ ok: true });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'client@mail.ru',
        // Пробелы по краям срезаны: адрес с пробелом почтовый сервер отвергнет.
        replyTo: 'support@otsfera.ru',
        headers: { inReplyTo: '<abc@mail.ru>', references: ['<abc@mail.ru>'] },
      })
    );
  });

  it('Message-ID письма неизвестен — заголовков сшивки нет ВОВСЕ, а не пустые', async () => {
    await sendEmailReply({ ...ARGS, inReplyTo: null });

    // Пустой `headers` почтовые клиенты трактуют по-своему; отсутствие ключа
    // однозначно означает «сшивать не с чем».
    expect(mocks.send.mock.calls[0]?.[0]).not.toHaveProperty('headers');
  });

  it('входящий ящик не настроен — честный отказ, письмо не уходит', async () => {
    mocks.getSettingValue.mockResolvedValue('не-адрес');

    const res = await sendEmailReply(ARGS);

    expect(res).toEqual({ ok: false });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('пустой адрес получателя — отказ до всякой настройки', async () => {
    const res = await sendEmailReply({ ...ARGS, to: '   ' });

    expect(res).toEqual({ ok: false });
    expect(mocks.getSettingValue).not.toHaveBeenCalled();
  });

  it.each([
    ['почта выключена', 'skipped'],
    ['провайдер отказал', 'failed'],
  ])('%s — это НЕ отправка', async (_name, status) => {
    mocks.send.mockResolvedValue({ status });

    // Иначе история диалога показала бы ответ, которого клиент не получил.
    await expect(sendEmailReply(ARGS)).resolves.toEqual({ ok: false });
  });

  it('база недоступна — контракт «{ ok } без исключений» держится', async () => {
    mocks.getSettingValue.mockRejectedValue(new Error('db down'));

    await expect(sendEmailReply(ARGS)).resolves.toEqual({ ok: false });
    expect(mocks.logWarn).toHaveBeenCalled();
  });
});
