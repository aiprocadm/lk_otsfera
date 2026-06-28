import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/partner/dashboard', () => ({
  kpis: vi.fn(),
  attention: vi.fn(),
  recentEvents: vi.fn()
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import { kpis, attention, recentEvents } from '@/lib/services/partner/dashboard';
import { GET } from '@/app/api/partner/dashboard/route';

describe('GET /api/partner/dashboard', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('403 for non-partner', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'organization', organizationId: 'o' } as any);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns kpis + attention + events for partner', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
    } as any);
    vi.mocked(kpis).mockResolvedValue({ openOrders: 5, outstanding: '10000.00', activeLeads: 2, commissionThisMonth: '500.00' });
    vi.mocked(attention).mockResolvedValue({ stuckOrders: [], overdueOrders: [], staleLeads: [] });
    vi.mocked(recentEvents).mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.kpis.openOrders).toBe(5);
    expect(body.kpis.outstanding).toBe('10000.00');
    expect(body.attention).toBeDefined();
    expect(body.events).toEqual([]);

    expect(kpis).toHaveBeenCalledWith(expect.anything(), { partnerId: 'p1', scopeOrgIds: [] });
  });

  it('passes assignedOrgIds to scope when partner is scoped manager', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'manager', assignedOrgIds: ['oA', 'oB']
    } as any);
    vi.mocked(kpis).mockResolvedValue({ openOrders: 0, outstanding: '0.00', activeLeads: 0, commissionThisMonth: '0.00' });
    vi.mocked(attention).mockResolvedValue({ stuckOrders: [], overdueOrders: [], staleLeads: [] });
    vi.mocked(recentEvents).mockResolvedValue([]);

    await GET();
    expect(kpis).toHaveBeenCalledWith(expect.anything(), { partnerId: 'p1', scopeOrgIds: ['oA', 'oB'] });
  });

  it('defaults scopeOrgIds to [] when assignedOrgIds is null/undefined', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'admin'
      // assignedOrgIds intentionally omitted → undefined
    } as any);
    vi.mocked(kpis).mockResolvedValue({ openOrders: 0, outstanding: '0.00', activeLeads: 0, commissionThisMonth: '0.00' });
    vi.mocked(attention).mockResolvedValue({ stuckOrders: [], overdueOrders: [], staleLeads: [] });
    vi.mocked(recentEvents).mockResolvedValue([]);

    await GET();
    expect(kpis).toHaveBeenCalledWith(expect.anything(), { partnerId: 'p1', scopeOrgIds: [] });
  });
});
