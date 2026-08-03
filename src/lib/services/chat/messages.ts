import type { PrismaClient, ThreadSide } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { notifyManagers, notifyOrgUsers } from '@/lib/notifications';
import { log } from '@/lib/logging';
import { canSeeThread } from './policy';

export type ListMessagesResult =
  | {
      ok: true;
      rows: Array<{
        id: string;
        authorId: string;
        authorName: string;
        body: string;
        hasAttachment: boolean;
        createdAt: Date;
      }>;
    }
  | { ok: false; error: 'forbidden' | 'thread_not_found' };

export async function listMessages(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { threadId: string; after?: string }
): Promise<ListMessagesResult> {
  const thread = await prisma.orderThread.findUnique({
    where: { id: args.threadId },
    select: {
      id: true,
      side: true,
      order: { select: { id: true, organizationId: true, partnerId: true, companyId: true } },
    },
  });
  if (!thread) return { ok: false, error: 'thread_not_found' };
  if (!canSeeThread(session, thread.side, thread.order)) return { ok: false, error: 'forbidden' };

  // FIX 4: guard invalid `after` cursor — if it parses to NaN, ignore it
  const afterDate = args.after ? new Date(args.after) : null;
  const validAfter = afterDate && !isNaN(afterDate.getTime()) ? afterDate : null;

  const rows = await prisma.message.findMany({
    where: {
      threadId: thread.id,
      ...(validAfter ? { createdAt: { gt: validAfter } } : {}),
    },
    select: {
      id: true,
      authorId: true,
      body: true,
      attachmentPath: true,
      createdAt: true,
      author: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return {
    ok: true,
    rows: rows.map((m) => ({
      id: m.id,
      authorId: m.authorId,
      authorName: m.author.name ?? '',
      body: m.body,
      // FIX 2: never expose raw storage path — only signal presence
      hasAttachment: m.attachmentPath !== null,
      createdAt: m.createdAt,
    })),
  };
}

type SendError = 'forbidden' | 'order_not_found' | 'empty_body' | 'too_large';
export type SendResult = { ok: true; messageId: string } | { ok: false; error: SendError };

const MAX_BODY = 5000;

export async function sendMessage(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; side: ThreadSide; body: string; attachmentPath?: string }
): Promise<SendResult> {
  const body = args.body?.trim() ?? '';
  if (!body) return { ok: false, error: 'empty_body' };
  if (body.length > MAX_BODY) return { ok: false, error: 'too_large' };

  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      organizationId: true,
      partnerId: true,
      companyId: true,
      orderNumber: true,
      title: true,
    },
  });
  if (!order) return { ok: false, error: 'order_not_found' };
  if (!canSeeThread(session, args.side, order)) return { ok: false, error: 'forbidden' };

  // FIX 1: IDOR defense — attachment must live in THIS order's chat folder
  if (
    args.attachmentPath !== undefined &&
    !args.attachmentPath.startsWith(`chat/${args.orderId}/`)
  ) {
    return { ok: false, error: 'forbidden' };
  }

  const thread = await prisma.orderThread.upsert({
    where: { orderId_side: { orderId: args.orderId, side: args.side } },
    update: { lastMessageAt: new Date() },
    create: { orderId: args.orderId, side: args.side },
  });

  const message = await prisma.message.create({
    data: {
      threadId: thread.id,
      authorId: session.sub,
      body,
      attachmentPath: args.attachmentPath ?? null,
    },
  });

  await recordAudit(prisma, {
    action: 'message_sent',
    entity: 'order_thread',
    entityId: thread.id,
    userId: session.sub,
    after: { messageId: message.id, side: args.side },
  });

  const isTeam = session.role === 'manager' || session.role === 'admin';
  try {
    if (isTeam) {
      if (args.side === 'org' && order.organizationId) {
        await notifyOrgUsers(prisma, {
          organizationId: order.organizationId,
          type: 'chat_message',
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            orderTitle: order.title,
            excerpt: body.slice(0, 200),
          },
        });
      }
      // side === 'partner' from team: partner-side notification deferred to a later task.
    } else {
      await notifyManagers(prisma, {
        orderId: order.id,
        type: 'chat_message',
        payload: { excerpt: body.slice(0, 200), side: args.side },
      });
    }
  } catch (err) {
    log.warn('[chat/sendMessage] notify failed', {
      messageId: message.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, messageId: message.id };
}
