import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { dealScopeWhere } from './board';

/**
 * Этап 6 PR-2 (ФТ-4.4, решение §10-1 ТЗ) — заметки на сделке. Параллельная
 * привязка DealNote: существующий поток заметок по заказу
 * (manager/dealNotes.addDealNote, orderId) не меняется; здесь — заметки по
 * dealId. Инвариант «хотя бы одна привязка» держится на сервис-слое:
 * этот модуль всегда пишет dealId, тот — orderId.
 */

function isStaff(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
}

export type DealNoteRow = {
  id: string;
  body: string;
  authorName: string;
  createdAt: Date;
};

export async function addNoteToDeal(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { dealId: string; body: string }
): Promise<{ ok: true; id: string } | { ok: false; error: 'forbidden' | 'not_found' | 'invalid' }> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  const body = (args.body ?? '').trim();
  if (!body) return { ok: false, error: 'invalid' };

  const deal = await prisma.deal.findFirst({
    where: { AND: [{ id: args.dealId }, dealScopeWhere(session)] },
    select: { id: true }
  });
  if (!deal) return { ok: false, error: 'not_found' };

  const note = await prisma.dealNote.create({
    data: { dealId: deal.id, authorId: session.sub, body },
    select: { id: true }
  });

  await recordAudit(prisma, {
    action: 'deal_note_created',
    entity: 'deal',
    entityId: deal.id,
    userId: session.sub,
    after: { noteId: note.id }
  });

  return { ok: true, id: note.id };
}

export async function listDealNotes(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { dealId: string }
): Promise<{ ok: true; rows: DealNoteRow[] } | { ok: false; error: 'forbidden' | 'not_found' }> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };

  const deal = await prisma.deal.findFirst({
    where: { AND: [{ id: args.dealId }, dealScopeWhere(session)] },
    select: { id: true }
  });
  if (!deal) return { ok: false, error: 'not_found' };

  const rows = await prisma.dealNote.findMany({
    where: { dealId: deal.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, body: true, createdAt: true, author: { select: { name: true } } }
  });

  return {
    ok: true,
    rows: rows.map((n) => ({ id: n.id, body: n.body, authorName: n.author.name, createdAt: n.createdAt }))
  };
}
