// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { kpis, attention, recentEvents } = vi.hoisted(() => ({
  kpis: vi.fn(),
  attention: vi.fn(),
  recentEvents: vi.fn()
}));
vi.mock('@/lib/services/partner/dashboard', () => ({ kpis, attention, recentEvents }));

import PartnerDashboard from '@/app/partner/dashboard/page';

const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', assignedOrgIds: ['org-1'] };

describe('PartnerDashboard', () => {
  beforeEach(() => {
    requirePartner.mockReset();
    kpis.mockReset();
    attention.mockReset();
    recentEvents.mockReset();
  });

  it('renders KPIs, attention items, and events using the assigned-org scope', async () => {
    requirePartner.mockResolvedValue(SESSION);
    kpis.mockResolvedValue({
      openOrders: 5,
      outstanding: '1000.00',
      activeLeads: 2,
      commissionThisMonth: '300.00'
    });
    attention.mockResolvedValue({ stuckOrders: [], overdueOrders: [], staleLeads: [] });
    recentEvents.mockResolvedValue([]);

    const { container } = await renderServerComponent(PartnerDashboard());

    expect(kpis).toHaveBeenCalledWith(
      expect.anything(),
      { partnerId: 'p1', scopeOrgIds: ['org-1'] }
    );
    expect(attention).toHaveBeenCalledWith(
      expect.anything(),
      { partnerId: 'p1', scopeOrgIds: ['org-1'] }
    );
    expect(recentEvents).toHaveBeenCalledWith(
      expect.anything(),
      { partnerId: 'p1', scopeOrgIds: ['org-1'] },
      10
    );
    expect(container.textContent).toContain('Кабинет партнёра');
  });

  it('falls back to an empty scope array when the session has no assignedOrgIds', async () => {
    requirePartner.mockResolvedValue({ ...SESSION, assignedOrgIds: undefined });
    kpis.mockResolvedValue({
      openOrders: 0,
      outstanding: '0.00',
      activeLeads: 0,
      commissionThisMonth: '0.00'
    });
    attention.mockResolvedValue({
      stuckOrders: [{ id: 'o1', title: 'Заказ', updatedAt: new Date('2024-01-01') }],
      overdueOrders: [],
      staleLeads: []
    });
    recentEvents.mockResolvedValue([
      { kind: 'lead_created', title: 'Новый лид', at: new Date('2024-01-01'), ref: { kind: 'lead', id: 'l1' } }
    ]);

    await renderServerComponent(PartnerDashboard());

    expect(kpis).toHaveBeenCalledWith(
      expect.anything(),
      { partnerId: 'p1', scopeOrgIds: [] }
    );
  });
});
