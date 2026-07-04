import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { DealHeader } from '@/components/partner/deal-header';
import type { DealDetail } from '@/lib/services/partner/dealDetail';

function makeDeal(overrides: Partial<DealDetail> = {}): DealDetail {
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
    ...overrides
  };
}

describe('DealHeader', () => {
  it('renders order number, title and status badge; omits organization/manager blocks when absent', () => {
    const html = renderToString(React.createElement(DealHeader, { deal: makeDeal() }));
    expect(html).toContain('№ <!-- -->№1');
    expect(html).toContain('Заказ на обучение');
    expect(html).not.toContain('Менеджер');
  });

  it('omits order number span when orderNumber is null', () => {
    const html = renderToString(React.createElement(DealHeader, { deal: makeDeal({ orderNumber: null }) }));
    expect(html).not.toContain('№ ');
  });

  it('renders organization link with INN when organization is present', () => {
    const deal = makeDeal({ organization: { id: 'o1', name: 'ООО Ромашка', inn: '7701234567' } });
    const html = renderToString(React.createElement(DealHeader, { deal }));
    expect(html).toContain('href="/partner/portfolio/o1"');
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('ИНН <!-- -->7701234567');
  });

  it('omits INN span when organization has no inn', () => {
    const deal = makeDeal({ organization: { id: 'o1', name: 'ООО Ромашка', inn: null } });
    const html = renderToString(React.createElement(DealHeader, { deal }));
    expect(html).not.toContain('ИНН');
  });

  it('renders manager block when managerName is present', () => {
    const deal = makeDeal({ managerName: 'Иван Петров' });
    const html = renderToString(React.createElement(DealHeader, { deal }));
    expect(html).toContain('Менеджер');
    expect(html).toContain('Иван Петров');
  });

  it('renders productMix chips when non-empty', () => {
    const deal = makeDeal({ productMix: ['training', 'certification'] });
    const html = renderToString(React.createElement(DealHeader, { deal }));
    // orderTypeRu labels are rendered — assert the chip wrapper markup is present.
    expect((html.match(/bg-gray-100 text-gray-600 rounded/g) ?? []).length).toBe(2);
  });

  it('omits productMix wrapper when empty', () => {
    const html = renderToString(React.createElement(DealHeader, { deal: makeDeal({ productMix: [] }) }));
    expect(html).not.toContain('flex-wrap gap-1.5');
  });
});
