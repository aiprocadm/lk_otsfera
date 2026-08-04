import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { notifyOrgUsers } from '@/lib/notifications';
import { replyToInbound } from '@/lib/services/inbound/reply';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { log } from '@/lib/logging';

export type SendInboundReplyArgs = {
  inboundMessageId: string;
  text: string;
};

export type SendInboundReplyResult =
  | { ok: true }
  | {
      ok: false;
      error: 'forbidden' | 'not_found' | 'invalid' | 'reply_failed' | 'email_unsupported';
    };

/**
 * Sends a manager reply to an inbound message through the existing outbound
 * transport (`replyToInbound`, reply.ts). Scope: the message must already be
 * bound to the manager's own company (`companyId` matches `session.companyId`)
 * — an unresolved (`companyId=null`) or cross-company message is `forbidden`;
 * bind it first via `bindInboundMessage` (bind.ts).
 *
 * Side-effect order is contractual: transport send → best-effort thread mirror
 * (message + thread bump + org notification) → audit → 1С sync log.
 */
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
      companyId: true,
      threadId: true,
      resolvedUserId: true,
    },
  });
  if (!message) return { ok: false, error: 'not_found' };

  if (!message.companyId || !session.companyId || message.companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }

  const text = args.text.trim();
  if (!text) return { ok: false, error: 'invalid' };

  const result = await replyToInbound(message, text);
  if (!result.ok) {
    return { ok: false, error: message.channel === 'email' ? 'email_unsupported' : 'reply_failed' };
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
