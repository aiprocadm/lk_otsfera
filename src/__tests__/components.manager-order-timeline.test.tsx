import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { ManagerOrderTimeline } from '@/components/manager/manager-order-timeline';
import type { ManagerOrderDetail } from '@/lib/services/manager/orders';
import type { AuditLog } from '@prisma/client';

function makeOrder(overrides: Partial<ManagerOrderDetail>): ManagerOrderDetail {
  return {
    createdAt: new Date('2026-01-01'),
    contractSignedAt: null,
    deadline: null,
    completedAt: null,
    paidAt: null,
    closedAt: null,
    lastSyncedAt: null,
    ...overrides
  } as ManagerOrderDetail;
}

function makeAudit(overrides: Partial<AuditLog>): AuditLog {
  return {
    id: 'a1',
    action: 'order_status_changed',
    createdAt: new Date('2026-02-01T10:00:00Z'),
    meta: {},
    ...overrides
  } as AuditLog;
}

describe('ManagerOrderTimeline', () => {
  it('renders all milestone labels', () => {
    const order = makeOrder({});
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: [] }));
    expect(html).toContain('Создан');
    expect(html).toContain('Договор подписан');
    expect(html).toContain('Дедлайн');
    expect(html).toContain('Завершён');
    expect(html).toContain('Оплачен');
    expect(html).toContain('Закрыт');
  });

  it('passed milestone (createdAt set): success/neutral coloring and formatted date', () => {
    const order = makeOrder({ createdAt: new Date('2026-01-15') });
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: [] }));
    expect(html).toContain('15.01.2026');
  });

  it('unpassed milestone (deadline null): renders — placeholder and gray dot', () => {
    const order = makeOrder({ deadline: null });
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: [] }));
    expect(html).toContain('bg-gray-200');
  });

  it('warning-tone milestone (deadline set): orange dot', () => {
    const order = makeOrder({ deadline: new Date('2026-03-01') });
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: [] }));
    expect(html).toContain('bg-orange-400');
  });

  it('success-tone milestone (completedAt set): green dot', () => {
    const order = makeOrder({ completedAt: new Date('2026-03-01') });
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: [] }));
    expect(html).toContain('bg-green-500');
  });

  it('no visible audit entries: activity section omitted', () => {
    const order = makeOrder({});
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: [] }));
    expect(html).not.toContain('Активность');
  });

  it('filters out partner-economics audit actions (HIDDEN_ACTIONS)', () => {
    const order = makeOrder({});
    const entries = [
      makeAudit({ id: 'h1', action: 'partner_commission_rate_changed' }),
      makeAudit({ id: 'h2', action: 'partner_commission_paid' }),
      makeAudit({ id: 'h3', action: 'partner_commission_recalculated' }),
      makeAudit({ id: 'h4', action: 'partner_rate_changed' })
    ];
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: entries }));
    expect(html).not.toContain('Активность');
  });

  it('shows a known action label (order_status_changed) with a before→after transition and actor', () => {
    const order = makeOrder({});
    const entries = [
      makeAudit({
        action: 'order_status_changed',
        meta: { before: { executionStatus: 'pending' }, after: { executionStatus: 'in_progress', actor: 'manager' } }
      })
    ];
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: entries }));
    expect(html).toContain('Статус изменён');
    expect(html).toContain('pending → in_progress');
    expect(html).toContain('актор: manager');
  });

  it('order_status_changed with only "after" (no before): shows just the after value', () => {
    const order = makeOrder({});
    const entries = [
      makeAudit({
        action: 'order_status_changed',
        meta: { after: { executionStatus: 'completed' } }
      })
    ];
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: entries }));
    expect(html).toContain('completed');
  });

  it('order_status_changed with meta null: falls back to {} without throwing', () => {
    const order = makeOrder({});
    const entries = [makeAudit({ action: 'order_status_changed', meta: null })];
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: entries }));
    expect(html).toContain('Статус изменён');
  });

  it('order_status_changed with neither before nor after and no actor: no detail line', () => {
    const order = makeOrder({});
    const entries = [makeAudit({ action: 'order_status_changed', meta: {} })];
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: entries }));
    expect(html).toContain('Статус изменён');
  });

  it('unknown action falls back to the raw action string as the label', () => {
    const order = makeOrder({});
    const entries = [makeAudit({ action: 'custom_weird_action', meta: {} })];
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: entries }));
    expect(html).toContain('custom_weird_action');
  });

  it('known non-status action (document_uploaded): no detail line rendered', () => {
    const order = makeOrder({});
    const entries = [makeAudit({ action: 'document_uploaded', meta: {} })];
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: entries }));
    expect(html).toContain('Документ загружен');
  });

  it('renders comment_posted label', () => {
    const order = makeOrder({});
    const entries = [makeAudit({ action: 'comment_posted', meta: {} })];
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: entries }));
    expect(html).toContain('Комментарий');
  });

  it('renders the 1C sync footer when lastSyncedAt is set', () => {
    const order = makeOrder({ lastSyncedAt: new Date('2026-04-01T12:30:00Z') });
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: [] }));
    expect(html).toContain('Обновлено из 1С');
  });

  it('omits the 1C sync footer when lastSyncedAt is null', () => {
    const order = makeOrder({ lastSyncedAt: null });
    const html = renderToString(React.createElement(ManagerOrderTimeline, { order, auditEntries: [] }));
    expect(html).not.toContain('Обновлено из 1С');
  });
});
