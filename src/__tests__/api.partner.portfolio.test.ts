import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/partner/portfolio', () => ({ listPortfolio: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import { listPortfolio } from '@/lib/services/partner/portfolio';
import { GET } from '@/app/api/partner/portfolio/route';

function req(qs: string = '') {
  return new Request(`http://localhost/api/partner/portfolio${qs}`);
}

describe('GET /api/partner/portfolio', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
  });

  it('403 non-partner', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'admin' } as any);
    expect((await GET(req())).status).toBe(403);
  });

  it('returns paginated items with default take=20, skip=0', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u',
      role: 'partner',
      partnerId: 'p1',
      partnerRole: 'admin',
      assignedOrgIds: [],
    } as any);
    vi.mocked(listPortfolio).mockResolvedValue({
      items: [
        {
          id: 'o1',
          name: 'Org1',
          inn: null,
          assignedManagerUserId: null,
          ordersCount: 0,
          debt: '0.00',
        },
      ],
      total: 1,
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].name).toBe('Org1');

    expect(listPortfolio).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1',
      scopeOrgIds: undefined,
      search: undefined,
      take: 20,
      skip: 0,
    });
  });

  it('parses take/skip/search query params and caps take at 100', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u',
      role: 'partner',
      partnerId: 'p1',
      partnerRole: 'admin',
      assignedOrgIds: [],
    } as any);
    vi.mocked(listPortfolio).mockResolvedValue({ items: [], total: 0 });

    await GET(req('?take=500&skip=10&search=ООО'));

    expect(listPortfolio).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1',
      scopeOrgIds: undefined,
      search: 'ООО',
      take: 100,
      skip: 10,
    });
  });

  it('passes assignedOrgIds as scope for scoped manager', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u',
      role: 'partner',
      partnerId: 'p1',
      partnerRole: 'manager',
      assignedOrgIds: ['oA', 'oB'],
    } as any);
    vi.mocked(listPortfolio).mockResolvedValue({ items: [], total: 0 });

    await GET(req());

    expect(listPortfolio).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scopeOrgIds: ['oA', 'oB'],
      })
    );
  });

  it('uses fallback for negative skip (parsePositiveInt returns fallback when value < 0)', async () => {
    vi.mocked(getSession).mockResolvedValue({
      sub: 'u',
      role: 'partner',
      partnerId: 'p1',
      partnerRole: 'admin',
      assignedOrgIds: [],
    } as any);
    vi.mocked(listPortfolio).mockResolvedValue({ items: [], total: 0 });

    await GET(req('?skip=-5&take=-1'));

    // Negative values should fall back to defaults: skip=0, take=20
    expect(listPortfolio).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        skip: 0,
        take: 20,
      })
    );
  });
});
