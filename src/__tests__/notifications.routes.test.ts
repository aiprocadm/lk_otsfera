import { describe, it, expect } from 'vitest';
import { notificationRoute } from '@/lib/notifications/routes';

/**
 * Таблица маршрутов (`У-232`, `Р-Э5-7`) — ветка за веткой: заметки, правила
 * автоматизации, эскалации SLA, обмен с 1С, документы. Страж
 * `notifications.routes.guardrail` проверяет существование страниц; здесь —
 * что каждая ветка выбирает правильный раздел.
 */

describe('notificationRoute — документы', () => {
  it('сотруднику: заказ → документ → общие документы', () => {
    expect(
      notificationRoute('document_uploaded_by_org', { orderId: 'o1', documentId: 'd1' }, 'manager')
    ).toBe('/manager/orders/o1');
    expect(notificationRoute('document_uploaded_by_partner', { documentId: 'd1' }, 'leader')).toBe(
      '/leader/documents/d1'
    );
    expect(notificationRoute('document_uploaded_by_org', {}, 'admin')).toBe(
      '/admin/documents?tab=general'
    );
  });

  it('клиенту: документ → заказ → общие документы', () => {
    expect(
      notificationRoute('document_published', { orderId: 'o1', documentId: 'd1' }, 'organization')
    ).toBe('/organization/documents/d1');
    expect(notificationRoute('document_published', { orderId: 'o1' }, 'partner')).toBe(
      '/partner/orders/o1'
    );
    expect(notificationRoute('document_published', { orderId: null }, 'partner')).toBe(
      '/partner/documents?tab=general'
    );
  });

  it('документ, принятый заказчиком, и оплаченный счёт — в заказ', () => {
    expect(
      notificationRoute('document_accepted', { orderId: 'o1', documentId: 'd1' }, 'manager')
    ).toBe('/manager/orders/o1');
    expect(notificationRoute('invoice_paid', { orderId: 'o1', documentId: 'd1' }, 'leader')).toBe(
      '/leader/orders/o1'
    );
  });
});

describe('notificationRoute — заметки и правила', () => {
  it('упоминание в заметке: сделка → доска, организация → карточка, диалог, задача, иное → null', () => {
    expect(notificationRoute('note_mention', { entity: 'deal', noteId: 'n1' }, 'manager')).toBe(
      '/manager/deals'
    );
    expect(
      notificationRoute(
        'note_mention',
        { entity: 'organization', organizationId: 'org1' },
        'leader'
      )
    ).toBe('/leader/organizations/org1?tab=notes');
    expect(notificationRoute('note_mention', { entity: 'dialog', dialogId: 'd1' }, 'manager')).toBe(
      '/manager/messengers/d1'
    );
    expect(notificationRoute('note_mention', { entity: 'task', taskId: 't1' }, 'leader')).toBe(
      '/leader/tasks/t1'
    );
    expect(notificationRoute('note_mention', { entity: 'planet' }, 'manager')).toBeNull();
    expect(notificationRoute('note_mention', {}, 'manager')).toBeNull();
  });

  it('уведомление правила: по сущности события; неизвестная сущность → null', () => {
    const cases: Array<[string, string | null]> = [
      ['task', '/manager/tasks/x1'],
      ['order', '/manager/orders/x1'],
      ['dialog', '/manager/messengers/x1'],
      ['lead', '/manager/leads/x1'],
      ['deal', '/manager/deals'],
      ['comet', null],
    ];
    for (const [entity, expected] of cases) {
      expect(notificationRoute('automation_notice', { entity, entityId: 'x1' }, 'manager')).toBe(
        expected
      );
    }
  });

  it('сбой правила: раздел настроек у админа и руководителя, менеджеру некуда', () => {
    expect(notificationRoute('automation_failed', { ruleId: 'r1' }, 'admin')).toBe(
      '/admin/settings/processes/automation'
    );
    expect(notificationRoute('automation_failed', { ruleId: 'r1' }, 'leader')).toBe(
      '/leader/settings/processes/automation'
    );
    expect(notificationRoute('automation_failed', { ruleId: 'r1' }, 'manager')).toBeNull();
  });
});

describe('notificationRoute — эскалации SLA', () => {
  it('источник → раздел; руководитель в разделы менеджера как играющий тренер', () => {
    expect(
      notificationRoute(
        'sla_escalation',
        { sourceType: 'client_request', sourceId: 'r1' },
        'leader'
      )
    ).toBe('/leader/requests/r1');
    expect(
      notificationRoute('sla_escalation', { sourceType: 'enrollment', sourceId: 'e1' }, 'manager')
    ).toBe('/manager/enrollments/e1');
    expect(
      notificationRoute('sla_escalation', { sourceType: 'call', sourceId: 'c1' }, 'leader')
    ).toBe('/manager/calls');
    expect(
      notificationRoute('sla_escalation', { sourceType: 'dialog', sourceId: 'd1' }, 'leader')
    ).toBe('/manager/messengers/d1');
    expect(notificationRoute('sla_escalation', { sourceType: 'inbound' }, 'manager')).toBe(
      '/manager/inbox'
    );
    expect(notificationRoute('sla_escalation', { sourceType: 'meteor' }, 'manager')).toBeNull();
    expect(notificationRoute('sla_escalation', {}, 'manager')).toBeNull();
  });
});

