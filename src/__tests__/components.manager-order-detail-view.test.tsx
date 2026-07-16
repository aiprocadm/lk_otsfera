import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }));
vi.mock('@/components/manager/manager-order-header', () => ({ ManagerOrderHeader: () => null }));
vi.mock('@/components/manager/manager-order-amounts', () => ({ ManagerOrderAmounts: () => null }));
vi.mock('@/components/manager/manager-order-timeline', () => ({ ManagerOrderTimeline: () => null }));
vi.mock('@/components/manager/manager-status-change-form', () => ({ ManagerStatusChangeForm: () => null }));
vi.mock('@/components/manager/manager-payments-list', () => ({ ManagerPaymentsList: () => null }));
vi.mock('@/components/partner/documents-list', () => ({ DocumentsList: () => null }));
vi.mock('@/components/training/order-items-section', () => ({ OrderItemsSection: () => null }));
vi.mock('@/components/orders/order-custom-fields', () => ({ OrderCustomFields: () => null }));
vi.mock('@/components/manager/claim-order-button', () => ({
  ClaimOrderButton: (props: { orderId: string; managerId: string | null }) =>
    React.createElement(
      'div',
      { 'data-testid': 'claim-order-button' },
      props.orderId,
      String(props.managerId)
    )
}));
vi.mock('@/components/manager/deal-activity/deal-activity-thread', () => ({
  DealActivityThread: (props: {
    orderId: string;
    items: unknown[];
    inboundEnabled: boolean;
    telephonyEnabled: boolean;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'deal-activity-thread' },
      props.orderId,
      String(props.items.length),
      String(props.inboundEnabled),
      String(props.telephonyEnabled)
    )
}));

import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';

function makeData(overrides: Record<string, unknown>) {
  return {
    order: {
      id: 'o1',
      orderNumber: 'A-1',
      title: 'X',
      executionStatus: 'in_progress',
      managerId: null,
      documents: [],
      payments: [],
      commentsCountByMe: 0
    },
    auditEntries: [],
    comments: [],
    documentRows: [],
    items: [],
    ...overrides
  } as never;
}

describe('ManagerOrderDetailView', () => {
  it('BackLink ведёт на переданный backHref', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/leader/orders',
        directions: [],
        students: []
      })
    );
    expect(html).toContain('href="/leader/orders"');
    expect(html).toContain('Все заказы');
  });

  it('documentRows count is shown in the "Документы" header when non-empty', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({ documentRows: [{ id: 'd1' }] }),
        backHref: '/manager/orders',
        directions: [],
        students: []
      })
    );
    expect(html).toContain('Документы');
    expect(html).toContain('(<!-- -->1<!-- -->)');
  });

  it('documentRows empty: no count badge in the "Документы" header', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({ documentRows: [] }),
        backHref: '/manager/orders',
        directions: [],
        students: []
      })
    );
    expect(html).not.toContain('Документы<!-- --> <span');
  });

  it('threads customFields down to OrderCustomFields (default [] when omitted)', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [{ id: 's1', name: 'Студент', email: 's@x.com' }]
      })
    );
    expect(html).toContain('Все заказы');
  });

  it('DealActivityThread gets order.id and defaults (activityItems=[], inboundEnabled=false, telephonyEnabled=false) when omitted', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: []
      })
    );
    expect(html).toContain('data-testid="deal-activity-thread"');
    expect(html).toContain('o1<!-- -->0<!-- -->false<!-- -->false');
  });

  it('ClaimOrderButton монтируется с order.id и managerId=null (кнопка сама решает видимость)', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: []
      })
    );
    expect(html).toContain('data-testid="claim-order-button"');
    expect(html).toContain('o1<!-- -->null');
  });

  it('ClaimOrderButton получает ненулевой managerId, когда заказ закреплён', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({
          order: {
            id: 'o1',
            orderNumber: 'A-1',
            title: 'X',
            executionStatus: 'in_progress',
            managerId: 'm1',
            documents: [],
            payments: [],
            commentsCountByMe: 0
          }
        }),
        backHref: '/manager/orders',
        directions: [],
        students: []
      })
    );
    expect(html).toContain('o1<!-- -->m1');
  });

  it('DealActivityThread receives explicit activityItems/inboundEnabled/telephonyEnabled when passed', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
        activityItems: [
          { kind: 'event', id: 'e1', at: new Date('2026-01-01'), label: 'Смена статуса заказа' }
        ],
        inboundEnabled: true,
        telephonyEnabled: true
      })
    );
    expect(html).toContain('o1<!-- -->1<!-- -->true<!-- -->true');
  });
});
