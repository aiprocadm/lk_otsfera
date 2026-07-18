import type { PrismaClient, Prisma, TaskPriority } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { taskWhereForLevel, NO_COMPANY_SENTINEL } from '@/lib/auth/accessProfile';

/**
 * M5 — read-агрегатор календаря (спека 2026-07-17-m5-calendar §3, подход M1).
 * Единая хронология месяца из двух источников без хранимой синхронизации:
 *  - события `CalendarEvent` (company-floor C8 + scope-уровень `tasks` профиля:
 *    all → вся компания; own/assigned → создатель ∨ участник);
 *  - задачи `Task` c dueDate в диапазоне (существующий шов taskWhereForLevel —
 *    scope задач переиспользуется, не дублируется).
 * Admin работает в контексте своей companyId (company-floor как у staffGate
 * G3/M4); внутри floor'а admin не сужается уровнем профиля (Model A).
 */

export type CalendarItem = {
  kind: 'event' | 'task';
  id: string;
  title: string;
  date: Date;
  endsAt: Date | null;
  allDay: boolean;
  /** event-only */
  location: string | null;
  description: string | null;
  createdById: string | null;
  createdByName: string | null;
  attendeeIds: string[];
  attendeeNames: string[];
  remindMinutes: number | null;
  linkedOrderId: string | null;
  linkedOrderTitle: string | null;
  linkedOrganizationId: string | null;
  linkedOrganizationName: string | null;
  /** task-only */
  priority: TaskPriority | null;
  completedAt: Date | null;
};

export type CalendarRange = { from: Date; to: Date };

/** Экспортирован для M6 (глобальный поиск): единый шов видимости событий. */
export function eventScopeWhere(session: SessionPayload): Prisma.CalendarEventWhereInput {
  const floor: Prisma.CalendarEventWhereInput = {
    companyId: session.companyId ?? NO_COMPANY_SENTINEL
  };
  if (session.role === 'admin') return floor;
  const level = session.accessProfile?.tasks;
  if (!level || level === 'all') return floor;
  // own | assigned → создатель ∨ участник (спека §3: у события нет орг-скоупа).
  return {
    AND: [
      floor,
      { OR: [{ createdById: session.sub }, { attendees: { some: { userId: session.sub } } }] }
    ]
  };
}

export function remindMinutesFrom(startsAt: Date, remindAt: Date | null): number | null {
  if (!remindAt) return null;
  const minutes = Math.round((startsAt.getTime() - remindAt.getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}

export async function listCalendarItems(
  prisma: PrismaClient,
  session: SessionPayload,
  range: CalendarRange
): Promise<CalendarItem[]> {
  const isStaff = session.role === 'admin' || session.role === 'manager';
  if (!isStaff || !session.companyId) return [];

  const [events, tasks] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: {
        AND: [
          eventScopeWhere(session),
          // пересечение [from, to): событие началось до конца окна и (не имеет
          // конца ∧ началось в окне) ∨ закончилось после начала окна.
          { startsAt: { lt: range.to } },
          { OR: [{ endsAt: null, startsAt: { gte: range.from } }, { endsAt: { gt: range.from } }] }
        ]
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        remindAt: true,
        createdById: true,
        createdBy: { select: { name: true } },
        attendees: { select: { userId: true, user: { select: { name: true } } } },
        linkedOrderId: true,
        linkedOrder: { select: { title: true } },
        linkedOrganizationId: true,
        linkedOrganization: { select: { name: true } }
      }
    }),
    prisma.task.findMany({
      where: {
        AND: [
          taskWhereForLevel(session, session.accessProfile?.tasks ?? 'all'),
          { dueDate: { gte: range.from, lt: range.to } }
        ]
      },
      orderBy: { dueDate: 'asc' },
      take: 500,
      select: {
        id: true,
        title: true,
        dueDate: true,
        priority: true,
        completedAt: true
      }
    })
  ]);

  const items: CalendarItem[] = [
    ...events.map(
      (e): CalendarItem => ({
        kind: 'event',
        id: e.id,
        title: e.title,
        date: e.startsAt,
        endsAt: e.endsAt,
        allDay: e.allDay,
        location: e.location,
        description: e.description,
        createdById: e.createdById,
        createdByName: e.createdBy.name,
        attendeeIds: e.attendees.map((a) => a.userId),
        attendeeNames: e.attendees.map((a) => a.user.name),
        remindMinutes: remindMinutesFrom(e.startsAt, e.remindAt),
        linkedOrderId: e.linkedOrderId,
        linkedOrderTitle: e.linkedOrder?.title ?? null,
        linkedOrganizationId: e.linkedOrganizationId,
        linkedOrganizationName: e.linkedOrganization?.name ?? null,
        priority: null,
        completedAt: null
      })
    ),
    ...tasks
      .filter((t) => t.dueDate !== null)
      .map(
        (t): CalendarItem => ({
          kind: 'task',
          id: t.id,
          title: t.title,
          date: t.dueDate as Date,
          endsAt: null,
          allDay: true,
          location: null,
          description: null,
          createdById: null,
          createdByName: null,
          attendeeIds: [],
          attendeeNames: [],
          remindMinutes: null,
          linkedOrderId: null,
          linkedOrderTitle: null,
          linkedOrganizationId: null,
          linkedOrganizationName: null,
          priority: t.priority,
          completedAt: t.completedAt
        })
      )
  ];

  return items.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Данные для селектов диалога события (участники/организации/заявки), company-scoped. */
export type EventFormOptions = {
  users: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
  orders: { id: string; title: string }[];
};

export async function getEventFormOptions(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<EventFormOptions> {
  const companyId = session.companyId ?? NO_COMPANY_SENTINEL; // нет компании → пустые списки (fail-safe)
  const [users, organizations, orders] = await Promise.all([
    prisma.user.findMany({
      where: { companyId, role: { in: ['admin', 'manager'] }, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200
    }),
    prisma.organization.findMany({
      where: { companyId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200
    }),
    prisma.order.findMany({
      where: { companyId },
      select: { id: true, title: true },
      orderBy: { createdAt: 'desc' },
      take: 100
    })
  ]);
  return { users, organizations, orders };
}
