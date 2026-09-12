import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';
import { notifyNoteMention } from '@/lib/notifications/noteMention';
import { extractMentions, listColleagues } from '@/lib/services/staffChat/mentions';
import {
  NOTE_BODY_MAX,
  NOTE_PIN_LIMIT,
  canAccessOrgNotes,
  canDeleteNote,
  canEditNote,
  orgAccessibleForNotes,
} from './policy';

/**
 * Мутации внутренних заметок (`У-183`, спека §3.6). Правила — в `policy.ts`;
 * здесь порядок: право → организация в скоупе → проверка → запись → аудит →
 * уведомление упомянутым (best-effort).
 */

export type NoteMutationResult =
  | { ok: true; noteId: string }
  | {
      ok: false;
      error:
        | 'forbidden'
        | 'not_found'
        | 'invalid'
        | 'note_too_long'
        | 'note_pin_limit'
        | 'note_edit_expired';
    };

type BodyCheck = { ok: true; body: string } | { ok: false; error: 'invalid' | 'note_too_long' };

function checkBody(raw: string): BodyCheck {
  const body = (raw ?? '').trim();
  if (!body) return { ok: false, error: 'invalid' };
  if (body.length > NOTE_BODY_MAX) return { ok: false, error: 'note_too_long' };
  return { ok: true, body };
}

/** Упомянутые коллеги (кроме автора); сбой поиска коллег — пустой список, заметка не страдает. */
async function mentionedIds(
  prisma: PrismaClient,
  session: SessionPayload,
  body: string
): Promise<string[]> {
  if (!body.includes('@')) return [];
  try {
    const colleagues = await listColleagues(prisma, session);
    return extractMentions(body, colleagues.rows).filter((id) => id !== session.sub);
  } catch (err) {
    log.warn('[organizationNotes] colleagues lookup failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function managerPath(orgId: string): string {
  return `/manager/organizations/${orgId}?tab=notes`;
}

export async function addOrganizationNote(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { organizationId: string; body: string }
): Promise<NoteMutationResult> {
  const org = await orgAccessibleForNotes(prisma, session, args.organizationId);
  if (!org) return { ok: false, error: 'not_found' };
  const checked = checkBody(args.body);
  if (!checked.ok) return checked;

  const mentioned = await mentionedIds(prisma, session, checked.body);
  const note = await prisma.organizationNote.create({
    data: {
      companyId: org.companyId,
      organizationId: org.id,
      authorId: session.sub,
      body: checked.body,
      mentionUserIds: mentioned,
    },
    select: { id: true },
  });
  await recordAudit(prisma, {
    action: 'organization_note_created',
    entity: 'organization_note',
    entityId: note.id,
    userId: session.sub,
    after: { organizationId: org.id },
  });
  await notifyNoteMention(prisma, {
    mentionedUserIds: mentioned,
    entity: 'organization',
    entityId: org.id,
    noteId: note.id,
    body: checked.body,
    managerPath: managerPath(org.id),
  });
  return { ok: true, noteId: note.id };
}

const NOTE_SELECT = {
  id: true,
  organizationId: true,
  companyId: true,
  authorId: true,
  createdAt: true,
  body: true,
  pinnedAt: true,
  mentionUserIds: true,
} as const;

/** Заметка в скоупе сессии или `null` (чужая компания и несуществующая неразличимы). */
async function loadNote(prisma: PrismaClient, session: SessionPayload, noteId: string) {
  if (!canAccessOrgNotes(session)) return null;
  const note = await prisma.organizationNote.findUnique({
    where: { id: noteId },
    select: NOTE_SELECT,
  });
  if (!note || note.companyId !== session.companyId) return null;
  const org = await orgAccessibleForNotes(prisma, session, note.organizationId);
  return org ? note : null;
}

export async function editOrganizationNote(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { noteId: string; body: string }
): Promise<NoteMutationResult> {
  const note = await loadNote(prisma, session, args.noteId);
  if (!note) return { ok: false, error: 'not_found' };
  // Не автор и не старший — запрет; автор, у которого вышли сутки, — своя
  // подсказка: коды не смешиваем, чтобы человек понял, что делать дальше.
  if (!canEditNote(session, note)) {
    return { ok: false, error: note.authorId === session.sub ? 'note_edit_expired' : 'forbidden' };
  }
  const checked = checkBody(args.body);
  if (!checked.ok) return checked;

  const mentioned = await mentionedIds(prisma, session, checked.body);
  await prisma.organizationNote.update({
    where: { id: note.id },
    data: { body: checked.body, mentionUserIds: mentioned },
  });
  await recordAudit(prisma, {
    action: 'organization_note_updated',
    entity: 'organization_note',
    entityId: note.id,
    userId: session.sub,
    after: { organizationId: note.organizationId },
  });
  // Оповещаем только тех, кого упомянули впервые: повторная правка не должна
  // спамить уже оповещённых.
  const fresh = mentioned.filter((id) => !note.mentionUserIds.includes(id));
  await notifyNoteMention(prisma, {
    mentionedUserIds: fresh,
    entity: 'organization',
    entityId: note.organizationId,
    noteId: note.id,
    body: checked.body,
    managerPath: managerPath(note.organizationId),
  });
  return { ok: true, noteId: note.id };
}

export async function removeOrganizationNote(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { noteId: string }
): Promise<NoteMutationResult> {
  const note = await loadNote(prisma, session, args.noteId);
  if (!note) return { ok: false, error: 'not_found' };
  if (!canDeleteNote(session)) return { ok: false, error: 'forbidden' };
  await prisma.organizationNote.delete({ where: { id: note.id } });
  // Тело — в `before`: удалённую заметку можно восстановить из журнала.
  await recordAudit(prisma, {
    action: 'organization_note_deleted',
    entity: 'organization_note',
    entityId: note.id,
    userId: session.sub,
    before: { organizationId: note.organizationId, body: note.body },
  });
  return { ok: true, noteId: note.id };
}

export async function pinOrganizationNote(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { noteId: string; pinned: boolean }
): Promise<NoteMutationResult> {
  const note = await loadNote(prisma, session, args.noteId);
  if (!note) return { ok: false, error: 'not_found' };
  if (args.pinned === (note.pinnedAt !== null)) return { ok: true, noteId: note.id };
  if (args.pinned) {
    const pinnedCount = await prisma.organizationNote.count({
      where: { organizationId: note.organizationId, pinnedAt: { not: null } },
    });
    if (pinnedCount >= NOTE_PIN_LIMIT) return { ok: false, error: 'note_pin_limit' };
  }
  await prisma.organizationNote.update({
    where: { id: note.id },
    data: { pinnedAt: args.pinned ? new Date() : null },
  });
  await recordAudit(prisma, {
    action: 'organization_note_pinned',
    entity: 'organization_note',
    entityId: note.id,
    userId: session.sub,
    after: { organizationId: note.organizationId, pinned: args.pinned },
  });
  return { ok: true, noteId: note.id };
}
