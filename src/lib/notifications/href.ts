import { notificationRoute } from './routes';

/**
 * Резолвер ссылки строки уведомления (Task C2, parity; этап 5 PR-3 `У-232`).
 * Чистая функция без побочных эффектов — используется NotificationBell для
 * router.push после пометки прочитанным и страницей «Уведомления»; null →
 * строка некликабельна.
 *
 * Два источника адреса:
 * 1. Таблица «тип × роль → маршрут» (`routes.ts`, `Р-Э5-7`) — считается от
 *    роли получателя по идентификаторам из `meta`.
 * 2. `meta.url` — запасной путь: относительный in-app путь ('/x', но не
 *    '//host') возвращается как есть; абсолютный http(s)-URL — ТОЛЬКО
 *    локальная часть `pathname + search + hash` (хост не проверяется и не
 *    используется: навигация всегда локальная, открытый редирект исключён
 *    по построению); всё прочее (не-строка, '//host', javascript:, невалидный
 *    URL) пропускается.
 *
 * Порядок зависит от роли:
 * - сотрудникам (admin/leader/manager) — СНАЧАЛА таблица, потом `meta.url`:
 *   до этапа 5 продьюсеры писали в строку `/manager/…` всем подряд, и старые
 *   строки в базе так и лежат; таблица лечит и их — руководитель попадает в
 *   `/leader/…`;
 * - заказчику и партнёру — сначала `meta.url` (их продьюсеры всегда писали
 *   свой кабинет, включая особые адреса вроде `/organization/settings`),
 *   потом таблица.
 */
export type NotificationRole = 'admin' | 'manager' | 'leader' | 'partner' | 'organization';

const STAFF_ROLES: ReadonlySet<NotificationRole> = new Set(['admin', 'manager', 'leader']);

/**
 * Локальный путь из meta.url: относительный — как есть; абсолютный http(s) —
 * pathname+search+hash (хост отбрасывается); иначе null.
 */
function localPathFromUrl(url: string): string | null {
  if (url.startsWith('/')) return url.startsWith('//') ? null : url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.pathname + u.search + u.hash;
}

export function notificationHref(
  role: NotificationRole,
  type: string,
  meta: unknown
): string | null {
  const m = meta !== null && typeof meta === 'object' ? (meta as Record<string, unknown>) : null;
  const url = m?.url;
  const fromUrl = typeof url === 'string' ? localPathFromUrl(url) : null;
  const fromTable = notificationRoute(type, m, role);

  return STAFF_ROLES.has(role) ? (fromTable ?? fromUrl) : (fromUrl ?? fromTable);
}
