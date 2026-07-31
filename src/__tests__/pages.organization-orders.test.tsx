// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import OrganizationOrdersPage from '@/app/organization/orders/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listOrgOrders } = vi.hoisted(() => ({ listOrgOrders: vi.fn() }));
vi.mock('@/lib/services/organization/orders', () => ({ listOrgOrders }));

// org-orders-filter ('use client') calls useRouter()/useSearchParams(), which
// require a mounted Next app-router context unavailable under jsdom + RTL.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-app-shell' },
      props.activeOrgName,
      props.children
    ),
}));

const CTX = {
  session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
  activeOrgId: 'org-1',
  activeOrgName: 'ООО Ромашка',
  memberships: [],
  viewerRole: 'admin' as const,
};

describe('OrganizationOrdersPage', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    listOrgOrders.mockReset();
  });

  it('applies valid execution/financial status filters and pagination params', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    listOrgOrders.mockResolvedValue({ rows: [], total: 0 });

    await renderServerComponent(
      OrganizationOrdersPage({
        searchParams: Promise.resolve({
          org: 'org-1',
          search: 'test',
          execution: 'in_progress',
          financial: 'paid',
          take: '10',
          skip: '5',
        }),
      })
    );

    expect(listOrgOrders).toHaveBeenCalledWith(
      {},
      {
        organizationId: 'org-1',
        search: 'test',
        executionStatus: 'in_progress',
        financialStatus: 'paid',
        take: 10,
        skip: 5,
      }
    );
  });

  it('ignores invalid execution/financial values and clamps take to MAX_TAKE with defaults', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    listOrgOrders.mockResolvedValue({ rows: [], total: 3 });

    const { container } = await renderServerComponent(
      OrganizationOrdersPage({
        searchParams: Promise.resolve({ execution: 'bogus', financial: 'bogus', take: '99999' }),
      })
    );

    expect(listOrgOrders).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        executionStatus: undefined,
        financialStatus: undefined,
        take: 100,
        skip: 0,
      })
    );
    expect(container.textContent).toContain('Заказы');
    expect(container.textContent).toContain('3 заказа');
  });

  it('renders with default (empty) searchParams', async () => {
    getOrgPageContext.mockResolvedValue(CTX);
    listOrgOrders.mockResolvedValue({ rows: [], total: 0 });

    await renderServerComponent(OrganizationOrdersPage({ searchParams: Promise.resolve({}) }));

    expect(listOrgOrders).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        take: 25,
        skip: 0,
      })
    );
  });
});
