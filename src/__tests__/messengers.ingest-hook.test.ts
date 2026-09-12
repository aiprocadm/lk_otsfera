import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const m = vi.hoisted(() => ({
  appendInboundToDialog: vi.fn(),
  resolveInboundSender: vi.fn(),
  writeSyncLog: vi.fn(),
  queueAdd: vi.fn(),
}));
vi.mock('@/lib/services/messengers/appendInbound', () => ({
  appendInboundToDialog: m.appendInboundToDialog,
}));
vi.mock('@/lib/services/inbound/resolve', () => ({
  resolveInboundSender: m.resolveInboundSender,
}));
vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog: m.writeSyncLog }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: m.queueAdd }) }));

import { ingestInboundMessage } from '@/lib/services/inbound/ingest';

/**
 * Хук «письмо из мессенджера → реплика диалога» в `ingestInboundMessage`
 * (спека 2026-09-12, Р-М-1). Сам диалог проверяется интеграционно
 * (`messengers.appendInbound.integration`); здесь — что ingest зовёт его с
 * привязкой резолвера, не зовёт для почты и кабинета и не падает от его сбоя.
 */
const prisma = {
  inboundMessage: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'im-1' }),
  },
} as unknown as PrismaClient;

describe('ingestInboundMessage → appendInboundToDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.appendInboundToDialog.mockResolvedValue({
      ok: true,
      dialogId: 'd1',
      messageId: 'mm1',
      deduped: false,
    });
  });

  it('распознанный отправитель → реплика с привязкой резолвера', async () => {
    m.resolveInboundSender.mockResolvedValue({
      matchType: 'exact',
      companyId: 'c1',
      orgId: 'o1',
      contactId: 'k1',
      userId: 'u1',
    });
    const r = await ingestInboundMessage(prisma, {
      channel: 'telegram',
      externalId: 'tg:1:1',
      senderRef: 'chat-1',
      senderDisplay: 'Иван',
      body: 'привет',
    });
    expect(r).toEqual({ ok: true, id: 'im-1', deduped: false });
    expect(m.appendInboundToDialog).toHaveBeenCalledWith(prisma, {
      inboundMessageId: 'im-1',
      channel: 'telegram',
      peerRef: 'chat-1',
      peerDisplay: 'Иван',
      body: 'привет',
      externalId: 'tg:1:1',
      binding: { companyId: 'c1', organizationId: 'o1', contactId: 'k1', userId: 'u1' },
    });
  });

  it('нераспознанный отправитель → реплика без привязки; пустые contact/user → null', async () => {
    m.resolveInboundSender.mockResolvedValue({ matchType: 'unresolved' });
    await ingestInboundMessage(prisma, {
      channel: 'max',
      externalId: 'max:1:1',
      senderRef: 'mx-1',
      body: 'кто здесь',
    });
    expect(m.appendInboundToDialog).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ channel: 'max', peerRef: 'mx-1', binding: null })
    );

    m.appendInboundToDialog.mockClear();
    m.resolveInboundSender.mockResolvedValue({ matchType: 'exact', companyId: 'c1', orgId: 'o1' });
    await ingestInboundMessage(prisma, {
      channel: 'whatsapp',
      externalId: 'wa:1:1',
      senderRef: '+79990001122',
      body: 'x',
    });
    expect(m.appendInboundToDialog).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        binding: { companyId: 'c1', organizationId: 'o1', contactId: null, userId: null },
      })
    );
  });

  it('почта и вопрос из кабинета в диалог не попадают', async () => {
    m.resolveInboundSender.mockResolvedValue({ matchType: 'unresolved' });
    await ingestInboundMessage(prisma, {
      channel: 'email',
      externalId: 'mail:1',
      senderRef: 'a@b.test',
      body: 'письмо',
    });
    await ingestInboundMessage(prisma, {
      channel: 'cabinet',
      externalId: 'cab:1',
      senderRef: 'u1',
      body: 'вопрос',
      sender: { userId: 'u1', organizationId: 'o1', companyId: 'c1' },
    });
    expect(m.appendInboundToDialog).not.toHaveBeenCalled();
  });

  it('сбой диалога логируется и не ломает приём (вебхук отвечает 200)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.resolveInboundSender.mockResolvedValue({ matchType: 'unresolved' });
    m.appendInboundToDialog.mockRejectedValueOnce(new Error('dialog db down'));
    const r = await ingestInboundMessage(prisma, {
      channel: 'telegram',
      externalId: 'tg:2:2',
      senderRef: 'chat-2',
      body: 'x',
    });
    expect(r).toEqual({ ok: true, id: 'im-1', deduped: false });
    expect(error).toHaveBeenCalledWith(
      '[inbound/ingest] dialog append failed',
      expect.objectContaining({ inboundMessageId: 'im-1', error: 'dialog db down' })
    );

    // Не-Error значение стрингифицируется.
    m.appendInboundToDialog.mockRejectedValueOnce('boom');
    await ingestInboundMessage(prisma, {
      channel: 'telegram',
      externalId: 'tg:3:3',
      senderRef: 'chat-3',
      body: 'x',
    });
    expect(error).toHaveBeenLastCalledWith(
      '[inbound/ingest] dialog append failed',
      expect.objectContaining({ error: 'boom' })
    );
    error.mockRestore();
  });
});
