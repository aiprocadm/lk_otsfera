import type { PrismaClient } from '@prisma/client';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { log } from '@/lib/logging';

/**
 * M5 (спека 2026-07-17-m5-calendar §5) — напоминания о событиях календаря.
 * Cron каждые 5 минут. Кандидат: remindAt ≤ now, reminderSentAt = null.
 * Идемпотентность двухуровневая: (1) атомарный claim reminderSentAt через
 * updateMany с where reminderSentAt:null — параллельный воркер получает count 0
 * и пропускает; (2) dedupKey строки Notification в диспетчере (BullMQ jobId).
 * Протухшие (remindAt старше 24ч — воркер лежал) только помечаются, без спама.
 * Fan-out best-effort: сбой доставки логируется и не роняет джоб (§3).
 */

const STALE_MS = 24 * 60 * 60 * 1000;

export async function runCalendarReminders(
  prisma: PrismaClient,
  now: Date
): Promise<{ remindersSent: number; stale: number }> {
  const candidates = await prisma.calendarEvent.findMany({
    where: { remindAt: { not: null, lte: now }, reminderSentAt: null },
    take: 200,
    select: {
      id: true,
      title: true,
      startsAt: true,
      remindAt: true,
      location: true,
      createdById: true,
      attendees: { select: { userId: true } }
    }
  });

  let remindersSent = 0;
  let stale = 0;

  for (const event of candidates) {
    // Атомарный claim: только один воркер «сжигает» напоминание.
    const claimed = await prisma.calendarEvent.updateMany({
      where: { id: event.id, reminderSentAt: null },
      data: { reminderSentAt: now }
    });
    if (claimed.count === 0) continue;

    /* v8 ignore next -- remindAt в выборке not:null, ветка защитная */
    const remindAtMs = event.remindAt?.getTime() ?? 0;
    if (now.getTime() - remindAtMs > STALE_MS) {
      stale += 1;
      continue;
    }

    const recipients = new Set<string>([event.createdById]);
    event.attendees.forEach((a) => recipients.add(a.userId));

    const when = event.startsAt.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow'
    });
    const title = 'Напоминание о событии';
    const body = `«${event.title}» — ${when}${event.location ? `, ${event.location}` : ''}`;

    for (const userId of recipients) {
      try {
        const row = await createNotification({
          userId,
          type: 'calendar_event_reminder',
          title,
          body,
          meta: { calendarEventId: event.id }
        });
        await deliverNotificationToUser({
          userId,
          title,
          body,
          type: 'calendar_event_reminder',
          url: '/manager/calendar',
          dedupKey: row.id
        });
      } catch (e) {
        log.error('[calendar-reminder] delivery failed', { err: e, calendarEventId: event.id, userId });
      }
    }

    remindersSent += 1;
  }

  return { remindersSent, stale };
}

/** BullMQ wrapper, вызывается воркером по расписанию. */
export async function calendarReminderProcessor(): Promise<{ remindersSent: number; stale: number }> {
  const { prisma } = await import('@/lib/db/prisma');
  return runCalendarReminders(prisma, new Date());
}
