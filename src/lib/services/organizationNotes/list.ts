import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canDeleteNote, canEditNote, orgAccessibleForNotes } from './policy';

export type OrganizationNoteView = {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  pinnedAt: Date | null;
  author: { id: string; name: string | null } | null;
  mentionUserIds: string[];
  /** Что можно этой сессии — кнопки рисуются по этим флагам, запрет держит сервис. */
  canEdit: boolean;
  canDelete: boolean;
};

export type ListOrganizationNotesResult =
  | { ok: true; notes: OrganizationNoteView[]; pinned: OrganizationNoteView[] }
  | { ok: false; error: 'not_found' };

const NOTE_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  pinnedAt: true,
  authorId: true,
  mentionUserIds: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.OrganizationNoteSelect;

type NoteRow = Prisma.OrganizationNoteGetPayload<{ select: typeof NOTE_SELECT }>;

export function toNoteView(session: SessionPayload, row: NoteRow, now: Date): OrganizationNoteView {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pinnedAt: row.pinnedAt,
    author: row.author,
    mentionUserIds: row.mentionUserIds,
    canEdit: canEditNote(session, row, now),
    canDelete: canDeleteNote(session),
  };
}

/**
 * Заметки организации (`У-183`): закреплённые отдельно (сверху вкладки и в
 * блоке «Важное» на «Обзоре»), остальные — новые сверху. Организация вне
 * скоупа или клиентская роль → `not_found`.
 */
export async function listOrganizationNotes(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<ListOrganizationNotesResult> {
  const org = await orgAccessibleForNotes(prisma, session, orgId);
  if (!org) return { ok: false, error: 'not_found' };
  const rows = await prisma.organizationNote.findMany({
    where: { organizationId: org.id },
    select: NOTE_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const now = new Date();
  const views = rows.map((r) => toNoteView(session, r, now));
  const pinned = views
    .filter((n) => n.pinnedAt !== null)
    .sort((a, b) => (b.pinnedAt?.getTime() ?? 0) - (a.pinnedAt?.getTime() ?? 0));
  return { ok: true, notes: views.filter((n) => n.pinnedAt === null), pinned };
}
