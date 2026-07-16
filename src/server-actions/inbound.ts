'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { getCompanyTeamVisibility, isOrgInScope } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { notifyOrgUsers } from '@/lib/notifications';
import { replyToInbound } from '@/lib/services/inbound/reply';
import { isInboundMessageInScope } from '@/lib/services/inbound/scope';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { log } from '@/lib/logging';

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
      log.warn('[inbound/replyInboundAction] thread mirror failed', {
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

const ArchiveInboundSchema = z.object({ inboundMessageId: z.string().min(1).max(64) });

export type ArchiveInboundResult =
  | { ok: true }
  | { ok: false; error: 'validation' | 'forbidden' | 'not_found' };

/**
 * Archives an inbound message (E2). Scope: the shared C8 predicate
 * `isInboundMessageInScope` (scope.ts) — own company's messages plus the
 * shared unresolved triage queue; a foreign company's bound message is
 * `forbidden`. Archiving an unresolved (companyId=null) message PINS it to
 * the archiver's company (bind-like semantics: a staff action fixes the
 * message to the actor's company) — otherwise the archived row would leave
 * EVERY session's scope forever (the scope matches own-company rows OR
 * status='unresolved', and archiving drops the status branch), i.e. it would
 * be invisible in the list and unrestorable. Pinning requires the actor to
 * HAVE a company, so a companyId-less session gets `forbidden` on the shared
 * queue. Idempotent: archiving an already-archived message is a no-op
 * `{ ok: true }` (no update, no audit).
 */
export async function archiveInboundMessageAction(input: {
  inboundMessageId: string;
}): Promise<ArchiveInboundResult> {
  const parsed = ArchiveInboundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManager();

  const message = await prisma.inboundMessage.findUnique({
    where: { id: parsed.data.inboundMessageId },
    select: { companyId: true, status: true }
  });
  if (!message) return { ok: false, error: 'not_found' };

  if (!isInboundMessageInScope(session, message)) return { ok: false, error: 'forbidden' };

  if (message.status === 'archived') return { ok: true };

  // Unresolved queue → pin to the archiver's company (see JSDoc); an
  // already-bound message keeps its companyId untouched.
  let data: { status: string; companyId?: string };
  if (message.companyId == null) {
    if (!session.companyId) return { ok: false, error: 'forbidden' };
    data = { status: 'archived', companyId: session.companyId };
  } else {
    data = { status: 'archived' };
  }

  await prisma.inboundMessage.update({
    where: { id: parsed.data.inboundMessageId },
    data
  });

  await recordAudit(prisma, {
    action: 'inbound_message_archived',
    entity: 'order_thread',
    entityId: parsed.data.inboundMessageId,
    userId: session.sub,
    before: { status: message.status },
    after: data
  });

  revalidatePath('/manager/inbox');
  return { ok: true };
}

/**
 * Restores an archived inbound message (E2) back to its pre-archive status:
 * `bound` if it was ever bound (`boundAt` set), otherwise `unresolved`.
 * Scope: same shared C8 predicate as archive. A non-archived message returns
 * `not_found` — there is nothing to restore (semantics agreed in the plan).
 * A message restored to `unresolved` keeps the companyId pinned by archive —
 * shared-queue visibility comes from the status branch of the scope, and a
 * later bind overwrites companyId from the target organization anyway.
 */
export async function restoreInboundMessageAction(input: {
  inboundMessageId: string;
}): Promise<ArchiveInboundResult> {
  const parsed = ArchiveInboundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManager();

  const message = await prisma.inboundMessage.findUnique({
    where: { id: parsed.data.inboundMessageId },
    select: { companyId: true, status: true, boundAt: true }
  });
  if (!message) return { ok: false, error: 'not_found' };

  if (!isInboundMessageInScope(session, message)) return { ok: false, error: 'forbidden' };

  if (message.status !== 'archived') return { ok: false, error: 'not_found' };

  const restoredStatus = message.boundAt ? 'bound' : 'unresolved';
  await prisma.inboundMessage.update({
    where: { id: parsed.data.inboundMessageId },
    data: { status: restoredStatus }
  });

  await recordAudit(prisma, {
    action: 'inbound_message_restored',
    entity: 'order_thread',
    entityId: parsed.data.inboundMessageId,
    userId: session.sub,
    before: { status: 'archived' },
    after: { status: restoredStatus }
  });

  revalidatePath('/manager/inbox');
  return { ok: true };
}
