import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/policy', async () => {
  const actual = await vi.importActual<any>('@/lib/auth/policy');
  return { ...actual, canPartnerAccessOrg: vi.fn() };
});
vi.mock('@/lib/services/partner/orgCard', () => ({ getOrgCard: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { getOrgCard } from '@/lib/services/partner/orgCard';
import { GET } from '@/app/api/partner/portfolio/[orgId]/route';

const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) });

describe('GET /api/partner/portfolio/[orgId]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET(new Request('http://x/'), ctx('o1'));
    expect(res.status).toBe(401);
  });

  it('403 when session role is not partner', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u',
      role: 'organization',
      organizationId: 'o1',
    } as any);
    const res = await GET(new Request('http://x/'), ctx('o1'));
    expect(res.status).toBe(403);
    expect(canPartnerAccessOrg).not.toHaveBeenCalled();
  });

  it('403 if partner has no scope for this org', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'partner', partnerId: 'p1' } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(false);

    const res = await GET(new Request('http://x/'), ctx('o1'));
    expect(res.status).toBe(403);
    expect(getOrgCard).not.toHaveBeenCalled();
  });

  it('404 if org does not exist', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'partner', partnerId: 'p1' } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(true);
    vi.mocked(getOrgCard).mockResolvedValue(null);

    const res = await GET(new Request('http://x/'), ctx('o1'));
    expect(res.status).toBe(404);
  });

  it('200 with card data on success', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'partner', partnerId: 'p1' } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(true);
    vi.mocked(getOrgCard).mockResolvedValue({
      id: 'o1',
      name: 'X',
      inn: '1',
      kpp: null,
      legalName: 'X LLC',
      assignedManagerUserId: null,
      partnerCommissionRate: null,
      partnerCommissionRateNote: null,
      kpi: { ordersCount: 0, debt: '0.00' },
    });

    const res = await GET(new Request('http://x/'), ctx('o1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('X');
  });
});
