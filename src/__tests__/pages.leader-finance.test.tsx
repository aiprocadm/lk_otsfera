// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getManagerFinanceOverview } = vi.hoisted(() => ({ getManagerFinanceOverview: vi.fn() }));
vi.mock('@/lib/services/manager/finance', () => ({ getManagerFinanceOverview }));

vi.mock('@/components/manager/manager-finance-view', () => ({
  ManagerFinanceView: (props: { data: unknown; ordersBasePath?: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'finance-view' },
      props.ordersBasePath,
      JSON.stringify(props.data)
    )
}));

import LeaderFinancePage from '@/app/leader/finance/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'leader' as const, companyId: 'c1' };

describe('LeaderFinancePage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    getManagerFinanceOverview.mockReset();
  });

  it('fetches company-wide finance overview (teamMode:true) and passes leader base path to the view', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    getManagerFinanceOverview.mockResolvedValue({
      summary: { totalDebt: '0.00' },
      sections: [],
      canSeeCommission: true
    });

    const { container } = await renderServerComponent(LeaderFinancePage());

    expect(requireManagerLeader).toHaveBeenCalled();
    expect(getManagerFinanceOverview).toHaveBeenCalledWith({}, SESSION, { teamMode: true });
    expect(container.textContent).toContain('Финансы');
    expect(container.textContent).toContain('/leader');
  });
});
