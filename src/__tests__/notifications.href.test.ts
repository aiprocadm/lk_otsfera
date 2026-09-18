import { describe, it, expect } from 'vitest';
import { notificationHref } from '@/lib/notifications/href';

/**
 * Резолвер ссылки строки уведомления после этапа 5 PR-3 (`У-232`, `Р-Э5-7`):
 * адрес считается от роли получателя по таблице `routes.ts`; `meta.url` —
 * запасной путь. Порядок зависит от роли: сотрудникам — сначала таблица (в
 * базе лежат старые строки с `/manager/…` для руководителя), клиентам —
 * сначала `meta.url` (их продьюсеры всегда писали свой кабинет).
 *
 * Прежний тест «роль leader получает те же order-bound ссылки /manager/…»
 * (ТЗ 2026-08-17) переписан: действующее ТЗ (`У-232`) велит руководителю
 * `/leader/orders/:id`, и при конфликте побеждает действующее (CLAUDE.md §14).
 */

/** Order-bound типы менеджерского фан-аута (NotifyManagersType, manager.ts). */
const MANAGER_ORDER_TYPES = [
  'comment_from_org',
  'document_uploaded_by_org',
  'document_uploaded_by_partner',
  'order_marked_paid_by_1c',
  'order_status_changed_by_manager',
  'chat_message',
] as const;

