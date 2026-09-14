/**
 * Unit-тесты ответа менеджера на письмо (`У-205`, спека этапа 3 §3.4) —
 * `src/lib/services/inbound/emailReply.ts`.
 *
 * Здесь проверяется ровно то, из-за чего ответ «не считается ответом»:
 * тема с одним «Re:», `Reply-To` на читаемый ящик, `In-Reply-To` на письмо
 * клиента и честный признак неудачи. Отправка мокается: unit-слой не ходит ни
 * в почту, ни в базу.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ send: vi.fn(), getSettingValue: vi.fn() }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingValue: m.getSettingValue }));
vi.mock('@/lib/email/send', () => ({ send: m.send }));

import { replySubject, sendEmailReply } from '@/lib/services/inbound/emailReply';

type Args = Parameters<typeof sendEmailReply>[0];

function reply(over: Partial<Args> = {}): Args {
  return {
    to: 'client@mail.ru',
    subject: 'Вопрос по счёту',
    text: 'Добрый день! Счёт отправили.',
    inReplyTo: null,
    ...over,
  };
}

/** Последний вызов `send` — то, что реально ушло бы в почтовый транспорт. */
function lastSend(): Record<string, unknown> {
  expect(m.send).toHaveBeenCalled();
  const calls = m.send.mock.calls;
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getSettingValue.mockResolvedValue('inbox@otsfera.ru');
  m.send.mockResolvedValue({ status: 'sent', id: 'em-1' });
});

describe('replySubject — «Re:» ставится один раз', () => {
  it('к обычной теме «Re:» добавляется', () => {
    expect(replySubject('Вопрос по счёту')).toBe('Re: Вопрос по счёту');
  });

  it('к уже отвеченной теме второе «Re:» не приклеивается — ни строчным, ни прописным', () => {
    expect(replySubject('Re: Вопрос по счёту')).toBe('Re: Вопрос по счёту');
    expect(replySubject('RE: Вопрос по счёту')).toBe('RE: Вопрос по счёту');
    expect(replySubject('  Re: Вопрос  ')).toBe('Re: Вопрос');
  });

  it('пустая тема превращается в «Re: ваше обращение», а не в пустую строку', () => {
    expect(replySubject('')).toBe('Re: ваше обращение');
    expect(replySubject('   ')).toBe('Re: ваше обращение');
    expect(replySubject(null)).toBe('Re: ваше обращение');
    expect(replySubject(undefined)).toBe('Re: ваше обращение');
  });
});

describe('sendEmailReply — адрес получателя', () => {
  it('пустой адрес → отказ БЕЗ попытки отправки', async () => {
    await expect(sendEmailReply(reply({ to: '   ' }))).resolves.toEqual({ ok: false });
    expect(m.send).not.toHaveBeenCalled();
    // Настройки тоже не читаем: отправлять всё равно некуда.
    expect(m.getSettingValue).not.toHaveBeenCalled();
  });

  it('адрес клиента уходит получателем как есть', async () => {
    await sendEmailReply(reply({ to: 'client@mail.ru' }));
    expect(lastSend().to).toBe('client@mail.ru');
  });
});

describe('sendEmailReply — тема письма', () => {
  it('в письмо уходит тема с одним «Re:»', async () => {
    await sendEmailReply(reply({ subject: 'Вопрос по счёту' }));
    expect(lastSend().subject).toBe('Re: Вопрос по счёту');

    await sendEmailReply(reply({ subject: 'RE: Вопрос по счёту' }));
    expect(lastSend().subject).toBe('RE: Вопрос по счёту');
  });

  it('письмо без темы получает «Re: ваше обращение»', async () => {
    await sendEmailReply(reply({ subject: null }));
    expect(lastSend().subject).toBe('Re: ваше обращение');
  });
});

