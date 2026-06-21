import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children)
}));
vi.mock('@/components/partner/deal-status-badge', () => ({
  DealStatusBadge: ({ stage }: { stage: { label: string } }) =>
    React.createElement('span', null, stage.label)
}));
import { ManagerOrdersCardList } from '@/components/manager/manager-orders-card-list';

const row = {
  id: 'o1', orderNumber: 'A-1', title: 'Заказ X',
  totalAmount: '1000', paidAmount: '0',
  executionStatus: 'in_progress', financialStatus: 'not_billed',
  organization: { id: 'g1', name: 'Орг' }, manager: { id: 'm1', name: 'Иван', email: 'i@x' }
} as never;

describe('ManagerOrdersCardList', () => {
  it('пусто → ничего не рендерит', () => {
    const html = renderToString(React.createElement(ManagerOrdersCardList, { rows: [], basePath: '/manager' }));
    expect(html).toBe('');
  });
  it('карточка ведёт на {basePath}/orders/{id} и показывает заголовок/орг', () => {
    const html = renderToString(React.createElement(ManagerOrdersCardList, { rows: [row], basePath: '/leader' }));
    expect(html).toContain('href="/leader/orders/o1"');
    expect(html).toContain('Заказ X');
    expect(html).toContain('Орг');
  });
});
