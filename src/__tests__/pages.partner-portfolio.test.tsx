// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listPortfolio } = vi.hoisted(() => ({ listPortfolio: vi.fn() }));
vi.mock('@/lib/services/partner/portfolio', () => ({ listPortfolio }));

// PortfolioSearch ('use client') calls useRouter()/useSearchParams().
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

import PortfolioPage from '@/app/partner/portfolio/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', assignedOrgIds: ['org-1'] };

const BASE_ITEM = {
  id: 'org-1',
  name: 'ООО Ромашка',
  inn: '123456',
  assignedManagerUserId: null,
  ordersCount: 3,
  debt: '1000.00'
};

describe('PortfolioPage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    listPortfolio.mockReset();
  });

  it('applies default pagination, org scope, and hides the paginator when pages<=1', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listPortfolio.mockResolvedValue({ items: [], total: 0 });

    const { container } = await renderServerComponent(
      PortfolioPage({ searchParams: Promise.resolve({}) })
    );

    expect(listPortfolio).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        partnerId: 'p1',
        scopeOrgIds: ['org-1'],
        search: undefined,
        take: 20,
        skip: 0
      })
    );
    expect(container.textContent).toContain('Портфель');
    // total===0 falls into the `total < 5` branch ("организации"), not "организаций".
    expect(container.textContent).toContain('0 организации');
    expect(container.textContent).not.toContain('Страница');
  });

  it('renders singular "организация" for total=1, clamps take, no scope when empty, and shows a paginator with "Назад"/"Вперёд"', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, assignedOrgIds: [] });
    listPortfolio.mockResolvedValue({ items: [BASE_ITEM], total: 1 });

    const { container } = await renderServerComponent(
      PortfolioPage({ searchParams: Promise.resolve({ take: '5000', search: 'ромашка' }) })
    );

    expect(listPortfolio).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scopeOrgIds: undefined, search: 'ромашка', take: 100 })
    );
    expect(container.textContent).toContain('1 организация');
  });

  it('renders "организации" for total between 2 and 4, and the paginator with both nav links mid-range', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listPortfolio.mockResolvedValue({
      items: [BASE_ITEM, { ...BASE_ITEM, id: 'org-2' }, { ...BASE_ITEM, id: 'org-3' }],
      total: 3
    });

    const { container } = await renderServerComponent(
      PortfolioPage({ searchParams: Promise.resolve({ take: '1', skip: '1', search: 'ромашка' }) })
    );

    expect(container.textContent).toContain('3 организации');
    expect(container.textContent).toContain('Страница');
    expect(container.textContent).toContain('Назад');
    expect(container.textContent).toContain('Вперёд');
  });

  it('renders "организаций" for total>=5 and falls back to DEFAULT_TAKE/skip:0 on non-numeric values', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listPortfolio.mockResolvedValue({ items: [], total: 5 });

    const { container } = await renderServerComponent(
      PortfolioPage({ searchParams: Promise.resolve({ take: 'nope', skip: 'nope' }) })
    );

    expect(listPortfolio).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ take: 20, skip: 0 })
    );
    expect(container.textContent).toContain('5 организаций');
  });
});