describe('notificationHref', () => {
  describe('запасной путь meta.url (клиентские роли — приоритетный)', () => {
    it('возвращает относительный url из meta для типа вне таблицы', () => {
      expect(notificationHref('partner', 'lead_status_changed', { url: '/partner/leads/l1' })).toBe(
        '/partner/leads/l1'
      );
      expect(
        notificationHref('organization', 'payment_received', { url: '/organization/orders/o1' })
      ).toBe('/organization/orders/o1');
    });

    it('у заказчика и партнёра meta.url приоритетнее таблицы', () => {
      expect(
        notificationHref('organization', 'requisites_requested', {
          url: '/organization/settings?tab=requisites',
        })
      ).toBe('/organization/settings?tab=requisites');
      expect(
        notificationHref('partner', 'document_published', {
          url: '/partner/portfolio',
          orderId: 'o1',
        })
      ).toBe('/partner/portfolio');
    });

    it('отвергает не-строковый url (число, объект, null) → таблица, а её нет → null', () => {
      expect(notificationHref('partner', 'x', { url: 42 })).toBeNull();
      expect(notificationHref('partner', 'x', { url: { nested: true } })).toBeNull();
      expect(notificationHref('partner', 'x', { url: null })).toBeNull();
    });

    it('принимает абсолютный http(s)-url продьюсеров: навигация по pathname+search+hash', () => {
      expect(
        notificationHref('partner', 'lead_status_changed', {
          url: 'https://lk.otsfera.ru/partner/leads/l1?x=1',
        })
      ).toBe('/partner/leads/l1?x=1');
      expect(
        notificationHref('organization', 'payment_received', {
          url: 'http://localhost:3000/organization/orders/o1',
        })
      ).toBe('/organization/orders/o1');
      expect(
        notificationHref('partner', 'document_published', {
          url: 'https://lk.otsfera.ru/partner/documents?tab=general#top',
        })
      ).toBe('/partner/documents?tab=general#top');
    });

    it('чужой хост не даёт внешнего редиректа: берётся только локальный путь', () => {
      expect(
        notificationHref('partner', 'x', { url: 'https://evil.example/partner/leads/l1' })
      ).toBe('/partner/leads/l1');
    });

    it('отвергает не-http(s) протоколы, невалидные URL и //host', () => {
      expect(notificationHref('partner', 'x', { url: 'javascript:alert(1)' })).toBeNull();
      expect(notificationHref('partner', 'x', { url: 'ftp://host/file' })).toBeNull();
      expect(notificationHref('partner', 'x', { url: 'http://' })).toBeNull();
      expect(notificationHref('partner', 'x', { url: 'совсем не урл' })).toBeNull();
      expect(notificationHref('partner', 'x', { url: '//evil.example/phish' })).toBeNull();
    });

    it('meta null/undefined/не-объект и тип вне таблицы → null', () => {
      expect(notificationHref('partner', 'x', null)).toBeNull();
      expect(notificationHref('partner', 'x', undefined)).toBeNull();
      expect(notificationHref('partner', 'x', 'just-a-string')).toBeNull();
    });

    it('клиент без url — таблица по идентификатору', () => {
      expect(notificationHref('organization', 'payment_received', { orderId: 'o1' })).toBe(
        '/organization/orders/o1'
      );
      expect(notificationHref('partner', 'commission_statement_ready', { statementId: 's1' })).toBe(
        '/partner/finance'
      );
      expect(notificationHref('organization', 'certificate_expiring', {})).toBe(
        '/organization/certificates'
      );
    });
  });

  describe('сотрудники: таблица важнее meta.url', () => {
    it.each(MANAGER_ORDER_TYPES)('%s + meta.orderId → /manager/orders/:id', (type) => {
      expect(notificationHref('manager', type, { orderId: 'ord-1' })).toBe('/manager/orders/ord-1');
    });

    it('руководитель — /leader/orders/:id (У-232), даже если в строке лежит старый /manager/…', () => {
      expect(notificationHref('leader', 'chat_message', { orderId: 'ord-1' })).toBe(
        '/leader/orders/ord-1'
      );
      expect(
        notificationHref('leader', 'comment_from_org', {
          orderId: 'ord-1',
          url: 'https://lk.otsfera.ru/manager/orders/ord-1',
        })
      ).toBe('/leader/orders/ord-1');
    });

    it('старый url менеджера в строке не перебивает таблицу', () => {
      expect(
        notificationHref('manager', 'chat_message', { url: '/manager/documents', orderId: 'o1' })
      ).toBe('/manager/orders/o1');
    });

    it('без orderId → список заказов, а не пустая строка', () => {
      expect(notificationHref('manager', 'chat_message', {})).toBe('/manager/orders');
      expect(notificationHref('manager', 'chat_message', null)).toBe('/manager/orders');
      expect(notificationHref('manager', 'chat_message', { orderId: 42 })).toBe('/manager/orders');
      expect(notificationHref('manager', 'chat_message', { orderId: '' })).toBe('/manager/orders');
    });

    it('документ без заказа → общие документы', () => {
      expect(notificationHref('manager', 'document_uploaded_by_org', { orderId: null })).toBe(
        '/manager/documents?tab=general'
      );
    });

    it('адрес, которого у роли нет, и url в строке отсутствует → null', () => {
      expect(notificationHref('admin', 'task_assigned', { taskId: 't1' })).toBeNull();
      expect(notificationHref('manager', 'certificate_expiring', { orderId: 'ord-1' })).toBeNull();
    });

    it('когда таблица молчит, сотрудник получает url из строки', () => {
      expect(
        notificationHref('admin', 'task_assigned', { taskId: 't1', url: '/admin/audit' })
      ).toBe('/admin/audit');
    });

    it('admin + ops_alert → здоровье системы (meta у алертов отсутствует)', () => {
      expect(notificationHref('admin', 'ops_alert', undefined)).toBe(
        '/admin/settings/system/health'
      );
      expect(notificationHref('admin', 'ops_alert', null)).toBe('/admin/settings/system/health');
      expect(notificationHref('manager', 'ops_alert', {})).toBeNull();
    });

    it('sync_error: документ — в карточку своего кабинета, иначе — в обмен', () => {
      expect(
        notificationHref('leader', 'sync_error', { kind: 'push_document_failed', documentId: 'd1' })
      ).toBe('/leader/documents/d1');
      expect(notificationHref('admin', 'sync_error', {})).toBe(
        '/admin/settings/integrations/1c/auto'
      );
      expect(notificationHref('manager', 'sync_error', {})).toBeNull();
    });
  });
});
