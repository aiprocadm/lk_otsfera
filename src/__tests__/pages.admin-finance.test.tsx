// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

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
    ),
}));

import AdminFinancePage from '@/app/admin/finance/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminFinancePage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    getManagerFinanceOverview.mockReset();
  });

  it('fetches unscoped finance overview (teamMode:false) and passes /admin base path', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    getManagerFinanceOverview.mockResolvedValue({
      summary: { totalDebt: '0.00' },
      sections: [],
      canSeeCommission: true,
    });

    const { container } = await renderServerComponent(AdminFinancePage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(getManagerFinanceOverview).toHaveBeenCalledWith({}, SESSION, { teamMode: false });
    expect(container.textContent).toContain('Финансы');
    expect(container.textContent).toContain('/admin');
  });
});
