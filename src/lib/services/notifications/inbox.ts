import type { Notification, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { buildNotificationScopeWhere } from '@/lib/services/notifications/scope';
import {
  groupNotificationTypes,
  NOTIFICATION_TYPE_GROUP,
  type NotificationGroupKey,
  type NotificationGroupOption,
} from '@/lib/notifications/groups';
import {
  notificationTypesForRole,
  type NotificationRoleKey,
  type NotificationTypeKey,
} from '@/lib/notifications/registry';

/**
 * Чтение и отметка прочтения уведомлений (роуты `/api/notifications` и
 * `/api/notifications/unread`).
 *
 * Скоуп по роли — единый `buildNotificationScopeWhere`; он же ограничивает
 * PATCH: id из тела запроса добавляется к скоупу через `AND`, поэтому пометить
 * чужое уведомление нельзя, даже зная его id (проверка не «найти и сравнить»,
 * а фильтр в самом `updateMany` — гонок нет).
 *
 * Для PATCH скоуп строится с `candidateIds`: тяжёлая meta-ветка менеджера
 * ограничивается ровно теми id, которые пришли в запросе.
 */

export type MarkNotificationsReadArgs =
  { id: string; isRead: boolean } | { ids: string[]; isRead: boolean };

export async function listNotifications(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; notifications: Notification[] }> {
  const where = await buildNotificationScopeWhere(prisma, session);

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: [
      { lastOccurredAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    take: 50,
  });

  return { ok: true, notifications };
}

/**
 * Счётчик непрочитанных. Запрос обслуживается индексом
 * Notification @@index([userId, isRead]) (F2 §16).
 */
export async function countUnreadNotifications(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; count: number }> {
  const scope = await buildNotificationScopeWhere(prisma, session);

  const count = await prisma.notification.count({
    where: { AND: [scope, { isRead: false }] },
  });

  return { ok: true, count };
}

export async function markNotificationsRead(
  prisma: PrismaClient,
  session: SessionPayload,
  args: MarkNotificationsReadArgs
): Promise<{ ok: true; updated: { count: number } }> {
  const idFilter = 'id' in args ? { id: args.id } : { id: { in: args.ids } };
  const where = await buildNotificationScopeWhere(prisma, session, {
    candidateIds: 'id' in args ? [args.id] : args.ids,
  });

  const updated = await prisma.notification.updateMany({
    where: { AND: [idFilter, where] },
    data: { isRead: args.isRead },
  });

  return { ok: true, updated };
}

/** Сколько строк на странице «Уведомления» (`У-228`). */
export const NOTIFICATIONS_PAGE_SIZE = 50;

export type NotificationsPageFilters = {
  /** Только непрочитанные. */
  unread?: boolean | undefined;
  /**
   * Группа (`У-348`): «Системные», «Коммуникация»… Чужая для роли или
   * неизвестная — игнорируется, как и тип.
   */
  group?: string | null | undefined;
  /** Тип из реестра; чужой роли или неизвестный — игнорируется, а не 404. */
  type?: string | null | undefined;
  /** Номер страницы, с единицы. */
  page?: number | undefined;
};

export type NotificationsPage = {
  ok: true;
  rows: Notification[];
  total: number;
  unreadTotal: number;
  page: number;
  pageSize: number;
  /**
   * Типы роли по группам, в порядке настроек (`У-317`, `У-348`); пустые для
   * роли группы не попадают. Фильтр экрана строится по нему.
   */
  groupOptions: NotificationGroupOption[];
  /** Какая группа реально применена: из типа, если он выбран, иначе из адреса. */
  group: NotificationGroupKey | null;
  /** Какой тип реально применён (после проверки по реестру). */
  type: NotificationTypeKey | null;
};

/**
 * Страница «Уведомления» (`У-228`): тот же скоуп, что у колокольчика, плюс
 * фильтры и честный `total`.
 *
 * Фильтр по группе и типу сверяется с реестром ДЛЯ РОЛИ: партнёр не отфильтрует
 * `sla_escalation`, даже подставив его в адрес, — чужие типы не показываются
 * и не предлагаются (пакет §8). Неизвестный тип — просто «без фильтра».
 */
export async function listNotificationsPage(
  prisma: PrismaClient,
  session: SessionPayload,
  filters: NotificationsPageFilters = {}
): Promise<NotificationsPage> {
  const scope = await buildNotificationScopeWhere(prisma, session);
  const typeOptions = notificationTypesForRole(session.role as NotificationRoleKey);
  const groupOptions = groupNotificationTypes(typeOptions);
  const type =
    filters.type && (typeOptions as string[]).includes(filters.type)
      ? (filters.type as NotificationTypeKey)
      : null;
  // Выбранный тип сам называет свою группу: `?group=orders&type=task_assigned`
  // покажет «Задачи», а не «Заказы» с чужим типом внутри (`У-348`).
  const groupOption = type
    ? groupOptions.find((g) => g.key === NOTIFICATION_TYPE_GROUP[type])
    : groupOptions.find((g) => g.key === filters.group);
  const group = groupOption?.key ?? null;
  const typeFilter = type ? [{ type }] : groupOption ? [{ type: { in: groupOption.types } }] : [];

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const where = {
    AND: [scope, ...(filters.unread ? [{ isRead: false }] : []), ...typeFilter],
  };

  const [rows, total, unreadTotal] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [
        { lastOccurredAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      skip: (page - 1) * NOTIFICATIONS_PAGE_SIZE,
      take: NOTIFICATIONS_PAGE_SIZE,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { AND: [scope, { isRead: false }] } }),
  ]);

  return {
    ok: true,
    rows,
    total,
    unreadTotal,
    page,
    pageSize: NOTIFICATIONS_PAGE_SIZE,
    groupOptions,
    group,
    type,
  };
}

/**
 * «Отметить все прочитанными» (`Р-Э5-3`): по скоупу сессии, без списка
 * идентификаторов. Фильтры страницы намеренно не участвуют — человек на
 * фильтре «Задачи» не должен думать, что пометил всё.
 */
export async function markAllNotificationsRead(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; updated: { count: number } }> {
  const scope = await buildNotificationScopeWhere(prisma, session);
  const updated = await prisma.notification.updateMany({
    where: { AND: [scope, { isRead: false }] },
    data: { isRead: true },
  });
  return { ok: true, updated };
}
