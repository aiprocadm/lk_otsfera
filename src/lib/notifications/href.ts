/**
 * Клиентский резолвер deep-link'а для строки уведомления (Task C2, parity).
 * Чистая функция без побочных эффектов — используется NotificationBell для
 * router.push после пометки прочитанным; null → строка некликабельна.
 *
 * Ветки (по приоритету):
 * 1. `meta.url` — только относительный in-app путь ('/x', но не '//host' —
 *    защита от открытого редиректа). Абсолютные url (в т.ч. записанные
 *    org/partner-продьюсерами через getAppBaseUrl) сознательно отвергаются:
 *    в router.push уходит только внутренний путь.
 * 2. role='manager' + order-bound типы фан-аута (NotifyManagersType,
 *    src/lib/notifications/manager.ts) + строковый meta.orderId →
 *    /manager/orders/:id (менеджерские продьюсеры url в meta не пишут).
 * 3. role='admin' + type='ops_alert' → /admin/health (алерты мониторинга
 *    создаются без meta — deliverAlert).
 * 4. Иначе null (например, воркеры certificate_expiring/sync_error без url).
 */
export type NotificationRole = 'admin' | 'manager' | 'partner' | 'organization';

/** Дублирует NotifyManagersType из manager.ts — как Set строк для рантайм-проверки. */
const MANAGER_ORDER_TYPES: ReadonlySet<string> = new Set([
  'comment_from_org',
  'document_uploaded_by_org',
  'document_uploaded_by_partner',
  'order_marked_paid_by_1c',
  'order_status_changed_by_manager',
  'chat_message'
]);

export function notificationHref(role: NotificationRole, type: string, meta: unknown): string | null {
  const m = meta !== null && typeof meta === 'object' ? (meta as Record<string, unknown>) : null;

  const url = m?.url;
  if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) return url;

  if (role === 'manager' && MANAGER_ORDER_TYPES.has(type)) {
    const orderId = m?.orderId;
    if (typeof orderId === 'string' && orderId.length > 0) return `/manager/orders/${orderId}`;
  }

  if (role === 'admin' && type === 'ops_alert') return '/admin/health';

  return null;
}
