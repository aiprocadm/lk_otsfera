import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { PartnerOrderHeader } from '@/components/partner/order-header';
import type { PartnerOrderDetail } from '@/lib/services/partner/orderDetail';

function makeDeal(overrides: Partial<PartnerOrderDetail> = {}): PartnerOrderDetail {
  return {
    id: 'd1',
    orderNumber: '№1',
    title: 'Заказ на обучение',
    stage: { label: 'Новый', tone: 'neutral' },
    executionStatus: 'pending',
    financialStatus: 'not_billed',
    totalAmount: '1000.00',
    paidAmount: '0.00',
    debt: '1000.00',
    vatIncluded: false,
    vatRate: null,
    productMix: [],
    createdAt: new Date('2026-01-01'),
    deadline: null,
    contractSignedAt: null,
    completedAt: null,
    closedAt: null,
    paidAt: null,
    lastSyncedAt: null,
    organization: null,
    managerName: null,
    documents: [],
    comments: [],
    items: [],
    ...overrides,
  };
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

describe('PartnerOrderHeader', () => {
  it('renders order number, title and status badge; omits organization/manager blocks when absent', () => {
    const html = renderToString(
      React.createElement(PartnerOrderHeader, { deal: makeDeal(), steps: null })
    );
    expect(html).toContain('№ <!-- -->№1');
    expect(html).toContain('Заказ на обучение');
    expect(html).not.toContain('Менеджер');
  });

  it('omits order number span when orderNumber is null', () => {
    const html = renderToString(
      React.createElement(PartnerOrderHeader, {
        deal: makeDeal({ orderNumber: null }),
        steps: null,
      })
    );
    expect(html).not.toContain('№ ');
  });

  it('renders organization link with INN when organization is present', () => {
    const deal = makeDeal({ organization: { id: 'o1', name: 'ООО Ромашка', inn: '7701234567' } });
    const html = renderToString(React.createElement(PartnerOrderHeader, { deal, steps: null }));
    expect(html).toContain('href="/partner/portfolio/o1"');
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('ИНН <!-- -->7701234567');
  });

  it('omits INN span when organization has no inn', () => {
    const deal = makeDeal({ organization: { id: 'o1', name: 'ООО Ромашка', inn: null } });
    const html = renderToString(React.createElement(PartnerOrderHeader, { deal, steps: null }));
    expect(html).not.toContain('ИНН');
  });

  it('renders manager block when managerName is present', () => {
    const deal = makeDeal({ managerName: 'Иван Петров' });
    const html = renderToString(React.createElement(PartnerOrderHeader, { deal, steps: null }));
    expect(html).toContain('Менеджер');
    expect(html).toContain('Иван Петров');
  });

  it('renders productMix chips when non-empty', () => {
    const deal = makeDeal({ productMix: ['training', 'certification'] });
    const html = renderToString(React.createElement(PartnerOrderHeader, { deal, steps: null }));
    // orderTypeRu labels are rendered — assert the chip wrapper markup is present.
    expect((html.match(/bg-gray-100 text-gray-600 rounded/g) ?? []).length).toBe(2);
  });

  it('omits productMix wrapper when empty', () => {
    const html = renderToString(
      React.createElement(PartnerOrderHeader, { deal: makeDeal({ productMix: [] }), steps: null })
    );
    expect(html).not.toContain('flex-wrap gap-1.5');
  });
  it('`У-353`: шкала — статусы справочника, текущий подсвечен; без шагов шкалы нет', () => {
    const html = renderToString(
      React.createElement(PartnerOrderHeader, { deal: makeDeal(), steps: STEPS })
    );
    expect(html).toContain('Принято в работу');
    expect(html).toContain('Заказ закрыт');
    expect(html).toMatch(/aria-current="step"[^>]*>2</);
    expect(html).not.toContain('Новая');
    const none = renderToString(
      React.createElement(PartnerOrderHeader, { deal: makeDeal(), steps: null })
    );
    expect(none).not.toContain('aria-label="Этапы заказа"');
  });

  it('`У-353`: отменённый заказ — пометка над шкалой', () => {
    const html = renderToString(
      React.createElement(PartnerOrderHeader, {
        deal: makeDeal(),
        steps: { ...STEPS, terminalLabel: 'Отменена' },
      })
    );
    expect(html).toContain('Отменена');
    expect(html).toContain('aria-label="Этапы заказа"');
  });
});
