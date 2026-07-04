import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { PortfolioCardList } from '@/components/partner/portfolio-card-list';
import type { PortfolioItem } from '@/lib/services/partner/portfolio';

function makeItem(overrides: Partial<PortfolioItem> = {}): PortfolioItem {
  return {
    id: 'o1',
    name: 'ООО Ромашка',
    inn: '7707083893',
    assignedManagerUserId: null,
    ordersCount: 3,
    debt: '0.00',
    ...overrides
  };
}

describe('PortfolioCardList', () => {
  it('renders null (nothing) when items is empty', () => {
    const html = renderToString(React.createElement(PortfolioCardList, { items: [] }));
    expect(html).toBe('');
  });

  it('renders a card with name, INN, orders count and neutral debt styling', () => {
    const html = renderToString(React.createElement(PortfolioCardList, { items: [makeItem()] }));
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('7707083893');
    expect(html).toContain('сделок');
    expect(html).toContain('text-gray-500');
    expect(html).toContain('href="/partner/portfolio/o1"');
  });

  it('shows fallback text when inn is null', () => {
    const html = renderToString(React.createElement(PortfolioCardList, { items: [makeItem({ inn: null })] }));
    expect(html).toContain('ИНН не указан');
  });

  it('shows red accent styling and formatted debt when debt > 0', () => {
    const html = renderToString(React.createElement(PortfolioCardList, { items: [makeItem({ debt: '25000.00' })] }));
    expect(html).toContain('text-red-700');
    expect(html).toContain('₽');
  });
});
