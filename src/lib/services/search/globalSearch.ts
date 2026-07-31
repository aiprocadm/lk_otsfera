import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { recordPiiAccess } from '@/lib/pii/record';
import { searchScopes } from './scopes';

/**
 * M6 (спека 2026-07-18): глобальный поиск staff — параллельная read-агрегация
 * по категориям поверх существующих scope-швов (scopes.ts), без новых таблиц.
 * Категории модулей под opt-in флагами (задачи/календарь/чат) участвуют только
 * при включённом флаге своего раздела — поиск не раскрывает выключенный модуль.
 * Строка запроса не пишется ни в журнал ПДн, ни в audit, ни в логи (§25.7).
 */

export const SEARCH_TAKE = 8;

export const SEARCH_CATEGORIES = [
  'orders',
  'organizations',
  'leads',
  'tasks',
  'events',
  'documents',
  'students',
  'messages',
] as const;
export type SearchCategory = (typeof SEARCH_CATEGORIES)[number];

export const SEARCH_CATEGORY_LABELS_RU: Record<SearchCategory, string> = {
  orders: 'Заказы',
  organizations: 'Организации',
  leads: 'Заявки',
  tasks: 'Задачи',
  events: 'Календарь',
  documents: 'Документы',
  students: 'Слушатели',
  messages: 'Чат команды',
};

export type SearchHit = {
  id: string;
  /** Первая строка результата (название/номер/сниппет). */
  title: string;
  /** Вторая строка (организация/автор/детали) — опциональна. */
  subtitle: string | null;
  href: string;
  date: Date | null;
};

export type SearchGroup = {
  key: SearchCategory;
  labelRu: string;
  hits: SearchHit[];
  /** true — выдача упёрлась в лимит (показаны первые SEARCH_TAKE). */
  limited: boolean;
};

export type GlobalSearchResult =
  | { ok: true; query: string; groups: SearchGroup[] }
  | { ok: false; error: 'forbidden' | 'too_short' };

