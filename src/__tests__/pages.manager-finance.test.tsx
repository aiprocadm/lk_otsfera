// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerFinancePage from '@/app/manager/finance/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));

const { getManagerFinanceOverview } = vi.hoisted(() => ({ getManagerFinanceOverview: vi.fn() }));
vi.mock('@/lib/services/manager/finance', () => ({ getManagerFinanceOverview }));

vi.mock('@/components/manager/manager-finance-view', () => ({
  ManagerFinanceView: (props: { data: unknown; ordersBasePath?: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'finance-view' },
      props.ordersBasePath,
      JSON.stringify(props.data)
    ),
}));

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  managerRole: 'member' as const,
  companyId: 'c1',
};

describe('ManagerFinancePage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    getCompanyTeamVisibility.mockReset();
    getManagerFinanceOverview.mockReset();
  });

  it('reads teamMode live and passes /manager base path to the view', async () => {
    requireManager.mockResolvedValue(SESSION);
    getCompanyTeamVisibility.mockResolvedValue(false);
    getManagerFinanceOverview.mockResolvedValue({
      summary: { totalDebt: '0.00' },
      sections: [],
      canSeeCommission: false,
    });

    const { container } = await renderServerComponent(ManagerFinancePage());

    expect(requireManager).toHaveBeenCalled();
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    expect(getManagerFinanceOverview).toHaveBeenCalledWith({}, SESSION, { teamMode: false });
    expect(container.textContent).toContain('Финансы');
    expect(container.textContent).toContain('/manager');
  });

  it('passes teamMode:true through to the overview call', async () => {
    requireManager.mockResolvedValue(SESSION);
    getCompanyTeamVisibility.mockResolvedValue(true);
    getManagerFinanceOverview.mockResolvedValue({
      summary: { totalDebt: '500.00' },
      sections: [],
      canSeeCommission: true,
    });

    await renderServerComponent(ManagerFinancePage());

    expect(getManagerFinanceOverview).toHaveBeenCalledWith({}, SESSION, { teamMode: true });
  });
});
