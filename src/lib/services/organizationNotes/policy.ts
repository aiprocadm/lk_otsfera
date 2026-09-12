import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canManagerAccessOrg } from '@/lib/auth/managerPolicy';
import { isManagerLeader, isStaffManagerSide } from '@/lib/auth/roleModel';

/**
 * Правила внутренних заметок (`У-183`, спека §3.6, `Р-Б-8`).
 *
 * Кто видит — сотрудники учебного центра компании организации; партнёр и
 * заказчик не должны узнать даже о существовании заметки (`not_found`).
 * Кто пишет — менеджер, руководитель, администратор. Правит автор в течение
 * суток, руководитель и администратор — всегда. Удаляет — руководитель и
 * администратор (умолчание `В-1-3`). Закрепляет любой, кто может писать, но не
 * больше трёх на организацию.
 */

/** Предел длины заметки — считается до сохранения (`note_too_long`). */
export const NOTE_BODY_MAX = 4000;
/** Сколько заметок можно держать закреплёнными сверху (`note_pin_limit`). */
export const NOTE_PIN_LIMIT = 3;
/** Окно правки своей заметки автором (`note_edit_expired`). */
export const NOTE_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Сотрудник ЦО своей компании: администратор, руководитель, менеджер. */
export function canAccessOrgNotes(session: SessionPayload): boolean {
  if (!session.companyId) return false;
  return session.role === 'admin' || isStaffManagerSide(session);
}

/** Руководитель и администратор — «старшие»: правят и удаляют любую заметку. */
export function isNoteSupervisor(session: SessionPayload): boolean {
  return session.role === 'admin' || isManagerLeader(session);
}

export function canEditNote(
  session: SessionPayload,
  note: { authorId: string | null; createdAt: Date },
  now: Date = new Date()
): boolean {
  if (isNoteSupervisor(session)) return true;
  return (
    note.authorId === session.sub && now.getTime() - note.createdAt.getTime() <= NOTE_EDIT_WINDOW_MS
  );
}

export function canDeleteNote(session: SessionPayload): boolean {
  return isNoteSupervisor(session);
}

/**
 * Организация доступна сотруднику: своя компания, а для рядового менеджера —
 * ещё и охват (командная видимость или закрепление; читается свежим внутри
 * `canManagerAccessOrg`, лидер-инвариант там же).
 */
export async function orgAccessibleForNotes(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<{ id: string; companyId: string } | null> {
  if (!canAccessOrgNotes(session)) return null;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, companyId: true },
  });
  if (!org || !org.companyId || org.companyId !== session.companyId) return null;
  const accessible = { id: org.id, companyId: org.companyId };
  if (session.role === 'admin') return accessible;
  return (await canManagerAccessOrg(prisma, session, orgId)) ? accessible : null;
}
