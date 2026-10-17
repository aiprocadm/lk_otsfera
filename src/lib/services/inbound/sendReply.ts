import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { notifyOrgUsers } from '@/lib/notifications';
import { replyToInbound } from '@/lib/services/inbound/reply';
import { emailSignatureFor } from '@/lib/services/inbound/emailSignature';
import { looksLikeEmail } from '@/lib/services/inbound/emailReply';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { isDialogChannel } from '@/lib/services/messengers/channels';
import { normalizeChannelValue } from '@/lib/services/contacts/resolveContactByChannel';
import { recordOutboundInDialog } from '@/lib/services/messengers/recordOutbound';
import { log } from '@/lib/logging';

export type SendInboundReplyArgs = {
  inboundMessageId: string;
  text: string;
  /** `У-316`: «Копия» ответа на письмо; у мессенджеров не применяется. */
  cc?: string[] | undefined;
};

export type SendInboundReplyResult =
  | { ok: true }
  | {
      ok: false;
      error: 'forbidden' | 'not_found' | 'invalid' | 'reply_failed';
    };

/**
 * Sends a manager reply to an inbound message through the existing outbound
 * transport (`replyToInbound`, reply.ts). Scope: the message must already be
 * bound to the manager's own company (`companyId` matches `session.companyId`)
 * — an unresolved (`companyId=null`) or cross-company message is `forbidden`;
 * bind it first via `bindInboundMessage` (bind.ts).
 *
 * Side-effect order is contractual: transport send → best-effort history in the
 * messenger dialog (спека 2026-09-12, Р-М-7: ответ из «Входящих писем» тоже
 * виден в диалоге) → best-effort thread mirror (message + thread bump + org
 * notification) → audit → 1С sync log.
 */
/** Сколько адресов можно поставить в «Копию» ответа. */
const CC_MAX = 10;

export async function sendInboundReply(
  prisma: PrismaClient,
  session: SessionPayload,
  args: SendInboundReplyArgs
): Promise<SendInboundReplyResult> {
  const message = await prisma.inboundMessage.findUnique({
    where: { id: args.inboundMessageId },
    select: {
      id: true,
      channel: true,
      senderRef: true,
      subject: true,
      externalMessageId: true,
      companyId: true,
      threadId: true,
      resolvedUserId: true,
      resolvedOrgId: true,
      contactId: true,
    },
  });
  if (!message) return { ok: false, error: 'not_found' };

  if (!message.companyId || !session.companyId || message.companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }

  const text = args.text.trim();
  if (!text) return { ok: false, error: 'invalid' };

  // `У-316`: у письма — «Копия» (кривой адрес — отказ формы) и подпись из
  // профиля; у мессенджеров ни того ни другого нет.
  let email: { cc?: string[]; signature?: string } = {};
  if (message.channel === 'email') {
    const cc = [...new Set((args.cc ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))];
    if (cc.length > CC_MAX || cc.some((a) => !looksLikeEmail(a))) {
      return { ok: false, error: 'invalid' };
    }
    const signature = await emailSignatureFor(prisma, session.sub);
    email = { ...(cc.length > 0 ? { cc } : {}), ...(signature ? { signature } : {}) };
  }

  const result = await replyToInbound(message, text, email);
  if (!result.ok) {
    // Один код на все каналы: почта больше не «не поддерживается» — она
    // отвечает так же, как мессенджеры, и отказ у неё такой же обычный.
    return { ok: false, error: 'reply_failed' };
  }

  // История диалога (Р-М-7). Сбой записи не отменяет ответ — он уже ушёл
  // клиенту; привязка передаётся на случай, если диалога ещё нет (письмо
  // старше бэкфилла).
  if (isDialogChannel(message.channel)) {
    try {
      await recordOutboundInDialog(prisma, {
        channel: message.channel,
        // У почты ключ диалога — нормализованный адрес, тот же, что при
        // приёме письма. Иначе ответ завёл бы ВТОРОЙ диалог с тем же
        // человеком, и переписка разошлась бы надвое.
        peerRef:
          message.channel === 'email'
            ? normalizeChannelValue('email', message.senderRef)
            : message.senderRef,
        authorId: session.sub,
        text,
        delivered: true,
        binding: {
          companyId: message.companyId,
          organizationId: message.resolvedOrgId,
          contactId: message.contactId,
          userId: message.resolvedUserId,
        },
      });
    } catch (err) {
      log.warn('[inbound/replyInboundAction] dialog history failed', {
        inboundMessageId: args.inboundMessageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Best-effort thread mirror: reflect the reply into the org chat thread (if
  // one is bound) so the organization sees it alongside the rest of the
  // conversation. A mirror failure must NOT fail the action — the reply
  // already went out over the real channel.
  if (message.threadId) {
    try {
      await prisma.message.create({
        data: { threadId: message.threadId, authorId: session.sub, body: text },
      });
      const thread = await prisma.orderThread.update({
        where: { id: message.threadId },
        data: { lastMessageAt: new Date() },
        select: { orderId: true },
      });
      const order = await prisma.order.findUnique({
        where: { id: thread.orderId },
        select: { id: true, organizationId: true, orderNumber: true, title: true },
      });
      if (order?.organizationId) {
        await notifyOrgUsers(prisma, {
          organizationId: order.organizationId,
          type: 'manager_replied',
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            orderTitle: order.title,
            commentExcerpt: text.slice(0, 200),
          },
        });
      }
    } catch (err) {
      log.warn('[inbound/replyInboundAction] thread mirror failed', {
        inboundMessageId: args.inboundMessageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await recordAudit(prisma, {
    action: 'inbound_message_replied',
    entity: 'order_thread',
    entityId: args.inboundMessageId,
    userId: session.sub,
    after: { channel: message.channel },
  });

  await writeSyncLog({
    entity: 'inbound',
    direction: 'outbound',
    operation: 'create',
    status: 'success',
  });

  return { ok: true };
}
