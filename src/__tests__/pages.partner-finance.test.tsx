// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

const { isPartnerAdmin } = vi.hoisted(() => ({ isPartnerAdmin: vi.fn() }));
vi.mock('@/lib/auth/policy', () => ({ isPartnerAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getFinanceKpis, listStatements, countStatements } = vi.hoisted(() => ({
  getFinanceKpis: vi.fn(),
  listStatements: vi.fn(),
  countStatements: vi.fn(),
}));
vi.mock('@/lib/services/partner/finance', () => ({
  getFinanceKpis,
  listStatements,
  countStatements,
}));

// ManualCalcForm / CommissionStatementsList ('use client') use useFormAction ->
// useRouter() and useClientResource -- stub next/navigation.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import FinancePage from '@/app/partner/finance/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1' };

const STATEMENT = {
  id: 's1',
  periodFrom: new Date('2024-01-01'),
  periodTo: new Date('2024-01-31'),
  status: 'draft' as const,
  totalCommissionAmount: '500.00',
  pdfPath: null,
  xlsxPath: null,
  itemCount: 3,
};

function render(sp: Record<string, string> = {}) {
  return renderServerComponent(FinancePage({ searchParams: Promise.resolve(sp) }));
}

describe('FinancePage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    isPartnerAdmin.mockReset();
    getFinanceKpis.mockReset();
    listStatements.mockReset();
    countStatements.mockReset();
    countStatements.mockResolvedValue(0);
  });

  it('renders KPIs and statements, showing ManualCalcForm for a partner admin', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getFinanceKpis.mockResolvedValue({
      earnedTotal: 1000,
      pendingTotal: 200,
      paidTotal: 800,
    });
    listStatements.mockResolvedValue([STATEMENT]);
    countStatements.mockResolvedValue(1);
    isPartnerAdmin.mockReturnValue(true);

    const { container } = await render();

    expect(getFinanceKpis).toHaveBeenCalledWith(expect.anything(), 'p1');
    expect(listStatements).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1',
      skip: 0,
      take: 30,
    });
    expect(countStatements).toHaveBeenCalledWith(expect.anything(), { partnerId: 'p1' });
    expect(container.textContent).toContain('Финансы');
    expect(container.textContent).toContain('Отчёты');
    // Одна страница — пагинатор молчит.
    expect(container.textContent).not.toContain('Страница 1 из');
  });

  it('С-6 (хотфикс №5): при 45 отчётах показывает «Страница 1 из 2 · 45 всего» и «Вперёд»', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getFinanceKpis.mockResolvedValue({ earnedTotal: 0, pendingTotal: 0, paidTotal: 0 });
    listStatements.mockResolvedValue([STATEMENT]);
    countStatements.mockResolvedValue(45);
    isPartnerAdmin.mockReturnValue(false);

    const { container } = await render();

    expect(container.textContent).toContain('Страница 1 из 2 · 45 всего');
    const next = Array.from(container.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Вперёд')
    );
    expect(next?.getAttribute('href')).toBe('/partner/finance?take=30&skip=30');
  });

  it('С-6 (хотфикс №5): ?skip=30 уходит в сервис и рисует «Назад»', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getFinanceKpis.mockResolvedValue({ earnedTotal: 0, pendingTotal: 0, paidTotal: 0 });
    listStatements.mockResolvedValue([STATEMENT]);
    countStatements.mockResolvedValue(45);
    isPartnerAdmin.mockReturnValue(false);

    const { container } = await render({ skip: '30' });

    expect(listStatements).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1',
      skip: 30,
      take: 30,
    });
    expect(container.textContent).toContain('Страница 2 из 2');
    expect(container.textContent).toContain('Назад');
    expect(container.textContent).not.toContain('Вперёд');
  });

  it('С-6 (хотфикс №5): мусор и перебор в take/skip → 30 и 0, take не больше 100', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getFinanceKpis.mockResolvedValue({ earnedTotal: 0, pendingTotal: 0, paidTotal: 0 });
    listStatements.mockResolvedValue([]);
    isPartnerAdmin.mockReturnValue(false);

    await render({ take: 'abc', skip: '-5' });
    expect(listStatements).toHaveBeenLastCalledWith(expect.anything(), {
      partnerId: 'p1',
      skip: 0,
      take: 30,
    });

    await render({ take: '500', skip: '0' });
    expect(listStatements).toHaveBeenLastCalledWith(expect.anything(), {
      partnerId: 'p1',
      skip: 0,
      take: 100,
    });
  });

  it('hides ManualCalcForm and the "Отчёты" list for a non-admin partner member with no statements', async () => {
    requirePartner.mockResolvedValue(SESSION);
    getFinanceKpis.mockResolvedValue({
      earnedTotal: 0,
      pendingTotal: 0,
      paidTotal: 0,
    });
    listStatements.mockResolvedValue([]);
    isPartnerAdmin.mockReturnValue(false);

    const { container } = await render();

    expect(container.textContent).toContain('Финансы');
    expect(container.textContent).toContain('Отчётов ещё нет.');
  });
});
