import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrder } from '@/lib/services/manager/orders';
import { recordPiiAccessMany, type PiiAccessArgs } from '@/lib/pii/record';

export type ActivityView = 'dialogue' | 'all';

export type ActivityItem =
  | { kind: 'message_in'; id: string; at: Date; channel: string; sender: string; body: string; attachmentName: string | null }
  | { kind: 'message_out'; id: string; at: Date; author: string; body: string; hasAttachment: boolean }
  | { kind: 'comment'; id: string; at: Date; author: string; body: string }
  | { kind: 'call'; id: string; at: Date; direction: string; number: string; durationSec: number | null; recordingReady: boolean; initiator: string | null }
  | { kind: 'note'; id: string; at: Date; author: string; body: string }
  | { kind: 'event'; id: string; at: Date; label: string };

export type GetDealActivityResult =
  | { ok: true; items: ActivityItem[] }
  | { ok: false; error: 'not_found' };

const DIALOGUE_KINDS = new Set<ActivityItem['kind']>(['message_in', 'message_out', 'comment']);

// Защитный cap (CLAUDE.md close-out follow-up): курсорная пагинация отложена в M2,
// но ни один источник не должен грузиться неограниченно. Берём последние N на источник —
// финальная сортировка по `at` в памяти всё равно даёт oldest→newest.
const ACTIVITY_SOURCE_CAP = 500;

export async function getDealActivity(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string,
  opts: { view: ActivityView }
): Promise<GetDealActivityResult> {
  // Гард C8/teamMode/leader — переиспользуем существующий (CLAUDE.md §4).
  const order = await getOrder(prisma, session, orderId);
  if (!order) return { ok: false, error: 'not_found' };

  const threads = await prisma.orderThread.findMany({
    where: { orderId },
    select: { id: true }
  });
  const threadIds = threads.map((t) => t.id);

  const [comments, messages, inbound, calls, notes, events] = await Promise.all([
    prisma.comment.findMany({
      where: { orderId },
      select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY_SOURCE_CAP
    }),
    threadIds.length
      ? prisma.message.findMany({
          where: { threadId: { in: threadIds } },
          select: { id: true, body: true, createdAt: true, attachmentPath: true, author: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: ACTIVITY_SOURCE_CAP
        })
      : Promise.resolve([]),
    threadIds.length
      ? prisma.inboundMessage.findMany({
          where: { threadId: { in: threadIds } },
          select: { id: true, channel: true, senderDisplay: true, senderRef: true, body: true, sentAt: true, createdAt: true, attachmentName: true },
          orderBy: { createdAt: 'desc' },
          take: ACTIVITY_SOURCE_CAP
        })
      : Promise.resolve([]),
    threadIds.length
      ? prisma.call.findMany({
          where: { threadId: { in: threadIds } },
          select: { id: true, direction: true, callerNumber: true, durationSec: true, startedAt: true, createdAt: true, recordingScanStatus: true, recordingPath: true, initiatedBy: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: ACTIVITY_SOURCE_CAP
        })
      : Promise.resolve([]),
    prisma.dealNote.findMany({
      where: { orderId },
      select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY_SOURCE_CAP
    }),
    prisma.auditLog.findMany({
      where: { entity: 'order', entityId: orderId, action: 'order_status_changed' },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY_SOURCE_CAP
    })
  ]);

  const items: ActivityItem[] = [
    ...comments.map((c): ActivityItem => ({ kind: 'comment', id: c.id, at: c.createdAt, author: c.author.name, body: c.body })),
    ...messages.map((m): ActivityItem => ({ kind: 'message_out', id: m.id, at: m.createdAt, author: m.author.name, body: m.body, hasAttachment: m.attachmentPath !== null })),
    ...inbound.map((i): ActivityItem => ({ kind: 'message_in', id: i.id, at: i.sentAt ?? i.createdAt, channel: i.channel, sender: i.senderDisplay ?? i.senderRef, body: i.body, attachmentName: i.attachmentName })),
    ...calls.map((c): ActivityItem => ({ kind: 'call', id: c.id, at: c.startedAt ?? c.createdAt, direction: c.direction, number: c.callerNumber, durationSec: c.durationSec, recordingReady: c.recordingScanStatus === 'clean' && !!c.recordingPath, initiator: c.initiatedBy?.name ?? null })),
    ...notes.map((n): ActivityItem => ({ kind: 'note', id: n.id, at: n.createdAt, author: n.author.name, body: n.body })),
    ...events.map((e): ActivityItem => ({ kind: 'event', id: e.id, at: e.createdAt, label: 'Смена статуса заказа' }))
  ];

  items.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Журнал ПДн (§12): читаем контакты клиента (отправители/абоненты) → фиксируем.
  const piiArgs: PiiAccessArgs[] = [];
  if (inbound.length) piiArgs.push({ session, context: 'deal_activity_inbound', subjectIds: inbound.map((i) => i.id) });
  if (calls.length) piiArgs.push({ session, context: 'deal_activity_calls', subjectIds: calls.map((c) => c.id) });
  if (piiArgs.length) await recordPiiAccessMany(prisma, piiArgs);

  const filtered = opts.view === 'dialogue' ? items.filter((i) => DIALOGUE_KINDS.has(i.kind)) : items;
  return { ok: true, items: filtered };
}