describe('notificationRoute — обмен, мониторинг, диалоги', () => {
  it('sync_error: документ → карточка; заявка партнёра → null; прочее → обмен/интеграции', () => {
    expect(
      notificationRoute('sync_error', { kind: 'push_document_failed', documentId: 'd1' }, 'manager')
    ).toBe('/manager/documents/d1');
    expect(
      notificationRoute('sync_error', { kind: 'push_lead_failed', leadId: 'l1' }, 'partner')
    ).toBeNull();
    expect(notificationRoute('sync_error', { kind: 'other' }, 'admin')).toBe('/admin/sync');
    expect(notificationRoute('sync_error', {}, 'leader')).toBe('/leader/settings/integrations');
    expect(notificationRoute('sync_error', {}, 'manager')).toBeNull();
  });

  it('ответ на входящее: диалог, если он есть, иначе «Входящие»', () => {
    expect(notificationRoute('inbound_reply', { dialogId: 'd1' }, 'manager')).toBe(
      '/manager/messengers/d1'
    );
    expect(notificationRoute('inbound_reply', { messageId: 'm1' }, 'leader')).toBe(
      '/manager/inbox'
    );
    expect(notificationRoute('inbound_reply', { dialogId: 'd1' }, 'admin')).toBeNull();
  });

  it('ответ менеджера клиенту ведёт во вкладку «Переписка с менеджером» (У-234)', () => {
    expect(notificationRoute('inbound_reply', { dialogId: 'd1' }, 'organization')).toBe(
      '/organization/messages?tab=manager&dialog=d1'
    );
    expect(notificationRoute('inbound_reply', { dialogId: 'd1' }, 'partner')).toBe(
      '/partner/messages?tab=manager&dialog=d1'
    );
    // Диалог неизвестен (ответ из «Входящих») — просто вкладка переписки.
    expect(notificationRoute('inbound_reply', { messageId: 'm1' }, 'organization')).toBe(
      '/organization/messages?tab=manager'
    );
  });

  it('отчёт по комиссии: партнёру — финансы, админу — карточка отчёта', () => {
    expect(notificationRoute('commission_statement_ready', { statementId: 's1' }, 'partner')).toBe(
      '/partner/finance'
    );
    expect(notificationRoute('commission_statement_ready', { statementId: 's1' }, 'admin')).toBe(
      '/admin/commission-statements/s1'
    );
  });

  it('реквизиты, удостоверения, календарь, служебный чат, здоровье', () => {
    expect(notificationRoute('requisites_requested', {}, 'organization')).toBe(
      '/organization/settings'
    );
    expect(notificationRoute('requisites_requested', {}, 'admin')).toBeNull();
    expect(notificationRoute('certificate_expiring', {}, 'partner')).toBe('/partner/certificates');
    expect(notificationRoute('calendar_event_reminder', {}, 'leader')).toBe('/leader/calendar');
    expect(notificationRoute('staff_dm_message', { conversationId: 'c1' }, 'admin')).toBe(
      '/admin/messages'
    );
    expect(notificationRoute('ops_alert', null, 'admin')).toBe('/admin/settings/system/health');
    expect(notificationRoute('ops_alert', null, 'manager')).toBeNull();
  });

  it('meta не объект — как пустая', () => {
    expect(notificationRoute('task_assigned', 'строка', 'manager')).toBe('/manager/tasks');
    expect(notificationRoute('task_assigned', 42, 'manager')).toBe('/manager/tasks');
  });
});

describe('notificationRoute — уточнения по замечаниям сверки', () => {
  it('эскалация по диалогу: составной sourceId «<dialogId>:<начало>» режется до id диалога', () => {
    expect(
      notificationRoute(
        'sla_escalation',
        { sourceType: 'dialog', sourceId: 'd1:2026-09-14T03:00:00.000Z' },
        'manager'
      )
    ).toBe('/manager/messengers/d1');
    expect(
      notificationRoute('sla_escalation', { sourceType: 'dialog', sourceId: ':' }, 'manager')
    ).toBe('/manager/messengers');
  });

  it('правило: документ, заявка и платёж тоже ведут в свои разделы', () => {
    expect(
      notificationRoute('automation_notice', { entity: 'document', entityId: 'd1' }, 'leader')
    ).toBe('/leader/documents/d1');
    expect(
      notificationRoute('automation_notice', { entity: 'client_request', entityId: 'r1' }, 'admin')
    ).toBe('/admin/requests/r1');
    expect(notificationRoute('automation_notice', { entity: 'payment' }, 'manager')).toBe(
      '/manager/finance'
    );
  });

  it('заметка о сделке ведёт в заказ, если он есть; об организации — на вкладку заметок', () => {
    expect(
      notificationRoute('note_mention', { entity: 'deal', orderId: 'o1', noteId: 'n1' }, 'leader')
    ).toBe('/leader/orders/o1');
    expect(
      notificationRoute(
        'note_mention',
        { entity: 'organization', organizationId: 'org1' },
        'manager'
      )
    ).toBe('/manager/organizations/org1?tab=notes');
    expect(notificationRoute('note_mention', { entity: 'organization' }, 'manager')).toBe(
      '/manager/organizations'
    );
  });
});
