'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, str } from '@/lib/actions/form';

import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import {
  createEvent,
  updateEvent,
  deleteEvent,
  REMIND_MINUTES,
  type CalendarEventInput,
  type CalendarErrorCode,
} from '@/lib/services/calendar/events';

/**
 * M5 — server-actions событий staff-календаря (спека 2026-07-17-m5-calendar §4).
 * Флаг staff_calendar гейтится здесь (Result 'forbidden', идиома backupCodes) —
 * страница со своим notFound-гейтом может быть открыта в момент выключения флага.
 * Company-scope и роли энфорсит сервис (staffGate + canSeeEvent).
 */

function revalidate(): void {
  revalidatePath('/manager/calendar');
  revalidatePath('/leader/calendar');
}

function eventInput(fd: FormData): CalendarEventInput {
  const startsAt = str(fd, 'startsAt');
  const endsAt = str(fd, 'endsAt');
  const remindRaw = Number(str(fd, 'remindMinutes'));
  const remind = (REMIND_MINUTES as readonly number[]).includes(remindRaw)
    ? (remindRaw as (typeof REMIND_MINUTES)[number])
    : null;
  return {
    title: str(fd, 'title'),
    description: str(fd, 'description') || null,
    location: str(fd, 'location') || null,
    // Пустая строка → invalid Date → сервис отбраковывает через z.coerce.date.
    startsAt: new Date(startsAt),
    endsAt: endsAt ? new Date(endsAt) : null,
    allDay: fd.get('allDay') === 'on' || str(fd, 'allDay') === 'true',
    remindMinutes: remind,
    linkedOrderId: str(fd, 'linkedOrderId') || null,
    linkedOrganizationId: str(fd, 'linkedOrganizationId') || null,
    attendeeIds: fd.getAll('attendeeIds').filter((v): v is string => typeof v === 'string'),
  };
}

export async function createEventAction(
  fd: FormData
): Promise<ActionResult<CalendarErrorCode> & { id?: string }> {
  const session = await requireSession();
  if (!isFeatureEnabled('staff_calendar')) return { ok: false, error: 'forbidden' };
  const res = await createEvent(prisma, session, eventInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true, id: res.id };
}

export async function updateEventAction(fd: FormData): Promise<ActionResult<CalendarErrorCode>> {
  const session = await requireSession();
  if (!isFeatureEnabled('staff_calendar')) return { ok: false, error: 'forbidden' };
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await updateEvent(prisma, session, id, eventInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

export async function deleteEventAction(fd: FormData): Promise<ActionResult<CalendarErrorCode>> {
  const session = await requireSession();
  if (!isFeatureEnabled('staff_calendar')) return { ok: false, error: 'forbidden' };
  const id = str(fd, 'id');
  if (!id) return { ok: false, error: 'not_found' };
  const res = await deleteEvent(prisma, session, id);
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}
