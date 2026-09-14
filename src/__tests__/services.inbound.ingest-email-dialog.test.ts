/**
 * Unit-тесты свёртки письма в диалог при приёме (`У-205`, спека этапа 3 §3.4) —
 * `ingestInboundMessage` в `src/lib/services/inbound/ingest.ts`.
 *
 * Главное здесь — КЛЮЧ диалога. У почты он строится в трёх местах (приём,
 * ответ из «Входящих», бэкфилл), и если хоть одно из них не приведёт адрес к
 * нижнему регистру, на одного человека заведутся два диалога и переписка
 * разойдётся надвое. Этот файл держит первое из трёх мест.
 *
 * Сам диалог (upsert, счётчики, уведомления) проверяется интеграционно
 * (`messengers.appendInbound.integration`) — здесь только то, ЧЕМ его зовут.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const m = vi.hoisted(() => ({
  appendInboundToDialog: vi.fn(),
  resolveInboundSender: vi.fn(),
  writeSyncLog: vi.fn(),
  queueAdd: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/lib/services/messengers/appendInbound', () => ({
  appendInboundToDialog: m.appendInboundToDialog,
}));
vi.mock('@/lib/services/inbound/resolve', () => ({ resolveInboundSender: m.resolveInboundSender }));
vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog: m.writeSyncLog }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: m.queueAdd }) }));

import { ingestInboundMessage } from '@/lib/services/inbound/ingest';

const prisma = {
  inboundMessage: { findUnique: m.findUnique, create: m.create },
} as unknown as PrismaClient;

/** Аргументы последней свёртки в диалог. */
function lastAppend(): Record<string, unknown> {
  expect(m.appendInboundToDialog).toHaveBeenCalled();
  const calls = m.appendInboundToDialog.mock.calls;
  return calls[calls.length - 1]![1] as Record<string, unknown>;
}

/** Данные последней записи письма во «Входящие». */
function lastCreateData(): Record<string, unknown> {
  expect(m.create).toHaveBeenCalled();
  const calls = m.create.mock.calls;
  return (calls[calls.length - 1]![0] as { data: Record<string, unknown> }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.findUnique.mockResolvedValue(null);
  m.create.mockResolvedValue({ id: 'im-1' });
  m.resolveInboundSender.mockResolvedValue({ matchType: 'unresolved' });
  m.appendInboundToDialog.mockResolvedValue({
    ok: true,
    dialogId: 'd-1',
    messageId: 'mm-1',
    deduped: false,
  });
});

