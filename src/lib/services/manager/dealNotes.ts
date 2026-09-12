import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrder } from '@/lib/services/manager/orders';
import { recordAudit } from '@/lib/auth/audit';
import { extractMentions, listColleagues } from '@/lib/services/staffChat/mentions';
import { notifyNoteMention } from '@/lib/notifications/noteMention';
import { log } from '@/lib/logging';

export type AddDealNoteResult =
  { ok: true; id: string } | { ok: false; error: 'not_found' | 'invalid' };

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
    select: { id: true },
  });

  await recordAudit(prisma, {
    action: 'deal_note_created',
    entity: 'order',
    entityId: args.orderId,
    userId: session.sub,
  });

  // M4 (§2.5): @упоминания в заметке → уведомление упомянутым staff. Best-effort
  // (§3): доставка вынесена в общий продьюсер `note_mention` (этап 1 ТЗ
  // 12.09.2026, спека §3.6) — он сам никогда не бросает; здесь страхуем поиск
  // коллег.
  try {
    if (body.includes('@')) {
      const colleagues = await listColleagues(prisma, session);
      const mentioned = extractMentions(body, colleagues.rows).filter((id) => id !== session.sub);
      await notifyNoteMention(prisma, {
        mentionedUserIds: mentioned,
        entity: 'deal',
        entityId: args.orderId,
        noteId: note.id,
        body,
        managerPath: `/manager/orders/${args.orderId}`,
      });
    }
  } catch (err) {
    log.warn('[dealNotes/addDealNote] mention notify failed', {
      noteId: note.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, id: note.id };
}
