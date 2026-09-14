/**
 * Unit-тесты новых полей почтового транспорта (`У-205`, спека этапа 3 §3.4) —
 * `replyTo` и `headers` в `src/lib/email/transport.ts`.
 *
 * Отдельный файл от `email.transport.test.ts`: тот проверяет старый конвейер
 * (ключ, кэш клиента, ошибки Resend), этот — только сшивку письма с
 * перепиской. Главное здесь — что у обычных писем кабинета новых полей в
 * вызове Resend НЕ ПОЯВЛЯЕТСЯ вовсе: `exactOptionalPropertyTypes` различает
 * «ключа нет» и «ключ = undefined», и Resend тоже.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { ResendConstructorMock, sendMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  const ResendConstructorMock = vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  }));
  return { ResendConstructorMock, sendMock };
});

vi.mock('resend', () => ({ Resend: ResendConstructorMock }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/config/integrationSettings', () => ({
  getSettingValue: async (_prisma: unknown, key: string) =>
    key === 'email.resendApiKey' ? 'test-api-key' : null,
}));

type TransportInput = Parameters<
  NonNullable<Awaited<ReturnType<typeof import('@/lib/email/transport').defaultTransport>>>['send']
>[0];

const BASE = {
  from: 'no-reply@otsfera.ru',
  to: 'client@mail.ru',
  subject: 'Re: Вопрос по счёту',
  html: '<p>Ответ</p>',
} as const;

/** Что транспорт передал в Resend. */
async function sendThrough(input: Partial<TransportInput>): Promise<Record<string, unknown>> {
  const { defaultTransport } = await import('@/lib/email/transport');
  const transport = await defaultTransport();
  expect(transport).not.toBeNull();
  await transport!.send({ ...BASE, ...input });
  const calls = sendMock.mock.calls;
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

beforeEach(() => {
  ResendConstructorMock.mockClear();
  sendMock.mockClear();
  sendMock.mockResolvedValue({ data: { id: 'em-1' }, error: null });
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

describe('defaultTransport — Reply-To (У-205)', () => {
  it('адрес входящего ящика доходит до Resend полем replyTo', async () => {
    const call = await sendThrough({ replyTo: 'inbox@otsfera.ru' });
    expect(call.replyTo).toBe('inbox@otsfera.ru');
  });

  it('у обычного письма поля replyTo нет вовсе — ни ключа, ни undefined', async () => {
    const call = await sendThrough({});
    expect(Object.keys(call)).not.toContain('replyTo');
  });

  it('пустая строка не превращается в пустой Reply-To', async () => {
    const call = await sendThrough({ replyTo: '' });
    expect(Object.keys(call)).not.toContain('replyTo');
  });
});

describe('defaultTransport — In-Reply-To и References (У-205)', () => {
  it('оба заголовка уходят в почтовой форме написания', async () => {
    const call = await sendThrough({
      headers: { inReplyTo: '<abc@mail.ru>', references: ['<abc@mail.ru>'] },
    });
    expect(call.headers).toEqual({
      'In-Reply-To': '<abc@mail.ru>',
      References: '<abc@mail.ru>',
    });
  });

  it('цепочка References склеивается ПРОБЕЛОМ, как требует почтовый формат', async () => {
    const call = await sendThrough({
      headers: {
        inReplyTo: '<c@mail.ru>',
        references: ['<a@mail.ru>', '<b@mail.ru>', '<c@mail.ru>'],
      },
    });
    expect(call.headers).toEqual({
      'In-Reply-To': '<c@mail.ru>',
      References: '<a@mail.ru> <b@mail.ru> <c@mail.ru>',
    });
  });

  it('только In-Reply-To → в заголовках один ключ, пустого References нет', async () => {
    const call = await sendThrough({ headers: { inReplyTo: '<abc@mail.ru>' } });
    expect(call.headers).toEqual({ 'In-Reply-To': '<abc@mail.ru>' });
  });

  it('только References → в заголовках один ключ', async () => {
    const call = await sendThrough({ headers: { references: ['<abc@mail.ru>'] } });
    expect(call.headers).toEqual({ References: '<abc@mail.ru>' });
  });

  it.each([
    ['поля нет', undefined],
    ['пустой объект', {}],
    ['пустой список ссылок', { references: [] }],
  ])('%s → ключа headers в вызове Resend нет вовсе', async (_name, headers) => {
    const call = await sendThrough(headers === undefined ? {} : { headers });
    expect(Object.keys(call)).not.toContain('headers');
  });
});

describe('defaultTransport — старые письма не изменились', () => {
  it('письмо без новых полей уходит ровно тем же набором ключей, что и до этапа 3', async () => {
    const call = await sendThrough({ text: 'Ответ' });
    expect(call).toEqual({
      from: 'no-reply@otsfera.ru',
      to: 'client@mail.ru',
      subject: 'Re: Вопрос по счёту',
      html: '<p>Ответ</p>',
      text: 'Ответ',
    });
  });

  it('ответ менеджера несёт и вложение, и сшивку одновременно', async () => {
    const call = await sendThrough({
      text: 'Счёт во вложении',
      attachments: [{ filename: 'Счёт.pdf', content: Buffer.from('pdf') }],
      replyTo: 'inbox@otsfera.ru',
      headers: { inReplyTo: '<abc@mail.ru>', references: ['<abc@mail.ru>'] },
    });
    expect(call.attachments).toEqual([{ filename: 'Счёт.pdf', content: Buffer.from('pdf') }]);
    expect(call.replyTo).toBe('inbox@otsfera.ru');
    expect(call.headers).toEqual({
      'In-Reply-To': '<abc@mail.ru>',
      References: '<abc@mail.ru>',
    });
  });
});

describe('defaultTransport — отказ Resend отличим от успеха', () => {
  it('отвергнутое письмо помечается failed и не выдаётся за отправленное', async () => {
    // Resend отверг письмо (битый адрес, лимит, отозванный ключ). Раньше
    // транспорт отдавал `{ id: null }` — ровно то же, что при удачной
    // отправке без id, и ответ ложился в диалог как доставленный, хотя клиент
    // его не получал.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendMock.mockResolvedValue({ data: null, error: { message: 'invalid recipient' } });

    const { defaultTransport } = await import('@/lib/email/transport');
    const transport = await defaultTransport();
    const result = await transport!.send({ ...BASE, replyTo: 'inbox@otsfera.ru' });

    expect(result).toEqual({ id: null, failed: true });
    expect(error).toHaveBeenCalledWith('[email] Resend API error', expect.anything());
    error.mockRestore();
  });
});
