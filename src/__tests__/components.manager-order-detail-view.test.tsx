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

import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';

const data = {
  order: {
    id: 'o1',
    orderNumber: 'A-1',
    title: 'X',
    executionStatus: 'in_progress',
    documents: [],
    payments: [],
    commentsCountByMe: 0
  },
  auditEntries: [],
  comments: [],
  documentRows: [],
  items: []
} as never;

describe('ManagerOrderDetailView', () => {
  it('BackLink ведёт на переданный backHref', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data,
        backHref: '/leader/orders',
        directions: [],
        students: []
      })
    );
    expect(html).toContain('href="/leader/orders"');
    expect(html).toContain('Все заказы');
  });
});
