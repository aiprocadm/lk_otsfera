import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';
import { isStaff, canSeeStaffConversation } from './policy';
import { extractMentions, listColleagues } from './mentions';

const MAX_BODY = 5000;
export const STAFF_REACTION_EMOJI = ['👍', '✅', '🔥', '😄', '❓'] as const;

type ConvWithParticipants = {
  id: string;
  kind: 'dm' | 'general';
  companyId: string;
  participants: { userId: string }[];
};

async function loadConv(prisma: PrismaClient, id: string): Promise<ConvWithParticipants | null> {
  return prisma.staffConversation.findUnique({
    where: { id },
    select: { id: true, kind: true, companyId: true, participants: { select: { userId: true } } },
  });
}

export type SendStaffError = 'forbidden' | 'conversation_not_found' | 'empty_body' | 'too_large';
export type SendStaffResult =
  { ok: true; messageId: string } | { ok: false; error: SendStaffError };

export async function sendStaffMessage(
  prisma: PrismaClient,
  session: SessionPayload,
  args: {
    conversationId: string;
    body: string;
    attachmentPath?: string;
    attachmentName?: string;
    attachmentMime?: string;
  }
): Promise<SendStaffResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  const body = (args.body ?? '').trim();
  if (!body && !args.attachmentPath) return { ok: false, error: 'empty_body' };
  if (body.length > MAX_BODY) return { ok: false, error: 'too_large' };

  const conv = await loadConv(prisma, args.conversationId);
  if (!conv) return { ok: false, error: 'conversation_not_found' };
  if (
    !canSeeStaffConversation(
      session,
      conv,
      conv.participants.map((p) => p.userId)
    )
  ) {
    return { ok: false, error: 'forbidden' };
  }
  // IDOR-гард пути вложения (зеркало chat/sendMessage)
  if (
    args.attachmentPath !== undefined &&
    !args.attachmentPath.startsWith(`staff-chat/${conv.id}/`)
  ) {
    return { ok: false, error: 'forbidden' };
  }

  // First-unread правило для ЛС: считаем ДО вставки
  let notifyDmRecipient: string | null = null;
  if (conv.kind === 'dm') {
    const other = conv.participants.map((p) => p.userId).find((id) => id !== session.sub);
    if (other) {
      const read = await prisma.staffMessageRead.findUnique({
        where: { conversationId_userId: { conversationId: conv.id, userId: other } },
        select: { lastReadAt: true },
      });
      const unread = await prisma.staffMessage.count({
        where: {
          conversationId: conv.id,
          authorId: { not: other },
          createdAt: { gt: read?.lastReadAt ?? new Date(0) },
        },
      });
      if (unread === 0) notifyDmRecipient = other;
    }
  }

  const message = await prisma.staffMessage.create({
    data: {
      conversationId: conv.id,
      authorId: session.sub,
      body,
      attachmentPath: args.attachmentPath ?? null,
      attachmentName: args.attachmentName ?? null,
      attachmentMime: args.attachmentMime ?? null,
      scanStatus: args.attachmentPath ? 'pending' : 'none',
    },
    select: { id: true },
  });
  await prisma.staffConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date() },
  });
  // Unread считается как lastMessageAt > lastReadAt БЕЗ учёта автора — без этого
  // upsert'а собственная отправка зажигала бы автору его же бейдж непрочитанного.
  await prisma.staffMessageRead.upsert({
    where: { conversationId_userId: { conversationId: conv.id, userId: session.sub } },
    update: { lastReadAt: new Date() },
    create: { conversationId: conv.id, userId: session.sub },
  });

  // AV-скан вложения — best-effort enqueue (образец inbound_attachment; §3 degrade gracefully)
  if (args.attachmentPath) {
    try {
      const payload: ScanDocumentPayload = { kind: 'staff_attachment', id: message.id };
      await getQueue('docs.scanDocument').add('scan', payload);
    } catch (err) {
      log.warn('[staffChat/sendStaffMessage] scan enqueue failed', {
        messageId: message.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await recordAudit(prisma, {
    action: 'staff_message_sent',
    entity: 'staff_conversation',
    entityId: conv.id,
    userId: session.sub,
    after: { messageId: message.id }, // тело НЕ пишем (§2.6 спеки)
  });

  // Уведомления — best-effort, не блокируют отправку
  try {
    const excerpt = body.slice(0, 200);
    const url = (role: string) => (role === 'admin' ? '/admin/messages' : '/manager/messages');
    // Без '@' в теле упоминаний быть не может — не ходим в БД за списком коллег зря
    const mentioned = body.includes('@')
      ? extractMentions(body, (await listColleagues(prisma, session)).rows).filter(
          (id) => id !== session.sub
        )
      : [];
    const recipients = mentioned.length
      ? await prisma.user.findMany({
          where: { id: { in: mentioned } },
          select: { id: true, role: true },
        })
      : [];
    for (const r of recipients) {
      const row = await createNotification({
        userId: r.id,
        type: 'staff_chat_mention',
        title: 'Вас упомянули в чате команды',
        body: excerpt,
        meta: { conversationId: conv.id, messageId: message.id },
      });
      await deliverNotificationToUser({
        userId: r.id,
        title: 'Вас упомянули в чате команды',
        body: excerpt,
        type: 'staff_chat_mention',
        url: url(r.role),
        dedupKey: row.id,
      });
    }
    if (notifyDmRecipient && !mentioned.includes(notifyDmRecipient)) {
      const rec = await prisma.user.findUnique({
        where: { id: notifyDmRecipient },
        select: { id: true, role: true },
      });
      if (rec) {
        const row = await createNotification({
          userId: rec.id,
          type: 'staff_dm_message',
          title: 'Новое сообщение в чате команды',
          body: excerpt,
          meta: { conversationId: conv.id },
        });
        await deliverNotificationToUser({
          userId: rec.id,
          title: 'Новое сообщение в чате команды',
          body: excerpt,
          type: 'staff_dm_message',
          url: url(rec.role),
          dedupKey: row.id,
        });
      }
    }
  } catch (err) {
    log.warn('[staffChat/sendStaffMessage] notify failed', {
      messageId: message.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, messageId: message.id };
}

export type StaffMessageRow = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  hasAttachment: boolean;
  attachmentName: string | null;
  scanStatus: string;
  createdAt: Date;
  reactions: { emoji: string; count: number; mine: boolean }[];
};
export type ListStaffMessagesResult =
  | { ok: true; rows: StaffMessageRow[] }
  | { ok: false; error: 'forbidden' | 'conversation_not_found' };

export async function listStaffMessages(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { conversationId: string; after?: string }
): Promise<ListStaffMessagesResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  const conv = await loadConv(prisma, args.conversationId);
  if (!conv) return { ok: false, error: 'conversation_not_found' };
  if (
    !canSeeStaffConversation(
      session,
      conv,
      conv.participants.map((p) => p.userId)
    )
  ) {
    return { ok: false, error: 'forbidden' };
  }
  const afterDate = args.after ? new Date(args.after) : null;
  const validAfter = afterDate && !isNaN(afterDate.getTime()) ? afterDate : null;
  const rows = await prisma.staffMessage.findMany({
    where: { conversationId: conv.id, ...(validAfter ? { createdAt: { gt: validAfter } } : {}) },
    select: {
      id: true,
      authorId: true,
      body: true,
      attachmentPath: true,
      attachmentName: true,
      scanStatus: true,
      createdAt: true,
      author: { select: { name: true } },
      reactions: { select: { userId: true, emoji: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return {
    ok: true,
    rows: rows.map((m) => {
      const byEmoji = new Map<string, { count: number; mine: boolean }>();
      for (const r of m.reactions) {
        const agg = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
        agg.count += 1;
        if (r.userId === session.sub) agg.mine = true;
        byEmoji.set(r.emoji, agg);
      }
      return {
        id: m.id,
        authorId: m.authorId,
        authorName: m.author.name ?? '',
        body: m.body,
        hasAttachment: m.attachmentPath !== null, // сырой путь наружу не отдаём
        attachmentName: m.attachmentName,
        scanStatus: m.scanStatus,
        createdAt: m.createdAt,
        reactions: [...byEmoji.entries()].map(([emoji, a]) => ({
          emoji,
          count: a.count,
          mine: a.mine,
        })),
      };
    }),
  };
}

export type ToggleReactionResult =
  | { ok: true; reacted: boolean }
  | { ok: false; error: 'forbidden' | 'invalid' | 'message_not_found' };

export async function toggleReaction(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { messageId: string; emoji: string }
): Promise<ToggleReactionResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  if (!(STAFF_REACTION_EMOJI as readonly string[]).includes(args.emoji))
    return { ok: false, error: 'invalid' };
  const message = await prisma.staffMessage.findUnique({
    where: { id: args.messageId },
    select: {
      id: true,
      conversation: {
        select: {
          id: true,
          kind: true,
          companyId: true,
          participants: { select: { userId: true } },
        },
      },
    },
  });
  if (!message) return { ok: false, error: 'message_not_found' };
  const conv = message.conversation;
  if (
    !canSeeStaffConversation(
      session,
      conv,
      conv.participants.map((p) => p.userId)
    )
  ) {
    return { ok: false, error: 'forbidden' };
  }
  const existing = await prisma.staffReaction.findUnique({
    where: {
      messageId_userId_emoji: { messageId: args.messageId, userId: session.sub, emoji: args.emoji },
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.staffReaction.delete({ where: { id: existing.id } });
    return { ok: true, reacted: false };
  }
  try {
    await prisma.staffReaction.create({
      data: { messageId: args.messageId, userId: session.sub, emoji: args.emoji },
    });
  } catch (err) {
    // P2002 — конкурентный идентичный toggle: @@unique держит дубль, реакция уже стоит → considered added.
    if ((err as { code?: string })?.code !== 'P2002') throw err;
  }
  return { ok: true, reacted: true };
}