describe('ingestInboundMessage — письмо становится репликой диалога', () => {
  it('письмо сворачивается в диалог канала «email»', async () => {
    const result = await ingestInboundMessage(prisma, {
      channel: 'email',
      externalId: 'email:42-7',
      senderRef: 'ivan@mail.ru',
      senderDisplay: 'Иван Петров',
      subject: 'Вопрос по счёту',
      body: 'Добрый день!',
      externalMessageId: '<abc@mail.ru>',
    });

    expect(result).toEqual({ ok: true, id: 'im-1', deduped: false });
    expect(m.appendInboundToDialog).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        inboundMessageId: 'im-1',
        channel: 'email',
        peerRef: 'ivan@mail.ru',
        peerDisplay: 'Иван Петров',
        body: 'Добрый день!',
        externalId: 'email:42-7',
      })
    );
  });

  it('адрес нормализуется: «Ivan@Mail.RU» и «ivan@mail.ru» дают ОДИН ключ диалога', async () => {
    await ingestInboundMessage(prisma, {
      channel: 'email',
      externalId: 'email:42-7',
      senderRef: '  Ivan@Mail.RU ',
      body: 'первое письмо',
    });
    expect(lastAppend().peerRef).toBe('ivan@mail.ru');

    await ingestInboundMessage(prisma, {
      channel: 'email',
      externalId: 'email:42-8',
      senderRef: 'ivan@mail.ru',
      body: 'второе письмо',
    });
    expect(lastAppend().peerRef).toBe('ivan@mail.ru');

    // Два письма — два вызова, но ключ один: диалог-двойника не будет.
    const keys = m.appendInboundToDialog.mock.calls.map(
      (call) => (call[1] as { peerRef: string }).peerRef
    );
    expect(keys).toEqual(['ivan@mail.ru', 'ivan@mail.ru']);
  });

  it('Message-ID письма пишется в строку «Входящих» — по нему сошьётся ответ', async () => {
    await ingestInboundMessage(prisma, {
      channel: 'email',
      externalId: 'email:42-7',
      senderRef: 'ivan@mail.ru',
      body: 'x',
      externalMessageId: '<abc@mail.ru>',
    });
    expect(lastCreateData().externalMessageId).toBe('<abc@mail.ru>');
  });

  it('письмо без Message-ID (сервер его не прислал) принимается с пустым полем', async () => {
    await ingestInboundMessage(prisma, {
      channel: 'email',
      externalId: 'email:42-9',
      senderRef: 'ivan@mail.ru',
      body: 'x',
    });
    expect(lastCreateData().externalMessageId).toBeNull();
  });

  it('Message-ID НЕ доезжает до реплики диалога', async () => {
    // ДЕФЕКТ (в отчёт): спека §3.4 требовала класть `Message-ID` в
    // `MessengerMessage.externalId`, а туда уходит `externalId` письма
    // (`email:<uid>`). Ответ из карточки диалога (а не из «Входящих») взять
    // идентификатор ветки неоткуда — сшивки не будет. Тест фиксирует факт.
    await ingestInboundMessage(prisma, {
      channel: 'email',
      externalId: 'email:42-7',
      senderRef: 'ivan@mail.ru',
      body: 'x',
      externalMessageId: '<abc@mail.ru>',
    });
    expect(lastAppend().externalId).toBe('email:42-7');
    expect(Object.values(lastAppend())).not.toContain('<abc@mail.ru>');
  });

  it('повторное письмо (тот же externalId) второй диалог не плодит', async () => {
    m.findUnique.mockResolvedValue({ id: 'im-1' });

    const result = await ingestInboundMessage(prisma, {
      channel: 'email',
      externalId: 'email:42-7',
      senderRef: 'ivan@mail.ru',
      body: 'Добрый день!',
      externalMessageId: '<abc@mail.ru>',
    });

    expect(result).toEqual({ ok: true, id: 'im-1', deduped: true });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.appendInboundToDialog).not.toHaveBeenCalled();
  });

  it('распознанный отправитель письма отдаёт диалогу свою привязку', async () => {
    m.resolveInboundSender.mockResolvedValue({
      matchType: 'exact',
      companyId: 'c-1',
      orgId: 'o-1',
      contactId: 'k-1',
      userId: 'u-1',
    });

    await ingestInboundMessage(prisma, {
      channel: 'email',
      externalId: 'email:42-7',
      senderRef: 'Ivan@Mail.RU',
      body: 'x',
    });

    expect(lastAppend().binding).toEqual({
      companyId: 'c-1',
      organizationId: 'o-1',
      contactId: 'k-1',
      userId: 'u-1',
    });
  });

  it('сбой свёртки письма в диалог не отменяет приём письма', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.appendInboundToDialog.mockRejectedValueOnce(new Error('dialog db down'));

    const result = await ingestInboundMessage(prisma, {
      channel: 'email',
      externalId: 'email:42-7',
      senderRef: 'ivan@mail.ru',
      body: 'x',
    });

    expect(result).toEqual({ ok: true, id: 'im-1', deduped: false });
    expect(error).toHaveBeenCalledWith(
      '[inbound/ingest] dialog append failed',
      expect.objectContaining({ inboundMessageId: 'im-1' })
    );
    error.mockRestore();
  });
});

describe('ingestInboundMessage — мессенджеры сворачиваются как раньше', () => {
  it.each([
    ['telegram', 'ChatID-77'],
    ['max', 'MX-77'],
    ['whatsapp', '+79990001122'],
  ] as const)(
    '%s: ключ диалога — адрес как есть, без приведения к нижнему регистру',
    async (channel, senderRef) => {
      await ingestInboundMessage(prisma, {
        channel,
        externalId: `${channel}:1:1`,
        senderRef,
        body: 'привет',
      });
      expect(lastAppend()).toMatchObject({ channel, peerRef: senderRef });
    }
  );

  it('вопрос из кабинета в диалог по-прежнему не сворачивается', async () => {
    await ingestInboundMessage(prisma, {
      channel: 'cabinet',
      externalId: 'cab:1',
      senderRef: 'u-1',
      body: 'вопрос',
      sender: { userId: 'u-1', organizationId: 'o-1', companyId: 'c-1' },
    });
    expect(m.appendInboundToDialog).not.toHaveBeenCalled();
  });
});
