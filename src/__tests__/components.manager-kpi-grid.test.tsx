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
  activeOrdersDelta: 0,
  attentionCount: 0,
  unreadComments: 2,
  urgentDeadlines: 1,
};

describe('ManagerKpiGrid', () => {
  it('delta === 0 renders the ±0 label', () => {
    const html = renderToString(React.createElement(ManagerKpiGrid, { data: base }));
    expect(html).toContain('±0 / 30д');
  });

  it('positive delta renders a leading +', () => {
    const html = renderToString(
      React.createElement(ManagerKpiGrid, { data: { ...base, activeOrdersDelta: 3 } })
    );
    expect(html).toContain('+3 / 30д');
  });

  it('negative delta renders without an extra sign (native minus)', () => {
    const html = renderToString(
      React.createElement(ManagerKpiGrid, { data: { ...base, activeOrdersDelta: -2 } })
    );
    expect(html).toContain('-2 / 30д');
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
