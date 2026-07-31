// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getOrgFinanceKpis, listOrgPayments } = vi.hoisted(() => ({
  getOrgFinanceKpis: vi.fn(),
  listOrgPayments: vi.fn(),
}));
vi.mock('@/lib/services/organization/finance', () => ({ getOrgFinanceKpis, listOrgPayments }));

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-app-shell' },
      props.activeOrgName,
      props.children
    ),
}));

import OrganizationFinancePage from '@/app/organization/finance/page';

const CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const,
};

describe('OrganizationFinancePage', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    getOrgFinanceKpis.mockReset();
    listOrgPayments.mockReset();
  });

  it('fetches KPIs and payments scoped to the active org and renders the finance sections', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgFinanceKpis.mockResolvedValue({ billed: '1000', paid: '500', outstanding: '500' });
    listOrgPayments.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      OrganizationFinancePage({ searchParams: Promise.resolve({ org: 'org-1' }) })
    );

    expect(getOrgPageContext).toHaveBeenCalledWith({ org: 'org-1' });
    expect(getOrgFinanceKpis).toHaveBeenCalledWith({}, 'org-1');
    expect(listOrgPayments).toHaveBeenCalledWith({}, { organizationId: 'org-1' });
    expect(container.textContent).toContain('Финансы');
    expect(container.textContent).toContain('ООО Ромашка');
  });

  it('renders with empty searchParams', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgFinanceKpis.mockResolvedValue({ billed: '0', paid: '0', outstanding: '0' });
    listOrgPayments.mockResolvedValue([]);

    await renderServerComponent(OrganizationFinancePage({ searchParams: Promise.resolve({}) }));

    expect(getOrgPageContext).toHaveBeenCalledWith({});
  });
});

// ─── Этап 9 PR-3 (ФТ-12.2): кнопка выгрузки платежей клиентом ────────────────

describe('OrganizationFinancePage — выгрузка в Excel', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    getOrgFinanceKpis.mockReset();
    listOrgPayments.mockReset();
    getOrgPageContext.mockResolvedValue(CTX);
    getOrgFinanceKpis.mockResolvedValue({ billed: '1000', paid: '500', outstanding: '500' });
    listOrgPayments.mockResolvedValue([]);
  });

  it('ссылка ведёт на клиентский роут и несёт активную организацию', async () => {
    const { container } = await renderServerComponent(
      OrganizationFinancePage({ searchParams: Promise.resolve({ org: 'org-1' }) })
    );
    const href = container
      .querySelector('a[href*="/api/organization/finance/export"]')!
      .getAttribute('href')!;
    expect(href).toContain('org=org-1');
  });
});
