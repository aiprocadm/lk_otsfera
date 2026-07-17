import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrder } from '@/lib/services/manager/orders';
import { recordAudit } from '@/lib/auth/audit';
import { extractMentions, listColleagues } from '@/lib/services/staffChat/mentions';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { log } from '@/lib/logging';

export type AddDealNoteResult =
  | { ok: true; id: string }
  | { ok: false; error: 'not_found' | 'invalid' };

export async function addDealNote(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; body: string }
): Promise<AddDealNoteResult> {
  const body = (args.body ?? '').trim();
  if (!body) return { ok: false, error: 'invalid' };

  const order = await getOrder(prisma, session, args.orderId);
  if (!order) return { ok: false, error: 'not_found' };

  const note = await prisma.dealNote.create({
    data: { orderId: args.orderId, authorId: session.sub, body },
    select: { id: true }
  });

  await recordAudit(prisma, {
    action: 'deal_note_created',
    entity: 'order',
    entityId: args.orderId,
    userId: session.sub
  });

  // M4 (§2.5): @упоминания в заметке → уведомление упомянутым staff. Best-effort (§3).
  try {
    if (body.includes('@')) {
      const colleagues = await listColleagues(prisma, session);
      const mentioned = extractMentions(body, colleagues.rows).filter((id) => id !== session.sub);
      if (mentioned.length) {
        const recipients = await prisma.user.findMany({
          where: { id: { in: mentioned } },
          select: { id: true, role: true }
        });
        const excerpt = body.slice(0, 200);
        for (const r of recipients) {
          const row = await createNotification({
            userId: r.id,
            type: 'deal_note_mention',
            title: 'Вас упомянули в заметке по заказу',
            body: excerpt,
            meta: { orderId: args.orderId, noteId: note.id }
          });
          await deliverNotificationToUser({
            userId: r.id,
            title: 'Вас упомянули в заметке по заказу',
            body: excerpt,
            type: 'deal_note_mention',
            ...(r.role === 'admin' ? {} : { url: `/manager/orders/${args.orderId}` }),
            dedupKey: row.id
          });
        }
      }
    }
  } catch (err) {
    log.warn('[dealNotes/addDealNote] mention notify failed', {
      noteId: note.id,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  return { ok: true, id: note.id };
}