function snippet(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function joinParts(...parts: (string | null | undefined)[]): string | null {
  const filled = parts.filter((p): p is string => !!p && p.length > 0);
  return filled.length ? filled.join(' · ') : null;
}

export async function globalSearch(
  prisma: PrismaClient,
  session: SessionPayload,
  args: {
    q: string;
    /**
     * Зеркало `teamModeOverride` списков лидера (leader/orders, leader/organizations):
     * страница /leader/search смотрит на всю компанию независимо от тумблера
     * managerTeamVisibility. Гейт — requireManagerLeader на самой странице;
     * сервис доверяет вызывающему так же, как listOrders.
     */
    teamModeOverride?: boolean;
  }
): Promise<GlobalSearchResult> {
  // Гейты: флаг (defense-in-depth к page-гейту) + staff-идиома (G3/M5).
  if (!isFeatureEnabled('global_search')) return { ok: false, error: 'forbidden' };
  const isStaff = session.role === 'admin' || session.role === 'manager';
  if (!isStaff || !session.companyId) return { ok: false, error: 'forbidden' };

  const q = args.q.trim().slice(0, 100);
  if (q.length < 2) return { ok: false, error: 'too_short' };

  const teamMode =
    session.role !== 'manager'
      ? false
      : args.teamModeOverride === true
        ? true
        : await getCompanyTeamVisibility(prisma, session.companyId);
  const scopes = searchScopes(session, teamMode);
  const insensitive = 'insensitive' as const;

  const [orders, organizations, leads, tasks, events, documents, students, messages] =
    await Promise.all([
      prisma.order.findMany({
        where: {
          AND: [
            scopes.orders,
            {
              OR: [
                { title: { contains: q, mode: insensitive } },
                { orderNumber: { contains: q, mode: insensitive } },
                // Внешние идентификаторы — точные строки, без case-фолда (идиома репо).
                { externalId: { contains: q } },
              ],
            },
          ],
        },
        select: {
          id: true,
          title: true,
          orderNumber: true,
          createdAt: true,
          organization: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: SEARCH_TAKE,
      }),
      prisma.organization.findMany({
        where: {
          AND: [
            scopes.organizations,
            {
              OR: [
                { name: { contains: q, mode: insensitive } },
                { inn: { contains: q } },
                { externalId: { contains: q } },
              ],
            },
          ],
        },
        select: { id: true, name: true, inn: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: SEARCH_TAKE,
      }),
      prisma.lead.findMany({
        where: {
          AND: [
            scopes.leads,
            {
              OR: [
                { clientCompanyName: { contains: q, mode: insensitive } },
                { subject: { contains: q, mode: insensitive } },
                { clientInn: { contains: q } },
              ],
            },
          ],
        },
        select: { id: true, clientCompanyName: true, subject: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: SEARCH_TAKE,
      }),
      isFeatureEnabled('internal_tasks')
        ? prisma.task.findMany({
            where: {
              AND: [
                scopes.tasks,
                {
                  OR: [
                    { title: { contains: q, mode: insensitive } },
                    { description: { contains: q, mode: insensitive } },
                  ],
                },
              ],
            },
            select: { id: true, title: true, description: true, dueDate: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: SEARCH_TAKE,
          })
        : Promise.resolve([]),
      isFeatureEnabled('staff_calendar')
        ? prisma.calendarEvent.findMany({
            where: {
              AND: [
                scopes.events,
                {
                  OR: [
                    { title: { contains: q, mode: insensitive } },
                    { description: { contains: q, mode: insensitive } },
                    { location: { contains: q, mode: insensitive } },
                  ],
                },
              ],
            },
            select: { id: true, title: true, location: true, startsAt: true },
            orderBy: { startsAt: 'desc' },
            take: SEARCH_TAKE,
          })
        : Promise.resolve([]),
      prisma.document.findMany({
        where: { AND: [scopes.documents, { name: { contains: q, mode: insensitive } }] },
        select: {
          id: true,
          name: true,
          createdAt: true,
          order: { select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: SEARCH_TAKE,
      }),
      prisma.student.findMany({
        where: {
          AND: [
            scopes.students,
            {
              OR: [
                { name: { contains: q, mode: insensitive } },
                { email: { contains: q, mode: insensitive } },
              ],
            },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          organization: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: SEARCH_TAKE,
      }),
      isFeatureEnabled('staff_chat')
        ? prisma.staffMessage.findMany({
            where: {
              AND: [
                scopes.messages,
                {
                  OR: [
                    { body: { contains: q, mode: insensitive } },
                    { attachmentName: { contains: q, mode: insensitive } },
                  ],
                },
              ],
            },
            select: {
              id: true,
              body: true,
              attachmentName: true,
              createdAt: true,
              author: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: SEARCH_TAKE,
          })
        : Promise.resolve([]),
    ]);

  // §25.7: слушатели в выдаче — ПДн; журналируем id (никогда не бросает,
  // no-op при пустой выдаче). Сырую строку запроса в meta класть нельзя.
  await recordPiiAccess(prisma, {
    session,
    context: 'global_search_students',
    subjectIds: students.map((s) => s.id),
    meta: { take: SEARCH_TAKE, hasQuery: true },
  });

  const groups: SearchGroup[] = [
    {
      key: 'orders' as const,
      hits: orders.map((o) => ({
        id: o.id,
        title: o.title,
        subtitle: joinParts(o.orderNumber, o.organization.name),
        href: `/manager/orders/${o.id}`,
        date: o.createdAt,
      })),
    },
    {
      key: 'organizations' as const,
      hits: organizations.map((org) => ({
        id: org.id,
        title: org.name,
        subtitle: org.inn ? `ИНН ${org.inn}` : null,
        href: `/manager/organizations/${org.id}`,
        date: org.createdAt,
      })),
    },
    {
      key: 'leads' as const,
      hits: leads.map((l) => ({
        id: l.id,
        title: l.clientCompanyName,
        subtitle: snippet(l.subject, 80),
        href: `/manager/leads/${l.id}`,
        date: l.createdAt,
      })),
    },
    {
      key: 'tasks' as const,
      hits: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        subtitle: t.description ? snippet(t.description, 80) : null,
        href: '/manager/tasks',
        date: t.dueDate ?? t.createdAt,
      })),
    },
    {
      key: 'events' as const,
      hits: events.map((e) => ({
        id: e.id,
        title: e.title,
        subtitle: e.location,
        href: '/manager/calendar',
        date: e.startsAt,
      })),
    },
    {
      key: 'documents' as const,
      hits: documents.map((d) => ({
        id: d.id,
        title: d.name,
        subtitle: d.order?.title ?? null,
        href: '/manager/documents',
        date: d.createdAt,
      })),
    },
    {
      key: 'students' as const,
      hits: students.map((s) => ({
        id: s.id,
        title: s.name,
        subtitle: joinParts(s.email, s.organization.name),
        href: `/manager/students/${s.id}`,
        date: s.createdAt,
      })),
    },
    {
      key: 'messages' as const,
      hits: messages.map((m) => ({
        id: m.id,
        title: m.body ? snippet(m.body, 120) : (m.attachmentName ?? ''),
        subtitle: m.author.name,
        href: '/manager/messages',
        date: m.createdAt,
      })),
    },
  ]
    .map((g) => ({
      ...g,
      labelRu: SEARCH_CATEGORY_LABELS_RU[g.key],
      limited: g.hits.length === SEARCH_TAKE,
    }))
    .filter((g) => g.hits.length > 0);

  return { ok: true, query: q, groups };
}
