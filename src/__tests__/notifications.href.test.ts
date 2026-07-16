import { describe, it, expect } from 'vitest';
import { notificationHref } from '@/lib/notifications/href';

/** Все order-bound типы менеджерского фан-аута (NotifyManagersType, manager.ts). */
const MANAGER_ORDER_TYPES = [
  'comment_from_org',
  'document_uploaded_by_org',
  'document_uploaded_by_partner',
  'order_marked_paid_by_1c',
  'order_status_changed_by_manager',
  'chat_message'
] as const;

describe('notificationHref', () => {
  describe('ветка 1: meta.url (приоритетная)', () => {
    it('возвращает относительный url из meta для любой роли/типа', () => {
      expect(notificationHref('partner', 'lead_status_changed', { url: '/partner/leads/l1' })).toBe(
        '/partner/leads/l1'
      );
      expect(notificationHref('organization', 'payment_received', { url: '/organization/orders/o1' })).toBe(
        '/organization/orders/o1'
      );
    });

    it('meta.url приоритетнее ролевых веток (manager order-bound, admin ops_alert)', () => {
      expect(
        notificationHref('manager', 'chat_message', { url: '/manager/documents', orderId: 'o1' })
      ).toBe('/manager/documents');
      expect(notificationHref('admin', 'ops_alert', { url: '/admin/dlq' })).toBe('/admin/dlq');
    });

    it('отвергает не-строковый url (число, объект, null)', () => {
      expect(notificationHref('partner', 'x', { url: 42 })).toBeNull();
      expect(notificationHref('partner', 'x', { url: { nested: true } })).toBeNull();
      expect(notificationHref('partner', 'x', { url: null })).toBeNull();
    });

    it('принимает абсолютный http(s)-url продьюсеров: навигация по pathname+search+hash', () => {
      // org/partner-продьюсеры пишут абсолютный url через getAppBaseUrl
      // (org.ts, partner.ts) — берётся только локальная часть
      expect(
        notificationHref('partner', 'lead_status_changed', { url: 'https://lk.otsfera.ru/partner/leads/l1?x=1' })
      ).toBe('/partner/leads/l1?x=1');
      expect(
        notificationHref('organization', 'payment_received', { url: 'http://localhost:3000/organization/orders/o1' })
      ).toBe('/organization/orders/o1');
      expect(notificationHref('partner', 'document_published', { url: 'https://lk.otsfera.ru/partner/documents?tab=general#top' })).toBe(
        '/partner/documents?tab=general#top'
      );
    });

    it('чужой хост не даёт внешнего редиректа: берётся только локальный путь', () => {
      // хост игнорируется по построению — в router.push уходит локальный
      // pathname, наружу уйти невозможно даже при вредоносном meta.url
      expect(notificationHref('partner', 'x', { url: 'https://evil.example/partner/leads/l1' })).toBe(
        '/partner/leads/l1'
      );
    });

    it('отвергает не-http(s) протоколы и невалидные URL', () => {
      expect(notificationHref('partner', 'x', { url: 'javascript:alert(1)' })).toBeNull();
      expect(notificationHref('partner', 'x', { url: 'ftp://host/file' })).toBeNull();
      expect(notificationHref('partner', 'x', { url: 'http://' })).toBeNull(); // new URL бросает
      expect(notificationHref('partner', 'x', { url: 'совсем не урл' })).toBeNull();
    });

    it('отвергает protocol-relative //host (открытый редирект)', () => {
      expect(notificationHref('partner', 'x', { url: '//evil.example/phish' })).toBeNull();
    });

    it('meta null/undefined/не-объект → ветка url пропускается', () => {
      expect(notificationHref('partner', 'x', null)).toBeNull();
      expect(notificationHref('partner', 'x', undefined)).toBeNull();
      expect(notificationHref('partner', 'x', 'just-a-string')).toBeNull();
    });
  });

  describe('ветка 2: manager + order-bound типы', () => {
    it.each(MANAGER_ORDER_TYPES)('%s + meta.orderId → /manager/orders/:id', (type) => {
      expect(notificationHref('manager', type, { orderId: 'ord-1' })).toBe('/manager/orders/ord-1');
    });

    it('без orderId → null', () => {
      expect(notificationHref('manager', 'chat_message', {})).toBeNull();
      expect(notificationHref('manager', 'chat_message', null)).toBeNull();
    });

    it('orderId не строка → null', () => {
      expect(notificationHref('manager', 'chat_message', { orderId: 42 })).toBeNull();
      // order-less фан-аут (notifyManagersOrderLess) пишет в meta orderId: null
      // и url НЕ пишет — такие строки остаются некликабельными
      expect(notificationHref('manager', 'document_uploaded_by_org', { orderId: null })).toBeNull();
    });

    it('orderId пустая строка → null (не строим /manager/orders/)', () => {
      expect(notificationHref('manager', 'chat_message', { orderId: '' })).toBeNull();
    });

    it('не-order тип у менеджера → null (воркеры certificate_expiring/sync_error без url)', () => {
      expect(notificationHref('manager', 'certificate_expiring', { orderId: 'ord-1' })).toBeNull();
      expect(notificationHref('manager', 'sync_error', {})).toBeNull();
    });

    it('те же order-bound типы у других ролей → null', () => {
      expect(notificationHref('organization', 'chat_message', { orderId: 'ord-1' })).toBeNull();
      expect(notificationHref('partner', 'document_uploaded_by_partner', { orderId: 'ord-1' })).toBeNull();
      expect(notificationHref('admin', 'comment_from_org', { orderId: 'ord-1' })).toBeNull();
    });
  });

  describe('ветка 3: admin + ops_alert', () => {
    it('admin + ops_alert → /admin/health (meta у алертов отсутствует)', () => {
      expect(notificationHref('admin', 'ops_alert', undefined)).toBe('/admin/health');
      expect(notificationHref('admin', 'ops_alert', null)).toBe('/admin/health');
    });

    it('admin + другой тип → null', () => {
      expect(notificationHref('admin', 'sync_error', {})).toBeNull();
    });

    it('ops_alert у не-админа → null', () => {
      expect(notificationHref('manager', 'ops_alert', {})).toBeNull();
      expect(notificationHref('partner', 'ops_alert', {})).toBeNull();
    });
  });

  describe('fallback: null → некликабельная строка', () => {
    it('partner/organization без url в meta → null', () => {
      expect(notificationHref('partner', 'commission_statement_ready', { statementId: 's1' })).toBeNull();
      expect(notificationHref('organization', 'certificate_expiring', {})).toBeNull();
    });
  });
});
