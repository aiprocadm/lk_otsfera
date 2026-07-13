import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrder } from '@/lib/services/manager/orders';
import { recordAudit } from '@/lib/auth/audit';

export type AddDealNoteResult =
  | { ok: true; id: string }
  | { ok: false; error: 'not_found' | 'invalid' };

export async function addDealNote(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; body: string }
): Promise<AddDealNoteResult> {
  const body = args.body.trim();
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

  return { ok: true, id: note.id };
}
