import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('a', { className }, children)
}));

import { OrgFinanceKpisGrid } from '@/components/organization/org-finance-kpis';
import type { OrgFinanceKpis } from '@/lib/services/organization/finance';

describe('OrgFinanceKpisGrid', () => {
  it('renders billed, paid, and outstanding as formatted money', () => {
    const kpis: OrgFinanceKpis = { billed: '10000.00', paid: '4000.00', outstanding: '6000.00' };
    const html = renderToString(React.createElement(OrgFinanceKpisGrid, { kpis }));
    expect(html).toContain('Выставлено');
    expect(html).toContain('Оплачено');
    expect(html).toContain('Задолженность');
  });
});
