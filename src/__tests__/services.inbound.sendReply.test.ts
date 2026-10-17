/**
 * Unit-тесты сервиса `sendInboundReply` (src/lib/services/inbound/sendReply.ts):
 * C8-скоуп сообщения, коды отказов транспорта, best-effort зеркало в тред и
 * порядок побочных эффектов (транспорт → зеркало → аудит → sync-log).
 * Тонкий экшен-адаптер проверяется в server-actions.inbound.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const {
  replyToInbound,
  recordAudit,
  notifyOrgUsers,
  writeSyncLog,
  recordOutboundInDialog,
  inboundMessageFindUnique,
  orderFindUnique,
  orderThreadUpdate,
  messageCreate,
} = vi.hoisted(() => ({
  replyToInbound: vi.fn(),
  recordAudit: vi.fn(),
  notifyOrgUsers: vi.fn(),
  writeSyncLog: vi.fn(),
  recordOutboundInDialog: vi.fn(),
  inboundMessageFindUnique: vi.fn(),
  orderFindUnique: vi.fn(),
  orderThreadUpdate: vi.fn(),
  messageCreate: vi.fn(),
}));

// `У-316`: подпись письма собирает свой модуль — здесь он подменён.
const { emailSignatureFor } = vi.hoisted(() => ({
  emailSignatureFor: vi.fn(async () => '-- \nС уважением,\nМенеджер'),
}));
vi.mock('@/lib/services/inbound/emailSignature', () => ({ emailSignatureFor }));
vi.mock('@/lib/services/inbound/reply', () => ({ replyToInbound }));
vi.mock('@/lib/services/messengers/recordOutbound', () => ({ recordOutboundInDialog }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers }));
vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    inboundMessage: { findUnique: inboundMessageFindUnique },
    order: { findUnique: orderFindUnique },
    orderThread: { update: orderThreadUpdate },
    message: { create: messageCreate },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { sendInboundReply } from '@/lib/services/inbound/sendReply';

function managerSession(opts: { sub?: string; companyId?: string | null } = {}): SessionPayload {
  return {
    sub: opts.sub ?? 'u-mgr-1',
    role: 'manager',
    companyId: opts.companyId ?? 'company-a',
    managedOrgIds: ['org-a'],
  };
}

let session: SessionPayload = managerSession();

describe('sendInboundReply (service)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session = managerSession();
  });

  it('returns not_found when the inbound message does not exist', async () => {
    inboundMessageFindUnique.mockResolvedValue(null);

    const result = await sendInboundReply(prisma, session, {
      inboundMessageId: 'im-1',
      text: 'hello',
    });

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(replyToInbound).not.toHaveBeenCalled();
  });

  it('returns forbidden when the message is unresolved (companyId null)', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1',
      channel: 'telegram',
      senderRef: 'chat-1',
      subject: null,
      companyId: null,
      threadId: null,
    });

    const result = await sendInboundReply(prisma, session, {
      inboundMessageId: 'im-1',
      text: 'hello',
    });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(replyToInbound).not.toHaveBeenCalled();
  });

  it('returns forbidden when the message belongs to another company', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1',
      channel: 'telegram',
      senderRef: 'chat-1',
      subject: null,
      companyId: 'company-other',
      threadId: null,
    });

    const result = await sendInboundReply(prisma, session, {
      inboundMessageId: 'im-1',
      text: 'hello',
    });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns invalid for empty/whitespace-only text', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1',
      channel: 'telegram',
      senderRef: 'chat-1',
      subject: null,
      companyId: 'company-a',
      threadId: null,
    });

    const result = await sendInboundReply(prisma, session, {
      inboundMessageId: 'im-1',
      text: '   ',
    });

    expect(result).toEqual({ ok: false, error: 'invalid' });
    expect(replyToInbound).not.toHaveBeenCalled();
  });

  it('у почты отказ отправки — такой же reply_failed, как у остальных каналов (У-205)', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1',
      channel: 'email',
      senderRef: 'a@b.com',
      subject: 'Hi',
      companyId: 'company-a',
      threadId: null,
    });
    replyToInbound.mockResolvedValue({ ok: false });

    const result = await sendInboundReply(prisma, session, {
      inboundMessageId: 'im-1',
      text: 'hello',
    });

    // Отдельного кода «почта не поддерживается» больше нет: с У-205 она
    // отвечает наравне с мессенджерами, и её отказ — обычный отказ отправки.
    expect(result).toEqual({ ok: false, error: 'reply_failed' });
  });

  it('returns reply_failed when a non-email channel send fails', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1',
      channel: 'whatsapp',
      senderRef: '+7999',
      subject: null,
      companyId: 'company-a',
      threadId: null,
    });
    replyToInbound.mockResolvedValue({ ok: false });

    const result = await sendInboundReply(prisma, session, {
      inboundMessageId: 'im-1',
      text: 'hello',
    });

    expect(result).toEqual({ ok: false, error: 'reply_failed' });
  });

  it('succeeds for a non-email channel without a bound thread (no mirror attempted)', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1',
      channel: 'telegram',
      senderRef: 'chat-1',
      subject: null,
      companyId: 'company-a',
      threadId: null,
    });
    replyToInbound.mockResolvedValue({ ok: true });

    const result = await sendInboundReply(prisma, session, {
      inboundMessageId: 'im-1',
      text: 'hello',
    });

    expect(result).toEqual({ ok: true });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'inbound_message_replied',
        entityId: 'im-1',
        userId: 'u-mgr-1',
      })
    );
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'inbound',
        direction: 'outbound',
        operation: 'create',
        status: 'success',
      })
    );
  });

  it('`У-205`: ключ диалога у почты — НОРМАЛИЗОВАННЫЙ адрес, а не сырой отправитель', async () => {
    // Приём письма кладёт диалог под нормализованным адресом. Ответь мы под
    // сырым — завёлся бы ВТОРОЙ диалог с тем же человеком, и переписка
    // разошлась бы надвое: половина у клиента, половина у сотрудника.
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1',
      channel: 'email',
      senderRef: '  Ivan.Petrov@Mail.RU ',
      subject: 'Счёт',
      companyId: 'company-a',
      threadId: null,
    });
    replyToInbound.mockResolvedValue({ ok: true });

    expect(
      await sendInboundReply(prisma, session, { inboundMessageId: 'im-1', text: 'ответ' })
    ).toEqual({ ok: true });

    expect(recordOutboundInDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channel: 'email', peerRef: 'ivan.petrov@mail.ru' })
    );
  });

  it('mirrors into the thread and notifies org users when threadId is bound', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1',
      channel: 'telegram',
      senderRef: 'chat-1',
      subject: null,
      companyId: 'company-a',
      threadId: 'thread-1',
    });
    replyToInbound.mockResolvedValue({ ok: true });
    messageCreate.mockResolvedValue({ id: 'msg-1' });
    orderThreadUpdate.mockResolvedValue({ orderId: 'ord-1' });
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      organizationId: 'org-a',
      orderNumber: '123',
      title: 'Course',
    });
    notifyOrgUsers.mockResolvedValue({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 1 });

    const result = await sendInboundReply(prisma, session, {
      inboundMessageId: 'im-1',
      text: 'Reply text',
    });

    expect(result).toEqual({ ok: true });
    expect(messageCreate).toHaveBeenCalledWith({
      data: { threadId: 'thread-1', authorId: 'u-mgr-1', body: 'Reply text' },
    });
    expect(orderThreadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'thread-1' },
        data: expect.objectContaining({ lastMessageAt: expect.any(Date) }),
      })
    );
    expect(notifyOrgUsers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-a',
        type: 'manager_replied',
        payload: expect.objectContaining({
          orderId: 'ord-1',
          orderNumber: '123',
          orderTitle: 'Course',
          commentExcerpt: 'Reply text',
        }),
      })
    );
  });

  it('still returns ok:true when the thread mirror throws (best-effort)', async () => {
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1',
      channel: 'telegram',
      senderRef: 'chat-1',
      subject: null,
      companyId: 'company-a',
      threadId: 'thread-1',
    });
    replyToInbound.mockResolvedValue({ ok: true });
    messageCreate.mockRejectedValue(new Error('db down'));

    const result = await sendInboundReply(prisma, session, {
      inboundMessageId: 'im-1',
      text: 'hello',
    });

    expect(result).toEqual({ ok: true });
    expect(recordAudit).toHaveBeenCalled();
    expect(writeSyncLog).toHaveBeenCalled();
  });

  it('mirror failure with a non-Error value is stringified in the warn log (still ok:true)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    inboundMessageFindUnique.mockResolvedValue({
      id: 'im-1',
      channel: 'telegram',
      senderRef: 'chat-1',
      subject: null,
      companyId: 'company-a',
      threadId: 'thread-1',
    });
    replyToInbound.mockResolvedValue({ ok: true });
    messageCreate.mockRejectedValue('string-boom');

    const result = await sendInboundReply(prisma, session, {
      inboundMessageId: 'im-1',
      text: 'hello',
    });

    expect(result).toEqual({ ok: true });
    expect(warn).toHaveBeenCalledWith(
      '[inbound/replyInboundAction] thread mirror failed',
      expect.objectContaining({ error: 'string-boom' })
    );
    warn.mockRestore();
  });

  // Спека 2026-09-12 (Р-М-7): ответ из «Входящих писем» попадает в историю диалога.
  describe('история диалога мессенджера', () => {
    it('после удачной отправки в мессенджер ответ записывается в диалог с привязкой письма', async () => {
      inboundMessageFindUnique.mockResolvedValue({
        id: 'im-1',
        channel: 'whatsapp',
        senderRef: '+79990001122',
        subject: null,
        companyId: 'company-a',
        threadId: null,
        resolvedUserId: 'u-org',
        resolvedOrgId: 'org-a',
        contactId: 'k-1',
      });
      replyToInbound.mockResolvedValue({ ok: true });

      const result = await sendInboundReply(prisma, session, {
        inboundMessageId: 'im-1',
        text: '  добрый день  ',
      });

      expect(result).toEqual({ ok: true });
      expect(recordOutboundInDialog).toHaveBeenCalledWith(prisma, {
        channel: 'whatsapp',
        peerRef: '+79990001122',
        authorId: 'u-mgr-1',
        text: 'добрый день',
        delivered: true,
        binding: {
          companyId: 'company-a',
          organizationId: 'org-a',
          contactId: 'k-1',
          userId: 'u-org',
        },
      });
    });

    it('`У-212`: вопрос из кабинета — тоже диалог, ответ ложится в его ленту', async () => {
      // До PR-7 кабинет диалогом не считался, и ответ сотрудника нигде не
      // оставался: клиент его получал уведомлением, а переписки не было.
      // Ключ диалога у кабинета — идентификатор пользователя (`senderRef`),
      // адреса у этого канала не существует.
      inboundMessageFindUnique.mockResolvedValue({
        id: 'im-1',
        channel: 'cabinet',
        senderRef: 'u-org',
        subject: 'тема',
        companyId: 'company-a',
        resolvedOrgId: 'org-a',
        contactId: null,
        threadId: null,
        resolvedUserId: 'u-org',
      });
      replyToInbound.mockResolvedValue({ ok: true });

      await sendInboundReply(prisma, session, { inboundMessageId: 'im-1', text: 'ответ' });
      expect(recordOutboundInDialog).toHaveBeenCalledWith(prisma, {
        channel: 'cabinet',
        peerRef: 'u-org',
        authorId: 'u-mgr-1',
        text: 'ответ',
        delivered: true,
        // Привязка известна из самого письма — диалог кабинета не должен
        // остаться в общей очереди ничейных.
        binding: {
          companyId: 'company-a',
          organizationId: 'org-a',
          contactId: null,
          userId: 'u-org',
        },
      });
    });

    it('неудачная отправка в историю не пишется', async () => {
      inboundMessageFindUnique.mockResolvedValue({
        id: 'im-1',
        channel: 'telegram',
        senderRef: 'chat-1',
        subject: null,
        companyId: 'company-a',
        threadId: null,
      });
      replyToInbound.mockResolvedValue({ ok: false });

      await sendInboundReply(prisma, session, { inboundMessageId: 'im-1', text: 'ответ' });
      expect(recordOutboundInDialog).not.toHaveBeenCalled();
    });

    it('сбой записи истории — best-effort: warn, ответ считается отправленным', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      inboundMessageFindUnique.mockResolvedValue({
        id: 'im-1',
        channel: 'telegram',
        senderRef: 'chat-1',
        subject: null,
        companyId: 'company-a',
        threadId: null,
      });
      replyToInbound.mockResolvedValue({ ok: true });
      recordOutboundInDialog.mockRejectedValueOnce(new Error('dialog down'));

      const result = await sendInboundReply(prisma, session, {
        inboundMessageId: 'im-1',
        text: 'ответ',
      });

      expect(result).toEqual({ ok: true });
      expect(warn).toHaveBeenCalledWith(
        '[inbound/replyInboundAction] dialog history failed',
        expect.objectContaining({ inboundMessageId: 'im-1', error: 'dialog down' })
      );

      recordOutboundInDialog.mockRejectedValueOnce('plain-boom');
      await sendInboundReply(prisma, session, { inboundMessageId: 'im-1', text: 'ответ' });
      expect(warn).toHaveBeenLastCalledWith(
        '[inbound/replyInboundAction] dialog history failed',
        expect.objectContaining({ error: 'plain-boom' })
      );
      expect(recordAudit).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });
  });
});

describe('sendInboundReply — «Копия» и подпись письма (`У-316`)', () => {
  const emailMsg = {
    id: 'im-e',
    channel: 'email',
    senderRef: 'client@mail.ru',
    subject: 'Счёт',
    externalMessageId: null,
    companyId: 'company-a',
    threadId: null,
    resolvedUserId: null,
    resolvedOrgId: null,
    contactId: null,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    replyToInbound.mockResolvedValue({ ok: false });
  });

  it('письмо: копия очищена (регистр, пробелы, дубли), подпись из профиля — в отправку', async () => {
    inboundMessageFindUnique.mockResolvedValue(emailMsg);
    await sendInboundReply(prisma, managerSession(), {
      inboundMessageId: 'im-e',
      text: 'ответ',
      cc: [' Boss@Mail.ru ', 'boss@mail.ru', ''],
    });
    expect(emailSignatureFor).toHaveBeenCalledWith(prisma, 'u-mgr-1');
    expect(replyToInbound).toHaveBeenCalledWith(emailMsg, 'ответ', {
      cc: ['boss@mail.ru'],
      signature: '-- \nС уважением,\nМенеджер',
    });
  });

  it('кривой адрес или больше десяти — отказ формы, письмо не уходит', async () => {
    inboundMessageFindUnique.mockResolvedValue(emailMsg);
    expect(
      await sendInboundReply(prisma, managerSession(), {
        inboundMessageId: 'im-e',
        text: 'ответ',
        cc: ['не-адрес'],
      })
    ).toEqual({ ok: false, error: 'invalid' });
    const many = Array.from({ length: 11 }, (_, i) => `c${i}@x.ru`);
    expect(
      await sendInboundReply(prisma, managerSession(), {
        inboundMessageId: 'im-e',
        text: 'о',
        cc: many,
      })
    ).toEqual({ ok: false, error: 'invalid' });
    expect(replyToInbound).not.toHaveBeenCalled();
  });

  it('письмо без копии и без подписи — пустые доп. поля; мессенджер — ни копии, ни подписи', async () => {
    inboundMessageFindUnique.mockResolvedValue(emailMsg);
    emailSignatureFor.mockResolvedValueOnce('');
    await sendInboundReply(prisma, managerSession(), { inboundMessageId: 'im-e', text: 'о' });
    expect(replyToInbound).toHaveBeenLastCalledWith(emailMsg, 'о', {});

    const tg = { ...emailMsg, channel: 'telegram', senderRef: 'chat-1' };
    inboundMessageFindUnique.mockResolvedValue(tg);
    emailSignatureFor.mockClear();
    await sendInboundReply(prisma, managerSession(), {
      inboundMessageId: 'im-e',
      text: 'о',
      cc: ['a@x.ru'],
    });
    expect(emailSignatureFor).not.toHaveBeenCalled();
    expect(replyToInbound).toHaveBeenLastCalledWith(tg, 'о', {});
  });
});
