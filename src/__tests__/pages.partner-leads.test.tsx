// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listLeads } = vi.hoisted(() => ({ listLeads: vi.fn() }));
vi.mock('@/lib/services/partner/leads', () => ({ listLeads }));

// LeadsSearch ('use client') calls useRouter()/useSearchParams().
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

import PartnerLeadsPage from '@/app/partner/leads/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', assignedOrgIds: ['org-1'] };

const BASE_ROW = {
  id: 'l1',
  clientCompanyName: 'ООО Клиент',
  clientInn: null,
  clientContactName: 'Иванов И.И.',
  subject: 'Обучение по ОТ',
  status: 'new' as const,
  estimatedAmount: null,
  productType: [],
  organizationId: null,
  organizationName: null,
  promotedOrderId: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01')
};

describe('PartnerLeadsPage', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    listLeads.mockReset();
  });

  it('applies default pagination, undefined status for unrecognized values, and hides the paginator when pages<=1', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listLeads.mockResolvedValue({ rows: [], total: 0, countsByStatus: {} });

    const { container } = await renderServerComponent(
      PartnerLeadsPage({ searchParams: Promise.resolve({ status: 'bogus' }) })
    );

    expect(listLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        partnerId: 'p1',
        scopeOrgIds: ['org-1'],
        status: undefined,
        take: 25,
        skip: 0
      })
    );
    expect(container.textContent).toContain('Заявки');
    expect(container.textContent).toContain('0 заявок');
    // pages === 1 -> no paginator rendered
    expect(container.textContent).not.toContain('Страница');
  });

  it('parses a valid status filter, no org scope when empty, shows search hint, and renders the paginator with a "Назад" link when skip>0', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, assignedOrgIds: [] });
    listLeads.mockResolvedValue({
      rows: [BASE_ROW],
      total: 60,
      countsByStatus: { new: 40, qualified: 20 }
    });

    const { container } = await renderServerComponent(
      PartnerLeadsPage({
        searchParams: Promise.resolve({ status: 'new', take: '20', search: 'клиент', skip: '25' })
      })
    );

    expect(listLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scopeOrgIds: undefined,
        status: 'new',
        search: 'клиент',
        take: 20,
        skip: 25
      })
    );
    expect(container.textContent).toContain('по запросу «клиент»');
    expect(container.textContent).toContain('Страница');
    // skip>0 -> "Назад" link renders
    expect(container.textContent).toContain('Назад');
  });

  it('clamps take to MAX_TAKE when an oversized value is requested', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listLeads.mockResolvedValue({ rows: [], total: 0, countsByStatus: {} });

    await renderServerComponent(
      PartnerLeadsPage({ searchParams: Promise.resolve({ take: '5000' }) })
    );

    expect(listLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ take: 100 })
    );
  });

  it('renders the "Вперёд" link when more pages remain after the current one', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listLeads.mockResolvedValue({
      rows: [BASE_ROW],
      total: 60,
      countsByStatus: { new: 60 }
    });

    const { container } = await renderServerComponent(
      PartnerLeadsPage({ searchParams: Promise.resolve({ take: '25', skip: '0' }) })
    );

    expect(container.textContent).toContain('Вперёд');
    expect(container.textContent).not.toContain('Назад');
  });

  it('pluralizes grandTotal=1 as "заявка" (mod10===1 && mod100!==11 branch)', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listLeads.mockResolvedValue({ rows: [], total: 0, countsByStatus: { new: 1 } });

    const { container } = await renderServerComponent(
      PartnerLeadsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('1 заявка');
  });

  it('pluralizes grandTotal=3 as "заявки" (mod10 2-4, not 12-14, branch)', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listLeads.mockResolvedValue({ rows: [], total: 0, countsByStatus: { new: 3 } });

    const { container } = await renderServerComponent(
      PartnerLeadsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('3 заявки');
  });

  it('pluralizes grandTotal=11 as "заявок" (mod100===11 exception to the "one" branch)', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listLeads.mockResolvedValue({ rows: [], total: 0, countsByStatus: { new: 11 } });

    const { container } = await renderServerComponent(
      PartnerLeadsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('11 заявок');
  });

  it('pluralizes grandTotal=14 as "заявок" (mod10=4 but mod100=14 is within the 12-14 exception)', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listLeads.mockResolvedValue({ rows: [], total: 0, countsByStatus: { new: 14 } });

    const { container } = await renderServerComponent(
      PartnerLeadsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('14 заявок');
  });

  it('treats an undefined per-status count as 0 in the grandTotal reduce', async () => {
    requirePartner.mockResolvedValue(SESSION);
    listLeads.mockResolvedValue({
      rows: [],
      total: 0,
      countsByStatus: { new: undefined, qualified: 2 }
    });

    const { container } = await renderServerComponent(
      PartnerLeadsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('2 заявки');
  });
});
