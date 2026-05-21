import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/policy', async () => {
  const actual = await vi.importActual<any>('@/lib/auth/policy');
  return { ...actual, canPartnerAccessOrg: vi.fn() };
});
vi.mock('@/lib/services/partner/rateOverride', () => ({
  setOrgCommissionRate: vi.fn(),
  clearOrgCommissionRate: vi.fn()
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { setOrgCommissionRate, clearOrgCommissionRate } from '@/lib/services/partner/rateOverride';
import { PUT } from '@/app/api/partner/portfolio/[orgId]/rate/route';

const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) });
const body = (b: unknown) => new Request('http://x/', { method: 'PUT', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } });

describe('PUT /api/partner/portfolio/[orgId]/rate', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await PUT(body({ rate: 0.1, reason: 'x' }), ctx('o1'))).status).toBe(401);
  });

  it('403 if not partner admin', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'manager'
    } as any);
    expect((await PUT(body({ rate: 0.1, reason: 'x' }), ctx('o1'))).status).toBe(403);
  });

  it('403 if admin but org outside partner scope', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
    } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(false);

    expect((await PUT(body({ rate: 0.1, reason: 'x' }), ctx('o1'))).status).toBe(403);
  });

  it('400 on invalid payload (no rate, no reason)', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
    } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(true);

    expect((await PUT(body({}), ctx('o1'))).status).toBe(400);
    expect((await PUT(body({ rate: 0.1 }), ctx('o1'))).status).toBe(400);
  });

  it('204 on successful set with rate', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'admin-user', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
    } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(true);

    const res = await PUT(body({ rate: 0.08, reason: 'VIP' }), ctx('o1'));
    expect(res.status).toBe(204);
    expect(setOrgCommissionRate).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1', partnerId: 'p1', newRate: 0.08, reason: 'VIP', changedByUserId: 'admin-user'
    });
  });

  it('204 on clear (rate=null)', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'admin-user', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
    } as any);
    vi.mocked(canPartnerAccessOrg).mockResolvedValue(true);

    const res = await PUT(body({ rate: null, reason: 'возврат к базе' }), ctx('o1'));
    expect(res.status).toBe(204);
    expect(clearOrgCommissionRate).toHaveBeenCalled();
  });
});
