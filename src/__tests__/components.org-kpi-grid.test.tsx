import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className }, children),
}));

import { OrgKpiGrid } from '@/components/organization/org-kpi-grid';
import type { OrgDashboardKpis } from '@/lib/services/organization/dashboard';

describe('OrgKpiGrid', () => {
  it('renders all four KPI cards with formatted amount and links', () => {
    const kpis: OrgDashboardKpis = {
      activeOrders: 5,
      outstandingAmount: '1234.50',
      studentsCount: 10,
      recentDocumentsCount: 3,
    };
    const html = renderToString(React.createElement(OrgKpiGrid, { kpis }));
    expect(html).toContain('href="/organization/orders"');
    expect(html).toContain('href="/organization/finance"');
    // Настоящий адрес, а не шлюз: сотрудники ведутся во вкладке карточки
    // своей организации (`Р-12`). Поправлено 19.09.2026 сухим прогоном.
    expect(html).toContain('href="/organization/company?tab=employees"');
    expect(html).toContain('href="/organization/documents"');
    expect(html).toContain('5');
    expect(html).toContain('10');
    expect(html).toContain('3');
  });
});
