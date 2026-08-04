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
  inboundMessageFindUnique,
  orderFindUnique,
  orderThreadUpdate,
  messageCreate,
} = vi.hoisted(() => ({
  replyToInbound: vi.fn(),
  recordAudit: vi.fn(),
  notifyOrgUsers: vi.fn(),
  writeSyncLog: vi.fn(),
  inboundMessageFindUnique: vi.fn(),
  orderFindUnique: vi.fn(),
  orderThreadUpdate: vi.fn(),
  messageCreate: vi.fn(),
}));

vi.mock('@/lib/services/inbound/reply', () => ({ replyToInbound }));
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

  it('returns email_unsupported when the channel is email and replyToInbound fails', async () => {
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

    expect(result).toEqual({ ok: false, error: 'email_unsupported' });
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
});
