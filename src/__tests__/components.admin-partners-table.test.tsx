import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children)
}));

vi.mock('@/server-actions/admin/partners', () => ({
  deactivatePartnerFormAction: vi.fn(),
  reactivatePartnerFormAction: vi.fn()
}));

import { PartnersTable } from '@/components/admin/partners-table';
import type { PartnerRow } from '@/lib/services/admin/partners';

function makeRow(overrides: Partial<PartnerRow> = {}): PartnerRow {
  return {
    id: 'p1',
    name: 'ООО Ромашка',
    slug: 'romashka',
    commissionRate: 0.15,
    isActive: true,
    activeOrgCount: 3,
    paidYTD: '150000',
    ...overrides
  };
}

describe('PartnersTable', () => {
  it('renders empty state when there are no rows', () => {
    const html = renderToString(React.createElement(PartnersTable, { rows: [] }));
    expect(html).toContain('Партнёров не найдено');
  });

  it('renders a partner row with formatted rate, currency, active dot, and edit link', () => {
    const rows = [makeRow()];
    const html = renderToString(React.createElement(PartnersTable, { rows }));
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('romashka');
    expect(html).toContain('15');
    expect(html).toContain('%');
    expect(html).toContain('href="/admin/partners/p1"');
    expect(html).toContain('Редактировать');
    expect(html).toContain('text-green-600');
    expect(html).toContain('Деактивировать');
  });

  it('renders "—" for null commissionRate', () => {
    const rows = [makeRow({ commissionRate: null })];
    const html = renderToString(React.createElement(PartnersTable, { rows }));
    expect(html).toContain('—');
  });

  it('renders inactive partner with gray dot and "Восстановить" action', () => {
    const rows = [makeRow({ id: 'p2', isActive: false })];
    const html = renderToString(React.createElement(PartnersTable, { rows }));
    expect(html).toContain('text-gray-300');
    expect(html).toContain('Восстановить');
    expect(html).not.toContain('Деактивировать');
  });

  it('renders paidYTD as currency and activeOrgCount', () => {
    const rows = [makeRow({ paidYTD: '99999.5', activeOrgCount: 7 })];
    const html = renderToString(React.createElement(PartnersTable, { rows }));
    expect(html).toContain('7');
    expect(html).toContain('99');
  });
});
