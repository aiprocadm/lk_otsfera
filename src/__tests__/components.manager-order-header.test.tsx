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

// Этап 5 ТЗ 28.10.2026 (`У-353`): шкала — статусы справочника, приходят готовыми.
const STEPS = {
  steps: [
    { id: 's1', label: 'Принято в работу', state: 'done' as const },
    { id: 's2', label: 'Оплата поступила', state: 'current' as const },
    { id: 's3', label: 'Заказ закрыт', state: 'upcoming' as const },
  ],
  terminalLabel: null,
  offPipelineLabel: null,
};

describe('ManagerOrderHeader', () => {
  it('renders order number, title, org name, manager name', () => {
    const order = makeOrder({});
    const html = renderToString(React.createElement(ManagerOrderHeader, { order, steps: null }));
    expect(html).toContain('№ <!-- -->A-100');
    expect(html).toContain('Заказ на обучение');
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('Иван Менеджеров');
  });

  it('omits orderNumber span when null', () => {
    const order = makeOrder({ orderNumber: null });
    const html = renderToString(React.createElement(ManagerOrderHeader, { order, steps: null }));
    expect(html).not.toContain('№ ');
  });

  it('omits org name block when organization is null', () => {
    const order = makeOrder({
      organization: null as unknown as ManagerOrderDetail['organization'],
    });
    const html = renderToString(React.createElement(ManagerOrderHeader, { order, steps: null }));
    expect(html).not.toContain('ООО Ромашка');
  });

  it('omits manager block when manager is null', () => {
    const order = makeOrder({ manager: null });
    const html = renderToString(React.createElement(ManagerOrderHeader, { order, steps: null }));
    expect(html).not.toContain('Иван Менеджеров');
  });

  it('renders productMix tags when present', () => {
    const order = makeOrder({ productMix: ['Курс А', 'Курс Б'] });
    const html = renderToString(React.createElement(ManagerOrderHeader, { order, steps: null }));
    expect(html).toContain('Курс А');
    expect(html).toContain('Курс Б');
  });

  it('omits productMix block when empty', () => {
    const order = makeOrder({ productMix: [] });
    const html = renderToString(React.createElement(ManagerOrderHeader, { order, steps: null }));
    expect(html).not.toContain('bg-gray-100 text-gray-600 rounded');
  });
  it('`У-353`: шкала — статусы справочника, текущий подсвечен; без шагов шкалы нет', () => {
    const html = renderToString(
      React.createElement(ManagerOrderHeader, { order: makeOrder({}), steps: STEPS })
    );
    expect(html).toContain('Принято в работу');
    expect(html).toContain('Заказ закрыт');
    expect(html).toMatch(/aria-current="step"[^>]*>2</);
    expect(html).not.toContain('Новая');
    const none = renderToString(
      React.createElement(ManagerOrderHeader, { order: makeOrder({}), steps: null })
    );
    expect(none).not.toContain('aria-label="Этапы заказа"');
  });

  it('`У-353`: отменённый заказ — пометка над шкалой', () => {
    const html = renderToString(
      React.createElement(ManagerOrderHeader, {
        order: makeOrder({}),
        steps: { ...STEPS, terminalLabel: 'Отменена' },
      })
    );
    expect(html).toContain('Отменена');
    expect(html).toContain('aria-label="Этапы заказа"');
  });
});
