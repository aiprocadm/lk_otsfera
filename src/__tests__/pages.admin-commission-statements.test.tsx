// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listAdminStatements, listPartnersForFilter } = vi.hoisted(() => ({
  listAdminStatements: vi.fn(),
  listPartnersForFilter: vi.fn(),
}));
vi.mock('@/lib/services/admin/commissionStatements', () => ({
  listAdminStatements,
  listPartnersForFilter,
}));

import AdminCommissionStatementsPage from '@/app/admin/commission-statements/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminCommissionStatementsPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    listAdminStatements.mockReset();
    listPartnersForFilter.mockReset();
  });

  it('parses status/partnerId/from/to filters and renders rows with same-month period + status badge', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listAdminStatements.mockResolvedValue([
      {
        id: 's1',
        partner: { name: 'Партнёр 1' },
        periodFrom: new Date('2024-01-01'),
        periodTo: new Date('2024-01-31'),
        status: 'draft',
        itemCount: 3,
        totalCommissionAmount: '1000',
      },
    ]);
    listPartnersForFilter.mockResolvedValue([{ id: 'p1', name: 'Партнёр 1' }]);

    const { container } = await renderServerComponent(
      AdminCommissionStatementsPage({
        searchParams: Promise.resolve({
          status: 'draft',
          partnerId: 'p1',
          from: '2024-01-01',
          to: '2024-01-31',
        }),
      })
    );

    expect(requireAdmin).toHaveBeenCalled();
    expect(listAdminStatements).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ status: 'draft', partnerId: 'p1', take: 100 })
    );
    expect(container.textContent).toContain('Комиссионные отчёты');
    expect(container.textContent).toContain('Партнёр 1');
    expect(container.textContent).toContain('Черновик');
    const link = container.querySelector('a[href="/admin/commission-statements/s1"]');
    expect(link).not.toBeNull();
  });

  it('ignores an invalid status and an invalid "from" date string, renders EmptyState when no rows', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listAdminStatements.mockResolvedValue([]);
    listPartnersForFilter.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminCommissionStatementsPage({
        searchParams: Promise.resolve({ status: 'bogus', from: 'not-a-date' }),
      })
    );

    expect(listAdminStatements).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        status: undefined,
        partnerId: undefined,
        from: undefined,
        to: undefined,
      })
    );
    expect(container.textContent).toContain('не найдены');
  });

  it('renders a cross-month period label and an unknown status badge fallback', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listAdminStatements.mockResolvedValue([
      {
        id: 's2',
        partner: { name: 'Партнёр 2' },
        periodFrom: new Date('2024-01-15'),
        periodTo: new Date('2024-02-15'),
        status: 'unknown_status',
        itemCount: 1,
        totalCommissionAmount: 'abc',
      },
    ]);
    listPartnersForFilter.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminCommissionStatementsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('unknown_status');
    expect(container.textContent).toContain('—');
  });
});
