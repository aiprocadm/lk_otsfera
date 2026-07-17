import { type PrismaClient, type Prisma } from '@prisma/client';
import { z } from 'zod';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canSeeEvent } from './policy';

/**
 * M5 — CRUD событий staff-календаря (Result-контракт §3, эталон tasks.ts G3).
 * Company-scoped: создатель и целевое событие обязаны быть в `session.companyId`;
 * чужое → not_found (IDOR не leak-аем). Привязки к заявке/организации и участники
 * валидируются на принадлежность компании. Напоминание: remindAt = startsAt −
 * remindMinutes; при update пере-вычисляется, и если сдвинулось в будущее —
 * reminderSentAt сбрасывается (событие перенесли → напомнить заново).
 */

export type CalendarErrorCode = 'forbidden' | 'not_found' | 'validation';

/** Разрешённые интервалы напоминания, минуты (UI: 15 мин / 1 час / 1 день). */
export const REMIND_MINUTES = [15, 60, 1440] as const;

const inputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).nullish(),
    location: z.string().trim().max(300).nullish(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullish(),
    allDay: z.boolean().optional(),
    remindMinutes: z
      .union([z.literal(15), z.literal(60), z.literal(1440)])
      .nullish(),
    linkedOrderId: z.string().trim().min(1).nullish(),
    linkedOrganizationId: z.string().trim().min(1).nullish(),
    attendeeIds: z.array(z.string()).optional()
  })
  .refine((d) => !d.endsAt || d.endsAt.getTime() > d.startsAt.getTime(), {
    message: 'endsAt must be after startsAt'
  });
export type CalendarEventInput = z.input<typeof inputSchema>;

class CalendarError extends Error {
  readonly code: CalendarErrorCode;
  constructor(code: CalendarErrorCode) {
    super(code);
    this.code = code;
    this.name = 'CalendarError';
  }
}

function staffGate(session: SessionPayload): { companyId: string } | { error: 'forbidden' } {
  const isStaff = session.role === 'admin' || session.role === 'manager';
  if (!isStaff || !session.companyId) return { error: 'forbidden' };
  return { companyId: session.companyId };
}

function remindAtFor(startsAt: Date, remindMinutes: number | null | undefined): Date | null {
  if (!remindMinutes) return null;
  return new Date(startsAt.getTime() - remindMinutes * 60_000);
}

/** Проверяет, что привязки и участники принадлежат компании события. */
async function validateRefs(
  tx: Prisma.TransactionClient,
  companyId: string,
  data: z.infer<typeof inputSchema>
): Promise<void> {
  if (data.linkedOrderId) {
    const o = await tx.order.findUnique({ where: { id: data.linkedOrderId }, select: { companyId: true } });
    if (!o || o.companyId !== companyId) throw new CalendarError('validation');
  }
  if (data.linkedOrganizationId) {
    const org = await tx.organization.findUnique({
      where: { id: data.linkedOrganizationId },
      select: { companyId: true }
    });
    if (!org || org.companyId !== companyId) throw new CalendarError('validation');
  }
  if (data.attendeeIds && data.attendeeIds.length > 0) {
    const ids = [...new Set(data.attendeeIds)];
    const count = await tx.user.count({
      where: { id: { in: ids }, companyId, role: { in: ['admin', 'manager'] } }
    });
    if (count !== ids.length) throw new CalendarError('validation');
  }
}

/** Синхронизирует множество участников события (set-разница, идиома syncAssignees). */
async function syncAttendees(
  tx: Prisma.TransactionClient,
  eventId: string,
  attendeeIds: string[]
): Promise<void> {
  const desired = new Set(attendeeIds);
  const existing = await tx.calendarEventAttendee.findMany({ where: { eventId }, select: { userId: true } });
  const existingIds = new Set(existing.map((e) => e.userId));
  const toRemove = [...existingIds].filter((id) => !desired.has(id));
  const toAdd = [...desired].filter((id) => !existingIds.has(id));
  if (toRemove.length > 0)
    await tx.calendarEventAttendee.deleteMany({ where: { eventId, userId: { in: toRemove } } });
  if (toAdd.length > 0)
    await tx.calendarEventAttendee.createMany({ data: toAdd.map((userId) => ({ eventId, userId })) });
}

const SCOPE_SELECT = {
  companyId: true,
  createdById: true,
  attendees: { select: { userId: true } }
} as const;

type ScopeRow = {
  companyId: string;
  createdById: string;
  attendees: { userId: string }[];
};

