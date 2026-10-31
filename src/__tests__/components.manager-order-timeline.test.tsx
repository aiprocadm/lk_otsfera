import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import type { AuditLog } from '@prisma/client';
import { ManagerOrderTimeline } from '@/components/manager/manager-order-timeline';
import type { ManagerOrderDetail } from '@/lib/services/manager/orders';

function makeOrder(overrides: Partial<ManagerOrderDetail>): ManagerOrderDetail {
  return {
    createdAt: new Date('2026-01-01'),
    contractSignedAt: null,
    deadline: null,
    completedAt: null,
    paidAt: null,
    closedAt: null,
    lastSyncedAt: null,
    ...overrides,
  } as ManagerOrderDetail;
}

function makeAudit(overrides: Partial<AuditLog>): AuditLog {
  return {
    id: 'a1',
    action: 'order_status_changed',
    createdAt: new Date('2026-02-01T10:00:00Z'),
    meta: {},
    ...overrides,
  } as AuditLog;
}

describe('ManagerOrderTimeline', () => {
  it('`У-353`: блока «Даты» с вехами больше нет — даты переходов в «Истории статусов»', () => {
    const order = makeOrder({
      contractSignedAt: new Date('2026-01-05'),
      deadline: new Date('2026-02-01'),
      completedAt: new Date('2026-02-10'),
    });
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, {
        order,
        auditEntries: [makeAudit({ action: 'document_uploaded' })],
      })
    );
    expect(html).toContain('Журнал изменений');
    for (const gone of ['Даты', 'Договор подписан', 'Дедлайн', 'Завершён', 'Оплачен']) {
      expect(html).not.toContain(gone);
    }
  });

  it('no visible audit entries: activity section omitted', () => {
    const order = makeOrder({});
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, { order, auditEntries: [] })
    );
    // Нечего показать — блока нет вовсе, а не пустая рамка с заголовком.
    expect(html).toBe('');
  });

  it('filters out partner-economics audit actions (HIDDEN_ACTIONS)', () => {
    const order = makeOrder({});
    const entries = [
      makeAudit({ id: 'h1', action: 'partner_commission_rate_changed' }),
      makeAudit({ id: 'h2', action: 'partner_commission_paid' }),
      makeAudit({ id: 'h3', action: 'partner_commission_recalculated' }),
      makeAudit({ id: 'h4', action: 'partner_rate_changed' }),
    ];
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, { order, auditEntries: entries })
    );
    // Скрытые строки не считаются — показать нечего, блока нет.
    expect(html).toBe('');
  });

  it('shows a known action label (order_status_changed) with a before→after transition and actor', () => {
    const order = makeOrder({});
    const entries = [
      makeAudit({
        action: 'order_status_changed',
        meta: {
          before: { executionStatus: 'pending' },
          after: { executionStatus: 'in_progress', actor: 'manager' },
        },
      }),
    ];
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, { order, auditEntries: entries })
    );
    expect(html).toContain('Статус изменён');
    expect(html).toContain('pending → in_progress');
    expect(html).toContain('актор: manager');
  });

  it('order_status_changed with only "after" (no before): shows just the after value', () => {
    const order = makeOrder({});
    const entries = [
      makeAudit({
        action: 'order_status_changed',
        meta: { after: { executionStatus: 'completed' } },
      }),
    ];
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, { order, auditEntries: entries })
    );
    expect(html).toContain('completed');
  });

  it('order_status_changed with meta null: falls back to {} without throwing', () => {
    const order = makeOrder({});
    const entries = [makeAudit({ action: 'order_status_changed', meta: null })];
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, { order, auditEntries: entries })
    );
    expect(html).toContain('Статус изменён');
  });

  it('order_status_changed with neither before nor after and no actor: no detail line', () => {
    const order = makeOrder({});
    const entries = [makeAudit({ action: 'order_status_changed', meta: {} })];
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, { order, auditEntries: entries })
    );
    expect(html).toContain('Статус изменён');
  });

  it('unknown action falls back to the raw action string as the label', () => {
    const order = makeOrder({});
    const entries = [makeAudit({ action: 'custom_weird_action', meta: {} })];
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, { order, auditEntries: entries })
    );
    expect(html).toContain('custom_weird_action');
  });

  it('known non-status action (document_uploaded): no detail line rendered', () => {
    const order = makeOrder({});
    const entries = [makeAudit({ action: 'document_uploaded', meta: {} })];
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, { order, auditEntries: entries })
    );
    expect(html).toContain('Документ загружен');
  });

  it('renders comment_posted label', () => {
    const order = makeOrder({});
    const entries = [makeAudit({ action: 'comment_posted', meta: {} })];
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, { order, auditEntries: entries })
    );
    expect(html).toContain('Комментарий');
  });

  it('renders the 1C sync footer when lastSyncedAt is set', () => {
    const order = makeOrder({ lastSyncedAt: new Date('2026-04-01T12:30:00Z') });
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, { order, auditEntries: [] })
    );
    expect(html).toContain('Обновлено из 1С');
  });

  it('omits the 1C sync footer when lastSyncedAt is null', () => {
    const order = makeOrder({ lastSyncedAt: null });
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, { order, auditEntries: [] })
    );
    expect(html).not.toContain('Обновлено из 1С');
  });
});

describe('ManagerOrderTimeline — смена ответственного (У-283)', () => {
  it('«Ответственный изменён» с именами было → стало', () => {
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, {
        order: makeOrder({}),
        auditEntries: [
          makeAudit({
            action: 'order_manager_changed',
            meta: { before: { managerId: 'u1' }, after: { managerId: 'u2' } },
          }),
        ],
        userNames: { u1: 'Иванов', u2: 'Петрова' },
      })
    );
    expect(html).toContain('Ответственный изменён');
    expect(html).toContain('Иванов → Петрова');
  });

  it('снят ответственный и неизвестный id — «никто» и «сотрудник», а не служебный номер', () => {
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, {
        order: makeOrder({}),
        auditEntries: [
          makeAudit({
            action: 'order_manager_changed',
            meta: { before: { managerId: 'gone' }, after: { managerId: null } },
          }),
        ],
      })
    );
    expect(html).toContain('сотрудник → никто');
    expect(html).not.toContain('gone');
  });

  it('«Взят в работу» с именем взявшего', () => {
    const html = renderToString(
      React.createElement(ManagerOrderTimeline, {
        order: makeOrder({}),
        auditEntries: [
          makeAudit({ action: 'order_self_assigned', meta: { after: { managerId: 'u2' } } }),
        ],
        userNames: { u2: 'Петрова' },
      })
    );
    expect(html).toContain('Взят в работу');
    expect(html).toContain('Петрова');
  });
});
