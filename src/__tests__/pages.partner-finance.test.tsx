// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

const { isPartnerAdmin } = vi.hoisted(() => ({ isPartnerAdmin: vi.fn() }));
vi.mock('@/lib/auth/policy', () => ({ isPartnerAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getFinanceKpis, listStatements } = vi.hoisted(() => ({
  getFinanceKpis: vi.fn(),
  listStatements: vi.fn()
}));
vi.mock('@/lib/services/partner/finance', () => ({ getFinanceKpis, listStatements }));

// ManualCalcForm / CommissionStatementsList ('use client') use useFormAction ->
// useRouter() and useClientResource -- stub next/navigation.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

import FinancePage from '@/app/partner/finance/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1' };

describe('FinancePage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    isPartnerAdmin.mockReset();
    getFinanceKpis.mockReset();
    listStatements.mockReset();
  });

  it('renders KPIs and statements, showing ManualCalcForm for a partner admin', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getFinanceKpis.mockResolvedValue({
      earnedTotal: 1000,
      pendingTotal: 200,
      paidTotal: 800
    });
    listStatements.mockResolvedValue([
      {
        id: 's1',
        periodFrom: new Date('2024-01-01'),
        periodTo: new Date('2024-01-31'),
        status: 'draft' as const,
        totalCommissionAmount: '500.00',
        pdfPath: null,
        xlsxPath: null,
        itemCount: 3
      }
    ]);
    isPartnerAdmin.mockReturnValue(true);

    const { container } = await renderServerComponent(FinancePage());

    expect(getFinanceKpis).toHaveBeenCalledWith(expect.anything(), 'p1');
    expect(listStatements).toHaveBeenCalledWith(expect.anything(), { partnerId: 'p1', take: 30 });
    expect(container.textContent).toContain('Финансы');
    expect(container.textContent).toContain('Отчёты');
  });

  it('hides ManualCalcForm and the "Отчёты" list for a non-admin partner member with no statements', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getFinanceKpis.mockResolvedValue({
      earnedTotal: 0,
      pendingTotal: 0,
      paidTotal: 0
    });
    listStatements.mockResolvedValue([]);
    isPartnerAdmin.mockReturnValue(false);

    const { container } = await renderServerComponent(FinancePage());

    expect(container.textContent).toContain('Финансы');
    expect(container.textContent).toContain('Отчётов ещё нет.');
  });
});
