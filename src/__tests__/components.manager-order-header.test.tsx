import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { ManagerOrderHeader } from '@/components/manager/manager-order-header';
import type { ManagerOrderDetail } from '@/lib/services/manager/orders';

function makeOrder(overrides: Partial<ManagerOrderDetail>): ManagerOrderDetail {
  return {
    orderNumber: 'A-100',
    title: 'Заказ на обучение',
    executionStatus: 'in_progress',
    financialStatus: 'partially_paid',
    totalAmount: '1000' as unknown as ManagerOrderDetail['totalAmount'],
    paidAmount: '500' as unknown as ManagerOrderDetail['paidAmount'],
    contractSignedAt: null,
    completedAt: null,
    closedAt: null,
    manager: { name: 'Иван Менеджеров' },
    organization: { name: 'ООО Ромашка' },
    productMix: [],
    ...overrides,
  } as ManagerOrderDetail;
}

describe('ManagerOrderHeader', () => {
  it('renders order number, title, org name, manager name', () => {
    const order = makeOrder({});
    const html = renderToString(React.createElement(ManagerOrderHeader, { order }));
    expect(html).toContain('№ <!-- -->A-100');
    expect(html).toContain('Заказ на обучение');
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('Иван Менеджеров');
  });

  it('omits orderNumber span when null', () => {
    const order = makeOrder({ orderNumber: null });
    const html = renderToString(React.createElement(ManagerOrderHeader, { order }));
    expect(html).not.toContain('№ ');
  });

  it('omits org name block when organization is null', () => {
    const order = makeOrder({
      organization: null as unknown as ManagerOrderDetail['organization'],
    });
    const html = renderToString(React.createElement(ManagerOrderHeader, { order }));
    expect(html).not.toContain('ООО Ромашка');
  });

  it('omits manager block when manager is null', () => {
    const order = makeOrder({ manager: null });
    const html = renderToString(React.createElement(ManagerOrderHeader, { order }));
    expect(html).not.toContain('Иван Менеджеров');
  });

  it('renders productMix tags when present', () => {
    const order = makeOrder({ productMix: ['Курс А', 'Курс Б'] });
    const html = renderToString(React.createElement(ManagerOrderHeader, { order }));
    expect(html).toContain('Курс А');
    expect(html).toContain('Курс Б');
  });

  it('omits productMix block when empty', () => {
    const order = makeOrder({ productMix: [] });
    const html = renderToString(React.createElement(ManagerOrderHeader, { order }));
    expect(html).not.toContain('bg-gray-100 text-gray-600 rounded');
  });
});