function scopeArg(row: ScopeRow) {
  return {
    companyId: row.companyId,
    createdById: row.createdById,
    attendeeUserIds: row.attendees.map((a) => a.userId)
  };
}

export async function createEvent(
  prisma: PrismaClient,
  session: SessionPayload,
  input: CalendarEventInput
): Promise<{ ok: true; id: string } | { ok: false; error: CalendarErrorCode }> {
  const g = staffGate(session);
  if ('error' in g) return { ok: false, error: g.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const data = parsed.data;

  try {
    const created = await prisma.$transaction(async (tx) => {
      await validateRefs(tx, g.companyId, data);
      const event = await tx.calendarEvent.create({
        data: {
          companyId: g.companyId,
          createdById: session.sub,
          title: data.title.trim(),
          description: data.description ?? null,
          location: data.location ?? null,
          startsAt: data.startsAt,
          endsAt: data.endsAt ?? null,
          allDay: data.allDay ?? false,
          remindAt: remindAtFor(data.startsAt, data.remindMinutes),
          linkedOrderId: data.linkedOrderId ?? null,
          linkedOrganizationId: data.linkedOrganizationId ?? null
        }
      });
      if (data.attendeeIds && data.attendeeIds.length > 0) {
        await tx.calendarEventAttendee.createMany({
          data: [...new Set(data.attendeeIds)].map((userId) => ({ eventId: event.id, userId }))
        });
      }
      await recordAudit(tx, {
        userId: session.sub,
        action: 'calendar_event_created',
        entity: 'calendar_event',
        entityId: event.id,
        after: { title: event.title, startsAt: event.startsAt.toISOString() }
      });
      return event;
    });
    return { ok: true, id: created.id };
  } catch (e) {
    if (e instanceof CalendarError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function updateEvent(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string,
  input: CalendarEventInput
): Promise<{ ok: true } | { ok: false; error: CalendarErrorCode }> {
  const g = staffGate(session);
  if ('error' in g) return { ok: false, error: g.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const data = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.calendarEvent.findUnique({
        where: { id },
        select: { ...SCOPE_SELECT, title: true, remindAt: true, reminderSentAt: true }
      });
      if (!before) throw new CalendarError('not_found');
      if (!canSeeEvent(session, scopeArg(before))) throw new CalendarError('not_found');
      await validateRefs(tx, before.companyId, data);
      const nextRemindAt = remindAtFor(data.startsAt, data.remindMinutes);
      // Напоминание пере-взводится, если новое remindAt в будущем (перенос вперёд).
      const rearm =
        before.reminderSentAt !== null && nextRemindAt !== null && nextRemindAt.getTime() > Date.now();
      await tx.calendarEvent.update({
        where: { id },
        data: {
          title: data.title.trim(),
          description: data.description ?? null,
          location: data.location ?? null,
          startsAt: data.startsAt,
          endsAt: data.endsAt ?? null,
          allDay: data.allDay ?? false,
          remindAt: nextRemindAt,
          ...(rearm ? { reminderSentAt: null } : {}),
          linkedOrderId: data.linkedOrderId ?? null,
          linkedOrganizationId: data.linkedOrganizationId ?? null
        }
      });
      if (data.attendeeIds !== undefined) await syncAttendees(tx, id, data.attendeeIds);
      await recordAudit(tx, {
        userId: session.sub,
        action: 'calendar_event_updated',
        entity: 'calendar_event',
        entityId: id,
        before: { title: before.title },
        after: { title: data.title.trim(), startsAt: data.startsAt.toISOString() }
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof CalendarError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function deleteEvent(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<{ ok: true } | { ok: false; error: CalendarErrorCode }> {
  const g = staffGate(session);
  if ('error' in g) return { ok: false, error: g.error };

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.calendarEvent.findUnique({
        where: { id },
        select: { ...SCOPE_SELECT, title: true }
      });
      if (!before) throw new CalendarError('not_found');
      if (!canSeeEvent(session, scopeArg(before))) throw new CalendarError('not_found');
      // CalendarEventAttendee — ON DELETE CASCADE.
      await tx.calendarEvent.delete({ where: { id } });
      await recordAudit(tx, {
        userId: session.sub,
        action: 'calendar_event_deleted',
        entity: 'calendar_event',
        entityId: id,
        before: { title: before.title }
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof CalendarError) return { ok: false, error: e.code };
    throw e;
  }
}
