'use server';

import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { getCompanyTeamVisibility, isOrgInScope } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { notifyOrgUsers } from '@/lib/notifications';
import { replyToInbound } from '@/lib/services/inbound/reply';
import { writeSyncLog } from '@/lib/services/oneCSync/log';

export type BindInboundMessageArgs = {
  inboundMessageId: string;
  organizationId: string;
  orderId?: string;
};

export type BindInboundMessageResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'not_found' };

/**
 * Binds an unresolved/mis-resolved InboundMessage to a specific organization
 * (and optionally an order), so a manager can triage inbound chat/email that
 * `resolveInboundSender` (src/lib/services/inbound/resolve.ts) failed to
 * auto-match. Company-scoped (CLAUDE.md §4, C8): the target organization must
 * belong to the manager's own company — team-visibility-aware via
 * `getCompanyTeamVisibility` (ON → any org in the company; OFF → only orgs in
 * `session.managedOrgIds` via `isOrgInScope`).
 */
export async function bindInboundMessageAction(
  args: BindInboundMessageArgs
): Promise<BindInboundMessageResult> {
  const session = await requireManager();

  const message = await prisma.inboundMessage.findUnique({
    where: { id: args.inboundMessageId },
    select: { id: true }
  });
  if (!message) return { ok: false, error: 'not_found' };

  const org = await prisma.organization.findUnique({
    where: { id: args.organizationId },
    select: { id: true, companyId: true }
  });
  if (!org) return { ok: false, error: 'not_found' };

  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  // C8: company is the hard isolation boundary — enforce in BOTH modes.
  // (managedOrgIds is loaded without a company filter, so in teamMode OFF a
  // cross-company OrganizationManager assignment would otherwise let a manager
  // bind an inbound to a foreign company's org, writing that foreign companyId
  // — an IDOR hole. CLAUDE.md §4/§5.)
  if (!session.companyId || org.companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }
  // managedOrgIds only further narrows within teamMode OFF (company already
  // enforced above).
  if (!teamMode && !isOrgInScope(session, args.organizationId)) {
    return { ok: false, error: 'forbidden' };
  }

  // Best-effort thread resolution: only if an orderId was given AND that
  // order belongs to the target org AND is itself in the manager's scope.
  let threadId: string | null = null;
  if (args.orderId) {
    const order = await prisma.order.findUnique({
      where: { id: args.orderId },
      select: { id: true, organizationId: true, companyId: true }
    });
    const orderInScope =
      !!order &&
      order.organizationId === args.organizationId &&
      // C8-гейт выше уже гарантирует session.companyId non-null.
      (teamMode ? order.companyId === session.companyId : true);
    if (orderInScope) {
      const thread = await prisma.orderThread.findUnique({
        where: { orderId_side: { orderId: args.orderId, side: 'org' } },
        select: { id: true }
      });
      threadId = thread?.id ?? null;
    }
  }

  await prisma.inboundMessage.update({
    where: { id: args.inboundMessageId },
    data: {
      resolvedOrgId: args.organizationId,
      companyId: org.companyId,
      threadId,
      status: 'bound',
      boundAt: new Date(),
      boundById: session.sub
    }
  });

  await recordAudit(prisma, {
    action: 'inbound_message_bound',
    entity: 'order_thread',
    entityId: args.inboundMessageId,
    userId: session.sub,
    after: { organizationId: args.organizationId, threadId }
  });

  return { ok: true };
}

export type ReplyInboundArgs = {
  inboundMessageId: string;
  text: string;
};

export type ReplyInboundResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'not_found' | 'invalid' | 'reply_failed' | 'email_unsupported' };

/**
 * Sends a manager reply to an inbound message through the existing outbound
 * transport (`replyToInbound`, src/lib/services/inbound/reply.ts). Scope: the
 * message must already be bound to the manager's own company (`companyId`
 * matches `session.companyId`) — an unresolved (`companyId=null`) or
 * cross-company message is `forbidden`; bind it first via
 * `bindInboundMessageAction`.
 */
export async function replyInboundAction(
  args: ReplyInboundArgs
): Promise<ReplyInboundResult> {
  const session = await requireManager();

  const message = await prisma.inboundMessage.findUnique({
    where: { id: args.inboundMessageId },
    select: { id: true, channel: true, senderRef: true, subject: true, companyId: true, threadId: true }
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
        data: { threadId: message.threadId, authorId: session.sub, body: text }
      });
      const thread = await prisma.orderThread.update({
        where: { id: message.threadId },
        data: { lastMessageAt: new Date() },
        select: { orderId: true }
      });
      const order = await prisma.order.findUnique({
        where: { id: thread.orderId },
        select: { id: true, organizationId: true, orderNumber: true, title: true }
      });
      if (order?.organizationId) {
        await notifyOrgUsers(prisma, {
          organizationId: order.organizationId,
          type: 'manager_replied',
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            orderTitle: order.title,
            commentExcerpt: text.slice(0, 200)
          }
        });
      }
    } catch (err) {
      console.warn('[inbound/replyInboundAction] thread mirror failed', {
        inboundMessageId: args.inboundMessageId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  await recordAudit(prisma, {
    action: 'inbound_message_replied',
    entity: 'order_thread',
    entityId: args.inboundMessageId,
    userId: session.sub,
    after: { channel: message.channel }
  });

  await writeSyncLog({
    entity: 'inbound',
    direction: 'outbound',
    operation: 'create',
    status: 'success'
  });

  return { ok: true };
}
