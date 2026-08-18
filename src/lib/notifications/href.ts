/**
 * Клиентский резолвер deep-link'а для строки уведомления (Task C2, parity).
 * Чистая функция без побочных эффектов — используется NotificationBell для
 * router.push после пометки прочитанным; null → строка некликабельна.
 *
 * Ветки (по приоритету):
 * 1. `meta.url`:
 *    - относительный in-app путь ('/x', но не '//host') — возвращается как есть;
 *    - абсолютный http(s)-URL (org/partner-продьюсеры пишут его через
 *      getAppBaseUrl — org.ts/partner.ts) — возвращается ТОЛЬКО локальная
 *      часть `pathname + search + hash`. Хост не проверяется и не
 *      используется: навигация всегда локальная по pathname, открытый
 *      редирект исключён по построению (даже вредоносный хост в meta.url
 *      даёт внутренний путь);
 *    - всё прочее (не-строка, '//host', не-http(s)-протокол вроде
 *      javascript:, невалидный URL) — ветка пропускается.
 * 2. role='manager' + order-bound типы фан-аута (NotifyManagersType,
 *    src/lib/notifications/manager.ts) + строковый meta.orderId →
 *    /manager/orders/:id (менеджерские продьюсеры url в meta не пишут).
 * 3. role='admin' + type='ops_alert' → /admin/health (алерты мониторинга
 *    создаются без meta — deliverAlert).
 * 4. Иначе null (например, воркеры certificate_expiring/sync_error без url).
 */
export type NotificationRole = 'admin' | 'manager' | 'leader' | 'partner' | 'organization';

/** Дублирует NotifyManagersType из manager.ts — как Set строк для рантайм-проверки. */
const MANAGER_ORDER_TYPES: ReadonlySet<string> = new Set([
  'comment_from_org',
  'document_uploaded_by_org',
  'document_uploaded_by_partner',
  'order_marked_paid_by_1c',
  'order_status_changed_by_manager',
  'chat_message',
]);

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
  if (typeof url === 'string') {
    const path = localPathFromUrl(url);
    if (path) return path;
  }

  if ((role === 'manager' || role === 'leader') && MANAGER_ORDER_TYPES.has(type)) {
    const orderId = m?.orderId;
    if (typeof orderId === 'string' && orderId.length > 0) return `/manager/orders/${orderId}`;
  }

  if (role === 'admin' && type === 'ops_alert') return '/admin/settings/system/health';

  return null;
}
