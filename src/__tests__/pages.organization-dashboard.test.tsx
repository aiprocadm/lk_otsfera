// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { kpis, attention, recentEvents } = vi.hoisted(() => ({
  kpis: vi.fn(),
  attention: vi.fn(),
  recentEvents: vi.fn()
}));
vi.mock('@/lib/services/organization/dashboard', () => ({ kpis, attention, recentEvents }));

// OrgAppShell renders the sidebar/nav chrome — it is a plain (non-async) function
// component with its own dedicated coverage, so we mock it here to keep this test
// focused on the page's own data-fetch/branching logic.
vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'org-app-shell' }, props.activeOrgName, props.children)
}));

import OrganizationDashboardPage from '@/app/organization/dashboard/page';

const CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const
};

describe('OrganizationDashboardPage', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    kpis.mockReset();
    attention.mockReset();
    recentEvents.mockReset();
  });

  it('resolves org context from searchParams and renders KPI/attention/events sections', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    kpis.mockResolvedValue({ activeOrders: 3, totalStudents: 10, outstandingDebt: '0' });
    attention.mockResolvedValue({ items: [] });
    recentEvents.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      OrganizationDashboardPage({ searchParams: Promise.resolve({ org: 'org-1' }) })
    );

    expect(getOrgPageContext).toHaveBeenCalledWith({ org: 'org-1' });
    expect(kpis).toHaveBeenCalledWith({}, 'org-1');
    expect(attention).toHaveBeenCalledWith({}, 'org-1');
    expect(recentEvents).toHaveBeenCalledWith({}, 'org-1');
    expect(container.textContent).toContain('Главная');
    expect(container.textContent).toContain('ООО Ромашка');
  });

  it('renders with empty searchParams (no org query param)', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    kpis.mockResolvedValue({});
    attention.mockResolvedValue({ items: [] });
    recentEvents.mockResolvedValue([]);

    await renderServerComponent(
      OrganizationDashboardPage({ searchParams: Promise.resolve({}) })
    );

    expect(getOrgPageContext).toHaveBeenCalledWith({});
  });
});
