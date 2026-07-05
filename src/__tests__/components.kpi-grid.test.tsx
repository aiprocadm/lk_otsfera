import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children)
}));

import { KpiGrid, type DashboardKpis } from '@/components/partner/kpi-grid';

describe('KpiGrid', () => {
  it('renders all four stat cards with formatted money and counts', () => {
    const kpis: DashboardKpis = {
      openOrders: 7,
      outstanding: '15000.00',
      activeLeads: 3,
      commissionThisMonth: '2500.00'
    };
    const html = renderToString(React.createElement(KpiGrid, { kpis }));
    expect(html).toContain('Открытые заказы');
    expect(html).toContain('7');
    expect(html).toContain('К оплате');
    expect(html).toContain('Заявки в работе');
    expect(html).toContain('3');
    expect(html).toContain('Комиссия за месяц');
    // The accent card (commission) uses the brand background.
    expect(html).toContain('bg-[#F97316] border-[#EA580C]');
    expect(html).toContain('href="/partner/deals"');
    expect(html).toContain('href="/partner/finance"');
    expect(html).toContain('href="/partner/leads"');
  });
});
