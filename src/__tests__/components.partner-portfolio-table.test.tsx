import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { PortfolioTable } from '@/components/partner/portfolio-table';
import type { PortfolioItem } from '@/lib/services/partner/portfolio';

function makeItem(overrides: Partial<PortfolioItem> = {}): PortfolioItem {
  return {
    id: 'o1',
    name: 'ООО Ромашка',
    inn: '7707083893',
    assignedManagerUserId: null,
    ordersCount: 3,
    debt: '0.00',
    ...overrides,
  };
}

describe('PortfolioTable', () => {
  it('renders the empty state when there are no items', () => {
    const html = renderToString(React.createElement(PortfolioTable, { items: [] }));
    expect(html).toContain('Нет организаций по выбранным фильтрам');
  });

  it('renders a row with name, INN, orders count and neutral debt styling', () => {
    const html = renderToString(React.createElement(PortfolioTable, { items: [makeItem()] }));
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('7707083893');
    expect(html).toContain('href="/partner/portfolio/o1"');
    expect(html).toContain('text-gray-500');
  });

  it('shows em-dash for a null INN', () => {
    const html = renderToString(
      React.createElement(PortfolioTable, { items: [makeItem({ inn: null })] })
    );
    expect(html).toContain('—');
  });

  it('shows red accent styling when debt > 0', () => {
    const html = renderToString(
      React.createElement(PortfolioTable, { items: [makeItem({ debt: '9000.00' })] })
    );
    expect(html).toContain('text-red-700');
  });

  it('renders multiple rows', () => {
    const html = renderToString(
      React.createElement(PortfolioTable, {
        items: [makeItem({ id: 'o1' }), makeItem({ id: 'o2', name: 'Вторая' })],
      })
    );
    expect(html).toContain('href="/partner/portfolio/o1"');
    expect(html).toContain('href="/partner/portfolio/o2"');
    expect(html).toContain('Вторая');
  });
});
