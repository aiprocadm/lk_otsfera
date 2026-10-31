import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrgOrderHeader } from '@/components/organization/org-order-header';
import type { OrgOrderDetail } from '@/lib/services/organization/orders';

function baseOrder(overrides: Partial<OrgOrderDetail> = {}): OrgOrderDetail {
  return {
    id: 'o1',
    organizationId: 'org1',
    orderNumber: '100',
    title: 'Заказ 1',
    stage: { label: 'В работе', tone: 'neutral' },
    executionStatus: 'in_progress',
    financialStatus: 'billed',
    totalAmount: '1000.00',
    paidAmount: '0.00',
    debt: '1000.00',
    vatIncluded: true,
    vatRate: '0.2',
    productMix: [],
    createdAt: new Date('2026-01-01'),
    deadline: null,
    contractSignedAt: null,
    completedAt: null,
    closedAt: null,
    paidAt: null,
    lastSyncedAt: null,
    managerName: null,
    payments: [],
    commentsCount: 0,
    items: [],
    ...overrides,
  } as OrgOrderDetail;
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

describe('OrgOrderHeader', () => {
  it('renders order number, title, and manager block when both present', () => {
    const order = baseOrder({ orderNumber: '77', managerName: 'Иванов И.И.' });
    const html = renderToString(React.createElement(OrgOrderHeader, { order, steps: null }));
    expect(html).toContain('font-mono">№');
    expect(html).toContain('77');
    expect(html).toContain('Заказ 1');
    expect(html).toContain('Иванов И.И.');
    expect(html).toContain('Менеджер');
  });

  it('omits order number and manager block when absent', () => {
    const order = baseOrder({ orderNumber: null, managerName: null });
    const html = renderToString(React.createElement(OrgOrderHeader, { order, steps: null }));
    expect(html).not.toContain('№ ');
    expect(html).not.toContain('Менеджер');
  });

  it('renders product mix tags when present', () => {
    const order = baseOrder({ productMix: ['Курс А', 'Курс Б'] });
    const html = renderToString(React.createElement(OrgOrderHeader, { order, steps: null }));
    expect(html).toContain('Курс А');
    expect(html).toContain('Курс Б');
  });

  it('omits product mix block when empty', () => {
    const order = baseOrder({ productMix: [] });
    const html = renderToString(React.createElement(OrgOrderHeader, { order, steps: null }));
    expect(html).not.toContain('Курс А');
  });

  it('`У-353`: шкала — статусы справочника, текущий подсвечен; без шагов шкалы нет', () => {
    const html = renderToString(
      React.createElement(OrgOrderHeader, { order: baseOrder({}), steps: STEPS })
    );
    expect(html).toContain('Принято в работу');
    expect(html).toContain('Заказ закрыт');
    expect(html).toMatch(/aria-current="step"[^>]*>2</);
    expect(html).not.toContain('Новая');
    const none = renderToString(
      React.createElement(OrgOrderHeader, { order: baseOrder({}), steps: null })
    );
    expect(none).not.toContain('aria-label="Этапы заказа"');
  });

  it('`У-353`: отменённый заказ — пометка над шкалой', () => {
    const html = renderToString(
      React.createElement(OrgOrderHeader, {
        order: baseOrder({}),
        steps: { ...STEPS, terminalLabel: 'Отменена' },
      })
    );
    expect(html).toContain('Отменена');
    expect(html).toContain('aria-label="Этапы заказа"');
  });
});