describe('sendEmailReply — Reply-To на читаемый ящик', () => {
  it('Reply-To берётся из настройки imap.user — туда вернётся ответ клиента', async () => {
    m.getSettingValue.mockResolvedValue('  inbox@otsfera.ru  ');
    await sendEmailReply(reply());
    expect(m.getSettingValue).toHaveBeenCalledWith(expect.anything(), 'imap.user');
    expect(lastSend().replyTo).toBe('inbox@otsfera.ru');
  });

  it.each([
    ['настройки нет', null],
    ['настройка пустая', '   '],
    ['вместо адреса логин без домена', 'support'],
    ['логин с доменом Windows', 'otsfera\\support'],
  ])('%s → ответ НЕ отправляется вовсе', async (_name, value: string | null) => {
    // Без читаемого обратного адреса письмо ушло бы с «no-reply», ответ
    // клиента попал бы в несуществующий ящик, а кабинет отчитался бы
    // «отправлено» — переписка оборвалась бы молча. Честный отказ лучше:
    // сотрудник видит, что ответ не ушёл.
    m.getSettingValue.mockResolvedValue(value);
    await expect(sendEmailReply(reply())).resolves.toEqual({ ok: false });
    expect(m.send).not.toHaveBeenCalled();
  });

  it('недоступная база при чтении настройки не роняет вызов, а даёт честный отказ', async () => {
    // Контракт веток `replyToInbound` — «`{ ok }` без исключений»: падение
    // здесь превратилось бы в ошибку server-action вместо понятного кода.
    m.getSettingValue.mockRejectedValue(new Error('db down'));
    await expect(sendEmailReply(reply())).resolves.toEqual({ ok: false });
  });
});

describe('sendEmailReply — сшивка с перепиской клиента', () => {
  it('inReplyTo ставит и In-Reply-To, и References', async () => {
    await sendEmailReply(reply({ inReplyTo: '<abc@mail.ru>' }));
    expect(lastSend().headers).toEqual({
      inReplyTo: '<abc@mail.ru>',
      references: ['<abc@mail.ru>'],
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['пустая строка', ''],
  ])('без Message-ID (%s) заголовков нет вовсе', async (_name, value) => {
    await sendEmailReply(reply({ inReplyTo: value as string | null | undefined }));
    expect(Object.keys(lastSend())).not.toContain('headers');
  });
});

describe('sendEmailReply — что считается отправленным', () => {
  it('status «sent» → успех', async () => {
    m.send.mockResolvedValue({ status: 'sent', id: 'em-1' });
    await expect(sendEmailReply(reply())).resolves.toEqual({ ok: true });
  });

  it.each([
    ['почта выключена', 'disabled'],
    ['не задан ключ Resend', 'no-api-key'],
    ['нет получателя', 'no-recipient'],
  ])('пропущенное письмо (%s) НЕ выдаётся за отправленное', async (_name, reason) => {
    m.send.mockResolvedValue({ status: 'skipped', reason });
    await expect(sendEmailReply(reply())).resolves.toEqual({ ok: false });
  });

  it('исключение внутри → отказ и предупреждение в журнал, без падения вызывающего', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    m.send.mockRejectedValueOnce(new Error('resend down'));
    await expect(sendEmailReply(reply())).resolves.toEqual({ ok: false });
    expect(warn).toHaveBeenCalledWith(
      '[inbound/emailReply] send failed',
      expect.objectContaining({ error: 'resend down' })
    );

    // Не-Error значение стрингифицируется, а не роняет обработчик.
    m.send.mockRejectedValueOnce('boom');
    await expect(sendEmailReply(reply())).resolves.toEqual({ ok: false });
    expect(warn).toHaveBeenLastCalledWith(
      '[inbound/emailReply] send failed',
      expect.objectContaining({ error: 'boom' })
    );
    warn.mockRestore();
  });

  it('сбой чтения настройки даёт отказ, а не исключение наружу', async () => {
    // Контракт веток `replyToInbound` — «`{ ok }` без исключений»: падение
    // здесь превратилось бы в ошибку server-action вместо понятного кода.
    m.getSettingValue.mockRejectedValueOnce(new Error('db down'));
    await expect(sendEmailReply(reply())).resolves.toEqual({ ok: false });
    expect(m.send).not.toHaveBeenCalled();
  });
});

describe('sendEmailReply — разметка письма', () => {
  it('текст менеджера экранируется: тег из письма не становится разметкой', async () => {
    await sendEmailReply(reply({ text: '<script>alert("хак")</script> & <b>жирно</b>' }));
    const sent = lastSend();
    const html = String(sent.html);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>жирно</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;хак&quot;');
    // Текстовая версия остаётся как написал менеджер — её никто не разбирает.
    expect(sent.text).toBe('<script>alert("хак")</script> & <b>жирно</b>');
  });

  it('переносы строк сохраняются вёрсткой, а не превращаются в один абзац', async () => {
    await sendEmailReply(reply({ text: 'первая строка\nвторая строка' }));
    const html = String(lastSend().html);
    expect(html).toContain('white-space:pre-wrap');
    expect(html).toContain('первая строка\nвторая строка');
  });
});
