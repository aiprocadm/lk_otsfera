// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listPartnerOrders } = vi.hoisted(() => ({ listPartnerOrders: vi.fn() }));
vi.mock('@/lib/services/partner/orders', () => ({ listPartnerOrders }));

// PartnerOrdersFilter ('use client') calls useRouter()/useSearchParams() -- stub next/navigation.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import PartnerDealsPage from '@/app/partner/orders/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', assignedOrgIds: ['org-1'] };

describe('PartnerDealsPage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    listPartnerOrders.mockReset();
  });

  it('applies default pagination and passes undefined status filters when unrecognized', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listPartnerOrders.mockResolvedValue({ rows: [], total: 0 });

    const { container } = await renderServerComponent(
      PartnerDealsPage({
        searchParams: Promise.resolve({ execution: 'bogus', financial: 'bogus' }),
      })
    );

    expect(listPartnerOrders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        partnerId: 'p1',
        scopeOrgIds: ['org-1'],
        executionStatus: undefined,
        financialStatus: undefined,
        take: 25,
        skip: 0,
      })
    );
    expect(container.textContent).toContain('Заказы');
    expect(container.textContent).toContain('0 заказов');
  });

  it('parses valid filters, take/skip, and clamps to MAX_TAKE; no org scope when assignedOrgIds is empty', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, assignedOrgIds: [] });
    listPartnerOrders.mockResolvedValue({
      rows: [
        {
          id: 'd1',
          orderNumber: '2024-001',
          title: 'Обучение по ОТ',
          totalAmount: '1000.00',
          paidAmount: '0.00',
          debt: '1000.00',
          executionStatus: 'in_progress' as const,
          financialStatus: 'not_billed' as const,
          stage: { label: 'В работе', tone: 'neutral' as const },
          organizationName: 'ООО Ромашка',
          organizationId: 'org-1',
          createdAt: new Date('2024-01-01'),
          deadline: null,
          closedAt: null,
        },
      ],
      total: 1,
    });

    await renderServerComponent(
      PartnerDealsPage({
        searchParams: Promise.resolve({
          execution: 'in_progress',
          financial: 'paid',
          take: '500',
          skip: '10',
          search: 'foo',
        }),
      })
    );

    expect(listPartnerOrders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        partnerId: 'p1',
        scopeOrgIds: undefined,
        executionStatus: 'in_progress',
        financialStatus: 'paid',
        search: 'foo',
        take: 100,
        skip: 10,
      })
    );
  });

  it('falls back to DEFAULT_TAKE and skip:0 when take/skip are non-numeric', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listPartnerOrders.mockResolvedValue({ rows: [], total: 0 });

    await renderServerComponent(
      PartnerDealsPage({
        searchParams: Promise.resolve({ take: 'abc', skip: 'xyz' }),
      })
    );

    expect(listPartnerOrders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ take: 25, skip: 0 })
    );
  });
});
