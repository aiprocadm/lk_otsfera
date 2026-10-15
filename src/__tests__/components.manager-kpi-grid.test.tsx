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

import { ManagerKpiGrid } from '@/components/manager/manager-kpi-grid';
import type { KpiData } from '@/lib/services/manager/dashboard';

const base: KpiData = {
  activeOrders: 5,
  attentionCount: 0,
  unreadComments: 2,
  urgentDeadlines: 1,
};

describe('ManagerKpiGrid', () => {
  it('этап 4 ТЗ 13.10.2026 (`У-297`): понятные названия и у каждой плитки свой фильтр', () => {
    const html = renderToString(React.createElement(ManagerKpiGrid, { data: base }));
    expect(html).toContain('Заказы в работе');
    expect(html).toContain('Просроченные заказы');
    expect(html).toContain('Срок в ближайшие 3 дня');
    expect(html).toContain('href="/manager/orders?focus=active"');
    expect(html).toContain('href="/manager/orders?focus=overdue"');
    expect(html).toContain('href="/manager/orders?focus=due_soon"');
    // Ни одна заказная плитка не ведёт в список без фильтра.
    expect(html).not.toContain('href="/manager/orders"');
    // Прежние неясные подписи не вернулись.
    expect(html).not.toMatch(/Активные заказы|Требует внимания|Срочные дедлайны|\/ 30д/);
  });

  it('attentionCount > 0 sets accent on the card', () => {
    const html = renderToString(
      React.createElement(ManagerKpiGrid, { data: { ...base, attentionCount: 4 } })
    );
    expect(html).toContain('bg-[#F97316] border-[#EA580C]');
  });

  it('attentionCount === 0 does not set accent', () => {
    const html = renderToString(React.createElement(ManagerKpiGrid, { data: base }));
    // Only the plain white-card class should appear (no accent background)
    const accentCount = (html.match(/bg-\[#F97316\] border-\[#EA580C\]/g) ?? []).length;
    expect(accentCount).toBe(0);
  });
});
