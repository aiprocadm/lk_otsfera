import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const m = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  recordOutboundInDialog: vi.fn(),
  sendToMessenger: vi.fn(),
  isMessengerAvailable: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: m.recordAudit }));
vi.mock('@/lib/services/messengers/recordOutbound', () => ({
  recordOutboundInDialog: m.recordOutboundInDialog,
}));
vi.mock('@/lib/services/messengers/transport', () => ({ sendToMessenger: m.sendToMessenger }));
vi.mock('@/lib/services/messengers/channels', async () => ({
  ...(await vi.importActual<typeof import('@/lib/services/messengers/channels')>(
    '@/lib/services/messengers/channels'
  )),
  isMessengerAvailable: m.isMessengerAvailable,
}));

import { DIALOG_MESSAGE_MAX, sendDialogMessage } from '@/lib/services/messengers/send';

/**
 * Ответ из диалога (спека 2026-09-12 §4 `send.ts`): порядок проверок, правило
 * первого ответившего, история и аудит — в том числе для неудачной отправки.
 */
const findUnique = vi.fn();
const updateMany = vi.fn();
const prisma = { messengerDialog: { findUnique, updateMany } } as unknown as PrismaClient;
const session = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;
const bound = { id: 'd1', channel: 'telegram', peerRef: 'chat-1', companyId: 'c1' };

describe('sendDialogMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(bound);
    m.isMessengerAvailable.mockReturnValue(true);
    m.sendToMessenger.mockResolvedValue({ ok: true });
    m.recordOutboundInDialog.mockResolvedValue({ dialogId: 'd1', messageId: 'mm1' });
    updateMany.mockResolvedValue({ count: 1 });
  });

  it('сессия без компании → forbidden, база не спрашивается', async () => {
    const r = await sendDialogMessage(
      prisma,
      { ...session, companyId: null },
      {
        dialogId: 'd1',
        text: 'x',
      }
    );
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('нет диалога или чужая компания → not_found', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(sendDialogMessage(prisma, session, { dialogId: 'x', text: 'x' })).resolves.toEqual(
      {
        ok: false,
        error: 'not_found',
      }
    );
    findUnique.mockResolvedValueOnce({ ...bound, companyId: 'other' });
    await expect(
      sendDialogMessage(prisma, session, { dialogId: 'd1', text: 'x' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    expect(m.sendToMessenger).not.toHaveBeenCalled();
  });

  it('пустой текст → invalid; длиннее предела → text_too_long; канал не подключён → channel_unavailable', async () => {
    await expect(
      sendDialogMessage(prisma, session, { dialogId: 'd1', text: '   ' })
    ).resolves.toEqual({ ok: false, error: 'invalid' });
    await expect(
      sendDialogMessage(prisma, session, {
        dialogId: 'd1',
        text: 'a'.repeat(DIALOG_MESSAGE_MAX + 1),
      })
    ).resolves.toEqual({ ok: false, error: 'text_too_long' });
    m.isMessengerAvailable.mockReturnValueOnce(false);
    await expect(
      sendDialogMessage(prisma, session, { dialogId: 'd1', text: 'ок' })
    ).resolves.toEqual({ ok: false, error: 'channel_unavailable' });
    expect(m.sendToMessenger).not.toHaveBeenCalled();
  });

  it('привязанный диалог: отправка обрезанного текста, история, аудит, без «захвата»', async () => {
    const r = await sendDialogMessage(prisma, session, { dialogId: 'd1', text: '  привет  ' });
    expect(r).toEqual({ ok: true, messageId: 'mm1' });
    expect(m.sendToMessenger).toHaveBeenCalledWith('telegram', 'chat-1', 'привет');
    expect(updateMany).not.toHaveBeenCalled();
    expect(m.recordOutboundInDialog).toHaveBeenCalledWith(prisma, {
      channel: 'telegram',
      peerRef: 'chat-1',
      authorId: 'm1',
      text: 'привет',
      delivered: true,
    });
    expect(m.recordAudit).toHaveBeenCalledTimes(1);
    expect(m.recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'messenger_message_sent',
      entity: 'messenger_dialog',
      entityId: 'd1',
      userId: 'm1',
      after: { channel: 'telegram', delivered: true },
    });
  });

  it('ничей диалог: первый ответивший забирает его в свою компанию (аудит привязки)', async () => {
    findUnique.mockResolvedValueOnce({ ...bound, companyId: null });
    await sendDialogMessage(prisma, session, { dialogId: 'd1', text: 'здравствуйте' });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', companyId: null },
      data: { companyId: 'c1' },
    });
    expect(m.recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'messenger_dialog_bound',
        after: { companyId: 'c1', reason: 'first_reply' },
      })
    );
    expect(m.recordAudit).toHaveBeenCalledTimes(2);
  });

  it('кто-то привязал диалог за это время → захват не состоялся, аудита привязки нет', async () => {
    findUnique.mockResolvedValueOnce({ ...bound, companyId: null });
    updateMany.mockResolvedValueOnce({ count: 0 });
    await sendDialogMessage(prisma, session, { dialogId: 'd1', text: 'здравствуйте' });
    expect(m.recordAudit).toHaveBeenCalledTimes(1);
    expect(m.recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'messenger_message_sent' })
    );
  });

  it('транспорт не доставил → reply_failed, но попытка остаётся в истории и аудите', async () => {
    m.sendToMessenger.mockResolvedValueOnce({ ok: false });
    const r = await sendDialogMessage(prisma, session, { dialogId: 'd1', text: 'не дойдёт' });
    expect(r).toEqual({ ok: false, error: 'reply_failed' });
    expect(m.recordOutboundInDialog).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ delivered: false })
    );
    expect(m.recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ after: { channel: 'telegram', delivered: false } })
    );
  });
});
