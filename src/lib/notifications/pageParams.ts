import type { NotificationsPageFilters } from '@/lib/services/notifications/inbox';

/**
 * Фильтры страницы «Уведомления» из адреса (`У-228`).
 *
 * Один разбор на шесть страниц: `?unread=1&group=tasks&type=task_assigned&page=2`
 * (группа — этап 4 ТЗ 28.10.2026, `У-348`). Мусор в адресе не роняет
 * страницу: неизвестные группу и тип проверит сервис по реестру роли, некорректный номер страницы становится первой.
 */
export function readNotificationsSearchParams(
  sp: Record<string, string | string[] | undefined>
): NotificationsPageFilters {
  const one = (v: string | string[] | undefined): string | undefined =>
    typeof v === 'string' ? v : undefined;
  const pageRaw = Number(one(sp.page) ?? '1');
  return {
    unread: one(sp.unread) === '1',
    group: one(sp.group) ?? null,
    type: one(sp.type) ?? null,
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
  };
}
