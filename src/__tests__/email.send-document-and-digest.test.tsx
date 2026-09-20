import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Две ветки отправки, которых не касались прежние тесты: документ заказчику с
 * вложением (`У-149`) и дневной дайджест (`У-230`), плюс отказ провайдера
 * (`У-205`).
 *
 * Главное здесь — **вложение опционально**: если файл прочитать не удалось,
 * письмо со ссылкой в кабинет всё равно полезнее молчания. И **свой текст
 * меняет только тему и текст** — вёрстка остаётся общей, иначе первое же
 * отредактированное письмо выглядело бы как спам.
 */
const transport = vi.hoisted(() => ({ send: vi.fn() }));
const cfg = vi.hoisted(() => ({
  isEmailEnabled: vi.fn(),
  getEmailFrom: vi.fn(),
  defaultTransport: vi.fn(),
}));
vi.mock('@/lib/email/transport', () => ({
  isEmailEnabled: cfg.isEmailEnabled,
  getEmailFrom: cfg.getEmailFrom,
  defaultTransport: cfg.defaultTransport,
}));

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { warn: logWarn, error: vi.fn(), info: vi.fn() } }));

import { send, sendOrgDocumentSentEmail, sendDailyDigestEmail } from '@/lib/email/send';

const DOC = {
  to: 'client@x.ru',
  organizationName: 'ООО «Ромашка»',
  documentType: 'Акт',
  documentNumber: 'А-12',
  documentName: 'Акт №12.pdf',
  documentUrl: 'https://lk.example/organization/documents/d1',
  orderNumber: 'З-2026-001',
  orderTitle: 'Обучение',
};

beforeEach(() => {
  vi.clearAllMocks();
  cfg.isEmailEnabled.mockResolvedValue(true);
  cfg.getEmailFrom.mockResolvedValue('no-reply@otsfera.ru');
  cfg.defaultTransport.mockResolvedValue(transport);
  transport.send.mockResolvedValue({ failed: false, id: 'msg-1' });
});

describe('send — общий конвейер', () => {
  it('провайдер отказал — «не отправлено», а не «отправлено»', async () => {
    transport.send.mockResolvedValue({ failed: true });

    await expect(send({ to: 'a@x.ru', subject: 'т', html: '<p>т</p>' })).resolves.toEqual({
      status: 'failed',
      reason: 'provider',
    });
  });

  it('нет получателя — пропускаем, не ходя в транспорт', async () => {
    await expect(send({ to: '', subject: 'т', html: '<p>т</p>' })).resolves.toEqual({
      status: 'skipped',
      reason: 'no-recipient',
    });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('почта выключена — пропускаем', async () => {
    cfg.isEmailEnabled.mockResolvedValue(false);

    await expect(send({ to: 'a@x.ru', subject: 'т', html: '<p>т</p>' })).resolves.toEqual({
      status: 'skipped',
      reason: 'disabled',
    });
  });

  it('включена, но ключа нет — предупреждаем в журнале', async () => {
    cfg.defaultTransport.mockResolvedValue(null);

    const res = await send({ to: 'a@x.ru', subject: 'т', html: '<p>т</p>' });

    expect(res).toEqual({ status: 'skipped', reason: 'no-api-key' });
    expect(logWarn).toHaveBeenCalledWith(
      '[email] отправка включена, но не задан ключ Resend — письмо пропущено'
    );
  });
});

describe('sendOrgDocumentSentEmail — документ заказчику', () => {
  it('вложение уходит вместе с письмом', async () => {
    const attachments = [{ filename: 'Акт.pdf', content: Buffer.from('x') }];

    const res = await sendOrgDocumentSentEmail({ ...DOC, attachments });

    expect(res).toEqual({ status: 'sent', id: 'msg-1' });
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ attachments }));
  });

  it('без вложения письмо всё равно уходит — ссылка в кабинет полезнее молчания', async () => {
    const res = await sendOrgDocumentSentEmail(DOC);

    expect(res).toEqual({ status: 'sent', id: 'msg-1' });
    const sent = transport.send.mock.calls[0]?.[0] as { attachments?: unknown; html: string };
    expect(sent.attachments).toBeUndefined();
    // Ссылка в кабинет на месте — за ней человек и придёт, если вложения нет.
    expect(sent.html).toContain('https://lk.example/organization/documents/d1');
  });

  it('свой текст меняет тему и текст, но не вёрстку', async () => {
    await sendOrgDocumentSentEmail({
      ...DOC,
      override: { subject: 'Ваши документы', text: 'Здравствуйте!', recipientName: 'Пётр' },
    });

    const sent = transport.send.mock.calls[0]?.[0] as { subject: string; html: string };
    expect(sent.subject).toBe('Ваши документы');
    expect(sent.html).toContain('Здравствуйте!');
    // Вёрстка общая: письмо остаётся полноценным документом с оболочкой.
    expect(sent.html).toContain('<!DOCTYPE html>');
  });
});

describe('sendDailyDigestEmail — дневной дайджест', () => {
  it('одно письмо на все события окна', async () => {
    const res = await sendDailyDigestEmail({
      to: 'user@x.ru',
      recipientName: 'Пётр',
      period: 'за 20 сентября',
      count: 2,
      moreCount: 0,
      cabinetUrl: 'https://lk.example/organization',
      itemsText: 'Новый документ\nОплата',
      items: [
        { title: 'Новый документ', body: 'Акт №1', url: 'https://lk.example/d/1' },
        { title: 'Оплата', body: 'Поступила оплата', url: 'https://lk.example/p/1' },
      ],
    } as never);

    expect(res).toEqual({ status: 'sent', id: 'msg-1' });
    const sent = transport.send.mock.calls[0]?.[0] as { html: string; text?: string };
    expect(sent.html).toContain('Новый документ');
    expect(sent.text).toContain('Оплата');
  });
});
