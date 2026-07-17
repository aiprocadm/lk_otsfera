import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// deliverNotificationToUser веером идёт во внешние каналы (email/queue) — мокаем
// его; createNotification оставляем настоящим (importOriginal), чтобы проверить
// реальные строки Notification в живой БД (в отличие от certificate-expiry, у
// календаря нет своей reminder-таблицы — единственная улика и есть Notification).
const { deliverNotificationToUser } = vi.hoisted(() => ({
  deliverNotificationToUser: vi.fn().mockResolvedValue({})
}));
vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>();
  return { ...actual, deliverNotificationToUser };
});

import { runCalendarReminders } from '@/worker/processors/calendar-reminder';

const prisma = new PrismaClient();
const ids: Record<string, string> = {};

const NOW = new Date();
const MIN = 60_000;
const HOUR = 60 * MIN;
/** Маркер «уже отправлено» для кейса (d) — не должен быть перезаписан. */
const ALREADY_SENT_AT = new Date('2026-01-01T00:00:00.000Z');

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: 'm5calrem-co' } });
  const creator = await prisma.user.create({
    data: { email: 'creator@m5calrem.test', name: 'Создатель', role: 'manager', companyId: company.id }
  });
  const attendee = await prisma.user.create({
    data: { email: 'attendee@m5calrem.test', name: 'Участник', role: 'manager', companyId: company.id }
  });

  // (a) свежий кандидат: remindAt в прошлом (<24ч), напоминание должно уйти
  const evFresh = await prisma.calendarEvent.create({
    data: {
      companyId: company.id,
      title: 'Свежая планёрка',
      location: 'Zoom',
      startsAt: new Date(NOW.getTime() + 50 * MIN),
      remindAt: new Date(NOW.getTime() - 10 * MIN),
      createdById: creator.id
    }
  });
  await prisma.calendarEventAttendee.create({ data: { eventId: evFresh.id, userId: attendee.id } });

  // (c) протухший кандидат: remindAt старше 24ч — только пометить, без отправки
  const evStale = await prisma.calendarEvent.create({
    data: {
      companyId: company.id,
      title: 'Протухшее событие',
      startsAt: new Date(NOW.getTime() - 24 * HOUR),
      remindAt: new Date(NOW.getTime() - 25 * HOUR),
      createdById: creator.id
    }
  });

  // (d) уже отправленное: reminderSentAt != null — не кандидат вовсе
  const evAlready = await prisma.calendarEvent.create({
    data: {
      companyId: company.id,
      title: 'Уже отправленное',
      startsAt: new Date(NOW.getTime() + 50 * MIN),
      remindAt: new Date(NOW.getTime() - 10 * MIN),
      reminderSentAt: ALREADY_SENT_AT,
      createdById: creator.id
    }
  });

  Object.assign(ids, {
    company: company.id,
    creator: creator.id,
    attendee: attendee.id,
    evFresh: evFresh.id,
    evStale: evStale.id,
    evAlready: evAlready.id
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [ids.creator, ids.attendee] } } });
  // CalendarEventAttendee каскадится с событием (onDelete: Cascade)
  await prisma.calendarEvent.deleteMany({ where: { companyId: ids.company } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.creator, ids.attendee] } } });
  await prisma.company.delete({ where: { id: ids.company } });
  await prisma.$disconnect();
});

async function reminderNotifications() {
  const rows = await prisma.notification.findMany({
    where: { type: 'calendar_event_reminder', userId: { in: [ids.creator, ids.attendee] } }
  });
  return rows;
}

describe('calendar-reminder processor (integration)', () => {
  it('(a) свежее событие: уведомления создателю и участнику, reminderSentAt проставлен', async () => {
    const res = await runCalendarReminders(prisma, NOW);
    expect(res.remindersSent).toBe(1);
    expect(res.stale).toBe(1);

    const rows = await reminderNotifications();
    const freshRows = rows.filter(
      (n) => (n.meta as { calendarEventId?: string } | null)?.calendarEventId === ids.evFresh
    );
    expect(freshRows).toHaveLength(2);
    expect(new Set(freshRows.map((n) => n.userId))).toEqual(new Set([ids.creator, ids.attendee]));
    expect(freshRows.every((n) => n.body.includes('Свежая планёрка'))).toBe(true);
    expect(freshRows.every((n) => n.body.includes('Zoom'))).toBe(true);

    const evFresh = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: ids.evFresh } });
    expect(evFresh.reminderSentAt).not.toBeNull();

    // доставка — по одному вызову на получателя, dedupKey = id строки Notification
    expect(deliverNotificationToUser).toHaveBeenCalledTimes(2);
    const dedupKeys = deliverNotificationToUser.mock.calls.map((c) => c[0].dedupKey).sort();
    expect(dedupKeys).toEqual(freshRows.map((n) => n.id).sort());
    for (const [payload] of deliverNotificationToUser.mock.calls) {
      expect(payload.type).toBe('calendar_event_reminder');
      expect(payload.url).toBe('/manager/calendar');
    }
  });

  it('(c) протухшее событие помечено без отправки уведомлений', async () => {
    const evStale = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: ids.evStale } });
    expect(evStale.reminderSentAt).not.toBeNull();

    const rows = await reminderNotifications();
    const staleRows = rows.filter(
      (n) => (n.meta as { calendarEventId?: string } | null)?.calendarEventId === ids.evStale
    );
    expect(staleRows).toHaveLength(0);
  });

  it('(d) событие с reminderSentAt != null не тронуто', async () => {
    const evAlready = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: ids.evAlready } });
    expect(evAlready.reminderSentAt).toEqual(ALREADY_SENT_AT);

    const rows = await reminderNotifications();
    const alreadyRows = rows.filter(
      (n) => (n.meta as { calendarEventId?: string } | null)?.calendarEventId === ids.evAlready
    );
    expect(alreadyRows).toHaveLength(0);
  });

  it('(b) повторный прогон идемпотентен: новых уведомлений и доставок нет', async () => {
    deliverNotificationToUser.mockClear();
    const before = (await reminderNotifications()).length;

    const res = await runCalendarReminders(prisma, new Date(NOW.getTime() + MIN));
    expect(res).toEqual({ remindersSent: 0, stale: 0 });

    const after = (await reminderNotifications()).length;
    expect(after).toBe(before);
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
  });
});
